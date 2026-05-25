from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import CurrentUser, get_current_user
from ..config import Settings, get_settings
from ..cosmos import create_doc, get_container, query
from ..services.translator import translate

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


class SessionCreate(BaseModel):
    title: str = Field(default="Untitled")
    sourceLang: str = Field(default="en-US")


class SessionOut(BaseModel):
    id: str
    title: str
    sourceLang: str
    createdAt: str


@router.post("", response_model=SessionOut)
async def create_session(
    body: SessionCreate,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    container = await get_container(settings)
    from ..cosmos import new_id

    sid = new_id()
    doc = {
        "id": sid,
        "sessionId": sid,
        "type": "session",
        "userOid": user.oid,
        "title": body.title,
        "sourceLang": body.sourceLang,
    }
    created = await create_doc(container, doc)
    return SessionOut(
        id=created["id"],
        title=created["title"],
        sourceLang=created["sourceLang"],
        createdAt=created["createdAt"],
    )


@router.get("")
async def list_sessions(
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    container = await get_container(settings)
    items = await query(
        container,
        "SELECT c.id, c.title, c.sourceLang, c.createdAt FROM c "
        "WHERE c.type='session' AND c.userOid=@oid ORDER BY c.createdAt DESC",
        [{"name": "@oid", "value": user.oid}],
    )
    return items


async def _ensure_session(container, session_id: str, user_oid: str) -> dict:
    items = await query(
        container,
        "SELECT * FROM c WHERE c.type='session' AND c.id=@id AND c.userOid=@oid",
        [{"name": "@id", "value": session_id}, {"name": "@oid", "value": user_oid}],
        partition_key=session_id,
    )
    if not items:
        raise HTTPException(404, "Session not found")
    return items[0]


@router.get("/{session_id}")
async def get_session(
    session_id: str,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    container = await get_container(settings)
    await _ensure_session(container, session_id, user.oid)
    items = await query(
        container,
        "SELECT * FROM c WHERE c.sessionId=@sid ORDER BY c.createdAt ASC",
        [{"name": "@sid", "value": session_id}],
        partition_key=session_id,
    )
    return {"items": items}


class SegmentIn(BaseModel):
    sourceText: str
    startMs: int = 0
    endMs: int = 0


@router.post("/{session_id}/segments")
async def add_segment(
    session_id: str,
    body: SegmentIn,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    container = await get_container(settings)
    session = await _ensure_session(container, session_id, user.oid)
    ja = await translate(settings, body.sourceText, source_lang=session.get("sourceLang"))

    existing = await query(
        container,
        "SELECT TOP 1 c.seq FROM c WHERE c.sessionId=@sid AND c.type='segment' ORDER BY c.seq DESC",
        [{"name": "@sid", "value": session_id}],
        partition_key=session_id,
    )
    seq = (existing[0]["seq"] if existing else 0) + 1

    doc = {
        "sessionId": session_id,
        "type": "segment",
        "seq": seq,
        "startMs": body.startMs,
        "endMs": body.endMs,
        "sourceText": body.sourceText,
        "ja": ja,
    }
    created = await create_doc(container, doc)
    return created
