import argparse
import json
import sqlite3
from urllib.parse import urlsplit, parse_qs, quote
from workspace import Workspace, LIMIT
from routing import Router, calculate
from report_export import export_report
from tool_engine import catalog
import shutil
from chat_store import ChatStore
from cloud_client import Cloud, CloudError
from uuid import UUID
from design_store import DesignStore
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import webbrowser

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, store, chat, cloud, workspace, router, **kwargs):
        self.store = store
        self.chat = chat
        self.cloud = cloud
        self.workspace = workspace
        self.router = router
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
        path = urlsplit(self.path).path
        if path in ("/api/work","/api/disk","/api/disk/download","/api/workspace/map"):
            if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
                return self.send_json({"error":"Invalid host"},403)
            try:
                query=parse_qs(urlsplit(self.path).query)
                if path=="/api/workspace/map":
                    return self.send_json(self.workspace.map_summary())
                if path=="/api/work":
                    return self.send_json(self.workspace.work())
                if path=="/api/disk":
                    return self.send_json(self.workspace.disk(int(query["parent"][0]) if "parent" in query else None, query.get("trash")==["1"]))
                file,title,size=self.workspace.download(int(query["id"][0]))
                with file.open("rb") as f:
                    self.send_response(200)
                    self.send_header("Content-Type","application/octet-stream")
                    self.send_header("Content-Disposition","attachment; filename*=UTF-8''"+quote(title,safe=""))
                    self.send_header("Content-Length",str(size))
                    self.send_header("X-Content-Type-Options","nosniff")
                    self.send_header("Cache-Control","no-store")
                    self.end_headers()
                    shutil.copyfileobj(f,self.wfile)
                return
            except (ValueError,TypeError,KeyError) as exc:
                return self.send_json({"error":str(exc)},400)
            except (sqlite3.Error,OSError):
                return self.send_json({"error":"Локальное хранилище недоступно"},503)
        if path in ("/api/memory","/api/cloud/status"):
            if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
                return self.send_json({"error":"Invalid host"},403)
            try:
                if path == "/api/cloud/status":
                    return self.send_json(self.cloud.status())
                query = parse_qs(urlsplit(self.path).query)
                return self.send_json(self.chat.memory_snapshot(int(query["cluster"][0]) if "cluster" in query else None))
            except (ValueError,TypeError):
                return self.send_json({"error":"Invalid block"},400)
            except sqlite3.Error:
                return self.send_json({"error":"Memory unavailable"},503)
        if urlsplit(self.path).path in ("/api/chat", "/api/chat/health"):
            if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
                return self.send_json({"error":"Invalid host"},403)
            try:
                if urlsplit(self.path).path == "/api/chat/health":
                    return self.send_json(self.chat.health())
                query = parse_qs(urlsplit(self.path).query)
                cluster = int(query["cluster"][0]) if "cluster" in query else None
                return self.send_json(self.chat.snapshot(cluster))
            except sqlite3.Error:
                return self.send_json({"error":"Memory unavailable"},503)
            except (ValueError, TypeError):
                return self.send_json({"error":"Invalid cluster"},400)
        if urlsplit(self.path).path == "/api/camera":
            self.send_json(self.store.load_camera())
        elif urlsplit(self.path).path == "/api/design":
            self.send_json(self.store.load())
        else:
            super().do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path not in ("/api/design", "/api/camera", "/api/chat", "/api/memory", "/api/cloud/key", "/api/cloud/models", "/api/cloud/connect", "/api/work", "/api/disk", "/api/disk/upload", "/api/routing/plan", "/api/routing/execute", "/api/routing/search", "/api/routing/calculate", "/api/routing/tools", "/api/routing/report", "/api/agent/state", "/api/agent/run", "/api/agent/save", "/api/agent/replay", "/api/agent/queue", "/api/agent/mileage", "/api/agent/export", "/api/routing/stream", "/api/agent/import-preview", "/api/agent/timesheet-preview", "/api/agent/import-commit"):
            return self.send_error(404)
        expected = f"http://127.0.0.1:{self.server.server_port}"
        if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}" or self.headers.get("Origin", expected) != expected:
            return self.send_json({"error": "Invalid origin"}, 403)
        if path == "/api/disk/upload":
            if self.headers.get_content_type()!="application/octet-stream":
                return self.send_json({"error":"Expected binary file"},415)
            try:
                query=parse_qs(urlsplit(self.path).query)
                size=int(self.headers.get("Content-Length","-1"))
                if not 0<=size<=LIMIT:
                    raise ValueError("Лимит файла 25 МиБ")
                self.connection.settimeout(45)
                return self.send_json(self.workspace.upload(int(query["parent"][0]) if "parent" in query else None,query["name"][0],self.rfile,size))
            except (ValueError,KeyError,TypeError) as exc:
                return self.send_json({"error":str(exc)},400)
            except (sqlite3.Error,OSError):
                return self.send_json({"error":"Загрузка не завершена"},503)
        if self.headers.get_content_type() != "application/json":
            return self.send_json({"error": "Expected JSON"}, 415)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= (16384 if path in ("/api/chat","/api/memory","/api/cloud/key","/api/work","/api/routing/plan","/api/routing/execute","/api/agent/run","/api/agent/save","/api/routing/stream") else 4096):
                raise ValueError("Invalid size")
            value = json.loads(self.rfile.read(size))
            if path == "/api/routing/stream":
                # HTTP close-delimited NDJSON, each line flushed immediately.
                self.send_response(200)
                self.send_header("Content-Type","application/x-ndjson; charset=utf-8")
                self.send_header("Cache-Control","no-store")
                self.send_header("Connection","close")
                self.end_headers()
                self.close_connection=True
                def event(value):
                    self.wfile.write((json.dumps(value,ensure_ascii=False)+"\n").encode("utf-8"))
                    self.wfile.flush()
                try:
                    result=self.router.execute(value,emit=lambda part:event({"type":"delta","text":part}))
                    event({"type":"done","result":result})
                except (BrokenPipeError,ConnectionResetError):pass
                except (ValueError,TypeError,CloudError,RuntimeError,sqlite3.Error,OSError) as exc:
                    try:event({"type":"error","error":str(exc) if isinstance(exc,(ValueError,CloudError)) else "Поток прерван; автоматического повтора нет"})
                    except OSError:pass
                return
            if path == "/api/agent/export":
                data,filename,mime=export_report(self.router.tools,value)
                self.send_response(200)
                self.send_header("Content-Type",mime)
                self.send_header("Content-Disposition",'attachment; filename="'+filename+'"')
                self.send_header("Content-Length",str(len(data)))
                self.send_header("Cache-Control","no-store")
                self.end_headers()
                self.wfile.write(data)
                return
            if path == "/api/agent/import-preview":
                return self.send_json(self.router.importer.preview(value))
            if path == "/api/agent/timesheet-preview":
                return self.send_json(self.router.importer.fill(value))
            if path == "/api/agent/import-commit":
                return self.send_json(self.router.importer.commit(value))
            if path == "/api/agent/state":
                if value!={}:raise ValueError("Некорректный запрос")
                return self.send_json(self.router.agent.state())
            if path == "/api/agent/run":
                if not isinstance(value,dict) or set(value)!={"steps"}:raise ValueError("Некорректные шаги")
                return self.send_json(self.router.agent.run(value["steps"]))
            if path == "/api/agent/save":
                return self.send_json(self.router.agent.save_scenario(value))
            if path == "/api/agent/replay":
                if not isinstance(value,dict) or set(value)!={"id"} or not isinstance(value["id"],str):raise ValueError("Некорректный сценарий")
                return self.send_json(self.router.agent.run(self.router.agent.scenario(value["id"])))
            if path == "/api/agent/queue":
                return self.send_json(self.router.agent.enqueue(value))
            if path == "/api/agent/mileage":
                return self.send_json(self.router.agent.mileage(value))
            if path == "/api/routing/tools":
                if value != {}: raise ValueError("Некорректный запрос")
                return self.send_json({"tools":catalog()})
            if path == "/api/routing/report":
                return self.send_json(self.router.tools.run(value))
            if path == "/api/routing/search":
                return self.send_json(self.router.search_tool(value))
            if path == "/api/routing/calculate":
                return self.send_json(calculate(value))
            if path == "/api/routing/plan":
                return self.send_json(self.router.plan(value))
            if path == "/api/routing/execute":
                return self.send_json(self.router.execute(value))
            if path == "/api/work":
                return self.send_json(self.workspace.save_work(value))
            if path == "/api/disk":
                return self.send_json(self.workspace.disk_action(value))
            if path == "/api/cloud/key":
                return self.send_json(self.cloud.save_key(value))
            if path == "/api/cloud/models":
                return self.send_json(self.cloud.load_models())
            if path == "/api/cloud/connect":
                return self.send_json(self.cloud.select(value))
            if path == "/api/memory":
                if not isinstance(value,dict) or set(value)!={"text","request_id","cloud"} or type(value["cloud"]) is not bool:
                    raise ValueError("Invalid request")
                paid = value.pop("cloud")
                if not paid:
                    return self.send_json(self.chat.memory_append(value))
                text, rid = value["text"], value["request_id"]
                if not isinstance(text,str) or not text.strip() or len(text)>1000 or not isinstance(rid,str) or str(UUID(rid))!=rid:
                    raise ValueError("Invalid request")
                if not self.chat.startup_health["ok"]:
                    raise RuntimeError("Memory integrity failure")
                with self.cloud.send_lock:
                    existing = self.chat.existing_request(value)
                    if existing:
                        return self.send_json(existing)
                    answer = self.cloud.complete(text.strip())
                    return self.send_json(self.chat.memory_append(value,answer))
            self.send_json(self.chat.append(value) if path == "/api/chat" else self.store.save_camera(value) if path == "/api/camera" else self.store.save(value))
        except CloudError as exc:
            self.send_json({"error":str(exc)},502)
        except (sqlite3.Error, RuntimeError, OSError):
            self.send_json({"error": "Local memory unavailable"}, 503)
        except (ValueError, TypeError, OverflowError) as exc:
            self.send_json({"error": str(exc) if path in ("/api/work","/api/disk","/api/routing/plan","/api/routing/execute","/api/routing/search","/api/routing/calculate","/api/routing/tools","/api/routing/report") or path.startswith("/api/agent/") else "Invalid settings"}, 400)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).resolve().parent / "data")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent / "public"
    if not all((root / name).is_file() for name in ("main.js", "geometry.js", "flow.js", "workspace.js")):
        raise SystemExit("Build the frontend first: npm run build")
    path=args.data_dir / "amatsureika.db"
    store=DesignStore(path)
    chat=ChatStore(path)
    cloud=Cloud(path)
    workspace=Workspace(path)
    router=Router(chat,workspace,cloud)
    router.agent.start()
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(root), store=store, chat=chat, cloud=cloud, workspace=workspace, router=router)) as server:
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
