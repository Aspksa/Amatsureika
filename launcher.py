"""Windows-friendly local startup; no additional Python packages."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
LOG = ROOT / "logs" / "startup.log"
TSC = ROOT / "node_modules" / "typescript" / "bin" / "tsc"

def say(message):
    print(message, flush=True)
    with LOG.open("a", encoding="utf-8") as log:
        log.write(str(message) + "\n")

def run(args):
    say("> " + subprocess.list2cmdline([str(a) for a in args]))
    with subprocess.Popen([str(a) for a in args], cwd=ROOT, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                          errors="replace", env={**os.environ, "PYTHONUTF8": "1", "PYTHONUNBUFFERED": "1"}) as proc:
        try:
            for line in proc.stdout:
                say(line.rstrip("\r\n"))
            rc = proc.wait()
        except KeyboardInterrupt:
            proc.terminate()
            proc.wait()
            raise
    if rc:
        raise RuntimeError(f"Command failed (exit code {rc}). See the output above.")

def find_node():
    for path in (ROOT / "runtime" / "node" / "node.exe", ROOT / "runtime" / "node" / "node"):
        if path.is_file():
            return path
    path = shutil.which("node")
    return Path(path).resolve() if path else None

def find_npm(node):
    candidates = [node.parent / "node_modules/npm/bin/npm-cli.js",
                  node.parent / "../lib/node_modules/npm/bin/npm-cli.js",
                  node.parent / "../share/nodejs/npm/bin/npm-cli.js"]
    for name in ("npm", "npm.cmd"):
        found = shutil.which(name)
        if found:
            p = Path(found)
            candidates.extend([p.resolve(), p.parent / "node_modules/npm/bin/npm-cli.js"])
    for path in candidates:
        if path.is_file() and path.suffix == ".js":
            return path.resolve()
    raise RuntimeError("npm CLI not found. Install Node.js LTS with npm, then reopen Start.bat.")

def build():
    node = find_node()
    outputs = [ROOT / "public/main.js", ROOT / "public/geometry.js", ROOT / "public/flow.js", ROOT / "public/workspace.js", ROOT / "public/chat_virtual.js"]
    sources = list((ROOT / "src").glob("*.ts")) + [ROOT / "tsconfig.json"]
    if not node:
        if all(p.is_file() and p.stat().st_mtime >= max(s.stat().st_mtime for s in sources) for p in outputs):
            say("Node.js not found; using existing frontend build.")
            return
        raise RuntimeError("Node.js not found. Install Node.js LTS, or place portable Node in runtime/node.")
    run([node, "--version"])
    if not TSC.is_file():
        say("First launch: installing the pinned TypeScript compiler (internet required).")
        run([node, find_npm(node), "install", "--no-audit", "--no-fund"])
    if not TSC.is_file():
        raise RuntimeError("TypeScript compiler missing after installation.")
    run([node, TSC, "-p", ROOT / "tsconfig.json"])
    if not all(p.is_file() for p in outputs):
        raise RuntimeError("Frontend build did not produce all JS modules.")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Build only; do not start browser or server")
    args = parser.parse_args()
    LOG.parent.mkdir(parents=True, exist_ok=True)
    try:
        say(f"Project: {ROOT}")
        say(f"Python: {sys.executable} ({sys.version.split()[0]})")
        build()
        if args.check:
            say("Startup check passed.")
            return 0
        say("Starting local server. Keep this window open.")
        run([sys.executable, "-u", ROOT / "server.py"])
        return 0
    except KeyboardInterrupt:
        say("Stopped by user.")
        return 0
    except Exception as exc:
        say(f"ERROR: {type(exc).__name__}: {exc}")
        return 1

if __name__ == "__main__":
    sys.exit(main())
