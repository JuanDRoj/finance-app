import io
import json
import logging

from httpx import AsyncClient

from app.core.logging import JsonFormatter, RequestIdFilter, request_id_ctx


def _record(msg: str = "hello", exc_info: object = None) -> logging.LogRecord:
    return logging.LogRecord("t", logging.INFO, __file__, 1, msg, None, exc_info)  # type: ignore[arg-type]


def test_json_formatter_outputs_valid_json_with_required_fields() -> None:
    record = _record()
    RequestIdFilter().filter(record)
    data = json.loads(JsonFormatter().format(record))
    assert {"timestamp", "level", "logger", "message", "request_id"} <= data.keys()
    assert data["level"] == "INFO"
    assert data["message"] == "hello"


def test_formatter_includes_exception_text_when_exc_info() -> None:
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        record = _record(exc_info=sys.exc_info())
    data = json.loads(JsonFormatter().format(record))
    assert "ValueError: boom" in data["exception"]


def test_log_outside_request_has_null_request_id() -> None:
    record = _record()
    RequestIdFilter().filter(record)
    assert json.loads(JsonFormatter().format(record))["request_id"] is None


async def test_request_id_context_is_reset_after_request(
    client: AsyncClient, log_stream: io.StringIO
) -> None:
    await client.get("/healthz", headers={"X-Request-ID": "rid-1"})
    assert request_id_ctx.get() is None
