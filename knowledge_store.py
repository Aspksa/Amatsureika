"""Structured knowledge over the existing SQLite and chronological chat, not a second chat store."""
import hashlib
import json
import re
import threading
import time
from collections import Counter
from contextlib import closing
from datetime import datetime,timezone,date
from uuid import uuid4
from evidence import rank

KINDS=("episodic","fact","procedural","context","error","decision","association")
STATES=("candidate","confirmed","rejected")
def utc():return datetime.now(timezone.utc).isoformat()
def norm(s):return " ".join(s.casefold().split())
def short(v,limit,required=True):
    if not isinstance(v,str) or len(v)>limit or required and not v.strip():raise ValueError("Некорректный текст")
    return v.strip()
def fingerprint(kind,subject,predicate,value):
    return hashlib.sha256(json.dumps([kind,*map(norm,(subject,predicate,value))],ensure_ascii=False).encode()).hexdigest()

class Knowledge:
    def __init__(self,chat):
        self.chat=chat;self.stop=threading.Event();self.worker=None
        with closing(chat.connect()) as db,db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS knowledge_items(
                    id TEXT PRIMARY KEY,kind TEXT NOT NULL,subject TEXT NOT NULL,predicate TEXT NOT NULL,value TEXT NOT NULL,
                    fingerprint TEXT NOT NULL UNIQUE,state TEXT NOT NULL,confidence REAL NOT NULL,
                    context TEXT NOT NULL,expires TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,
                    uses INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS knowledge_sources(item_id TEXT NOT NULL REFERENCES knowledge_items(id),source_type TEXT NOT NULL,source_id TEXT NOT NULL,
                    added TEXT NOT NULL,PRIMARY KEY(item_id,source_type,source_id));
                CREATE TABLE IF NOT EXISTS knowledge_versions(id INTEGER PRIMARY KEY,item_id TEXT NOT NULL REFERENCES knowledge_items(id),snapshot TEXT NOT NULL,created TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS knowledge_links(a TEXT NOT NULL REFERENCES knowledge_items(id),b TEXT NOT NULL REFERENCES knowledge_items(id),kind TEXT NOT NULL,strength INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,PRIMARY KEY(a,b,kind));
                CREATE TABLE IF NOT EXISTS knowledge_cursor(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS knowledge_lookup ON knowledge_items(kind,state,subject,predicate);
            """)
    def put(self,db,kind,subject,predicate,value,context,source_type,source_id,expires=""):
        key=fingerprint(kind,subject,predicate,value)
        r=db.execute("SELECT id FROM knowledge_items WHERE fingerprint=?",(key,)).fetchone()
        if r:i=r[0]
        else:
            i=uuid4().hex;ts=utc()
            db.execute("INSERT INTO knowledge_items(id,kind,subject,predicate,value,fingerprint,state,confidence,context,expires,created,updated) VALUES(?,?,?,?,?,?,'candidate',0,?,?,?,?)",(i,kind,subject,predicate,value,key,context,expires,ts,ts))
        db.execute("INSERT OR IGNORE INTO knowledge_sources VALUES(?,?,?,?)",(i,source_type,str(source_id),utc()))
        return i
    def add(self,v):
        if not isinstance(v,dict) or set(v)!={"kind","subject","predicate","value","context","expires"} or v["kind"] not in KINDS:raise ValueError("Некорректное знание")
        subject=short(v["subject"],150);predicate=short(v["predicate"],100);value=short(v["value"],2000);context=short(v["context"],1000,False);expires=short(v["expires"],10,False)
        if expires:date.fromisoformat(expires)
        with closing(self.chat.connect()) as db,db:
            db.execute("BEGIN IMMEDIATE")
            i=self.put(db,v["kind"],subject,predicate,value,context,"user_entry",uuid4().hex,expires)
        return {"id":i}
    def consolidate(self):
        with closing(self.chat.connect()) as db,db:
            db.execute("BEGIN IMMEDIATE")
            for key,sql,kind in [
                ("chat","SELECT id,text,created_at FROM chat_messages WHERE role='user' AND id>? ORDER BY id LIMIT 100","episodic"),
            ]:
                cursor=db.execute("SELECT value FROM knowledge_cursor WHERE key=?",(key,)).fetchone()
                rows=db.execute(sql,(int(cursor[0]) if cursor else 0,)).fetchall()
                for r in rows:
                    # Verbatim user message: never automatically treated as a factual claim.
                    self.put(db,kind,"Диалог","сообщение пользователя",r["text"],r["created_at"],"message",r["id"])
                if rows:db.execute("INSERT OR REPLACE INTO knowledge_cursor VALUES(?,?)",(key,str(rows[-1]["id"])))
            # Scenarios are actual saved procedures, runs are observed outcomes, not hypothetical experiences.
            for r in db.execute("SELECT id,name,steps,created FROM agent_scenarios ORDER BY created DESC LIMIT 100").fetchall():
                self.put(db,"procedural",r["name"],"сохранённый сценарий",r["steps"][:2000],r["created"],"scenario",r["id"])
            for r in db.execute("SELECT id,tool,status,detail,created FROM agent_runs ORDER BY created DESC LIMIT 100").fetchall():
                self.put(db,"decision" if r["status"]=="ok" else "error",r["tool"],"результат инструмента",r["status"]+": "+r["detail"],r["created"],"run",r["id"])
        return {"ok":True}
    def review(self,v):
        if not isinstance(v,dict) or set(v)!={"id","state","confidence","confirm"} or v["confirm"] is not True or v["state"] not in STATES or type(v["confidence"]) not in (int,float) or not 0<=v["confidence"]<=1:raise ValueError("Некорректное подтверждение")
        with closing(self.chat.connect()) as db,db:
            db.execute("BEGIN IMMEDIATE")
            r=db.execute("SELECT * FROM knowledge_items WHERE id=?",(v["id"],)).fetchone()
            if not r:raise ValueError("Знание не найдено")
            if v["state"]=="confirmed" and r["kind"]=="fact":
                peers=db.execute("SELECT * FROM knowledge_items WHERE kind='fact' AND state='confirmed' AND id!=?",(r["id"],)).fetchall()
                if any(norm(p["subject"])==norm(r["subject"]) and norm(p["predicate"])==norm(r["predicate"]) and norm(p["value"])!=norm(r["value"]) for p in peers):raise ValueError("Конфликт с подтверждённым фактом. Сначала разрешите противоречие.")
            db.execute("INSERT INTO knowledge_versions(item_id,snapshot,created) VALUES(?,?,?)",(r["id"],json.dumps(dict(r),ensure_ascii=False),utc()))
            db.execute("UPDATE knowledge_items SET state=?,confidence=?,updated=? WHERE id=?",(v["state"],v["confidence"] if v["state"]=="confirmed" else 0,utc(),r["id"]))
        return {"ok":True}
    def link(self,v):
        if not isinstance(v,dict) or set(v)!={"a","b","kind"} or v["a"]==v["b"] or v["kind"] not in ("related","supports","contradicts","precedes","hypothesis_cause"):raise ValueError("Некорректная связь")
        with closing(self.chat.connect()) as db,db:
            if db.execute("SELECT COUNT(*) FROM knowledge_items WHERE id IN (?,?)",(v["a"],v["b"])).fetchone()[0]!=2:raise ValueError("Знания не найдены")
            db.execute("INSERT INTO knowledge_links VALUES(?,?,?,1,?) ON CONFLICT(a,b,kind) DO UPDATE SET strength=MIN(100,strength+1)",(v["a"],v["b"],v["kind"],utc()))
        return {"ok":True}
    def search(self,q,confirmed_only=False):
        q=short(q,500,False);terms=list(dict.fromkeys(re.findall(r"\w{2,}",q.casefold())))[:16]
        with closing(self.chat.connect()) as db:
            rows=db.execute("SELECT * FROM knowledge_items WHERE state!='rejected' ORDER BY updated DESC LIMIT 1500").fetchall()
            found=[]
            for r in rows:
                stale=bool(r["expires"] and r["expires"]<date.today().isoformat())
                if confirmed_only and (r["state"]!="confirmed" or stale):continue
                words=set(re.findall(r"\w{2,}",(r["subject"]+" "+r["predicate"]+" "+r["value"]).casefold()))
                score,_=rank(terms,words) if terms else (1,[])
                if score<=0:continue
                found.append({**dict(r),"score":score,"stale":stale})
            found.sort(key=lambda r:(r["score"],r["state"]=="confirmed",not r["stale"],r["confidence"],r["updated"]),reverse=True)
            result=found[:30]
            for r in result:
                r["sources"]=[dict(s) for s in db.execute("SELECT source_type,source_id,added FROM knowledge_sources WHERE item_id=? ORDER BY added DESC LIMIT 8",(r["id"],))]
                r["links"]=[dict(x) for x in db.execute("SELECT a,b,kind,strength FROM knowledge_links WHERE a=? OR b=? LIMIT 12",(r["id"],r["id"]))]
                r["versions"]=db.execute("SELECT COUNT(*) FROM knowledge_versions WHERE item_id=?",(r["id"],)).fetchone()[0]
            return result
    def stats(self):
        with closing(self.chat.connect()) as db:
            rows=db.execute("SELECT kind,state,COUNT(*) n FROM knowledge_items GROUP BY kind,state").fetchall()
            return {"counts":[dict(r) for r in rows],"stale":db.execute("SELECT COUNT(*) FROM knowledge_items WHERE expires!='' AND expires<?",(date.today().isoformat(),)).fetchone()[0],"links":db.execute("SELECT COUNT(*) FROM knowledge_links").fetchone()[0],"versions":db.execute("SELECT COUNT(*) FROM knowledge_versions").fetchone()[0]}
    def context(self,q):
        rows=self.search(q,True)[:4]
        return [f"[Подтверждено пользователем; знание {r['id']}; уверенность пользователя {r['confidence']}; дата {r['updated'][:10]}] {r['subject']} / {r['predicate']}: {r['value'][:500]}" for r in rows]
    def history(self,i):
        with closing(self.chat.connect()) as db:
            return {"items":[{"created":r["created"],"snapshot":json.loads(r["snapshot"])} for r in db.execute("SELECT snapshot,created FROM knowledge_versions WHERE item_id=? ORDER BY id DESC LIMIT 50",(i,))]}
    def start(self):
        if self.worker:return
        def loop():
            while not self.stop.wait(30):
                try:self.consolidate()
                except Exception:pass
        self.worker=threading.Thread(target=loop,daemon=True);self.worker.start()
    def dispatch(self,v):
        if not isinstance(v,dict):raise ValueError("Некорректное действие")
        a=v.get("action")
        rest={k:x for k,x in v.items() if k!="action"}
        if a=="add":return self.add(rest)
        if a=="review":return self.review(rest)
        if a=="link":return self.link(rest)
        if a=="search" and set(rest)=={"query"}:return {"items":self.search(rest["query"])}
        if a=="stats" and not rest:return self.stats()
        if a=="consolidate" and not rest:return self.consolidate()
        if a=="history" and set(rest)=={"id"} and isinstance(rest["id"],str):return self.history(rest["id"])
        raise ValueError("Неизвестное действие памяти")
