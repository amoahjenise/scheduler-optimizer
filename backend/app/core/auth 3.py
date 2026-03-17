"""Authentication and authorization middleware for multi-tenant support."""
import logging
import os
from typing import Optional, Annotated
from fastapi import Depends, HTTPException, Header, Request
from sqlalchemy.orm import Session
import jwt
from jwt import PyJWKClient
from functools import lru_cache

from app.db.deps import get_db
from app.models.organization import Organization, OrganizationMember, MemberRole
from app.core.config import settings

logger = logging.getLogger(__name__)

# Clerk JWKS URL for verifying JWTs
# The domain is extracted from the publishable key or set via env var
CLERK_JWKS_URL = os.getenv(
    "CLERK_JWKS_URL", 
    "https://helpful-parrot-18.clerk.accounts.dev/.well-known/jwks.json"
)


class AuthContext:
    """Context object containing authenticated user and organization info."""
    
    def __init__(
        self,
        user_id: str,
        user_email: Optional[str] = None,
        user_name: Optional[str] = None,
        organization_id: Optional[str] = None,
        organization: Optional[Organization] = None,
        membership: Optional[OrganizationMember] = None,
        is_authenticated: bool = False
    ):
        self.user_id = user_id
        self.user_email = user_email
        self.user_name = user_name
        self.organization_id = organization_id
        self.organization = organization
        self.membership = membership
        self.is_authenticated = is_authenticated
    
    @property
    def role(self) -> Optional[MemberRole]:
        return self.membership.role if self.membership else None
    
    @property
    def is_admin(self) -> bool:
        return self.membership and self.membership.role == MemberRole.ADMIN
    
    @property
    def can_manage(self) -> bool:
        return self.membership and self.membership.role in [MemberRole.ADMIN, MemberRole.MANAGER]
    
    def __repr__(self):
        return f"<AuthContext user={self.user_id} org={self.organization_id} role={self.role}>"


@lru_cache(maxsize=1)
def get_jwks_client():
    """Get cached JWKS client for Clerk JWT verification."""
    return PyJWKClient(CLERK_JWKS_URL)


def verify_clerk_token(token: str) -> dict:
    """
    Verify a Clerk JWT token and return the payload.
    
    Args:
        token: JWT bearer token from Authorization header
        
    Returns:
        Decoded JWT payload with user claims
        
    Raises:
        HTTPException: If token is invalid or expired
    """
    try:
        # Remove "Bearer " prefix if present
        if token.startswith("Bearer "):
            token = token[7:]
        
        # Get the signing key from Clerk's JWKS
        jwks_client = get_jwks_client()
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        
        # Decode and verify the token
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"verify_aud": False}  # Clerk doesn't always set audience
        )
        
        return payload
        
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        logger.warning(f"Invalid token: {e}")
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
    except Exception as e:
        logger.error(f"Token verification failed: {e}", exc_info=True)
        raise HTTPException(status_code=401, detail=f"Token verification failed: {str(e)}")


def get_optional_auth(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_organization_id: Optional[str] = Header(None, alias="X-Organization-ID"),
    db: Session = Depends(get_db)
) -> AuthContext:
    """
    Get optional authentication context. Returns unauthenticated context if no token.
    Use this for endpoints that work with or without auth.
    """
    if not authorization:
        return AuthContext(user_id="anonymous", is_authenticated=False)
    
    try:
        return _build_auth_context(authorization, x_organization_id, db)
    except HTTPException:
        return AuthContext(user_id="anonymous", is_authenticated=False)


def get_required_auth(
    request: Request,
    authorization: Optional[str] = Header(None, description="Bearer token from Clerk"),
    x_organization_id: Optional[str] = Header(None, alias="X-Organization-ID"),
    db: Session = Depends(get_db)
) -> AuthContext:
    """
    Get required authentication context. Raises 401 if not authenticated.
    Use this for endpoints that require authentication.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    return _build_auth_context(authorization, x_organization_id, db)


def get_org_required_auth(
    request: Request,
    authorization: Optional[str] = Header(None, description="Bearer token from Clerk"),
    x_organization_id: Optional[str] = Header(None, alias="X-Organization-ID", description="Organization ID"),
    db: Session = Depends(get_db)
) -> AuthContext:
    """
    Get authentication context with required organization membership.
    Raises 401 if not authenticated, 403 if not a member of the organization.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    auth = _build_auth_context(authorization, x_organization_id, db)
    
    if not auth.organization_id:
        raise HTTPException(status_code=400, detail="Organization ID is required")
    
    if not auth.membership:
        raise HTTPException(
            status_code=403, 
            detail="You are not a member of this organization"
        )
    
    if not auth.membership.is_active:
        raise HTTPException(
            status_code=403,
            detail="Your membership in this organization is inactive"
        )
    
    return auth


def get_manager_auth(
    auth: AuthContext = Depends(get_org_required_auth)
) -> AuthContext:
    """
    Get authentication context requiring manager or admin role.
    Use for endpoints that modify schedules, nurses, etc.
    """
    if not auth.can_manage:
        raise HTTPException(
            status_code=403,
            detail="Manager or admin role required for this action"
        )
    return auth


def get_admin_auth(
    auth: AuthContext = Depends(get_org_required_auth)
) -> AuthContext:
    """
    Get authentication context requiring admin role.
    Use for endpoints that manage organization settings and members.
    """
    if not auth.is_admin:
        raise HTTPException(
            status_code=403,
            detail="Admin role required for this action"
        )
    return auth


def _build_auth_context(
    authorization: str,
    organization_id: Optional[str],
    db: Session
) -> AuthContext:
    """Build the authentication context from token and org header."""
    
    # Verify the token
    payload = verify_clerk_token(authorization)
    
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token: missing user ID")
    
    # Extract user info from token
    user_email = payload.get("email") or payload.get("primary_email_address")
    user_name = None
    if payload.get("first_name") or payload.get("last_name"):
        user_name = f"{payload.get('first_name', '')} {payload.get('last_name', '')}".strip()
    
    # Build base context
    auth = AuthContext(
        user_id=user_id,
        user_email=user_email,
        user_name=user_name,
        is_authenticated=True
    )
    
    # If organization ID provided, check membership
    if organization_id:
        org = db.query(Organization).filter(
            Organization.id == organization_id,
            Organization.is_active == True
        ).first()
        
        if org:
            auth.organization_id = organization_id
            auth.organization = org
            
            # Check if user is a member
            membership = db.query(OrganizationMember).filter(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.user_id == user_id,
                OrganizationMember.is_active == True
            ).first()
            
            auth.membership = membership
    
    return auth


# Type aliases for cleaner dependency injection
OptionalAuth = Annotated[AuthContext, Depends(get_optional_auth)]
RequiredAuth = Annotated[AuthContext, Depends(get_required_auth)]
OrgAuth = Annotated[AuthContext, Depends(get_org_required_auth)]
ManagerAuth = Annotated[AuthContext, Depends(get_manager_auth)]
AdminAuth = Annotated[AuthContext, Depends(get_admin_auth)]
