"""JSON logs that Cloud Logging understands, plus the middleware that stamps each request.

Cloud Logging reads `severity` (not `level`) and `message` from a JSON line on stdout, and
links the line to the request when it carries `logging.googleapis.com/trace` with the value
`projects/<project id>/traces/<trace id>`. The trace id comes from the `X-Cloud-Trace-Context`
header that Cloud Run adds to every request; the project id is the `GOOGLE_CLOUD_PROJECT`
setting (Cloud Run does not expose it to the container by itself).
"""

import json
import logging
import re
import sys
import time
import uuid
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import internal_error_response

request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)
trace_ctx: ContextVar[str | None] = ContextVar("trace_id", default=None)

REQUEST_ID_HEADER = "X-Request-ID"
TRACE_HEADER = "X-Cloud-Trace-Context"
TRACE_FIELD = "logging.googleapis.com/trace"
_VALID_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")
# `TRACE_ID/SPAN_ID;o=TRACE_TRUE`: a 32-digit hex trace id, then an optional decimal span id and
# an optional sampled flag. Anything else is ignored rather than copied into the logs.
_TRACE_CONTEXT = re.compile(r"([0-9a-fA-F]{32})(?:/[0-9]+)?(?:;o=[01])?")

# Attributes every LogRecord has, or that this module stamps; anything else came from `extra=`.
_STANDARD_ATTRS = frozenset(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys()
    | {"message", "asctime", "taskName", "request_id", "trace_id"}
)
# Fields `extra=` can never set: the ones the formatter owns, `exception` (only `exc_info` may fill
# it, so a log line cannot pose as a traceback), the special fields Cloud Logging interprets
# (it would take them as the real severity source, request data, labels, ...), and `color_message`,
# the ANSI copy of the message that uvicorn adds to its records, which is noise in JSON.
_CLOUD_LOGGING_SPECIAL_FIELDS = (
    "httpRequest",
    "logging.googleapis.com/insertId",
    "logging.googleapis.com/labels",
    "logging.googleapis.com/operation",
    "logging.googleapis.com/sourceLocation",
    "logging.googleapis.com/spanId",
    "logging.googleapis.com/trace_sampled",
)
_RESERVED_FIELDS = frozenset(
    {
        "timestamp",
        "severity",
        "logger",
        "message",
        "request_id",
        TRACE_FIELD,
        "exception",
        "color_message",
        *_CLOUD_LOGGING_SPECIAL_FIELDS,
    }
)


def _parse_trace_id(header: str | None) -> str | None:
    match = _TRACE_CONTEXT.fullmatch(header) if header else None
    return match.group(1).lower() if match else None


class RequestIdFilter(logging.Filter):
    """Stamp the current request id and trace id on every record (None outside a request)."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get()
        record.trace_id = trace_ctx.get()
        return True


class JsonFormatter(logging.Formatter):
    def __init__(self, project_id: str | None = None) -> None:
        super().__init__()
        self.project_id = project_id

    def format(self, record: logging.LogRecord) -> str:
        data: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "severity": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", request_id_ctx.get()),
        }
        trace_id = getattr(record, "trace_id", trace_ctx.get())
        if trace_id and self.project_id:
            data[TRACE_FIELD] = f"projects/{self.project_id}/traces/{trace_id}"
        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRS and key not in _RESERVED_FIELDS:
                data[key] = value
        if record.exc_info:
            data["exception"] = self.formatException(record.exc_info)
        return json.dumps(data, default=str)


def configure_logging(level: str = "INFO", project_id: str | None = None) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter(project_id))
    handler.addFilter(RequestIdFilter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())

    # Route uvicorn through the same handler; our middleware emits the access log.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True
    logging.getLogger("uvicorn.access").disabled = True


_logger = logging.getLogger("app.request")


class RequestIdMiddleware:
    """Pure ASGI middleware: request id, trace id, access log and the last-resort 500.

    It is the outermost app middleware, so it also sees what no handler caught. An unexpected
    exception is logged once here (with the request id and trace) and answered with the single
    500 body, and it is NOT re-raised: `ServerErrorMiddleware` would answer on its own, without
    `X-Request-ID`, and uvicorn would log the traceback a second time, without a request id.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = MutableHeaders(scope=scope)
        incoming = headers.get(REQUEST_ID_HEADER)
        request_id = (
            incoming if incoming and _VALID_REQUEST_ID.fullmatch(incoming) else uuid.uuid4().hex
        )
        request_token = request_id_ctx.set(request_id)
        trace_token = trace_ctx.set(_parse_trace_id(headers.get(TRACE_HEADER)))
        status = 500
        response_started = False
        start = time.perf_counter()

        async def send_wrapper(message: Message) -> None:
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                status = message["status"]
                response_started = True
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            # Traceback only; no query string, headers or body.
            _logger.exception(
                "unhandled_exception",
                extra={"method": scope["method"], "path": scope["path"]},
            )
            # If the status line already went out there is nothing left to say to the client;
            # the server closes the connection, which is how a truncated response is signalled.
            if not response_started:
                await internal_error_response()(scope, receive, send_wrapper)
        finally:
            _logger.info(
                "request_completed",
                extra={
                    "method": scope["method"],
                    "path": scope["path"],
                    "status": status,
                    "duration_ms": round((time.perf_counter() - start) * 1000, 2),
                },
            )
            trace_ctx.reset(trace_token)
            request_id_ctx.reset(request_token)
