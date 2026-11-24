"""Local-first retrieval and explicitly approved, bounded cloud context."""
import json
import re
import sqlite3
import threading
import time
from collections import OrderedDict
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4
import zipfile
import xml.etree.ElementTree as ET

STOP=set("что кто где когда как какой какая какие это мне меня мой моя мои про о об и в на с из для по у а или не ли был была есть найди покажи скажи вспомни помнишь информацию данные пожалуйста расскажи".split())
LABELS={"staff":"сотрудники сотрудник ФИО","timesheet":"табель часы","cards":"топливная карта карты","vehicles":"автомобиль машина госномер","fuel":"ГСМ топливо заправка литры"}
FIELDS={"name":"ФИО","job":"должность","number":"номер","plate":"госномер","model":"модель","driver":"водитель","employee":"сотрудник","date":"дата","hours":"часы","provider":"поставщик","vehicle":"автомобиль","card":"карта","kind":"топливо","liters":"литры","cost":"стоимость","note":"примечание"}
TEXT_LIMIT=256*1024
CONTEXT_LIMIT=6000
PLAN_TTL=300

def tokens(text):
    return list(dict.fromkeys(w for w in re.findall(r"[^\W_]+",text.casefold()) if len(w)>=2 and w not in STOP))[:16]

def validate(value):
    if not isinstance(value,dict) or set(value)!={"text","request_id"}:
        raise ValueError("Некорректный запрос")
    q,rid=value["text"],value["request_id"]
    if not isinstance(q,str) or not q.strip() or len(q)>1000 or not isinstance(rid,str) or str(UUID(rid))!=rid:
        raise ValueError("Некорректный запрос")
    return {"text":q.strip(),"request_id":rid}

def extract(path,title):
    suffix=Path(title).suffix.lower()
    try:
        if suffix in (".txt",".md",".csv",".json",".log",".tsv"):
            with path.open("rb") as f:
                raw=f.read(TEXT_LIMIT)
            for enc in ("utf-8-sig","cp1251"):
                try: return raw.decode(enc)
                except UnicodeDecodeError: pass
        if suffix==".docx":
            with zipfile.ZipFile(path) as z:
                info=z.getinfo("word/document.xml")
                if info.file_size>TEXT_LIMIT: return ""
                with z.open(info) as f: raw=f.read(TEXT_LIMIT+1)
                if len(raw)>TEXT_LIMIT or b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper(): return ""
                root=ET.fromstring(raw)
                ns="{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
                return "\n".join("".join(t.text or "" for t in p.iter(ns+"t")) for p in root.iter(ns+"p"))
    except (OSError,ValueError,KeyError,RuntimeError,zipfile.BadZipFile,ET.ParseError):
        pass
    return ""

def excerpt(text,terms,limit=700):
    low=text.casefold()
    matches=[low.find(t) for t in terms if t in low]
    start=max(0,min(matches)-120) if matches else 0
    return ("…" if start else "")+text[start:start+limit]+("…" if len(text)>start+limit else "")

class Router:
    def __init__(self,chat,workspace,cloud):
        self.chat,self.workspace,self.cloud=chat,workspace,cloud
        self.lock=threading.RLock()
        self.plans=OrderedDict()
        self.fts=True
        try:
            with closing(chat.connect()) as db, db:
                db.executescript("""
                CREATE VIRTUAL TABLE IF NOT EXISTS routing_chat_fts USING fts5(text,content='chat_messages',content_rowid='id',tokenize='unicode61');
                CREATE TABLE IF NOT EXISTS routing_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TRIGGER IF NOT EXISTS routing_chat_insert AFTER INSERT ON chat_messages BEGIN
                    INSERT INTO routing_chat_fts(rowid,text) VALUES(new.id,new.text);
                END;
                CREATE TRIGGER IF NOT EXISTS routing_chat_delete AFTER DELETE ON chat_messages BEGIN
                    INSERT INTO routing_chat_fts(routing_chat_fts,rowid,text) VALUES('delete',old.id,old.text);
                END;
                CREATE TRIGGER IF NOT EXISTS routing_chat_update AFTER UPDATE OF text ON chat_messages BEGIN
                    INSERT INTO routing_chat_fts(routing_chat_fts,rowid,text) VALUES('delete',old.id,old.text);
                    INSERT INTO routing_chat_fts(rowid,text) VALUES(new.id,new.text);
                END;
                CREATE VIRTUAL TABLE IF NOT EXISTS routing_workspace_fts USING fts5(source UNINDEXED, item_id UNINDEXED, title, body, tokenize='unicode61');
                CREATE TABLE IF NOT EXISTS routing_workspace_versions(source TEXT,item_id INTEGER,version TEXT,PRIMARY KEY(source,item_id));
                """)
                if not db.execute("SELECT 1 FROM routing_meta WHERE key='chat_v1'").fetchone():
                    db.execute("INSERT INTO routing_chat_fts(routing_chat_fts) VALUES('rebuild')")
                    db.execute("INSERT INTO routing_meta VALUES('chat_v1','1')")
        except sqlite3.OperationalError as e:
            if "no such module: fts5" not in str(e).lower(): raise
            self.fts=False

    def sources(self,db):
        # SQLite snapshot, active work and files only. Resolve references locally.
        records=db.execute("SELECT * FROM work_records ORDER BY id").fetchall()
        fields={r["id"]:json.loads(r["payload"]) for r in records}
        def ref(rid):
            f=fields.get(rid,{})
            return str(f.get("name") or f.get("plate") or ("#"+str(rid))) if rid is not None else "—"
        result=[]
        for r in records:
            if r["archived"]: continue
            f=fields[r["id"]]
            parts=[]
            for k,v in f.items():
                if k in ("driver","employee","vehicle","card"): v=ref(v)
                # Do not put full fuel-card numbers into the retrieval context.
                if k=="number" and r["kind"]=="cards": v="••••"+str(v)[-4:]
                parts.append(FIELDS.get(k,k)+": "+str(v))
            title=LABELS[r["kind"]]
            body="; ".join(parts)
            result.append(("work",r["id"],title,body,r["updated"],r["updated"]+"|"+body,None))
        for r in db.execute("""
            WITH RECURSIVE live(id) AS (
                SELECT id FROM disk_entries WHERE parent IS NULL AND trashed=0
                UNION ALL SELECT e.id FROM disk_entries e JOIN live p ON e.parent=p.id WHERE e.trashed=0
            ) SELECT d.* FROM disk_entries d JOIN live l ON l.id=d.id WHERE d.kind='file' ORDER BY d.id
        """):
            path=self.workspace.files/str(r["blob"])
            if not re.fullmatch(r"[0-9a-f]{32}",str(r["blob"])) or path.is_symlink() or not path.is_file(): continue
            try: stat=path.stat()
            except OSError: continue
            if stat.st_size!=r["size"]: continue
            result.append(("file",r["id"],r["name"],"",r["updated"],r["updated"]+"|"+str(stat.st_mtime_ns),path))
        return result

    def search(self,q):
        terms=tokens(q)
        if not terms: return []
        # Safe, literal FTS query; no user-controlled operators.
        match=" OR ".join('"'+t+'"' for t in terms)
        candidates=[]
        with closing(self.chat.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE" if self.fts else "BEGIN")
            sources=self.sources(db)
            metadata={(source,i):(title,stamp) for source,i,title,body,stamp,version,path in sources}
            if self.fts:
                versions={(r[0],r[1]):r[2] for r in db.execute("SELECT * FROM routing_workspace_versions")}
                for source,i,title,body,stamp,version,path in sources:
                    if versions.get((source,i))==version: continue
                    if path is not None: body=extract(path,title)
                    db.execute("DELETE FROM routing_workspace_fts WHERE source=? AND item_id=?",(source,i))
                    db.execute("INSERT INTO routing_workspace_fts(source,item_id,title,body) VALUES(?,?,?,?)",(source,i,title,body))
                    db.execute("INSERT OR REPLACE INTO routing_workspace_versions VALUES(?,?,?)",(source,i,version))
                for source,i in versions.keys()-metadata.keys():
                    db.execute("DELETE FROM routing_workspace_fts WHERE source=? AND item_id=?",(source,i))
                    db.execute("DELETE FROM routing_workspace_versions WHERE source=? AND item_id=?",(source,i))
                chatrows=db.execute("""SELECT m.* FROM routing_chat_fts JOIN chat_messages m ON m.id=routing_chat_fts.rowid
                    WHERE routing_chat_fts MATCH ? ORDER BY bm25(routing_chat_fts),m.id DESC LIMIT 60""",(match,)).fetchall()
                for r in db.execute("SELECT source,item_id,title,body FROM routing_workspace_fts WHERE routing_workspace_fts MATCH ? ORDER BY bm25(routing_workspace_fts) LIMIT 60",(match,)):
                    key=(r["source"],r["item_id"])
                    if key in metadata:
                        candidates.append((key[0],key[1],r["title"],r["body"],metadata[key][1],None))
            else:
                chatrows=db.execute("SELECT * FROM chat_messages ORDER BY id DESC LIMIT 2000").fetchall()
                for source,i,title,body,stamp,version,path in sources[:1000]:
                    candidates.append((source,i,title,extract(path,title) if path else body,stamp,None))
            pages=self.chat.clusters(db)
            offsets={};total=0
            for p in pages: offsets[p["id"]]=total;total+=p["count"]
            for r in chatrows:
                if r["role"]=="assistant" and r["text"].startswith(("Сообщение сохранено","Локальный поиск","Найдено в локальной памяти","Недостаточно данных","Локальный подсчёт")): continue
                block=(offsets[r["cluster_id"]]+r["position"]-1)//500+1
                candidates.append(("memory",block,"Сообщение #"+str(r["id"])+" ("+r["role"]+")",r["text"],r["created_at"],r["id"]))
        hits=[]
        for source,i,title,body,stamp,message in candidates:
            words=set(tokens(title+" "+body)) if len(body)<120 else set(re.findall(r"[^\W_]+",(title+" "+body).casefold()))
            found=[t for t in terms if t in words]
            if not found: continue
            try: age=max(0,(datetime.now(timezone.utc)-datetime.fromisoformat(stamp)).days)
            except (ValueError,TypeError): age=9999
            hits.append({"source":source,"id":i,"message_id":message,"title":title,"text":excerpt(body,terms),"updated":stamp,"age_days":age,"coverage":len(found)/len(terms),"matched":found})
        hits.sort(key=lambda h:(h["coverage"],h["source"]=="work",-h["age_days"]),reverse=True)
        # Keep several different sources instead of repeating identical excerpts.
        distinct=[];seen=set()
        for h in hits:
            key=(h["source"],h["id"],h["text"])
            if key not in seen: distinct.append(h);seen.add(key)
            if len(distinct)>=8: break
        return distinct

    def plan(self,value):
        value=validate(value)
        q=value["text"]
        hits=self.search(q)
        count_kinds={"сотрудников":"staff","автомобилей":"vehicles","машин":"vehicles","топливных карт":"cards","записей табеля":"timesheet","записей гсм":"fuel"}
        count_match=re.fullmatch(r"сколько\s+(сотрудников|автомобилей|машин|топливных карт|записей табеля|записей гсм|файлов|документов|сообщений)[?\s]*",q.casefold())
        count_answer=None
        if count_match:
            what=count_match.group(1)
            summary=self.workspace.map_summary()
            if what=="сообщений": n=sum(c["count"] for c in self.chat.memory_snapshot()["clusters"])
            elif what in ("файлов","документов"): n=len(summary["files"])
            else: n=summary["work"].get(count_kinds[what],0)
            count_answer=f"Локальный подсчёт SQLite: {what} — {n}."
            if what in count_kinds:
                hits=[{"source":"work","id":r["id"],"message_id":None,"title":LABELS[r["kind"]],"text":"Активная запись учтена в подсчёте","updated":datetime.now(timezone.utc).isoformat(),"age_days":0,"coverage":1,"matched":[]} for r in summary["records"] if r["kind"]==count_kinds[what]][:8]
            elif what in ("файлов","документов"):
                hits=[{"source":"file","id":r["id"],"message_id":None,"title":r["name"],"text":"Файл учтён в подсчёте","updated":datetime.now(timezone.utc).isoformat(),"age_days":0,"coverage":1,"matched":[]} for r in summary["files"][:8]]
        lookup=bool(re.match(r"^\s*(найди|покажи|вспомни|поиск|что (?:я|мы) (?:писал|говорил))\b",q.casefold()))
        # Explicit retrieval, not arbitrary factual inference. Conflicts are
        # conservative possible discrepancies, not an AI verdict.
        conflicts=[]
        for i,a in enumerate(hits):
            for b in hits[i+1:]:
                if a["source"]==b["source"]=="work" and a["title"]==b["title"] and a["coverage"]==b["coverage"]==1 and a["text"]!=b["text"]:
                    conflicts.append("Несколько разных рабочих записей: "+a["title"]);break
        conflicts=list(dict.fromkeys(conflicts))[:3]
        sufficient=count_answer is not None or (lookup and bool(hits) and hits[0]["coverage"]>=.75 and not conflicts)
        context_parts=[]
        for h in hits:
            part=f"[{h['source']} #{h['id']}; {h['title']}; дата {h['updated'][:10]}] {h['text']}"
            if len("\n".join(context_parts+[part]))>CONTEXT_LIMIT: break
            context_parts.append(part)
        context="\n".join(context_parts)
        lines=[f"[{h['source']} #{h['id']}] {h['title']} ({h['updated'][:10]}): {h['text']}" for h in hits]
        local=("Найдено в локальной памяти (цитаты, не проверенные факты):\n"+"\n\n".join(lines)) if hits else "Недостаточно данных в локальной памяти. Запрос сохраню; для рассуждения можно явно разрешить Cloud.ru."
        if hits and not sufficient: local="Локальный поиск: найденные сведения могут быть неполными или устаревшими.\n"+"\n\n".join(lines)
        if any(h["age_days"]>365 for h in hits): local+="\nНекоторые источники старше года; актуальность не подтверждена."
        if conflicts: local+="\nВозможные расхождения: "+"; ".join(conflicts)
        if count_answer is not None: local=count_answer;conflicts=[]
        plan={"token":uuid4().hex,"hits":hits,"intent":"count" if count_answer is not None else "lookup" if lookup else "reasoning","sufficient":sufficient,"conflicts":conflicts,"context":context,"local":local,"fts":self.fts}
        with self.lock:
            now=time.monotonic()
            for k in list(self.plans):
                if now-self.plans[k][0]>PLAN_TTL: del self.plans[k]
            while len(self.plans)>=64:self.plans.popitem(last=False)
            self.plans[plan["token"]]=(now,value,plan)
        return plan

    def execute(self,value):
        if not isinstance(value,dict) or set(value)!={"token","request_id","text","cloud"} or type(value["cloud"]) is not bool:
            raise ValueError("Некорректное подтверждение")
        req=validate({"text":value["text"],"request_id":value["request_id"]})
        with self.lock:
            existing=self.chat.existing_request(req)
            if existing: return existing
            if not isinstance(value["token"],str): raise ValueError("Некорректный план")
            item=self.plans.get(value["token"])
            if not item or time.monotonic()-item[0]>PLAN_TTL or item[1]!=req:
                raise ValueError("План поиска устарел; повторите поиск")
            if not self.chat.startup_health["ok"]: raise RuntimeError("Memory integrity failure")
            plan=item[2]
            paid=value["cloud"] and not plan["sufficient"]
            if paid:
                # Single attempt for the approved plan. No auto-retry after an
                # ambiguous transport error; the next plan requires consent again.
                del self.plans[value["token"]]
                with self.cloud.send_lock:
                    existing=self.chat.existing_request(req)
                    if existing:return existing
                    reply=self.cloud.complete(req["text"],plan["context"])
                    result=self.chat.memory_append(req,reply)
            else:
                result=self.chat.memory_append(req,plan["local"])
                self.plans.pop(value["token"],None)
            return {**result,"route":"cloud" if paid else "local"}
