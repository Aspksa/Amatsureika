import argparse
import json
from urllib.parse import urlsplit
from design_store import DesignStore
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import webbrowser

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, store, **kwargs):
        self.store = store
        super().__init__(*args, **kwargs)

    def send_json(self, value, status=200):
        data = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if urlsplit(self.path).path == "/api/camera":
            self.send_json(self.store.load_camera())
        elif urlsplit(self.path).path == "/api/design":
            self.send_json(self.store.load())
        else:
            super().do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path not in ("/api/design", "/api/camera"):
            return self.send_error(404)
        expected = f"http://127.0.0.1:{self.server.server_port}"
        if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}" or self.headers.get("Origin", expected) != expected:
            return self.send_json({"error": "Invalid origin"}, 403)
        if self.headers.get_content_type() != "application/json":
            return self.send_json({"error": "Expected JSON"}, 415)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 4096:
                raise ValueError("Invalid size")
            value = json.loads(self.rfile.read(size))
            self.send_json(self.store.save_camera(value) if path == "/api/camera" else self.store.save(value))
        except (ValueError, TypeError, OverflowError):
            self.send_json({"error": "Invalid settings"}, 400)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).resolve().parent / "data")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent / "public"
    if not (root / "main.js").is_file():
        raise SystemExit("Build the frontend first: npm run build")
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(root), store=DesignStore(args.data_dir / "amatsureika.db"))) as server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print(url, flush=True)
        if not args.no_browser:
            try:
                if not webbrowser.open(url):
                    print("Open the address above manually.", flush=True)
            except Exception as exc:
                print(f"Browser could not open: {exc}. Open the address manually.", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
