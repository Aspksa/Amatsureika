import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen

root = Path(__file__).resolve().parents[1]
with subprocess.Popen([sys.executable, "-u", str(root / "server.py"), "--no-browser"],
                      cwd=root, stdout=subprocess.PIPE, text=True) as proc:
    try:
        url = proc.stdout.readline().strip()
        assert url.startswith("http://127.0.0.1:"), url
        for path, token in (("", b"AMATSUREIKA"), ("main.js", b"createElementNS"), ("style.css", b"core-ring")):
            with urlopen(url + path, timeout=10) as response:
                assert response.status == 200 and token in response.read(), path
    finally:
        proc.terminate()
        proc.wait(timeout=10)
print("HTTP startup smoke passed")
