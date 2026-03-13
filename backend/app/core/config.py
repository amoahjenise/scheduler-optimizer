from pydantic_settings import BaseSettings
import json

class Settings(BaseSettings):
    APP_NAME: str = "Scheduler Optimizer"
    DEBUG: bool = False
    DATABASE_URL: str
    ALLOW_ORIGINS: list[str] = []
    CLERK_SECRET_KEY: str
    CLERK_WEBHOOK_SIGNING_SECRET: str
    CLERK_PUBLIC_KEY: str
    FASTAPI_BACKEND_URL: str
    AWS_ACCESS_KEY_ID: str
    AWS_SECRET_ACCESS_KEY: str
    AWS_DEFAULT_REGION: str = 'us-east-1'
    OPENAI_API_KEY: str
    DEFAULT_PROMPT_ID: int = 0
    GLOBAL_PROMPT_ID: int = 1
    class Config:
        env_file = ".env"
        extra = "forbid"  # Optional: ensures no extra variables are silently accepted

    # Override the __init__ to parse comma-separated strings or JSON arrays for ALLOW_ORIGINS
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if isinstance(self.ALLOW_ORIGINS, str):
            # Try parsing as JSON first
            try:
                self.ALLOW_ORIGINS = json.loads(self.ALLOW_ORIGINS)
            except json.JSONDecodeError:
                # Fall back to comma-separated
                self.ALLOW_ORIGINS = [origin.strip() for origin in self.ALLOW_ORIGINS.split(",")]

settings = Settings()
