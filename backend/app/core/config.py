from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    APP_NAME: str = "Scheduler Optimizer"
    DEBUG: bool = True
    DATABASE_URL: str
    ALLOW_ORIGINS: list[str] = []

    class Config:
        env_file = ".env"

    # Override the __init__ to parse comma-separated strings for ALLOW_ORIGINS
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if isinstance(self.ALLOW_ORIGINS, str):
            self.ALLOW_ORIGINS = [origin.strip() for origin in self.ALLOW_ORIGINS.split(",")]

settings = Settings()
