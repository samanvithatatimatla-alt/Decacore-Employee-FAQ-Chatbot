"""Azure Functions v2 programming model.

Deploy this file in a Function App with the same DATABASE_URL setting as the API.
The timer runs daily at 02:00 UTC. The HTTP trigger is for a protected demo/manual run;
in production, protect it with Function authLevel=function and keep the key private.
"""
from __future__ import annotations

import json

import azure.functions as func

from app.database import SessionLocal
from app.services.purge import purge_expired

app = func.FunctionApp()


@app.timer_trigger(schedule="0 0 2 * * *", arg_name="timer", run_on_startup=False, use_monitor=True)
def scheduled_purge(timer: func.TimerRequest) -> None:
    with SessionLocal() as db:
        purge_expired(db, triggered_by="timer")


@app.route(route="purge", methods=["POST"], auth_level=func.AuthLevel.FUNCTION)
def manual_purge(req: func.HttpRequest) -> func.HttpResponse:
    with SessionLocal() as db:
        log = purge_expired(db, triggered_by="function-http")
        return func.HttpResponse(
            json.dumps({
                "conversations_deleted": log.conversations_deleted,
                "messages_deleted": log.messages_deleted,
                "duration_ms": log.duration_ms,
            }),
            mimetype="application/json",
        )
