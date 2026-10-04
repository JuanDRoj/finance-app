#!/usr/bin/env python3
"""Batería de pruebas de los hooks (guard_cloud, guard_scope, check_trust).

Ejecuta los hooks REALES del repo contra un proyecto temporal (no toca el repo).
Uso: python3 .claude/hooks/tests/test_hooks.py   (sale con código 1 si algo falla)
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HOOKS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)


def make_project(with_env=True):
    d = os.path.realpath(tempfile.mkdtemp(prefix="hooktest-"))
    for sub in ("backend/app", "frontend/src", "docs"):
        os.makedirs(f"{d}/{sub}")
    if with_env:
        write(f"{d}/infra/env/staging.env",
              "# IDs no secretos\nGCP_PROJECT_ID=finance-stg-123\nREGION=southamerica-east1\nSQL_INSTANCE=finance-db-stg\n")
    write(f"{d}/infra/scripts/lib.sh",
          'set -euo pipefail\nsource "$(dirname "$0")/../env/staging.env"\n'
          'run() { if [[ "${DRY_RUN:-0}" == 1 ]]; then echo "$@"; else "$@"; fi; }\n')
    write(f"{d}/infra/scripts/20_cloud_sql.sh",
          '#!/usr/bin/env bash\nsource "$(dirname "$0")/lib.sh"\n# crea la instancia (nunca en prod)\n'
          'run gcloud sql instances describe "$SQL_INSTANCE" --project "$GCP_PROJECT_ID" \\\n'
          '  || run gcloud sql instances create "$SQL_INSTANCE" --project "$GCP_PROJECT_ID" --region "$REGION" --tier db-f1-micro\n')
    write(f"{d}/infra/scripts/90_cleanup.sh",
          '#!/usr/bin/env bash\nsource "$(dirname "$0")/lib.sh"\ngcloud sql instances delete "$SQL_INSTANCE" --project "$GCP_PROJECT_ID" --quiet\n')
    write(f"{d}/infra/scripts/30_other.sh",
          '#!/usr/bin/env bash\ngcloud run deploy api --project finance-other-999 --region southamerica-east1\n')
    write(f"{d}/infra/scripts/40_noproject.sh",
          '#!/usr/bin/env bash\ngcloud run services list --region southamerica-east1\n')
    write(f"{d}/infra/scripts/50_local.sh", '#!/usr/bin/env bash\necho "solo local"\ndocker compose up -d\n')
    write(f"{d}/infra/scripts/60_nested.sh", '#!/usr/bin/env bash\nbash "$(dirname "$0")/90_cleanup.sh"\n')
    write(f"{d}/.env", "SECRET_GCLOUD=gcloud run deploy x --project prod\n")
    write(f"{d}/infra/scripts/70_reads_env.sh", '#!/usr/bin/env bash\nsource ../../.env\n')
    return d


def run_hook(script, args, payload, project):
    env = dict(os.environ, CLAUDE_PROJECT_DIR=project)
    out = subprocess.run(["python3", os.path.join(HOOKS, script), *args],
                         input=json.dumps(payload), capture_output=True, text=True, env=env)
    if out.returncode != 0:
        return "ERROR", out.stderr.strip()[-300:]
    if not out.stdout.strip():
        return None, ""
    data = json.loads(out.stdout)["hookSpecificOutput"]
    return data["permissionDecision"], data["permissionDecisionReason"]


results = {"ok": 0, "fail": 0}


def expect(label, got, expected, reason):
    status = "OK  " if got == expected else "FAIL"
    results["ok" if got == expected else "fail"] += 1
    short = reason.replace("\n", " | ")[:150]
    print(f"{status} {label:<64} → {str(got):<5} (esperado {expected}) {short if got != expected or got else ''}")


def cloud(project, command, expected, cwd=None):
    payload = {"tool_name": "Bash", "tool_input": {"command": command}, "cwd": cwd or project}
    got, reason = run_hook("guard_cloud.py", [], payload, project)
    expect(command.replace("\n", "\\n")[:64], got, expected, reason)


def scope(project, label, rules, tool, value, expected, agent="backend-dev", main_only=False, cwd=None):
    payload = {"tool_name": tool, "cwd": cwd or project}
    payload["tool_input"] = {"command": value} if tool == "Bash" else {"file_path": value}
    if agent:
        payload["agent_id"] = "a1"
        payload["agent_type"] = agent
    args = (["--main-only"] if main_only else []) + rules
    got, reason = run_hook("guard_scope.py", args, payload, project)
    expect(f"[{agent or 'main'}] {label}"[:64], got, expected, reason)


P = make_project(with_env=True)
Q = make_project(with_env=False)
try:
    print("=== guard_cloud · con infra/env/staging.env (GCP_PROJECT_ID=finance-stg-123) ===")
    cloud(P, "gcloud run services delete x --project finance-stg-123", "deny")
    cloud(P, "gcloud sql instances create db --project finance-production", "deny")
    cloud(P, "gcloud run deploy api --project finance-stg-123 --region southamerica-east1", None)
    cloud(P, "gcloud run deploy api --project=finance-other-1", "deny")
    cloud(P, "gcloud run deploy api --region southamerica-east1", "deny")
    cloud(P, 'gcloud run deploy api --project "$GCP_PROJECT_ID"', None)
    cloud(P, 'gcloud run deploy api --project "$UNKNOWN_VAR"', "ask")
    cloud(P, "gcloud auth list", None)
    cloud(P, "gcloud --version", None)
    cloud(P, "gcloud projects list", None)
    cloud(P, "gcloud projects create finance-stg-123", None)
    cloud(P, "gcloud config set project finance-stg-123", "ask")
    cloud(P, "gcloud config set project finance-other", "deny")
    cloud(P, "gcloud iam service-accounts keys create k.json --iam-account x --project finance-stg-123", "deny")
    cloud(P, "firebase emulators:start --only auth", None)
    cloud(P, "firebase deploy --only hosting", "deny")
    cloud(P, "firebase deploy -P finance-stg-123", None)
    cloud(P, "vercel --prod", "deny")
    cloud(P, 'bash -c "gcloud run deploy x --project finance-other"', "deny")
    cloud(P, "bash infra/scripts/20_cloud_sql.sh", "ask")
    cloud(P, "DRY_RUN=1 ./infra/scripts/20_cloud_sql.sh", "ask")
    cloud(P, "cd infra && bash scripts/20_cloud_sql.sh", "ask")
    cloud(P, "bash infra/scripts/90_cleanup.sh", "deny")
    cloud(P, "./infra/scripts/30_other.sh", "deny")
    cloud(P, "bash infra/scripts/40_noproject.sh", "deny")
    cloud(P, "bash infra/scripts/50_local.sh", None)
    cloud(P, "bash infra/scripts/60_nested.sh", "deny")
    cloud(P, "bash infra/scripts/70_reads_env.sh", None)  # nunca lee .env
    cloud(P, "source infra/scripts/lib.sh", None)
    cloud(P, "git commit -F - <<'EOF'\nchore: block gcloud prod access\nEOF", None)
    cloud(P, "git push origin HEAD:main", "deny")
    cloud(P, "git push --force origin kan-1-x", "deny")
    cloud(P, "rm -rf /", "deny")
    cloud(P, "uv run alembic downgrade -1", "ask")
    cloud(P, 'echo "gcloud is great"', None)
    cloud(P, "which gcloud", None)
    cloud(P, "git status", None)

    print("\n=== guard_cloud · SIN staging.env (antes de KAN-9) ===")
    cloud(Q, "gcloud run deploy api --project finance-stg-123", "ask")
    cloud(Q, "gcloud run deploy api --project finance-prod", "deny")
    cloud(Q, "gcloud run deploy api", "deny")

    print("\n=== guard_scope · backend-dev (backend/) ===")
    B = ["backend/"]
    scope(P, "Edit backend/app/main.py", B, "Edit", f"{P}/backend/app/main.py", None)
    scope(P, "Write frontend/x.ts", B, "Write", f"{P}/frontend/x.ts", "deny")
    scope(P, "Write fuera del repo", B, "Write", "/tmp/x.txt", "deny")
    scope(P, "rm -rf frontend/src", B, "Bash", "rm -rf frontend/src", "deny")
    scope(P, "rm -rf backend/app/__pycache__", B, "Bash", "rm -rf backend/app/__pycache__", None)
    scope(P, "cd backend && rm -rf ../frontend", B, "Bash", "cd backend && rm -rf ../frontend", "deny")
    scope(P, "sed -i frontend", B, "Bash", "sed -i 's/a/b/' frontend/src/x.ts", "deny")
    scope(P, "sed -i backend", B, "Bash", "sed -i 's/a/b/' backend/app/x.py", None)
    scope(P, "sed sin -i (solo lee)", B, "Bash", "sed -n '1,5p' frontend/src/x.ts", None)
    scope(P, "echo > frontend/x", B, "Bash", "echo hi > frontend/x", "deny")
    scope(P, "pytest | tee /tmp/out.log", B, "Bash", "cd backend && uv run pytest 2>&1 | tee /tmp/out.log", None)
    scope(P, "cp backend → frontend", B, "Bash", "cp backend/openapi.json frontend/openapi.json", "deny")
    scope(P, "cp frontend → backend", B, "Bash", "cp frontend/x.ts backend/x.ts", None)
    scope(P, "mv backend → frontend", B, "Bash", "mv backend/a.py frontend/a.py", "deny")
    scope(P, "find frontend -delete", B, "Bash", "find frontend -name '*.ts' -delete", "deny")
    scope(P, "mkdir -p backend/app/modules", B, "Bash", "mkdir -p backend/app/modules/accounts", None)
    scope(P, "bash -c rm frontend", B, "Bash", 'bash -c "rm -rf frontend"', "deny")
    scope(P, 'rm "$TARGET"', B, "Bash", 'rm "$TARGET"', "ask")
    scope(P, "ruff > /dev/null 2>&1", B, "Bash", "cd backend && uv run ruff check . > /dev/null 2>&1", None)
    scope(P, "cat > frontend/x <<EOF", B, "Bash", "cat > frontend/x <<EOF\nhola\nEOF", "deny")
    scope(P, "rm -rf * en la raíz", B, "Bash", "rm -rf *", "deny")
    scope(P, "git status", B, "Bash", "git status", None)
    scope(P, "git diff main...HEAD", B, "Bash", "git diff main...HEAD", None)
    scope(P, "git branch --list kan-*", B, "Bash", 'git branch --list "kan-*"', None)
    scope(P, "git commit", B, "Bash", "git commit -m x", "deny")
    scope(P, "git -C backend add .", B, "Bash", "git -C backend add .", "deny")
    scope(P, "git branch -D foo", B, "Bash", "git branch -D foo", "deny")
    scope(P, "git switch main", B, "Bash", "git switch main", "deny")

    print("\n=== guard_scope · qa ===")
    QA = ["backend/tests/", "frontend/e2e/", "frontend/playwright.config.ts",
          "frontend/*.test.ts", "frontend/*.test.tsx", "docs/qa/"]
    scope(P, "mkdir -p frontend/e2e", QA, "Bash", "mkdir -p frontend/e2e", None, agent="qa")
    scope(P, "mkdir -p docs/qa", QA, "Bash", "mkdir -p docs/qa", None, agent="qa")
    scope(P, "touch frontend/src/lib/money.test.ts", QA, "Bash", "touch frontend/src/lib/money.test.ts", None, agent="qa")
    scope(P, "rm backend/app/main.py", QA, "Bash", "rm backend/app/main.py", "deny", agent="qa")
    scope(P, "Write backend/tests/api/test_x.py", QA, "Write", f"{P}/backend/tests/api/test_x.py", None, agent="qa")

    print("\n=== guard_scope · reviewer (sin rutas: solo lectura) ===")
    scope(P, "git diff main...HEAD", [], "Bash", "git diff main...HEAD", None, agent="reviewer")
    scope(P, "git checkout main", [], "Bash", "git checkout main", "deny", agent="reviewer")
    scope(P, "echo > backend/a", [], "Bash", "echo x > backend/a", "deny", agent="reviewer")
    scope(P, "git log > /tmp/x (fuera del repo)", [], "Bash", "git log --oneline > /tmp/x", None, agent="reviewer")

    print("\n=== guard_scope · orquestador durante /tarea (--main-only) ===")
    M = [".claude/", "CLAUDE.md", "*/CLAUDE.md", "docs/", "README.md"]
    scope(P, "Edit backend/app/main.py", M, "Edit", f"{P}/backend/app/main.py", "deny", agent=None, main_only=True)
    scope(P, "Edit docs/x.md", M, "Edit", f"{P}/docs/x.md", None, agent=None, main_only=True)
    scope(P, "Edit backend/CLAUDE.md", M, "Edit", f"{P}/backend/CLAUDE.md", None, agent=None, main_only=True)
    scope(P, "Write scratchpad (fuera del repo)", M, "Write", "/tmp/scratch/x.md", None, agent=None, main_only=True)
    scope(P, "git add + commit", M, "Bash", 'git add backend/app/main.py && git commit -m "KAN-1 feat: x"',
          None, agent=None, main_only=True)
    scope(P, "commit con heredoc que tiene '>'", M, "Bash", "git commit -F - <<'EOF'\n> línea citada\nEOF",
          None, agent=None, main_only=True)
    scope(P, "gh pr create --body con >", M, "Bash", 'gh pr create --title t --body "a > b"',
          None, agent=None, main_only=True)
    scope(P, "rm -rf backend/app", M, "Bash", "rm -rf backend/app", "deny", agent=None, main_only=True)
    scope(P, "subagente con --main-only → no objeta", M, "Edit", f"{P}/backend/x.py", None,
          agent="backend-dev", main_only=True)

    print("\n=== check_trust (SessionStart) ===")
    config_dir = tempfile.mkdtemp(prefix="hooktest-config-")
    for label, projects, expected in [
        ("repo confiable → silencio", {P: {"hasTrustDialogAccepted": True}}, None),
        ("repo no confiable → aviso", {P: {"hasTrustDialogAccepted": False}}, "warn"),
        ("solo la carpeta padre confiable → aviso", {os.path.dirname(P): {"hasTrustDialogAccepted": True}}, "warn"),
    ]:
        write(f"{config_dir}/.claude.json", json.dumps({"projects": projects}))
        env = dict(os.environ, CLAUDE_PROJECT_DIR=P, CLAUDE_CONFIG_DIR=config_dir)
        out = subprocess.run(["python3", os.path.join(HOOKS, "check_trust.py")],
                             input=json.dumps({"hook_event_name": "SessionStart", "source": "startup", "cwd": P}),
                             capture_output=True, text=True, env=env)
        got = "warn" if out.stdout.strip() and "systemMessage" in json.loads(out.stdout) else None
        expect(label, got, expected, out.stdout or out.stderr)
    shutil.rmtree(config_dir)
finally:
    shutil.rmtree(P)
    shutil.rmtree(Q)

print(f"\nResultado: {results['ok']} ok · {results['fail']} fallidas")
sys.exit(1 if results["fail"] else 0)
