from __future__ import annotations

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..models import NotificationLog


class NotificationService:
    def send(self, db: Session, to: str, subject: str, body: str) -> None:
        if not to:
            return
        status = "logged"
        error = None
        if settings.notification_backend == "graph":
            try:
                token = self._graph_token()
                sender = settings.graph_sender_user
                if not sender:
                    raise RuntimeError("GRAPH_SENDER_USER is required for Graph notifications")
                response = httpx.post(
                    f"https://graph.microsoft.com/v1.0/users/{sender}/sendMail",
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json={
                        "message": {
                            "subject": subject,
                            "body": {"contentType": "Text", "content": body},
                            "toRecipients": [{"emailAddress": {"address": to}}],
                        },
                        "saveToSentItems": True,
                    },
                    timeout=15,
                )
                response.raise_for_status()
                status = "sent"
            except Exception as exc:  # notification failures must never break business flow
                status = "failed"
                error = str(exc)[:4000]
        db.add(NotificationLog(recipient=to, subject=subject, status=status, error=error))
        db.commit()

    def _graph_token(self) -> str:
        if settings.graph_client_secret:
            response = httpx.post(
                f"https://login.microsoftonline.com/{settings.graph_tenant_id}/oauth2/v2.0/token",
                data={
                    "client_id": settings.graph_client_id,
                    "client_secret": settings.graph_client_secret,
                    "scope": "https://graph.microsoft.com/.default",
                    "grant_type": "client_credentials",
                },
                timeout=15,
            )
            response.raise_for_status()
            return response.json()["access_token"]
        from azure.identity import DefaultAzureCredential

        return DefaultAzureCredential().get_token("https://graph.microsoft.com/.default").token


notification_service = NotificationService()
