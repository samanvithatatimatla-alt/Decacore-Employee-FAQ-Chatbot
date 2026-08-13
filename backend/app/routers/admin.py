from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import require_roles
from ..database import get_db
from ..models import User
from ..services.purge import purge_expired

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/purge")
def manual_purge(db: Session = Depends(get_db), user: User = Depends(require_roles("HRAdmin"))):
    log = purge_expired(db, triggered_by=f"manual:{user.email}")
    return {
        "run_at": log.run_at,
        "conversations_deleted": log.conversations_deleted,
        "messages_deleted": log.messages_deleted,
        "duration_ms": log.duration_ms,
        "triggered_by": log.triggered_by,
    }
