from contextlib import asynccontextmanager
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .azure_credential import close_credential
from .cosmos import close_cosmos
from .routers import sessions, speech, summary


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_cosmos()
    await close_credential()


app = FastAPI(title="Mobile Translator API", lifespan=lifespan)

origins = [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}


@app.get("/api/healthz")
async def api_healthz() -> dict:
    return {"status": "ok"}


app.include_router(speech.router)
app.include_router(sessions.router)
app.include_router(summary.router)
