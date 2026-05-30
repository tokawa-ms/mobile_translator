from __future__ import annotations

import json
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from typing import Optional

from ..auth import CurrentUser, get_current_user
from ..config import Settings, get_settings
from ..cosmos import create_doc, get_container, query
from ..services.translator import translate

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _md_escape(value: object) -> str:
    text = str(value or "")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _format_markdown_export(session: dict, items: list[dict]) -> str:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        grouped[str(item.get("type", "unknown"))].append(item)

    lines: list[str] = []
    lines.append(f"# Session Export: {_md_escape(session.get('title') or session.get('id'))}")
    lines.append("")
    lines.append("## Metadata")
    lines.append("")
    lines.append(f"- Session ID: {_md_escape(session.get('id'))}")
    lines.append(f"- Title: {_md_escape(session.get('title'))}")
    lines.append(f"- Source Language: {_md_escape(session.get('sourceLang'))}")
    if session.get("speakerName"):
        lines.append(f"- Speaker Name: {_md_escape(session.get('speakerName'))}")
    if session.get("sessionNumber") is not None:
        lines.append(f"- Session Number: {_md_escape(session.get('sessionNumber'))}")
    lines.append(f"- Created At: {_md_escape(session.get('createdAt'))}")
    lines.append(f"- Exported Items: {len(items)}")

    segments = sorted(grouped.get("segment", []), key=lambda x: x.get("seq", 0))
    if segments:
        lines.append("")
        lines.append("## Segments")
        lines.append("")
        for seg in segments:
            lines.append(f"### [{seg.get('seq', '?')}] {_md_escape(seg.get('createdAt'))}")
            lines.append("")
            lines.append(f"- startMs: {seg.get('startMs', 0)}")
            lines.append(f"- endMs: {seg.get('endMs', 0)}")
            lines.append("")
            lines.append("**Source**")
            lines.append("")
            lines.append(_md_escape(seg.get("sourceText")))
            lines.append("")
            lines.append("**Japanese Translation**")
            lines.append("")
            lines.append(_md_escape(seg.get("ja")))
            lines.append("")

    summaries = sorted(grouped.get("summary", []), key=lambda x: x.get("createdAt", ""))
    if summaries:
        lines.append("## Summaries")
        lines.append("")
        for summary in summaries:
            lines.append(
                f"### {(_md_escape(summary.get('kind')) or 'summary').upper()} ({_md_escape(summary.get('createdAt'))})"
            )
            lines.append("")
            lines.append(f"- id: {_md_escape(summary.get('id'))}")
            lines.append(f"- model: {_md_escape(summary.get('model'))}")
            lines.append(f"- fromSeq: {_md_escape(summary.get('fromSeq'))}")
            lines.append(f"- toSeq: {_md_escape(summary.get('toSeq'))}")
            lines.append("")
            lines.append(_md_escape(summary.get("text")))
            lines.append("")

    topics = sorted(grouped.get("topic", []), key=lambda x: x.get("createdAt", ""))
    if topics:
        lines.append("## Topics")
        lines.append("")
        for topic in topics:
            lines.append(f"### {_md_escape(topic.get('title'))}")
            lines.append("")
            lines.append(f"- id: {_md_escape(topic.get('id'))}")
            lines.append(f"- summaryId: {_md_escape(topic.get('summaryId'))}")
            lines.append(f"- createdAt: {_md_escape(topic.get('createdAt'))}")
            lines.append("")
            lines.append(_md_escape(topic.get("rationale")))
            lines.append("")

    questions = sorted(grouped.get("question", []), key=lambda x: x.get("createdAt", ""))
    if questions:
        lines.append("## Questions")
        lines.append("")
        for question in questions:
            lines.append(f"### Topic {_md_escape(question.get('topicId'))}")
            lines.append("")
            lines.append(f"- id: {_md_escape(question.get('id'))}")
            lines.append(f"- createdAt: {_md_escape(question.get('createdAt'))}")
            lines.append("")
            if question.get("en"):
                lines.append(f"- EN: {_md_escape(question.get('en'))}")
            if question.get("ja"):
                lines.append(f"- JA: {_md_escape(question.get('ja'))}")
            if not question.get("en") and not question.get("ja"):
                lines.append(f"- Text: {_md_escape(question.get('text'))}")
            lines.append("")

    excluded = {"session", "segment", "summary", "topic", "question"}
    others: list[dict] = []
    for t, values in grouped.items():
        if t not in excluded:
            others.extend(values)
    if others:
        lines.append("## Other Items")
        lines.append("")
        for other in sorted(others, key=lambda x: x.get("createdAt", "")):
            lines.append(f"### {_md_escape(other.get('type'))}")
            lines.append("")
            lines.append("```json")
            lines.append(json.dumps(other, ensure_ascii=False, indent=2))
            lines.append("```")
            lines.append("")

    return "\n".join(lines).strip() + "\n"


class SessionCreate(BaseModel):
    title: str = Field(default="Untitled")
    sourceLang: str = Field(default="en-US")
    speakerName: Optional[str] = Field(default=None)
    sessionNumber: Optional[int] = Field(default=None)


class SessionOut(BaseModel):
    id: str
    title: str
    sourceLang: str
    speakerName: Optional[str] = None
    sessionNumber: Optional[int] = None
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
        "speakerName": (body.speakerName.strip() if body.speakerName and body.speakerName.strip() else None),
        "sessionNumber": body.sessionNumber,
    }
    created = await create_doc(container, doc)
    return SessionOut(
        id=created["id"],
        title=created["title"],
        sourceLang=created["sourceLang"],
        speakerName=created.get("speakerName"),
        sessionNumber=created.get("sessionNumber"),
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
        "SELECT c.id, c.title, c.sourceLang, c.speakerName, c.sessionNumber, c.createdAt FROM c "
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


@router.get("/{session_id}/segments/export")
async def export_session_segments(
    session_id: str,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    container = await get_container(settings)
    session = await _ensure_session(container, session_id, user.oid)

    segments = await query(
        container,
        "SELECT c.seq, c.startMs, c.endMs, c.sourceText, c.ja, c.createdAt FROM c "
        "WHERE c.sessionId=@sid AND c.type='segment' ORDER BY c.seq ASC",
        [{"name": "@sid", "value": session_id}],
        partition_key=session_id,
    )

    payload = {
        "session": {
            "id": session.get("id"),
            "title": session.get("title"),
            "sourceLang": session.get("sourceLang"),
            "speakerName": session.get("speakerName"),
            "sessionNumber": session.get("sessionNumber"),
            "createdAt": session.get("createdAt"),
        },
        "utterances": segments,
    }

    filename = f"session-{session_id}-utterances.json"
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    return Response(
        content=body,
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{session_id}/items/export/markdown")
async def export_session_items_markdown(
    session_id: str,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    container = await get_container(settings)
    session = await _ensure_session(container, session_id, user.oid)

    items = await query(
        container,
        "SELECT * FROM c WHERE c.sessionId=@sid ORDER BY c.createdAt ASC",
        [{"name": "@sid", "value": session_id}],
        partition_key=session_id,
    )

    markdown = _format_markdown_export(session, items)
    filename = f"session-{session_id}-all-items.md"
    return Response(
        content=markdown,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
