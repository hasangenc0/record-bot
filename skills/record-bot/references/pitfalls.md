# Pitfalls

## Cursor and zoom

`--cursor` and `--zoom auto` follow the real OS pointer. In-page automation (`page.mouse.move`, `locator.click()`) does not move it. Warp or move the OS pointer to the control, then click. Do not draw a fake on-page cursor.

Zoom stays in while typing in the same area. It zooms out only on a long travel across the frame. If the overlay is consistently high or low on macOS, capture and cursor coordinates disagree.

## Audio

Generate voiceover first. Hold the UI through the first sentence. Record until the WAV would finish, then mux the styled `path`, not `rawPath`. `--delay` is a global shift only.

`--mic` records the microphone. It does not play the TTS track.

## Framing

A 1280×800 window on a 1920×1080 canvas leaves ~200px on each side even with `--padding 80`. Size the window nearer 16:9 first. Default `#1a1a24` disappears on dark apps; pass `--background`.

## Process

Wait for compose after SIGTERM. `kill -9` leaves a raw file and no styled MP4. The first `voiceover` needs network if F5-TTS is not installed yet; wait for that install. Preinstall in a VM with `record-bot install-tts --json`. `RECORD_BOT_F5TTS_PYTHON` overrides the managed env. If `record` fails in ~10s on macOS, Screen Recording is missing for the spawned process (`record-bot`, Terminal, or that runtime).
