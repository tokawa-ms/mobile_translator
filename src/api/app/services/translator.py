from __future__ import annotations

import httpx

from ..azure_credential import get_credential
from ..config import Settings

_COG_SCOPE = "https://cognitiveservices.azure.com/.default"


async def translate(settings: Settings, text: str, source_lang: str | None = None) -> str:
    cred = get_credential()
    aad_token = await cred.get_token(_COG_SCOPE)
    url = f"{settings.translator_endpoint.rstrip('/')}/translate"
    params: dict[str, str] = {"api-version": "3.0", "to": settings.target_language}
    if source_lang:
        params["from"] = source_lang.split("-")[0]
    headers = {
        "Authorization": f"Bearer {aad_token.token}",
        "Ocp-Apim-Subscription-Region": settings.translator_region,
        "Content-Type": "application/json",
    }
    body = [{"Text": text}]
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, params=params, headers=headers, json=body)
        resp.raise_for_status()
        data = resp.json()
    return data[0]["translations"][0]["text"]
