# Agent notes

record-bot is a non-interactive CLI. Drive it with subprocesses. Never expect a TTY prompt.

The product playbook is what an installed CLI prints: `record-bot skill --json`. Source for that file is `skills/record-bot/SKILL.md`. For flags and JSON shapes, run `record-bot schema --json`.

## Contract

- Exit `0` on success, `1` on failure.
- Pass `--json`. Stdout is exactly one JSON object. Everything else is on stderr.
- Always pass `--duration` for `record` unless you will send SIGINT/SIGTERM yourself.
- Always pass `-o` with an absolute path you control.
- Do not parse stderr.
- Wait until the process exits. After capture it composes the styled MP4 (padding, background, crop, auto-zoom, cursor). That extra pass can take as long as the recording.

## Typical flow

```bash
record-bot skill --json
record-bot schema --json
record-bot sources --json
record-bot record --screen 1 -o /tmp/demo.mp4 --duration 10 --json
record-bot voiceover --text "Welcome to the demo." -o /tmp/vo.wav --json
record-bot mux --video /tmp/demo.mp4 --audio /tmp/vo.wav -o /tmp/demo.narrated.mp4 --json
```

`schema --json` prints commands, flags (types, defaults, constraints), env vars, and JSON success/failure shapes. Agents should read that before calling `record`, `voiceover`, or `mux`.

Optional `--crop x,y,w,h` (or `WxH+X+Y`) keeps only that rectangle of the raw capture in the styled MP4.

Success JSON includes `path` (styled) and `rawPath` (unstyled capture). Audio sidecars and `*.cursor.jsonl` sit next to the raw file.

Raw only:

```bash
record-bot record --screen 1 -o /tmp/demo.mp4 --duration 10 --no-style --json
```

Pick a window with `--window-id` from `sources` when more than one title matches `--window`.

## Signals

SIGINT and SIGTERM stop capture, write the raw MP4, compose the styled file to `-o`, then exit. Wait for the process; do not kill -9 unless it hangs.

## Permissions

macOS Screen Recording must be granted to the same process you spawn (the `record-bot` release binary, Terminal, `node`, or your agent runtime). A missing grant fails `record` rather than hanging forever; the helper times out in about 10s.

## Layout

- `cli/` Node CLI
- `native/darwin/` ScreenCaptureKit capture, source list, and cursor logger
- `native/bin/<platform-arch>/` built helpers (`capture`, `sources`, `cursor`)
- `bin/record-bot` npm entry
- `Makefile` compiles capture tools (`make capture`), installs F5-TTS (`make f5-tts`), logs into Modal (`make modal-login`), and stages release files (`make bundle`)
- `cloud/record.py` Modal worker: Xvfb + Harbor demo (`make modal-login`, `make modal-record`, or `.github/workflows/modal-record.yml`)

`voiceover` auto-installs F5-TTS unless `.venv` or `RECORD_BOT_F5TTS_PYTHON` is present. Preinstall with `record-bot install-tts --json`. Pass `--json` and an absolute `-o`. First synthesis downloads weights (~1.3GB) unless `install-tts` already fetched them. Logs stay on stderr; wait until the process exits.

## Demo

`demo/` is a scenario-driven Playwright walkthrough recorded with record-bot (it calls `voiceover`, `record`, and `mux`). Each demo is a `Scenario` in `demo/scenarios/`; the generic engine lives in `demo/engine.ts`.

- `demo/engine.ts` — launches Chromium, points it at the target, records, and muxes. `DemoContext` exposes the polished OS-pointer helpers: `moveTo`, `moveAndClick`, `moveAndType`, cursor-kind hinting, plus canvas helpers `moveToPoint`/`drag` (real press-drag-release for whiteboards) and `viewportSize`.
- `demo/scenarios/` — one file per demo. A scenario targets either a `local` static app (served over HTTP, e.g. Harbor) or a live `url` (GitHub, Excalidraw, OpenStreetMap). Voiceover is optional per scenario.
- `demo/scenarios/index.ts` — registry. Add a demo by dropping a file here and registering it.

```bash
make f5-tts
npx playwright install chromium
npm run demo -- --list                 # list scenarios
npm run demo                           # default scenario (harbor)
npm run demo -- --scenario github      # live GitHub tour
npm run demo -- --scenario github --no-voiceover
```

Writes `demo/out/<scenario>.mp4`. Pass `--no-voiceover` to skip TTS. Live-URL scenarios must stay login-free and lean on durable selectors (GitHub uses the `nav[aria-label="Repository"]` tabs). Screen Recording must be granted to the Node process on macOS.
