# Imagen del backend (KAN-13, INF-07). La misma imagen sirve para el servicio de Cloud Run y para el
# job de migraciones: el job solo cambia el comando (`alembic upgrade head`).
#
# Construir (desde la raiz del repo):  docker build --platform linux/amd64 -t finance-api:local backend/
# En staging la sube infra/scripts/cloud_run_image.sh; el despliegue lo hace Cloud Run, no este archivo.
#
# Versiones fijadas (como en infra/firebase-emulator/Dockerfile): para subirlas, cambia solo estas lineas.

# --- Etapa 1: dependencias ---------------------------------------------------------------------------
# uv resuelve desde uv.lock (--locked falla si pyproject.toml y el lock no coinciden). Todas las
# dependencias del lock tienen wheel para linux/x86_64, asi que no hacen falta compiladores.
FROM python:3.14.8-slim-trixie AS builder

COPY --from=ghcr.io/astral-sh/uv:0.12.23 /uv /usr/local/bin/uv

# UV_PYTHON_DOWNLOADS=never: usa el Python de la imagen (requires-python es ==3.14.*), no descarga otro.
# UV_COMPILE_BYTECODE: deja los .pyc hechos para que el arranque en frio no los genere.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project

# --- Etapa 2: imagen final ---------------------------------------------------------------------------
# Misma base que la etapa 1 (el .venv apunta al Python de /usr/local/bin), sin uv ni cachés.
FROM python:3.14.8-slim-trixie AS runtime

# Usuario sin privilegios y sin shell. El codigo queda de root y de solo lectura para la app.
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent \
        --shell /usr/sbin/nologin app

WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
# Solo lo que corre en produccion: nada de tests, .env, cachés ni openapi.json (ver .dockerignore).
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./
RUN python -m compileall -q app migrations

# Config de logging de uvicorn: sus lineas de arranque ("Started server process"...) salen antes
# del lifespan, y sin esto irian en texto plano por stderr. Con esto salen en JSON por stdout con el
# mismo formateador que el resto de la app (severity, message, timestamp). Cuando arranca la app,
# configure_logging (lifespan) toma el control y mantiene el mismo formato.
COPY <<'EOF' /app/uvicorn-log.json
{
  "version": 1,
  "disable_existing_loggers": false,
  "formatters": {"json": {"()": "app.core.logging.JsonFormatter"}},
  "handlers": {
    "stdout": {"class": "logging.StreamHandler", "stream": "ext://sys.stdout", "formatter": "json"}
  },
  "loggers": {
    "uvicorn": {"handlers": ["stdout"], "level": "INFO", "propagate": false},
    "uvicorn.error": {"level": "INFO"},
    "uvicorn.access": {"handlers": [], "level": "WARNING", "propagate": false}
  }
}
EOF

# PATH con el venv: `alembic` y `uvicorn` se resuelven sin ruta (el job corre `alembic upgrade head`).
# PORT: Cloud Run lo define (8080); el valor de aqui solo sirve para correr la imagen a mano.
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

USER 10001:10001
EXPOSE 8080

# exec: uvicorn queda como PID 1 y recibe el SIGTERM de Cloud Run (10 s para cerrar).
# --proxy-headers con --forwarded-allow-ips '*': el contenedor solo es alcanzable a traves del
# frontal de Google, que pone X-Forwarded-*. --no-access-log: el access log lo emite
# RequestIdMiddleware (con request_id y traza).
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips '*' --log-config /app/uvicorn-log.json --no-access-log --timeout-graceful-shutdown 10"]
