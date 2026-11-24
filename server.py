from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import webbrowser

if __name__ == "__main__":
    root = Path(__file__).resolve().parent / "public"
    if not (root / "main.js").is_file():
        raise SystemExit("Build the frontend first: npm run build")
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(root))) as server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print(url, flush=True)
        webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
