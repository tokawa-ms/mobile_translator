from __future__ import annotations

from azure.identity.aio import get_bearer_token_provider
from openai import AsyncAzureOpenAI

from ..azure_credential import get_credential
from ..config import Settings

_COG_SCOPE = "https://cognitiveservices.azure.com/.default"

_client: AsyncAzureOpenAI | None = None
_token_provider = None


def get_openai(settings: Settings) -> AsyncAzureOpenAI:
    global _client, _token_provider
    if _client is None:
        _token_provider = get_bearer_token_provider(get_credential(), _COG_SCOPE)
        _client = AsyncAzureOpenAI(
            azure_endpoint=settings.azure_openai_endpoint,
            api_version=settings.azure_openai_api_version,
            azure_ad_token_provider=_token_provider,
        )
    return _client


async def chat(
    settings: Settings,
    deployment: str,
    system: str,
    user: str,
    max_tokens: int = 800,
) -> str:
    client = get_openai(settings)
    resp = await client.chat.completions.create(
        model=deployment,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=max_tokens,
        temperature=0.3,
    )
    return resp.choices[0].message.content or ""
