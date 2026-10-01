#!/usr/bin/env python3
"""Generate a voiceover WAV with F5-TTS.

Stdout is exactly one JSON object. Everything else goes to stderr.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from importlib.resources import files


DEFAULT_MODEL = "F5TTS_v1_Base"
DEFAULT_REF_TEXT = "Some call me nature, others call me mother nature."


def configure_ffmpeg() -> None:
    lib_dirs = [
        os.environ.get("RECORD_BOT_FFMPEG_LIB"),
        "/opt/homebrew/opt/ffmpeg/lib",
        "/usr/local/opt/ffmpeg/lib",
    ]
    found = next((directory for directory in lib_dirs if directory and os.path.isdir(directory)), None)
    if not found:
        return
    for key in ("DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH", "LD_LIBRARY_PATH"):
        current = os.environ.get(key)
        os.environ[key] = found if not current else f"{found}{os.pathsep}{current}"


def configure_tls() -> None:
    cert = (
        os.environ.get("RECORD_BOT_SSL_CERT_FILE")
        or os.environ.get("SSL_CERT_FILE")
        or os.environ.get("REQUESTS_CA_BUNDLE")
        or os.environ.get("NODE_EXTRA_CA_CERTS")
    )
    if cert and os.path.isfile(cert):
        os.environ.setdefault("SSL_CERT_FILE", cert)
        os.environ.setdefault("REQUESTS_CA_BUNDLE", cert)
        os.environ.setdefault("CURL_CA_BUNDLE", cert)


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def fail(message: str, details: str | None = None) -> int:
    payload: dict = {"ok": False, "error": message}
    if details:
        payload["details"] = details
    emit(payload)
    return 1


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="voiceover.py")
    parser.add_argument("--text")
    parser.add_argument("--text-file")
    parser.add_argument("--ref-audio")
    parser.add_argument("--ref-text")
    parser.add_argument("-o", "--output", required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--nfe-step", type=int, default=32)
    parser.add_argument("--remove-silence", action="store_true")
    parser.add_argument("--device")
    return parser.parse_args(argv)


def bundled_ref_audio() -> str:
    return str(files("f5_tts").joinpath("infer/examples/basic/basic_ref_en.wav"))


def load_text(args: argparse.Namespace) -> str:
    if args.text_file:
        with open(args.text_file, encoding="utf-8") as handle:
            return handle.read().strip()
    return (args.text or "").strip()


def main(argv: list[str] | None = None) -> int:
    configure_ffmpeg()
    configure_tls()
    args = parse_args(sys.argv[1:] if argv is None else argv)
    text = load_text(args)
    if not text:
        return fail("Provide --text or --text-file with the words to speak.")

    output_path = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    ref_audio = os.path.abspath(args.ref_audio) if args.ref_audio else bundled_ref_audio()
    if not os.path.isfile(ref_audio):
        return fail(f"Reference audio not found: {ref_audio}")

    if args.ref_text is not None:
        ref_text = args.ref_text
    elif args.ref_audio:
        ref_text = ""
    else:
        ref_text = DEFAULT_REF_TEXT

    real_stdout = sys.stdout
    sys.stdout = sys.stderr
    device = "unknown"
    seed = 0
    wav = []
    sample_rate = 24000
    try:
        from f5_tts.api import F5TTS

        tts = F5TTS(model=args.model, device=args.device or None)

        def show_info(*values: object, **kwargs: object) -> None:
            kwargs.setdefault("file", sys.stderr)
            print(*values, **kwargs)

        wav, sample_rate, _spec = tts.infer(
            ref_file=ref_audio,
            ref_text=ref_text,
            gen_text=text,
            file_wave=output_path,
            remove_silence=args.remove_silence,
            speed=args.speed,
            nfe_step=args.nfe_step,
            seed=args.seed,
            show_info=show_info,
        )
        device = tts.device
        seed = tts.seed
    except Exception as error:
        sys.stdout = real_stdout
        return fail(str(error), traceback.format_exc())
    finally:
        sys.stdout = real_stdout

    duration_ms = int(round(len(wav) / float(sample_rate) * 1000))
    emit(
        {
            "ok": True,
            "path": output_path,
            "sampleRate": int(sample_rate),
            "durationMs": duration_ms,
            "model": args.model,
            "device": str(device),
            "seed": int(seed),
            "refAudio": ref_audio,
        }
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
