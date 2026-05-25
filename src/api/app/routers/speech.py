from fastapi import APIRouter, Depends

from ..auth import CurrentUser, get_current_user
from ..config import Settings, get_settings
from ..services.speech import issue_speech_token

router = APIRouter(prefix="/api/speech", tags=["speech"])


@router.post("/token")
async def speech_token(
    _: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    return await issue_speech_token(settings)
