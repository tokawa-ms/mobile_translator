from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from azure.cosmos.aio import CosmosClient, ContainerProxy

from .azure_credential import get_credential
from .config import Settings


_client: CosmosClient | None = None
_container: ContainerProxy | None = None


async def get_container(settings: Settings) -> ContainerProxy:
    global _client, _container
    if _container is None:
        _client = CosmosClient(settings.cosmos_endpoint, credential=get_credential())
        db = _client.get_database_client(settings.cosmos_database)
        _container = db.get_container_client(settings.cosmos_container)
    return _container


async def close_cosmos() -> None:
    global _client, _container
    if _client is not None:
        await _client.close()
    _client = None
    _container = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid4())


async def create_doc(container: ContainerProxy, doc: dict[str, Any]) -> dict[str, Any]:
    doc.setdefault("id", new_id())
    doc.setdefault("createdAt", _now())
    doc["updatedAt"] = _now()
    return await container.create_item(body=doc)


async def query(
    container: ContainerProxy,
    sql: str,
    params: list[dict[str, Any]] | None = None,
    partition_key: str | None = None,
) -> list[dict[str, Any]]:
    kwargs: dict[str, Any] = {"query": sql, "parameters": params or []}
    if partition_key is not None:
        kwargs["partition_key"] = partition_key
    else:
        kwargs["enable_cross_partition_query"] = True
    items: list[dict[str, Any]] = []
    async for item in container.query_items(**kwargs):
        items.append(item)
    return items
