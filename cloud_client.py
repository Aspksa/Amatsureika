"""Cloud.ru Foundation Models. Only explicitly requested calls; stdlib HTTPS."""
import json
import os
import threading
import sqlite3
from contextlib import closing
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError

BASE = "https://foundation-models.api.cloud.ru/v1"

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class CloudError(RuntimeError):
    pass

class Cloud:
    def __init__(self, path, transport=None):
        self.path = path
        self.key_path = path.parent / "cloud.key"
        self.lock = threading.RLock()
        self.send_lock = threading.Lock()
        self.transport = transport or self.http
        self.key = os.environ.get("CLOUD_RU_API_KEY", "").strip()
        if not self.key and self.key_path.is_file():
            self.key = self.key_path.read_text(encoding="utf-8").strip()
        self.models = []
        self.verified = False
        self.model = ""
        with closing(sqlite3.connect(path)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS cloud_selection (id INTEGER PRIMARY KEY CHECK(id=1), model TEXT NOT NULL)")
            row = db.execute("SELECT model FROM cloud_selection WHERE id=1").fetchone()
            if row:
                self.model = row[0]

    def status(self):
        with self.lock:
            return {"has_key": bool(self.key), "saved_key": self.key_path.is_file(),
                    "model": self.model, "verified": self.verified, "models": list(self.models)}

    def save_key(self, value):
        if not isinstance(value,dict) or set(value)!={"key","persist"} or type(value["persist"]) is not bool:
            raise ValueError("Invalid key settings")
        key = value["key"]
        if not isinstance(key,str) or len(key)>4096 or any(ord(c)<33 or ord(c)>126 for c in key):
            raise ValueError("Invalid key")
        with self.lock:
            if value["persist"] and key:
                tmp = self.key_path.with_suffix(".tmp")
                fd = os.open(tmp, os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o600)
                with os.fdopen(fd,"w",encoding="utf-8") as f:
                    f.write(key)
                os.replace(tmp,self.key_path)
            else:
                self.key_path.unlink(missing_ok=True)
            self.key = key
            self.models = []
            self.verified = False
            return self.status()

    def http(self, method, endpoint, key, payload=None):
        req = Request(BASE+endpoint, data=None if payload is None else json.dumps(payload).encode("utf-8"),
                      headers={"Authorization":"Bearer "+key,"Content-Type":"application/json"},method=method)
        try:
            with build_opener(NoRedirect()).open(req,timeout=45) as r:
                data = r.read(4*1024*1024+1)
                if len(data)>4*1024*1024:
                    raise CloudError("Ответ Cloud.ru слишком большой")
                return json.loads(data)
        except HTTPError as e:
            raise CloudError("Cloud.ru HTTP "+str(e.code)) from None
        except (URLError,TimeoutError,OSError,ValueError):
            raise CloudError("Cloud.ru недоступен или ответ не распознан") from None

    def load_models(self):
        with self.lock:
            if not self.key:
                raise CloudError("Сначала введите API-ключ")
            self.verified = False
            data = self.transport("GET","/models",self.key)
            if not isinstance(data,dict) or not isinstance(data.get("data"),list):
                raise CloudError("Некорректный каталог моделей")
            self.models = sorted(set(m["id"] for m in data["data"] if isinstance(m,dict) and isinstance(m.get("id"),str) and 0<len(m["id"])<=512))
            self.verified = True
            return self.status()

    def select(self, value):
        with self.lock:
            if not isinstance(value,dict) or set(value)!={"model"} or not self.verified or value["model"] not in self.models:
                raise ValueError("Load models first")
            with closing(sqlite3.connect(self.path)) as db, db:
                db.execute("INSERT INTO cloud_selection VALUES(1,?) ON CONFLICT(id) DO UPDATE SET model=excluded.model",(value["model"],))
            self.model = value["model"]
            return self.status()

    def complete(self, text):
        with self.lock:
            if not self.key or not self.verified or self.model not in self.models:
                raise CloudError("Сначала загрузите и подключите модель")
            key, model = self.key, self.model
        result = self.transport("POST","/chat/completions",key,{"model":model,"messages":[{"role":"user","content":text}],"max_completion_tokens":512,"stream":False})
        try:
            answer = result["choices"][0]["message"]["content"]
            if not isinstance(answer,str) or not answer.strip() or len(answer)>100000:
                raise ValueError()
            return answer
        except (KeyError,IndexError,TypeError,ValueError):
            raise CloudError("Модель не вернула текстовый ответ") from None
