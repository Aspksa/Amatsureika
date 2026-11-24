"""Local work registers and virtual file tree. SQLite is the only database."""
import json
import math
import sqlite3
from contextlib import closing, nullcontext
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import uuid4

LIMIT = 25 * 1024 * 1024
SCHEMA = {
    "staff": {"name":"text", "job":"text", "number":"text"},
    "vehicles": {"plate":"text", "model":"text", "driver":"staff?"},
    "cards": {"number":"text", "provider":"text", "vehicle":"vehicles?"},
    "timesheet": {"employee":"staff", "date":"date", "hours":"hours", "note":"optional"},
    "fuel": {"date":"date", "vehicle":"vehicles", "card":"cards?", "kind":"text", "liters":"positive", "cost":"nonnegative", "note":"optional"},
}

def now():
    return datetime.now(timezone.utc).isoformat()

def ident(v):
    if type(v) is not int or v < 1:
        raise ValueError("Некорректный идентификатор")
    return v

def name(v):
    if not isinstance(v,str) or not v.strip() or len(v)>180 or any(ord(c)<32 for c in v) or any(c in v for c in '/\\:*?"<>|') or v.strip() in (".",".."):
        raise ValueError("Недопустимое имя")
    return v.strip()

class Workspace:
    def __init__(self,path):
        self.path=Path(path)
        self.files=self.path.parent / "Документы"
        self.files.mkdir(parents=True,exist_ok=True)
        with closing(self.connect()) as db, db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS work_records (
                    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
                    archived INTEGER NOT NULL DEFAULT 0, updated TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS work_record_versions(id INTEGER PRIMARY KEY,record_id INTEGER NOT NULL REFERENCES work_records(id),before_state TEXT NOT NULL,after_state TEXT NOT NULL,created TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS work_versions_record ON work_record_versions(record_id,id DESC);
                CREATE INDEX IF NOT EXISTS work_kind ON work_records(kind,archived,id);
                CREATE TABLE IF NOT EXISTS work_edit_audit(request_id TEXT PRIMARY KEY, question TEXT NOT NULL, record_id INTEGER NOT NULL, mutation TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS disk_entries (
                    id INTEGER PRIMARY KEY, parent INTEGER REFERENCES disk_entries(id),
                    name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('folder','file')),
                    blob TEXT UNIQUE, size INTEGER NOT NULL DEFAULT 0,
                    trashed INTEGER NOT NULL DEFAULT 0, updated TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS disk_parent ON disk_entries(parent,trashed);
            """)

    def connect(self):
        db=sqlite3.connect(self.path,timeout=10)
        db.row_factory=sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def work(self):
        with closing(self.connect()) as db:
            rows=db.execute("SELECT * FROM work_records ORDER BY id").fetchall()
            return {"records":[{"id":r["id"],"kind":r["kind"],"fields":json.loads(r["payload"]),"archived":bool(r["archived"]),"updated":r["updated"]} for r in rows]}

    def save_work(self, data, *, expected_updated=None, audit=None, connection=None):
        if not isinstance(data,dict):
            raise ValueError("Некорректная запись")
        kind=data.get("kind")
        if kind not in SCHEMA:
            raise ValueError("Неизвестный раздел")
        with (closing(self.connect()) if connection is None else nullcontext(connection)) as db, (db if connection is None else nullcontext()):
            if connection is None:db.execute("BEGIN IMMEDIATE")
            rid=data.get("id")
            if audit is not None:
                done=db.execute("SELECT question,record_id FROM work_edit_audit WHERE request_id=?",(audit["request_id"],)).fetchone()
                if done:
                    if done["question"]!=audit["text"] or done["record_id"]!=rid:raise ValueError("Идентификатор уже использован")
                    return {"id":rid,"duplicate":True}
            old=None
            if rid is not None:
                old=db.execute("SELECT * FROM work_records WHERE id=? AND kind=?",(ident(rid),kind)).fetchone()
                if not old:
                    raise ValueError("Запись не найдена")
            if expected_updated is not None and (not old or old["archived"] or old["updated"]!=expected_updated):
                raise ValueError("Запись изменилась. Сформируйте новый предварительный просмотр.")
            if "archived" in data:
                if not old or type(data["archived"]) is not bool:
                    raise ValueError("Некорректный архив")
                db.execute("UPDATE work_records SET archived=?,updated=? WHERE id=?",(int(data["archived"]),now(),rid))
            else:
                fields=data.get("fields")
                if not isinstance(fields,dict) or set(fields)!=set(SCHEMA[kind]):
                    raise ValueError("Заполните поля")
                clean={}
                for k,t in SCHEMA[kind].items():
                    v=fields[k]
                    if t in ("text","optional"):
                        if not isinstance(v,str) or len(v)>500 or (t=="text" and not v.strip()):
                            raise ValueError("Заполните "+k)
                        clean[k]=v.strip()
                    elif t=="date":
                        if not isinstance(v,str):
                            raise ValueError("Некорректная дата")
                        clean[k]=date.fromisoformat(v).isoformat()
                    elif t in ("hours","positive","nonnegative"):
                        if type(v) not in (int,float) or not math.isfinite(v) or v<0 or (t=="positive" and v<=0) or (t=="hours" and v>24) or v>1000000000:
                            raise ValueError("Некорректное число "+k)
                        clean[k]=round(v,3)
                    else:
                        if v is None and t.endswith("?"):
                            clean[k]=None
                            continue
                        ref=db.execute("SELECT archived FROM work_records WHERE id=? AND kind=?",(ident(v),t.rstrip("?"))).fetchone()
                        if not ref or (ref["archived"] and (not old or json.loads(old["payload"]).get(k)!=v)):
                            raise ValueError("Связанная запись недоступна")
                        clean[k]=v
                if kind=="timesheet":
                    for r in db.execute("SELECT id,payload FROM work_records WHERE kind='timesheet' AND archived=0"):
                        f=json.loads(r["payload"])
                        if r["id"]!=rid and f["employee"]==clean["employee"] and f["date"]==clean["date"]:
                            raise ValueError("Табель за этот день уже существует")
                if kind=="fuel" and clean["card"] is not None:
                    card=json.loads(db.execute("SELECT payload FROM work_records WHERE id=?",(clean["card"],)).fetchone()[0])
                    if card["vehicle"] is not None and card["vehicle"]!=clean["vehicle"]:
                        raise ValueError("Карта закреплена за другим автомобилем")
                payload=json.dumps(clean,ensure_ascii=False)
                if old:
                    db.execute("UPDATE work_records SET payload=?,updated=? WHERE id=?",(payload,now(),rid))
                else:
                    rid=db.execute("INSERT INTO work_records(kind,payload,updated) VALUES(?,?,?)",(kind,payload,now())).lastrowid
            current=db.execute("SELECT * FROM work_records WHERE id=?",(rid,)).fetchone()
            # Store actual future changes only; never fabricate a historical state.
            if not old or old["payload"]!=current["payload"] or old["archived"]!=current["archived"]:
                db.execute("INSERT INTO work_record_versions(record_id,before_state,after_state,created) VALUES(?,?,?,?)",(rid,json.dumps(dict(old),ensure_ascii=False) if old else "null",json.dumps(dict(current),ensure_ascii=False),now()))
            if audit is not None:
                db.execute("INSERT INTO work_edit_audit VALUES(?,?,?,?,?)",(audit["request_id"],audit["text"],rid,json.dumps(audit["mutation"],ensure_ascii=False),now()))
            return {"id":rid}

    def edit_receipt(self,request_id,text):
        with closing(self.connect()) as db:
            r=db.execute("SELECT * FROM work_edit_audit WHERE request_id=?",(request_id,)).fetchone()
            if not r:return None
            if r["question"]!=text:raise ValueError("Идентификатор уже использован")
            return json.loads(r["mutation"])

    def entry(self,db,rid):
        r=db.execute("SELECT * FROM disk_entries WHERE id=?",(ident(rid),)).fetchone()
        if not r:
            raise ValueError("Файл или папка не найдены")
        return r

    def visible(self,db,rid):
        seen=set()
        while rid is not None:
            if rid in seen:
                raise ValueError("Ошибка дерева папок")
            seen.add(rid)
            r=self.entry(db,rid)
            if r["trashed"]:
                return False
            rid=r["parent"]
        return True

    def folder(self,db,parent):
        if parent is not None and (self.entry(db,parent)["kind"]!="folder" or not self.visible(db,parent)):
            raise ValueError("Папка недоступна")

    def unique(self,db,parent,title,exclude=0):
        for r in db.execute("SELECT id,name FROM disk_entries WHERE parent IS ? AND trashed=0",(parent,)):
            if r["id"]!=exclude and r["name"].casefold()==title.casefold():
                raise ValueError("Такое имя уже существует")

    def disk(self,parent=None,trash=False):
        with closing(self.connect()) as db, db:
            db.execute("BEGIN")
            if trash:
                rows=[r for r in db.execute("SELECT * FROM disk_entries WHERE trashed=1 ORDER BY updated DESC") if self.visible(db,r["parent"])]
                crumbs=[]
            else:
                self.folder(db,parent)
                rows=db.execute("SELECT * FROM disk_entries WHERE parent IS ? AND trashed=0 ORDER BY kind DESC,name COLLATE NOCASE",(parent,)).fetchall()
                crumbs=[]
                p=parent
                while p is not None:
                    r=self.entry(db,p)
                    crumbs.append({"id":p,"name":r["name"]})
                    p=r["parent"]
                crumbs.reverse()
            return {"entries":[{k:r[k] for k in ("id","parent","name","kind","size","updated")} for r in rows],"crumbs":crumbs}

    def disk_action(self,data):
        if not isinstance(data,dict):
            raise ValueError("Некорректная операция")
        action=data.get("action")
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            if action=="folder":
                parent=data.get("parent")
                title=name(data.get("name"))
                self.folder(db,parent)
                self.unique(db,parent,title)
                return {"id":db.execute("INSERT INTO disk_entries(parent,name,kind,updated) VALUES(?,?,'folder',?)",(parent,title,now())).lastrowid}
            rid=ident(data.get("id"))
            r=self.entry(db,rid)
            if action=="restore":
                if not r["trashed"]:
                    raise ValueError("Объект не в корзине")
                self.folder(db,r["parent"])
                self.unique(db,r["parent"],r["name"],rid)
                db.execute("UPDATE disk_entries SET trashed=0,updated=? WHERE id=?",(now(),rid))
            elif action=="trash" and self.visible(db,rid):
                db.execute("UPDATE disk_entries SET trashed=1,updated=? WHERE id=?",(now(),rid))
            elif action=="move" and self.visible(db,rid):
                parent=data.get("parent");self.folder(db,parent)
                p=parent
                while p is not None:
                    if p==rid:raise ValueError("Нельзя переместить папку в собственное поддерево")
                    p=self.entry(db,p)["parent"]
                self.unique(db,parent,r["name"],rid)
                db.execute("UPDATE disk_entries SET parent=?,updated=? WHERE id=?",(parent,now(),rid))
            elif action=="rename" and self.visible(db,rid):
                title=name(data.get("name"))
                self.unique(db,r["parent"],title,rid)
                db.execute("UPDATE disk_entries SET name=?,updated=? WHERE id=?",(title,now(),rid))
            else:
                raise ValueError("Операция недоступна")
            return {"id":rid}

    def upload(self,parent,title,stream,size):
        title=name(title)
        if type(size) is not int or not 0<=size<=LIMIT:
            raise ValueError("Лимит файла 25 МиБ")
        blob=uuid4().hex
        target=self.files/blob
        try:
            # Do not hold a SQLite writer reservation while a slow upload arrives.
            with target.open("xb") as f:
                remaining=size
                while remaining:
                    chunk=stream.read(min(remaining,65536))
                    if not chunk or len(chunk)>remaining:
                        raise ValueError("Загрузка прервана")
                    f.write(chunk)
                    remaining-=len(chunk)
                f.flush()
                import os
                os.fsync(f.fileno())
            with closing(self.connect()) as db, db:
                db.execute("BEGIN IMMEDIATE")
                self.folder(db,parent)
                self.unique(db,parent,title)
                rid=db.execute("INSERT INTO disk_entries(parent,name,kind,blob,size,updated) VALUES(?,?,'file',?,?,?)",(parent,title,blob,size,now())).lastrowid
            return {"id":rid}
        except BaseException:
            target.unlink(missing_ok=True)
            raise

    def map_summary(self):
        with closing(self.connect()) as db:
            db.execute("BEGIN")
            rows=db.execute("""
                WITH RECURSIVE live(id,kind,name,size) AS (
                    SELECT id,kind,name,size FROM disk_entries WHERE parent IS NULL AND trashed=0
                    UNION ALL
                    SELECT e.id,e.kind,e.name,e.size FROM disk_entries e JOIN live p ON e.parent=p.id WHERE e.trashed=0
                ) SELECT id,name,size FROM live WHERE kind='file' ORDER BY id
            """).fetchall()
            work=db.execute("SELECT kind,COUNT(*) AS count FROM work_records WHERE archived=0 GROUP BY kind").fetchall()
            records=db.execute("SELECT id,kind FROM work_records WHERE archived=0 ORDER BY id").fetchall()
            return {"files":[dict(r) for r in rows],"work":{r["kind"]:r["count"] for r in work},"records":[dict(r) for r in records]}

    def download(self,rid):
        with closing(self.connect()) as db:
            r=self.entry(db,rid)
            if r["kind"]!="file" or not self.visible(db,rid):
                raise ValueError("Файл недоступен")
            blob=r["blob"]
            if not isinstance(blob,str) or len(blob)!=32 or any(c not in "0123456789abcdef" for c in blob):
                raise ValueError("Повреждённая запись")
            path=self.files/blob
            if path.is_symlink() or not path.is_file() or path.stat().st_size!=r["size"]:
                raise ValueError("Файл отсутствует или повреждён")
            return path,r["name"],r["size"]
