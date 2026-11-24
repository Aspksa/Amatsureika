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
            for path, token in (("", b"AMATSUREIKA"), ("main.js", b"createElementNS"), ("geometry.js", b"collisions"), ("flow.js", b"runQuietFlow"), ("workspace.js", b"setupWorkspace"), ("style.css", b"core-ring"), ("", b"restoreDesign")):
                with urlopen(url + path, timeout=10) as response:
                    assert response.status == 200 and token in response.read(), path
            with urlopen(url, timeout=10) as response:
                page = response.read()
                assert b'class="core-title"' not in page
                assert b'class="core-wave"' not in page
                assert b'id="cloudSend"' not in page
                assert b'id="chatToolsToggle"' in page and b'<textarea id="prompt"' in page
                assert b'id="routingConsent"' in page
                assert b'id="toolReports"' in page and b'id="reportsDialog"' in page
                for icon in (b'id="workIcon"',b'id="docsIcon"',b'id="settingsIcon"',b'id="cloudIcon"',b'id="chatIcon"'):
                    assert icon in page
            with urlopen(url+"api/work",timeout=10) as response:
                assert json.load(response)=={"records":[]}
            with urlopen(url+"api/disk",timeout=10) as response:
                assert json.load(response)=={"entries":[],"crumbs":[]}
            with urlopen(url+"api/workspace/map",timeout=10) as response:
                assert json.load(response)=={"files":[],"work":{},"records":[]}
            with urlopen(url + "main.js", timeout=10) as response:
                source = response.read().decode("utf-8")
                assert "ДОЛГОВРЕМЕННАЯ ПАМЯТЬ" not in source
                assert "/api/memory" in source
                assert "runQuietFlow" in source
                assert "energy-wave" not in source
                assert "pulseQueue" not in source
                assert "http://www.w3.org/2000/svg" in source
                assert "http://www.w3.org/5000/svg" not in source
                assert 'class: "memory-block"' in source
                assert 'class: "cluster-shape"' not in source
            with urlopen(url + "api/design", timeout=10) as response:
                settings = json.load(response)
            camera = {"zoom": 2.5, "tx": 120, "ty": -32, "mode": "hex"}
            if expected is not None:
                assert settings == expected, (settings, expected)
                with urlopen(url + "api/camera", timeout=10) as response:
                    assert json.load(response) == camera
                return
            with urlopen(Request(url + "api/camera", data=json.dumps(camera).encode(), headers={"Content-Type":"application/json"}), timeout=10) as response:
                assert json.load(response) == camera
            try:
                urlopen(Request(url + "api/camera", data=json.dumps({**camera, "zoom": 0}).encode(), headers={"Content-Type":"application/json"}), timeout=10)
                raise AssertionError("Invalid camera accepted")
            except HTTPError as error:
                assert error.code == 400
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
