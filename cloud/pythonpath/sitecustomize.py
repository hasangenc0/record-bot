"""Make Modal/grpclib trust the OS certificate store.

grpclib hardcodes Mozilla certifi and ignores Python's default CA path, the
Windows certificate store, and the macOS Keychain. On a corporate laptop those
stores already contain the intercept CA; Node's NODE_EXTRA_CA_CERTS bundle is
the wrong source.

Put this directory on PYTHONPATH before invoking `modal`.
"""

from __future__ import annotations

import ssl
import subprocess
import sys
import tempfile
from pathlib import Path


def _windows_store_pems() -> str:
    chunks: list[str] = []
    for store in ("CA", "ROOT"):
        try:
            entries = ssl.enum_certificates(store)
        except AttributeError:
            break
        except OSError:
            continue
        for der, encoding, _trust in entries:
            if encoding == "x509_asn":
                chunks.append(ssl.DER_cert_to_PEM_cert(der))
    return "\n".join(chunks)


def _macos_keychain_pems() -> str:
    keychains = [
        "/System/Library/Keychains/SystemRootCertificates.keychain",
        "/Library/Keychains/System.keychain",
    ]
    login = Path.home() / "Library/Keychains/login.keychain-db"
    if login.exists():
        keychains.append(str(login))
    chunks: list[str] = []
    for keychain in keychains:
        result = subprocess.run(
            ["security", "find-certificate", "-a", "-p", keychain],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0 and result.stdout:
            chunks.append(result.stdout)
    return "\n".join(chunks)


def _file_pem(path: str | None) -> str:
    if not path:
        return ""
    file = Path(path)
    if file.is_file():
        return file.read_text()
    return ""


def _os_ca_bundle() -> Path:
    chunks: list[str] = []
    try:
        import certifi

        chunks.append(Path(certifi.where()).read_text())
    except ImportError:
        pass

    paths = ssl.get_default_verify_paths()
    chunks.append(_file_pem(paths.cafile or paths.openssl_cafile))
    # Homebrew OpenSSL on this laptop is the corporate-managed CA bundle.
    chunks.append(_file_pem("/opt/homebrew/etc/openssl@3/cert.pem"))
    chunks.append(_file_pem("/opt/homebrew/etc/ca-certificates/cert.pem"))

    if sys.platform == "win32":
        chunks.append(_windows_store_pems())
    elif sys.platform == "darwin":
        chunks.append(_macos_keychain_pems())

    combined = Path(tempfile.gettempdir()) / "record-bot-os-ca.pem"
    combined.write_text("\n".join(chunk for chunk in chunks if chunk))
    return combined


def _ssl_context(bundle: Path) -> ssl.SSLContext:
    ctx = ssl.create_default_context(purpose=ssl.Purpose.SERVER_AUTH, cafile=str(bundle))
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.set_ciphers("ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:DHE+CHACHA20")
    ctx.set_alpn_protocols(["h2"])
    return ctx


def _patch(bundle: Path) -> None:
    try:
        import certifi

        certifi.where = lambda: str(bundle)  # type: ignore[method-assign]
    except ImportError:
        pass

    try:
        from grpclib.client import Channel
    except ImportError:
        return

    def os_ctx(self, *, verify_paths=None):  # noqa: ARG001
        return _ssl_context(bundle)

    Channel._get_default_ssl_context = os_ctx  # type: ignore[method-assign]


_patch(_os_ca_bundle())
