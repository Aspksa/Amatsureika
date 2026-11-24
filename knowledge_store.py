"""Structured knowledge over the existing SQLite and chronological chat, not a second chat store."""
import hashlib
import math
import json
import re
import threading
import time
from collections import Counter, OrderedDict
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
    def __init__(self,chat,cloud=None):
        self.cloud=cloud;self.chat=chat;self.stop=threading.Event();self.worker=None;self.query_vectors=OrderedDict();self.cache_lock=threading.Lock()
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
                CREATE TABLE IF NOT EXISTS knowledge_vectors(item_id TEXT PRIMARY KEY REFERENCES knowledge_items(id),model TEXT NOT NULL,digest TEXT NOT NULL,vector TEXT NOT NULL,created TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS knowledge_cursor(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS knowledge_state_updated ON knowledge_items(state,updated DESC);
                CREATE INDEX IF NOT EXISTS knowledge_links_reverse ON knowledge_links(b);
                CREATE INDEX IF NOT EXISTS knowledge_versions_item ON knowledge_versions(item_id,id DESC);
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
            i=self.put(db,v["kind"],subject,predicate,value,context,"user_entry",fingerprint(v["kind"],subject,predicate,value),expires)
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
            rows=db.execute("SELECT * FROM knowledge_items WHERE state='confirmed' AND (expires='' OR expires>=?) ORDER BY updated DESC LIMIT 1500",(date.today().isoformat(),)).fetchall() if confirmed_only else db.execute("SELECT * FROM knowledge_items WHERE state!='rejected' ORDER BY updated DESC LIMIT 1500").fetchall()
            found=[]
            for r in rows:
                stale=bool(r["expires"] and r["expires"]<date.today().isoformat())
                if confirmed_only and (r["state"]!="confirmed" or stale):continue
                words=set(re.findall(r"\w{2,}",(r["subject"]+" "+r["predicate"]+" "+r["value"]).casefold()))
                score,_=rank(terms,words) if terms else (1,[])
                if score<=0:continue
                found.append({**dict(r),"score":score,"stale":stale})
            found.sort(key=lambda r:(r["score"],r["state"]=="confirmed",not r["stale"],r["confidence"],min(r["uses"],20),r["updated"]),reverse=True)
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
        rows=self.fusion(q[:500])[:4]
        if rows:
            with closing(self.chat.connect()) as db,db:
                db.executemany("UPDATE knowledge_items SET uses=uses+1 WHERE id=? AND state='confirmed'",[(r["id"],) for r in rows])
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
    def embedding_preview(self,i):
        if not isinstance(i,str):raise ValueError("Некорректный ID")
        with closing(self.chat.connect()) as db:
            r=db.execute("SELECT * FROM knowledge_items WHERE id=? AND state='confirmed'",(i,)).fetchone()
            if not r:raise ValueError("Можно индексировать только подтверждённое знание")
            text=r["subject"]+" / "+r["predicate"]+": "+r["value"]
            digest=hashlib.sha256(text.encode()).hexdigest()
            cached=db.execute("SELECT 1 FROM knowledge_vectors WHERE item_id=? AND digest=? AND model=?",(i,digest,"Qwen/Qwen3-Embedding-0.6B")).fetchone()
        return {"id":i,"text":text,"model":"Qwen/Qwen3-Embedding-0.6B","cached":bool(cached)}
    def embed_item(self,i,text):
        preview=self.embedding_preview(i)
        if text!=preview["text"]:raise ValueError("Текст изменился. Повторите подтверждение.")
        if preview["cached"]:return {"cached":True}
        if not self.cloud:raise ValueError("Cloud.ru недоступен")
        digest=hashlib.sha256(text.encode()).hexdigest()
        with self.cloud.send_lock:
            # Recheck after waiting for other paid operations.
            current=self.embedding_preview(i)
            if current["text"]!=text:raise ValueError("Текст изменился")
            if current["cached"]:return {"cached":True}
            vec=self.cloud.embed(text)
            with closing(self.chat.connect()) as db,db:
                db.execute("INSERT OR REPLACE INTO knowledge_vectors VALUES(?,?,?,?,?)",(i,preview["model"],digest,json.dumps(vec),utc()))
        return {"cached":False}
    def semantic(self,q):
        q=short(q,500)
        if not self.cloud:raise ValueError("Cloud.ru недоступен")
        # Every uncached query still needs explicit consent via dispatch.
        rows=self.vector_rows()
        if not rows:return []
        key=hashlib.sha256(q.encode()).hexdigest()
        with self.cloud.send_lock:
            with self.cache_lock:query=self.query_vectors.get(key)
            if query is None:
                query=self.cloud.embed(q)
                with self.cache_lock:
                    self.query_vectors[key]=query
                    while len(self.query_vectors)>32:self.query_vectors.popitem(last=False)
        return self.fusion(q,query=query)
    def vector_rows(self):
        with closing(self.chat.connect()) as db:
            return db.execute("SELECT k.*,v.vector,v.digest FROM knowledge_items k JOIN knowledge_vectors v ON v.item_id=k.id WHERE k.state='confirmed' AND v.model=? AND (k.expires='' OR k.expires>=?) ORDER BY k.updated DESC LIMIT 1500",("Qwen/Qwen3-Embedding-0.6B",date.today().isoformat())).fetchall()
    def fusion(self,q,query=None):
        lexical=self.search(q,True)
        result={r["id"]:{**r,"lexical_score":r["score"],"fusion_score":r["score"]} for r in lexical}
        if query is None:
            with self.cache_lock:query=self.query_vectors.get(hashlib.sha256(q.encode()).hexdigest())
        if query is not None:
            for row in self.vector_rows():
                r=dict(row);text=r["subject"]+" / "+r["predicate"]+": "+r["value"]
                if r.pop("digest")!=hashlib.sha256(text.encode()).hexdigest():continue
                try:vec=json.loads(r.pop("vector"))
                except ValueError:continue
                if not isinstance(vec,list) or len(vec)!=len(query) or any(type(x) not in (int,float) or not math.isfinite(x) for x in vec):continue
                similarity=sum(a*b for a,b in zip(query,vec))
                if similarity<=0:continue
                old=result.get(r["id"])
                lexical_score=old["lexical_score"] if old else 0
                result[r["id"]]={**(old or r),"semantic_score":similarity,"lexical_score":lexical_score,"fusion_score":.55*lexical_score+.45*max(0,min(1,similarity))}
            for r in result.values():
                if "semantic_score" not in r:r["fusion_score"]*=.55
        return sorted(result.values(),key=lambda x:(x["fusion_score"],x["confidence"],min(x["uses"],20),x["updated"]),reverse=True)[:30]
    def health(self):
        with closing(self.chat.connect()) as db:
            counts=dict(db.execute("SELECT state,COUNT(*) FROM knowledge_items GROUP BY state").fetchall())
            missing=db.execute("SELECT COUNT(*) FROM knowledge_items k WHERE NOT EXISTS(SELECT 1 FROM knowledge_sources s WHERE s.item_id=k.id)").fetchone()[0]
            broken=db.execute("SELECT COUNT(*) FROM knowledge_links l LEFT JOIN knowledge_items a ON a.id=l.a LEFT JOIN knowledge_items b ON b.id=l.b WHERE a.id IS NULL OR b.id IS NULL").fetchone()[0]
            expired=db.execute("SELECT COUNT(*) FROM knowledge_items WHERE expires!='' AND expires<?",(date.today().isoformat(),)).fetchone()[0]
            vectors=db.execute("SELECT COUNT(*) FROM knowledge_vectors").fetchone()[0]
            top=[dict(x) for x in db.execute("SELECT id,subject,predicate,uses,state FROM knowledge_items WHERE uses>0 ORDER BY uses DESC LIMIT 10")]
            cursor=db.execute("SELECT value FROM knowledge_cursor WHERE key='chat'").fetchone()
            lag=db.execute("SELECT COUNT(*) FROM chat_messages WHERE role='user' AND id>?",(int(cursor[0]) if cursor else 0,)).fetchone()[0]
        return {"states":counts,"missing_provenance":missing,"broken_links":broken,"expired":expired,"vectors":vectors,"pending_messages":lag,"frequent_context":top,"note":"Частота извлечения не доказывает истинность; только подтверждённые актуальные знания входят в контекст."}
    def graph(self,q):
        items=self.search(q)
        ids={r["id"] for r in items};links={}
        for r in items:
            for link in r.get("links",[]):
                if link["a"] in ids and link["b"] in ids:links[(link["a"],link["b"],link["kind"])]=link
        return {"items":[{**r,"value":r["value"][:350]} for r in items],"links":list(links.values()),"note":"Сохранённые связи. Гипотеза причины не является доказанной причиной."}
    def timeline(self,q):
        items=self.search(q)
        return {"items":sorted(items,key=lambda r:(r["created"],r["id"])),"note":"Дата записи знания, не обязательно дата события. Исходный контекст сохранён."}
    def dispatch(self,v):
        if not isinstance(v,dict):raise ValueError("Некорректное действие")
        a=v.get("action")
        rest={k:x for k,x in v.items() if k!="action"}
        if a=="add":return self.add(rest)
        if a=="review":return self.review(rest)
        if a=="link":return self.link(rest)
        if a=="search" and set(rest)=={"query"}:return {"items":self.search(rest["query"])}
        if a=="stats" and not rest:return self.stats()
        if a=="health" and not rest:return self.health()
        if a=="graph" and set(rest)=={"query"}:return self.graph(rest["query"])
        if a=="timeline" and set(rest)=={"query"}:return self.timeline(rest["query"])
        if a=="fusion" and set(rest)=={"query"}:return {"items":self.fusion(short(rest["query"],500))}
        if a=="consolidate" and not rest:return self.consolidate()
        if a=="embedding_preview" and set(rest)=={"id"}:return self.embedding_preview(rest["id"])
        if a=="embed" and set(rest)=={"id","text","confirm"} and rest["confirm"] is True:return self.embed_item(rest["id"],rest["text"])
        if a=="semantic" and set(rest)=={"query","confirm"} and rest["confirm"] is True:return {"items":self.semantic(rest["query"])}
        if a=="history" and set(rest)=={"id"} and isinstance(rest["id"],str):return self.history(rest["id"])
        raise ValueError("Неизвестное действие памяти")
