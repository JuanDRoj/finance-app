import io
import json
import logging
import sys
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.core.config import get_settings
from app.core.logging import (
    JsonFormatter,
    RequestIdFilter,
    configure_logging,
    request_id_ctx,
    trace_ctx,
)
from app.main import create_app

TRACE_KEY = "logging.googleapis.com/trace"
TRACE_ID = "105445aa7843bc8bf206b12000100000"


def _record(msg: str = "hello", exc_info: object = None) -> logging.LogRecord:
    return logging.LogRecord("t", logging.INFO, __file__, 1, msg, None, exc_info)  # type: ignore[arg-type]


def test_json_formatter_outputs_valid_json_with_required_fields() -> None:
    record = _record()
    RequestIdFilter().filter(record)
    data = json.loads(JsonFormatter().format(record))
    assert {"timestamp", "severity", "logger", "message", "request_id"} <= data.keys()
    assert data["severity"] == "INFO"
    assert data["message"] == "hello"


def test_formatter_uses_severity_and_not_level() -> None:
    assert "level" not in json.loads(JsonFormatter().format(_record()))


@pytest.mark.parametrize(
    "levelno", [logging.DEBUG, logging.WARNING, logging.ERROR, logging.CRITICAL]
)
def test_severity_matches_the_cloud_logging_names(levelno: int) -> None:
    record = _record()
    record.levelno, record.levelname = levelno, logging.getLevelName(levelno)
    assert json.loads(JsonFormatter().format(record))["severity"] == logging.getLevelName(levelno)


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
    record.__dict__.update(
        {"timestamp": "evil", "severity": "evil", "logger": "evil", "message": "evil", "foo": "bar"}
    )
    data = json.loads(JsonFormatter().format(record))
    assert data["timestamp"] != "evil"
    assert data["severity"] == "INFO"
    assert data["logger"] == "t"
    assert data["message"] == "hello"
    assert data["foo"] == "bar"


def test_extra_cannot_inject_the_trace_field_even_when_there_is_no_trace() -> None:
    record = _record()
    record.__dict__[TRACE_KEY] = "projects/evil/traces/evil"
    assert TRACE_KEY not in json.loads(JsonFormatter(project_id="p").format(record))


def test_color_message_added_by_uvicorn_is_dropped() -> None:
    record = _record()
    record.__dict__["color_message"] = "\x1b[1mhello\x1b[0m"
    assert "color_message" not in json.loads(JsonFormatter().format(record))


# --- logging.googleapis.com/trace -------------------------------------------------------


def _trace_of(record_trace_id: str | None, project_id: str | None) -> dict[str, object]:
    token = trace_ctx.set(record_trace_id)
    try:
        record = _record()
        RequestIdFilter().filter(record)
        return json.loads(JsonFormatter(project_id=project_id).format(record))  # type: ignore[no-any-return]
    finally:
        trace_ctx.reset(token)


def test_trace_field_is_built_from_project_and_trace_id() -> None:
    data = _trace_of(TRACE_ID, "my-proj")
    assert data[TRACE_KEY] == f"projects/my-proj/traces/{TRACE_ID}"


def test_trace_field_is_omitted_without_project_id() -> None:
    assert TRACE_KEY not in _trace_of(TRACE_ID, None)


def test_trace_field_is_omitted_without_trace_id() -> None:
    assert TRACE_KEY not in _trace_of(None, "my-proj")


async def test_logs_of_a_request_carry_the_trace_from_the_cloud_trace_header(
    app: FastAPI, client: AsyncClient, log_stream: io.StringIO
) -> None:
    @app.get("/_test/log-trace")
    async def _log() -> dict[str, str]:
        logging.getLogger("tests.route").info("inside handler")
        return {}

    await client.get(
        "/_test/log-trace", headers={"X-Cloud-Trace-Context": f"{TRACE_ID}/1234567;o=1"}
    )

    lines = [json.loads(x) for x in log_stream.getvalue().splitlines()]
    lines = [line for line in lines if line["logger"] != "httpx"]
    assert {"inside handler", "request_completed"} <= {line["message"] for line in lines}
    assert all(line[TRACE_KEY] == f"projects/test-project/traces/{TRACE_ID}" for line in lines)


async def test_trace_id_is_normalized_to_lowercase(
    app: FastAPI, client: AsyncClient, log_stream: io.StringIO
) -> None:
    await client.get("/healthz", headers={"X-Cloud-Trace-Context": TRACE_ID.upper()})

    completed = _completed_line(log_stream)
    assert completed[TRACE_KEY] == f"projects/test-project/traces/{TRACE_ID}"


@pytest.mark.parametrize(
    "header",
    [
        "../../etc/passwd",
        "abc123/1;o=1",  # too short
        "g" * 32 + "/1;o=1",  # not hex
        TRACE_ID + "00/1;o=1",  # too long
        f"{TRACE_ID}/abc;o=1",  # span id is not decimal
        f"{TRACE_ID}/1;o=7",  # bad sampled flag
        "",
    ],
)
async def test_missing_or_malformed_trace_header_adds_no_trace_field(
    client: AsyncClient, log_stream: io.StringIO, header: str
) -> None:
    await client.get("/healthz", headers={"X-Cloud-Trace-Context": header})

    assert TRACE_KEY not in _completed_line(log_stream)


async def test_request_without_trace_header_adds_no_trace_field(
    client: AsyncClient, log_stream: io.StringIO
) -> None:
    await client.get("/healthz")

    assert TRACE_KEY not in _completed_line(log_stream)


async def test_trace_context_is_reset_after_request(client: AsyncClient) -> None:
    await client.get("/healthz", headers={"X-Cloud-Trace-Context": f"{TRACE_ID}/1;o=1"})
    assert trace_ctx.get() is None


def _completed_line(log_stream: io.StringIO) -> dict[str, object]:
    lines = [json.loads(x) for x in log_stream.getvalue().splitlines()]
    return next(line for line in lines if line["message"] == "request_completed")


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
    assert logging.getLogger("uvicorn.access").disabled is True
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


@pytest.mark.usefixtures("restore_logging")
def test_uvicorn_logs_come_out_as_json_with_severity(capsys: pytest.CaptureFixture[str]) -> None:
    _simulate_uvicorn_dict_config()
    configure_logging("INFO")

    uvicorn_error = logging.getLogger("uvicorn.error")
    uvicorn_error.info(
        "Uvicorn running on %s", "http://0.0.0.0:8080", extra={"color_message": "\x1b[1mx\x1b[0m"}
    )
    try:
        raise ValueError("boom")
    except ValueError:
        uvicorn_error.exception("Exception in ASGI application")

    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert [line["severity"] for line in lines] == ["INFO", "ERROR"]
    assert all(line["logger"] == "uvicorn.error" for line in lines)
    assert lines[0]["message"] == "Uvicorn running on http://0.0.0.0:8080"
    assert "color_message" not in lines[0]
    assert "ValueError: boom" in lines[1]["exception"]


@pytest.mark.usefixtures("restore_logging")
async def test_lifespan_passes_the_gcp_project_to_the_log_formatter(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj-123")
    get_settings.cache_clear()
    token = trace_ctx.set(TRACE_ID)
    try:
        async with app.router.lifespan_context(app):
            logging.getLogger("tests.lifespan").info("inside lifespan")
    finally:
        trace_ctx.reset(token)

    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    line = next(x for x in lines if x["message"] == "inside lifespan")
    assert line[TRACE_KEY] == f"projects/proj-123/traces/{TRACE_ID}"


def _staging_app(monkeypatch: pytest.MonkeyPatch) -> FastAPI:
    monkeypatch.setenv("ENV", "staging")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@localhost:5432/x")
    get_settings.cache_clear()
    return create_app()


@pytest.mark.usefixtures("restore_logging")
async def test_lifespan_warns_when_not_local_and_the_gcp_project_is_missing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    app = _staging_app(monkeypatch)

    async with app.router.lifespan_context(app):
        pass

    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    warnings = [x for x in lines if x["severity"] == "WARNING"]
    assert [x["message"] for x in warnings] == ["gcp_project_not_set"]


@pytest.mark.usefixtures("restore_logging")
async def test_lifespan_does_not_warn_when_the_gcp_project_is_set(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    app = _staging_app(monkeypatch)
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj-123")
    get_settings.cache_clear()

    async with app.router.lifespan_context(app):
        pass

    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert not [x for x in lines if x["severity"] == "WARNING"]


@pytest.mark.usefixtures("restore_logging")
async def test_lifespan_does_not_warn_in_local_without_a_gcp_project(
    app: FastAPI, capsys: pytest.CaptureFixture[str]
) -> None:
    async with app.router.lifespan_context(app):
        pass

    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert not [x for x in lines if x["severity"] == "WARNING"]
