import json
import logging
import sys
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.core.logging import JsonFormatter, RequestIdFilter, configure_logging, request_id_ctx


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
        record = _record(exc_info=sys.exc_info())
    data = json.loads(JsonFormatter().format(record))
    assert "ValueError: boom" in data["exception"]


def test_log_outside_request_has_null_request_id() -> None:
    record = _record()
    RequestIdFilter().filter(record)
    assert json.loads(JsonFormatter().format(record))["request_id"] is None


async def test_request_id_context_is_reset_after_request(
    client: AsyncClient,
) -> None:
    await client.get("/healthz", headers={"X-Request-ID": "rid-1"})
    assert request_id_ctx.get() is None


def test_extra_cannot_override_reserved_fields() -> None:
    record = _record()
    record.__dict__.update({"timestamp": "evil", "level": "evil", "logger": "evil", "foo": "bar"})
    data = json.loads(JsonFormatter().format(record))
    assert data["timestamp"] != "evil"
    assert data["level"] == "INFO"
    assert data["logger"] == "t"
    assert data["foo"] == "bar"


@pytest.fixture
def restore_logging() -> Iterator[None]:
    names = ["", "uvicorn", "uvicorn.error", "uvicorn.access"]
    saved = [
        (
            n,
            logging.getLogger(n).handlers[:],
            logging.getLogger(n).propagate,
            logging.getLogger(n).disabled,
            logging.getLogger(n).level,
        )
        for n in names
    ]
    yield
    for n, handlers, propagate, disabled, level in saved:
        lg = logging.getLogger(n)
        lg.handlers, lg.propagate, lg.disabled = handlers, propagate, disabled
        lg.setLevel(level)


def _simulate_uvicorn_dict_config() -> None:
    for name in ("uvicorn", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers = [logging.StreamHandler()]
        lg.propagate = False
        lg.disabled = False


def _assert_uvicorn_routed_to_root() -> None:
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        assert lg.handlers == []
        assert lg.propagate is True
    assert any(isinstance(h.formatter, JsonFormatter) for h in logging.getLogger().handlers)


@pytest.mark.usefixtures("restore_logging")
def test_configure_logging_routes_uvicorn_loggers_to_root() -> None:
    _simulate_uvicorn_dict_config()
    configure_logging("INFO")
    _assert_uvicorn_routed_to_root()


@pytest.mark.usefixtures("restore_logging")
async def test_lifespan_reconfigures_logging_after_uvicorn_config(app: FastAPI) -> None:
    # uvicorn applies its dictConfig before running the app lifespan.
    _simulate_uvicorn_dict_config()
    async with app.router.lifespan_context(app):
        _assert_uvicorn_routed_to_root()
