from __future__ import annotations

from typing import Annotated

import httpx
from cachetools import TTLCache
from fastapi import Depends, Header, HTTPException, status
from jose import jwt
from jose.exceptions import JWTError

from .config import Settings, get_settings


_jwks_cache: TTLCache = TTLCache(maxsize=4, ttl=3600)


async def _get_jwks(tenant_id: str) -> dict:
    if tenant_id in _jwks_cache:
        return _jwks_cache[tenant_id]
    url = f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        jwks = resp.json()
    _jwks_cache[tenant_id] = jwks
    return jwks


class CurrentUser:
    def __init__(self, oid: str, name: str | None, tid: str):
        self.oid = oid
        self.name = name
        self.tid = tid


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    token = authorization.split(" ", 1)[1]
    try:
        unverified_header = jwt.get_unverified_header(token)
    except JWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token header: {e}") from e

    jwks = await _get_jwks(settings.tenant_id)
    key = next(
        (k for k in jwks.get("keys", []) if k.get("kid") == unverified_header.get("kid")),
        None,
    )
    if key is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Signing key not found")

    issuers = {
        f"https://login.microsoftonline.com/{settings.tenant_id}/v2.0",
        f"https://sts.windows.net/{settings.tenant_id}/",
    }
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=[key.get("alg", "RS256")],
            audience=settings.api_audience,
            options={"verify_iss": False},
        )
    except JWTError as e:
        # Entra access tokens can emit aud as either "api://<app-id>" or "<app-id>".
        if settings.api_audience.startswith("api://"):
            fallback_audience = settings.api_audience.removeprefix("api://")
            try:
                claims = jwt.decode(
                    token,
                    key,
                    algorithms=[key.get("alg", "RS256")],
                    audience=fallback_audience,
                    options={"verify_iss": False},
                )
            except JWTError as fallback_error:
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED,
                    f"Invalid token: {fallback_error}",
                ) from fallback_error
        else:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {e}") from e

    iss = claims.get("iss")
    if iss not in issuers:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid issuer: {iss}")

    if claims.get("tid") != settings.tenant_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid tenant")

    scopes = (claims.get("scp") or "").split()
    if settings.api_scope and settings.api_scope not in scopes:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient scope")

    oid = claims.get("oid") or claims.get("sub")
    if not oid:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing oid")

    return CurrentUser(oid=oid, name=claims.get("name"), tid=claims["tid"])
