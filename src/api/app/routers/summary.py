from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import CurrentUser, get_current_user
from ..config import Settings, get_settings
from ..cosmos import create_doc, get_container, query
from ..services.openai_client import chat

router = APIRouter(prefix="/api/sessions", tags=["summary"])


async def _get_segments(container, session_id: str, limit: int | None = None) -> list[dict]:
    sql = (
        "SELECT c.seq, c.sourceText, c.ja FROM c "
        "WHERE c.sessionId=@sid AND c.type='segment' ORDER BY c.seq DESC"
    )
    items = await query(
        container, sql, [{"name": "@sid", "value": session_id}], partition_key=session_id
    )
    items = list(reversed(items))
    if limit and len(items) > limit:
        items = items[-limit:]
    return items


def _segments_to_text(segments: list[dict]) -> str:
    return "\n".join(f"[{s['seq']}] {s.get('ja') or s.get('sourceText','')}" for s in segments)


async def _ensure_session_owned(container, session_id: str, user_oid: str) -> dict:
    items = await query(
        container,
        "SELECT * FROM c WHERE c.type='session' AND c.id=@id AND c.userOid=@oid",
        [{"name": "@id", "value": session_id}, {"name": "@oid", "value": user_oid}],
        partition_key=session_id,
    )
    if not items:
        raise HTTPException(404, "Session not found")
    return items[0]


@router.post("/{session_id}/summary/recent")
async def summarize_recent(
    session_id: str,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    container = await get_container(settings)
    await _ensure_session_owned(container, session_id, user.oid)
    segs = await _get_segments(container, session_id, limit=30)
    if not segs:
        raise HTTPException(400, "No segments to summarize")
    text = await chat(
        settings,
        settings.azure_openai_deployment_mini,
        system=(
            "あなたは会話を日本語で簡潔に要約するアシスタントです。"
            "5-8 行の箇条書きで直近の議論の要点をまとめてください。"
        ),
        user=f"以下の発話列を要約してください。\n\n{_segments_to_text(segs)}",
        max_tokens=500,
    )
    doc = await create_doc(
        container,
        {
            "sessionId": session_id,
            "type": "summary",
            "kind": "recent",
            "model": settings.azure_openai_deployment_mini,
            "fromSeq": segs[0]["seq"],
            "toSeq": segs[-1]["seq"],
            "text": text,
        },
    )
    return doc


@router.post("/{session_id}/summary/long")
async def summarize_long(
    session_id: str,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    container = await get_container(settings)
    await _ensure_session_owned(container, session_id, user.oid)
    segs = await _get_segments(container, session_id)
    if not segs:
        raise HTTPException(400, "No segments to summarize")
    text = await chat(
        settings,
        settings.azure_openai_deployment_full,
        system=(
            "あなたは長時間の会話を日本語で構造化して要約する専門家です。"
            "見出し付きで、テーマ・主要論点・決定事項・未解決事項を整理してください。"
        ),
        user=f"以下のセッション全体を要約してください。\n\n{_segments_to_text(segs)}",
        max_tokens=1500,
    )
    doc = await create_doc(
        container,
        {
            "sessionId": session_id,
            "type": "summary",
            "kind": "long",
            "model": settings.azure_openai_deployment_full,
            "fromSeq": segs[0]["seq"],
            "toSeq": segs[-1]["seq"],
            "text": text,
        },
    )
    return doc


class TopicsRequest(BaseModel):
    summaryId: str | None = None


@router.post("/{session_id}/topics")
async def generate_topics(
    session_id: str,
    body: TopicsRequest,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    container = await get_container(settings)
    await _ensure_session_owned(container, session_id, user.oid)

    if body.summaryId:
        summaries = await query(
            container,
            "SELECT * FROM c WHERE c.sessionId=@sid AND c.type='summary' AND c.id=@id",
            [{"name": "@sid", "value": session_id}, {"name": "@id", "value": body.summaryId}],
            partition_key=session_id,
        )
    else:
        summaries = await query(
            container,
            "SELECT TOP 1 * FROM c WHERE c.sessionId=@sid AND c.type='summary' AND c.kind='recent' "
            "ORDER BY c.createdAt DESC",
            [{"name": "@sid", "value": session_id}],
            partition_key=session_id,
        )
    if not summaries:
        raise HTTPException(400, "No summary available")
    summary = summaries[0]

    raw = await chat(
        settings,
        settings.azure_openai_deployment_mini,
        system=(
            "あなたはミーティング進行をサポートするアシスタントです。"
            "与えられた要約から、聞き手が質問しうる Q&A 候補のトピックを 5 個提案してください。"
            "出力は JSON 配列で、各要素は {\"title\": string, \"rationale\": string} の形式とし、"
            "JSON のみを出力してください。"
        ),
        user=f"要約:\n{summary['text']}",
        max_tokens=600,
    )
    start = raw.find("[")
    end = raw.rfind("]")
    if start < 0 or end < start:
        raise HTTPException(502, "Topic generation did not return a JSON array")
    try:
        topics_raw = json.loads(raw[start : end + 1])
    except json.JSONDecodeError as e:
        raise HTTPException(502, f"Invalid topic JSON from model: {e.msg}") from e
    if not isinstance(topics_raw, list):
        raise HTTPException(502, "Topic generation returned non-array JSON")

    saved = []
    for t in topics_raw[:10]:
        if not isinstance(t, dict) or "title" not in t:
            continue
        doc = await create_doc(
            container,
            {
                "sessionId": session_id,
                "type": "topic",
                "summaryId": summary["id"],
                "title": str(t.get("title", "")),
                "rationale": str(t.get("rationale", "")),
            },
        )
        saved.append(doc)
    return {"topics": saved}


@router.post("/{session_id}/topics/{topic_id}/question")
async def generate_question(
    session_id: str,
    topic_id: str,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    container = await get_container(settings)
    await _ensure_session_owned(container, session_id, user.oid)
    topics = await query(
        container,
        "SELECT * FROM c WHERE c.sessionId=@sid AND c.type='topic' AND c.id=@id",
        [{"name": "@sid", "value": session_id}, {"name": "@id", "value": topic_id}],
        partition_key=session_id,
    )
    if not topics:
        raise HTTPException(404, "Topic not found")
    topic = topics[0]
    summaries = await query(
        container,
        "SELECT * FROM c WHERE c.sessionId=@sid AND c.type='summary' AND c.id=@id",
        [{"name": "@sid", "value": session_id}, {"name": "@id", "value": topic["summaryId"]}],
        partition_key=session_id,
    )
    summary_text = summaries[0]["text"] if summaries else ""

    q = await chat(
        settings,
        settings.azure_openai_deployment_mini,
        system=(
            "あなたは聞き手として、議論を深める質問を 1 つ、丁寧な日本語で組み立てます。"
            "前置きや解説は不要で、質問文だけを出力してください。"
        ),
        user=f"トピック: {topic['title']}\n背景: {topic.get('rationale','')}\n要約:\n{summary_text}",
        max_tokens=200,
    )
    doc = await create_doc(
        container,
        {
            "sessionId": session_id,
            "type": "question",
            "topicId": topic_id,
            "text": q.strip(),
        },
    )
    return doc
