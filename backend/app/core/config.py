from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    APP_NAME: str = "Scheduler Optimizer"
    DEBUG: bool = True
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
    class Config:
        env_file = ".env"
        extra = "forbid"  # Optional: ensures no extra variables are silently accepted

    # Override the __init__ to parse comma-separated strings for ALLOW_ORIGINS
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if isinstance(self.ALLOW_ORIGINS, str):
            self.ALLOW_ORIGINS = [origin.strip() for origin in self.ALLOW_ORIGINS.split(",")]

settings = Settings()
