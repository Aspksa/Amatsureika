import argparse
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import webbrowser

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent / "public"
    if not (root / "main.js").is_file():
        raise SystemExit("Build the frontend first: npm run build")
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(root))) as server:
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
