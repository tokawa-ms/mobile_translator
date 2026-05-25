from __future__ import annotations

from ..azure_credential import get_credential
from ..config import Settings

_COG_SCOPE = "https://cognitiveservices.azure.com/.default"


async def issue_speech_token(settings: Settings) -> dict:
    if not settings.speech_resource_id:
        raise RuntimeError("SPEECH_RESOURCE_ID is required for Microsoft Entra auth with Speech SDK")

    cred = get_credential()
    aad_token = await cred.get_token(_COG_SCOPE)
    token = f"aad#{settings.speech_resource_id}#{aad_token.token}"
    return {"token": token, "region": settings.speech_region}
