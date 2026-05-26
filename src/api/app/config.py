from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Entra ID (user auth)
    tenant_id: str
    api_audience: str  # e.g. api://<api-client-id>
    api_scope: str = "access_as_user"

    # Azure OpenAI
    azure_openai_endpoint: str
    azure_openai_api_version: str = "2024-10-21"
    azure_openai_deployment_mini: str = "gpt-5.4-mini"
    azure_openai_deployment_full: str = "gpt-5.4"

    # Speech / Translator
    speech_region: str
    speech_endpoint: str  # https://<region>.api.cognitive.microsoft.com
    speech_resource_id: str = ""  # for token issuance via aad (optional)
    translator_endpoint: str
    translator_region: str

    # Cosmos
    cosmos_endpoint: str
    cosmos_database: str = "mt"
    cosmos_container: str = "items"

    # CORS
    cors_allowed_origins: str = "*"

    # Misc
    target_language: str = "ja"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
