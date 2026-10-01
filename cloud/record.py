"""Record a demo scenario on Modal with Xvfb + record-bot.

    PYTHONPATH=cloud/pythonpath uv run --with modal modal token new
    PYTHONPATH=cloud/pythonpath uv run --with modal modal run cloud/record.py --scenario github

PYTHONPATH loads OS CAs (Keychain / Windows store) because Modal trusts
certifi only. If token new prints Connection lost, create a token in the
dashboard and run: modal token set --no-verify --profile default
From a laptop that cannot reach api.modal.com, run .github/workflows/modal-record.yml
(set MODAL_TOKEN_ID / MODAL_TOKEN_SECRET repo secrets).
"""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

import modal

REPO = Path(__file__).resolve().parent.parent
REMOTE_ROOT = "/opt/record-bot"
DISPLAY = ":99"
WIDTH = 3840
HEIGHT = 2160

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install(
        "ca-certificates",
        "curl",
        "ffmpeg",
        "fonts-liberation",
        "make",
        "wmctrl",
        "x11-utils",
        "xdotool",
        "xvfb",
        "xz-utils",
    )
    .run_commands(
        "curl -fsSL https://nodejs.org/dist/v22.18.0/node-v22.18.0-linux-x64.tar.xz "
        "| tar -xJ -C /usr/local --strip-components=1",
        "node -v",
        "npm -v",
    )
    .add_local_dir(
        str(REPO),
        REMOTE_ROOT,
        copy=True,
        ignore=[
            ".cache/**",
            ".cursor/**",
            ".git/**",
            ".release-files/**",
            ".venv/**",
            "demo/out/**",
            "node_modules/**",
        ],
    )
    .run_commands(
        f"chmod +x {REMOTE_ROOT}/bin/record-bot",
        f"cd {REMOTE_ROOT} && npm ci",
        f"cd {REMOTE_ROOT} && npx playwright install-deps chromium",
        f"cd {REMOTE_ROOT} && npx playwright install chromium",
    )
)

app = modal.App("record-bot", image=image)


def start_display() -> dict[str, str]:
    env = os.environ.copy()
    env["DISPLAY"] = DISPLAY
    env["RECORD_BOT_FFMPEG"] = "/usr/bin/ffmpeg"
    env["RECORD_BOT_DEMO_HIDPI"] = "1"
    env["RECORD_BOT_DEMO_DEBUG"] = "1"
    env["RECORD_BOT_DISPLAY_SIZE"] = f"{WIDTH}x{HEIGHT}"
    subprocess.Popen(
        [
            "Xvfb",
            DISPLAY,
            "-screen",
            "0",
            f"{WIDTH}x{HEIGHT}x24",
            "-ac",
            "+extension",
            "RANDR",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(0.8)
    os.environ["DISPLAY"] = DISPLAY
    os.environ["RECORD_BOT_FFMPEG"] = env["RECORD_BOT_FFMPEG"]
    os.environ["RECORD_BOT_DEMO_HIDPI"] = "1"
    os.environ["RECORD_BOT_DISPLAY_SIZE"] = env["RECORD_BOT_DISPLAY_SIZE"]
    return env


@app.function(timeout=20 * 60, memory=8192, cpu=2)
def record_demo(scenario: str = "harbor") -> bytes:
    env = start_display()
    output = Path(f"/tmp/{scenario}.mp4")
    result = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            str(Path(REMOTE_ROOT) / "demo" / "record.ts"),
            "--scenario",
            scenario,
            "--no-voiceover",
            "-o",
            str(output),
        ],
        cwd=REMOTE_ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=15 * 60,
    )
    log = ((result.stdout or "") + "\n" + (result.stderr or "")).strip()
    print(log[-12000:], flush=True)
    if result.returncode != 0 or not output.is_file():
        raise RuntimeError(
            f"{scenario} demo failed\n"
            f"exit={result.returncode}\n"
            f"{log[-8000:]}"
        )
    return output.read_bytes()


@app.local_entrypoint()
def main(scenario: str = "harbor"):
    """Record one scenario. Pass several comma-separated to batch them:

        modal run cloud/record.py --scenario github
        modal run cloud/record.py --scenario harbor,github
    """
    out_dir = REPO / "demo" / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    names = [name.strip() for name in scenario.split(",") if name.strip()]
    for name in names:
        data = record_demo.remote(name)
        dest = out_dir / f"modal-{name}.mp4"
        dest.write_bytes(data)
        print(f"wrote {len(data)} bytes to {dest}")
