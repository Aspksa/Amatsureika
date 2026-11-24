import json
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError

root = Path(__file__).resolve().parents[1]

def session(data_dir, expected=None):
    with subprocess.Popen([sys.executable, "-u", str(root / "server.py"), "--no-browser", "--data-dir", str(data_dir)],
                          cwd=root, stdout=subprocess.PIPE, text=True) as proc:
        try:
            url = proc.stdout.readline().strip()
            assert url.startswith("http://127.0.0.1:"), url
            for path, token in (("", b"AMATSUREIKA"), ("main.js", b"createElementNS"), ("style.css", b"core-ring"), ("", b"restoreDesign")):
                with urlopen(url + path, timeout=10) as response:
                    assert response.status == 200 and token in response.read(), path
            with urlopen(url + "api/design", timeout=10) as response:
                settings = json.load(response)
            if expected is not None:
                assert settings == expected, (settings, expected)
                return
            settings.update(glow=17, depth=42, motion=0, textMotion=25, texture=12, speed=1.5)
            req = Request(url + "api/design", data=json.dumps(settings).encode(), headers={"Content-Type":"application/json"})
            with urlopen(req, timeout=10) as response:
                assert json.load(response) == settings
            for invalid in ({**settings, "glow": 101}, {**settings, "motion": True}, {}):
                try:
                    urlopen(Request(url + "api/design", data=json.dumps(invalid).encode(), headers={"Content-Type":"application/json"}), timeout=10)
                    raise AssertionError("Invalid settings accepted")
                except HTTPError as error:
                    assert error.code == 400
            return settings
        finally:
            proc.terminate()
            proc.wait(timeout=10)

with tempfile.TemporaryDirectory() as directory:
    expected = session(directory)
    session(directory, expected)
print("HTTP startup and SQLite design persistence smoke passed")
