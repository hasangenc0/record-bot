---
name: record-bot
description: Record a screen or window to a styled MP4 with record-bot. Use when the user wants a product demo, screen recording, voiceover, auto-zoom, cursor overlay, mux, F5-TTS narration, or to capture a walkthrough.
---

# record-bot

Headless CLI for product recordings. You operate the app. record-bot captures, styles, speaks, and muxes. Never expect a TTY prompt.

The user installed `record-bot` (Homebrew or npm). It is on `PATH`. For flags, types, and JSON shapes:

```bash
record-bot schema --json
```

Do not invent flags.

## Contract

- Exit `0` on success, `1` on failure.
- Pass `--json`. Stdout is exactly one JSON object. Logs go to stderr. Do not parse stderr.
- Pass `-o` with an absolute path the user owns. Examples below use `/tmp`; on Windows use an absolute directory you control.
- For `record`, pass `--duration` unless you will send SIGINT or SIGTERM yourself.
- Wait until the process exits. After capture it composes the styled MP4. That pass can take as long as the recording.
- Stop an open-ended recording with SIGINT or SIGTERM. Do not `kill -9` unless it hangs.
- Do not mux until `record` has exited. Compose can take as long as the capture.

## JSON you will use

- `record`: `path` is the styled MP4. Mux and deliver that. `rawPath` is the unstyled capture — do not mux it.
- `voiceover`: `path` is the WAV. `durationMs` is milliseconds. Keep recording until delay + that duration, plus a short tail.
- `mux`: `path` is the narrated file to deliver.

## Permissions

On macOS, Screen Recording must be granted to the process you spawn (`record-bot`, Terminal, or the agent runtime). A missing grant fails `record` in about 10 seconds; it does not hang. Grant Microphone only if you use `--mic`.

## Roles

| Who | Job |
| --- | --- |
| You | Open the app, keep the window frontmost, click, type, move the **real OS pointer** |
| `record` | Capture a screen or window to a styled MP4 |
| `voiceover` | Write a WAV (F5-TTS) |
| `mux` | Overlay that WAV onto the **styled** MP4 (`path` from `record`, not `rawPath`) |

Playwright, Selenium, or a human can drive the UI. `page.mouse` does **not** move the OS pointer. `--cursor` and `--zoom auto` stay still unless the real pointer moves.

## Narrated walkthrough

1. `record-bot sources --json --windows` (or `--screens`). If several titles match, use `--window-id`.
2. Write spoken English (not UI labels). Generate audio **before** recording:

```bash
record-bot voiceover --text-file /tmp/script.txt -o /tmp/vo.wav --json
```

Use `durationMs` from that JSON. The first `voiceover` installs F5-TTS if needed (once; Python, PyTorch, and the TTS package). Wait for that process. First synthesis also downloads ~1.3GB of weights. On a VM or image, preinstall with `record-bot install-tts --json` so later voiceovers skip that wait. `RECORD_BOT_F5TTS_PYTHON` is an optional override.

3. Size the window near 16:9 if the canvas is 1920×1080. Keep it visible.
4. Start record **without** `--duration` if you do not know the length. Spawn it, then drive the UI, then SIGTERM. Hold the UI for the opening sentence before the first click. Keep recording until delay + `durationMs` plus a short tail.

```bash
record-bot record --window-id window:123 -o /tmp/demo.mp4 --zoom auto --cursor --json
```

5. Mux the styled file:

```bash
record-bot mux --video /tmp/demo.mp4 --audio /tmp/vo.wav -o /tmp/out.mp4 --json
```

`--video` must be `path` from `record` (styled). Do not mux `rawPath`. Deliver `path` from `mux`.

Skip voiceover: the styled `path` from `record` is the final file. `--mic` / `--system-audio` are live capture, not TTS.

Fixed-length capture with no UI script:

```bash
record-bot record --screen 1 -o /tmp/demo.mp4 --duration 10 --json
```

Raw only: add `--no-style` (`path` is then the raw file).

## Style

Default `-o` is 1920×1080: padding 80, background `#1a1a24`, cursor on, zoom auto (max 1.7). Raw sibling: `<name>.raw.mp4`.

| Goal | How |
| --- | --- |
| Thin even gutter | Window aspect near 16:9, then `--padding 40` |
| Dark UI that does not melt into the canvas | `--background` with a contrasting color or an image that exists |
| No overlay / no zoom | `--no-cursor --zoom off` |
| Keep a rectangle of the raw capture | `--crop x,y,w,h` or `WxH+X+Y` |

Huge left/right bars are a window that is too short for 16:9, not “too much padding”. Zoom waits until the pointer settles (~0.22s). It does not zoom during a long fly-in.

`--delay` on mux shifts the whole WAV. It cannot pin one sentence to one click.

`--ref-text` is the transcript of the **voice sample**, not the narration. F5-TTS misreads labels like “Done column” as “down”; write “mark it done”.
