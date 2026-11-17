"""Download the local wllama runtime and GGUF weights. The page never calls this."""

import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent

ASSETS = [
    (
        "https://cdn.jsdelivr.net/npm/@wllama/wllama@3.13.0/esm/index.js",
        ROOT / "vendor" / "wllama" / "index.js",
        275466,
    ),
    (
        "https://cdn.jsdelivr.net/npm/@wllama/wllama@3.13.0/esm/wasm/wllama.wasm",
        ROOT / "vendor" / "wllama" / "wllama.wasm",
        10244628,
    ),
    (
        "https://cdn.jsdelivr.net/npm/@wllama/wllama@3.13.0/LICENCE",
        ROOT / "vendor" / "wllama" / "LICENCE",
        1071,
    ),
    (
        "https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf",
        ROOT / "models" / "Qwen3-0.6B-Q4_K_M.gguf",
        396705472,
    ),
    (
        "https://huggingface.co/jingyaogong/minimind-3-gguf/resolve/main/minimind-3.q8.gguf",
        ROOT / "models" / "minimind-3.q8.gguf",
        68189920,
    ),
]


def download(url, dest, expected):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file() and dest.stat().st_size == expected:
        print(f"exists {dest.relative_to(ROOT)} ({expected} bytes)")
        return
    print(f"get {dest.name}")
    req = urllib.request.Request(url, headers={"User-Agent": "minimind-browser/fetch_assets"})
    with urllib.request.urlopen(req, timeout=120) as resp, dest.open("wb") as out:
        total = int(resp.headers.get("Content-Length") or expected or 0)
        done = 0
        last = -1
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if total:
                pct = done * 100 // total
                if pct != last:
                    print(f"  {dest.name} {pct}%", flush=True)
                    last = pct
    size = dest.stat().st_size
    if size != expected:
        dest.unlink(missing_ok=True)
        raise SystemExit(f"size mismatch for {dest.name}: got {size}, expected {expected}")
    print(f"saved {dest.relative_to(ROOT)}")


def main():
    for url, dest, expected in ASSETS:
        download(url, dest, expected)
    print("ready")


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print(f"failed: {err}", file=sys.stderr)
        raise
