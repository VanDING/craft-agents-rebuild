from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]
BIN_DIR = REPO_ROOT / "apps" / "electron" / "resources" / "bin"
SCRIPTS_DIR = REPO_ROOT / "apps" / "electron" / "resources" / "scripts"


def resolve_platform_key() -> str:
    sys_name = platform.system().lower()
    machine = platform.machine().lower()

    if machine in ("x86_64", "amd64"):
        arch = "x64"
    elif machine in ("arm64", "aarch64"):
        arch = "arm64"
    else:
        arch = machine

    if sys_name.startswith("darwin"):
        os_key = "darwin"
    elif sys_name.startswith("linux"):
        os_key = "linux"
    elif sys_name.startswith("windows"):
        os_key = "win32"
    else:
        os_key = os.name

    return f"{os_key}-{arch}"


def resolve_uv_binary() -> Path:
    platform_key = resolve_platform_key()
    uv_name = "uv.exe" if os.name == "nt" else "uv"
    bundled = BIN_DIR / platform_key / uv_name
    if bundled.exists():
        return bundled

    fallback = shutil.which("uv")
    if fallback:
        return Path(fallback)

    raise FileNotFoundError(f"No bundled uv at {bundled} and no uv on PATH")


def resolve_wrapper(tool_name: str) -> Path:
    wrapper = BIN_DIR / (f"{tool_name}.cmd" if os.name == "nt" else tool_name)
    if not wrapper.exists():
        raise FileNotFoundError(f"{tool_name} wrapper not found: {wrapper}")
    return wrapper


def build_env() -> dict[str, str]:
    uv = resolve_uv_binary()
    env = dict(os.environ)
    env["CRAFT_UV"] = str(uv)
    env["CRAFT_SCRIPTS"] = str(SCRIPTS_DIR)
    env["PATH"] = os.pathsep.join([
        str(BIN_DIR),
        str(uv.parent),
        env.get("PATH", ""),
    ])
    return env


# Matches the uv invocation line inside a .cmd wrapper, capturing the python
# version and script name so the harness stays in lockstep with the wrappers.
_UV_WRAPPER_RE = re.compile(
    r'"%CRAFT_UV%"\s+run\s+--python\s+(\S+)\s+"%CRAFT_SCRIPTS%\\([A-Za-z0-9_]+\.py)"'
)


def resolve_uv_invocation(tool_name: str) -> tuple[str, Path] | None:
    """Return (python_version, script) the wrapper would run, or None if the
    wrapper is not a uv-based one (e.g. craft-agent.cmd)."""
    wrapper = resolve_wrapper(tool_name)
    for line in wrapper.read_text(encoding="utf-8", errors="ignore").splitlines():
        match = _UV_WRAPPER_RE.search(line)
        if match:
            return match.group(1), SCRIPTS_DIR / match.group(2)
    return None


def run_tool(tool_name: str, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    if env is None:
        env = build_env()
    # Windows: .cmd wrappers forward args through cmd.exe, which cannot carry
    # literal newlines inside an argument (a newline terminates the batch
    # command line). Tools legitimately receive multiline markdown via --text,
    # so on Windows we invoke the tool script directly through uv — the same
    # binary and script the wrapper forwards to, minus the cmd layer.
    # POSIX wrappers use "$@" and preserve arguments exactly, so they remain
    # under test unchanged.
    if os.name == "nt":
        invocation = resolve_uv_invocation(tool_name)
        if invocation is not None:
            python_version, script = invocation
            return subprocess.run(
                [str(env["CRAFT_UV"]), "run", "--python", python_version, str(script), *args],
                cwd=REPO_ROOT,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
    wrapper = resolve_wrapper(tool_name)
    return subprocess.run(
        [str(wrapper), *args],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
