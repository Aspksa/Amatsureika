"""Local-first retrieval and explicitly approved, bounded cloud context."""
import json
from tool_engine import ToolEngine, catalog, command, report_text
from advanced_tools import AdvancedTools, parse_command, anomaly_text, bundle_text, compare_text
from agent_engine import Agent, parse as agent_parse
from work_import import Importer
from web_research import WebResearch
from evidence import rank as sparse_rank, evidence_links, missing_terms
import ast
from decimal import Decimal, localcontext, DecimalException
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
        self.tools=ToolEngine(workspace,chat)
        self.advanced=AdvancedTools(workspace,self.tools,extract)
        self.agent=Agent(chat,workspace,self.tools,self.advanced)
        self.importer=Importer(workspace)
        self.web=WebResearch(chat,workspace)
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

    def search(self,q,scope="all"):
        terms=tokens(q)
        if not terms: return []
        # Safe, literal FTS query; no user-controlled operators.
        match=" OR ".join('"'+t+'"' + (' OR "'+t[:4]+'"*' if len(t)>=6 else "") for t in terms)
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
                if r["role"]=="assistant" and r["text"].startswith(("Сообщение сохранено","Локальный поиск","Найдено в локальной памяти","Недостаточно данных","Локальный подсчёт","Локальный отчёт SQLite","Комплексный локальный отчёт","Локальная проверка аномалий","Сравнение извлечённого текста","Изменение сохранено локально","Изменение уже сохранено","Изменение не выполнено","Локальный сценарий:")): continue
                block=(offsets[r["cluster_id"]]+r["position"]-1)//500+1
                candidates.append(("memory",block,"Сообщение #"+str(r["id"])+" ("+r["role"]+")",r["text"],r["created_at"],r["id"]))
        hits=[]
        for source,i,title,body,stamp,message in candidates:
            if scope!="all" and source!=scope: continue
            words=set(tokens(title+" "+body)) if len(body)<120 else set(re.findall(r"[^\W_]+",(title+" "+body).casefold()))
            similarity,found=sparse_rank(terms,words)
            if similarity<=0: continue
            try: age=max(0,(datetime.now(timezone.utc)-datetime.fromisoformat(stamp)).days)
            except (ValueError,TypeError): age=9999
            hits.append({"trust":"register" if source=="work" else "document" if source=="file" else "historical_statement","source":source,"id":i,"message_id":message,"title":title,"text":excerpt(body,terms),"updated":stamp,"age_days":age,"coverage":len(found)/len(terms),"similarity":similarity,"matched":found})
        hits.sort(key=lambda h:(h["coverage"],h.get("similarity",0),h["source"]=="work",-h["age_days"]),reverse=True)
        # Keep several different sources instead of repeating identical excerpts.
        distinct=[];seen=set()
        for h in hits:
            key=(h["source"],h["id"],h["text"])
            if key not in seen: distinct.append(h);seen.add(key)
            if len(distinct)>=8: break
        return distinct

    def search_tool(self,value):
        if not isinstance(value,dict) or set(value)!={"text","scope"} or value["scope"] not in ("all","memory","work","file"):
            raise ValueError("Некорректная область поиска")
        q=value["text"]
        if not isinstance(q,str) or not q.strip() or len(q)>1000: raise ValueError("Некорректный поиск")
        return {"hits":self.search(q, value["scope"]),"fts":self.fts}

    def plan(self,value):
        value=validate(value)
        q=value["text"]
        attachment_ids=list(dict.fromkeys(int(x) for x in re.findall(r"(?m)^\[Документ #(\d{1,12})\]$",q)))
        if len(attachment_ids)>3:raise ValueError("До трёх вложений")
        question=re.sub(r"(?m)^\[Документ #\d{1,12}\]$","",q).strip()
        task=parse_command(q) if not attachment_ids else None
        advanced_answer=None;advanced_sources=[];mutation=None
        with closing(self.chat.connect()) as db:
            previous=db.execute("SELECT text FROM chat_messages WHERE role='user' AND request_id!=? ORDER BY id DESC LIMIT 1",(value["request_id"],)).fetchone()
        agent_steps=agent_parse(q,previous[0] if previous else None) if not task and not attachment_ids else None
        receipt=self.workspace.edit_receipt(value["request_id"],q)
        if receipt:
            advanced_answer="Изменение уже сохранено: запись #"+str(receipt["id"])+" · "+receipt["label"]
        elif task:
            action,args=task
            if action=="bundle":
                data=self.advanced.bundle(args);advanced_answer=bundle_text(data)
                advanced_sources=[h for r in data["reports"] for h in r["sources"]]
            elif action=="anomalies":
                data=self.advanced.anomalies();advanced_answer=anomaly_text(data)
                advanced_sources=[{"source":"work","id":i,"title":a["text"]} for a in data["issues"] for i in a["ids"]]
            elif action=="compare":
                data=self.advanced.compare(*args);advanced_answer=compare_text(data)
                advanced_sources=[{"source":"file","id":f["id"],"title":f["name"]} for f in data["files"]]
            else:
                mutation=self.advanced.preview(*args)
                advanced_answer="Изменение не выполнено: требуется подтверждение."
                advanced_sources=[{"source":"work","id":mutation["id"],"title":mutation["label"]}]
        if agent_steps and advanced_answer is None:
            run=self.agent.run(agent_steps)
            advanced_answer="Локальный сценарий:\n"+"\n\n".join(s["text"] for s in run["steps"])+"\n"+run["snapshot"]
            advanced_sources=[h for s in run["steps"] for h in s["sources"]]
        tool=command(q) if advanced_answer is None and not attachment_ids else None
        report=self.tools.run(tool) if tool else None
        hits=self.search(question) if report is None and advanced_answer is None else []
        attachment_hits=[]
        for rid in attachment_ids:
            path,title,size=self.workspace.download(rid)
            body=extract(path,title)
            if not body:body="Содержимое не извлечено; доступно только имя файла."
            attachment_hits.append({"source":"file","id":rid,"message_id":None,"title":title,"text":body[:1600],"updated":datetime.now(timezone.utc).isoformat(),"age_days":0,"coverage":0,"matched":[]})
        if attachment_hits:hits=attachment_hits+[h for h in hits if (h["source"],h["id"]) not in {("file",i) for i in attachment_ids}][:8-len(attachment_hits)]
        count_kinds={"сотрудников":"staff","автомобилей":"vehicles","машин":"vehicles","топливных карт":"cards","записей табеля":"timesheet","записей гсм":"fuel"}
        count_match=re.fullmatch(r"сколько\s+(сотрудников|автомобилей|машин|топливных карт|записей табеля|записей гсм|файлов|документов|сообщений)[?\s]*",q.casefold())
        count_answer=advanced_answer
        if advanced_answer is not None:
            seen=set()
            for h in advanced_sources:
                key=(h["source"],h["id"])
                if key in seen:continue
                seen.add(key)
                hits.append({**h,"message_id":None,"text":"Источник локального инструмента","updated":datetime.now(timezone.utc).isoformat(),"age_days":0,"coverage":1,"matched":[]})
                if len(hits)>=8:break
        if report is not None:
            count_answer=report_text(report)
            hits=[{**h,"message_id":None,"text":"Источник учтён в локальном отчёте","updated":report["generated"],"age_days":0,"coverage":1,"matched":[]} for h in report["sources"]]
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
        lookup=not attachment_ids and bool(re.match(r"^\s*(найди|покажи|вспомни|поиск|что (?:я|мы) (?:писал|говорил))\b",q.casefold()))
        # Explicit retrieval, not arbitrary factual inference. Conflicts are
        # conservative possible discrepancies, not an AI verdict.
        conflicts=[]
        for i,a in enumerate(hits):
            for b in hits[i+1:]:
                if a["source"]==b["source"]=="work" and a["title"]==b["title"] and a["coverage"]==b["coverage"]==1 and a["text"]!=b["text"]:
                    conflicts.append("Несколько разных рабочих записей: "+a["title"]);break
        conflicts=list(dict.fromkeys(conflicts))[:3]
        sufficient=count_answer is not None or (lookup and bool(hits) and hits[0]["coverage"]>=.75 and not conflicts)
        links=evidence_links(hits) if count_answer is None else []
        missing=missing_terms(tokens(question),hits) if count_answer is None else []
        context_parts=[]
        for h in hits:
            part=f"[{h['source']} #{h['id']}; {h['title']}; дата {h['updated'][:10]}] {h['text']}"
            if len("\n".join(context_parts+[part]))>CONTEXT_LIMIT: break
            context_parts.append(part)
        if not sufficient and not mutation:
            with closing(self.chat.connect()) as db:
                recent=db.execute("SELECT role,text FROM chat_messages WHERE request_id!=? ORDER BY id DESC LIMIT 4",(value["request_id"],)).fetchall()[::-1]
            for r in recent:
                part="[Недавний диалог; "+r["role"]+"] "+r["text"][:400]
                if len("\n".join(context_parts+[part]))<=CONTEXT_LIMIT:context_parts.append(part)
        context="\n".join(context_parts)
        lines=[f"[{h['source']} #{h['id']}] {h['title']} ({h['updated'][:10]}): {h['text']}" for h in hits]
        local=("Найдено в локальной памяти (цитаты, не проверенные факты):\n"+"\n\n".join(lines)) if hits else "Недостаточно данных в локальной памяти. Запрос сохраню; для рассуждения можно явно разрешить Cloud.ru."
        if hits and not sufficient: local="Локальный поиск: найденные сведения могут быть неполными или устаревшими.\n"+"\n\n".join(lines)
        if any(h["age_days"]>365 for h in hits): local+="\nНекоторые источники старше года; актуальность не подтверждена."
        if conflicts: local+="\nВозможные расхождения: "+"; ".join(conflicts)
        if count_answer is not None: local=count_answer;conflicts=[]
        else:
            if missing:local+="\nБез точного подтверждения в найденных выдержках: "+", ".join(missing)+"."
            if links:local+="\nПересечения источников (общие слова, не причинность): "+"; ".join(x["from"]+" ↔ "+x["to"]+": "+", ".join(x["terms"]) for x in links[:4])
        plan={"token":uuid4().hex,"hits":hits,"intent":"edit" if mutation else "workflow" if advanced_answer is not None else "tool" if report is not None else "count" if count_answer is not None else "lookup" if lookup else "reasoning","sufficient":sufficient,"conflicts":conflicts,"context":context,"local":local,"fts":self.fts,"mutation":mutation,"missing":missing,"links":links}
        with self.lock:
            now=time.monotonic()
            for k in list(self.plans):
                if now-self.plans[k][0]>PLAN_TTL: del self.plans[k]
            while len(self.plans)>=64:self.plans.popitem(last=False)
            self.plans[plan["token"]]=(now,value,plan)
        return plan

    def execute(self,value,emit=None):
        if not isinstance(value,dict) or set(value) not in ({"token","request_id","text","cloud"},{"token","request_id","text","cloud","approve_edit"}) or type(value["cloud"]) is not bool or type(value.get("approve_edit",False)) is not bool:
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
            mutation=plan.get("mutation")
            if value.get("approve_edit") and not mutation:raise ValueError("Нет изменения для подтверждения")
            paid=value["cloud"] and not plan["sufficient"]
            if paid:
                # Single attempt for the approved plan. No auto-retry after an
                # ambiguous transport error; the next plan requires consent again.
                del self.plans[value["token"]]
                with self.cloud.send_lock:
                    existing=self.chat.existing_request(req)
                    if existing:return existing
                    reply=self.cloud.complete_stream(req["text"],plan["context"],emit) if emit is not None else self.cloud.complete(req["text"],plan["context"])
                    result=self.chat.memory_append(req,reply)
            else:
                answer=plan["local"]
                if mutation and value.get("approve_edit"):
                    self.advanced.apply(mutation,req["request_id"],req["text"])
                    answer="Изменение сохранено локально: запись #"+str(mutation["id"])+" · "+mutation["label"]+": "+str(mutation["before"])+" → "+str(mutation["after"])
                result=self.chat.memory_append(req,answer)
                self.plans.pop(value["token"],None)
            return {**result,"route":"cloud" if paid else "local"}

def calculate(value):
    if not isinstance(value,dict) or set(value)!={"expression"}:
        raise ValueError("Некорректное выражение")
    expr=value["expression"]
    if not isinstance(expr,str) or not expr.strip() or len(expr)>160:
        raise ValueError("Введите выражение до 160 символов")
    expr=expr.strip().replace("×","*").replace("÷","/").replace("−","-").replace(",",".")
    if not re.fullmatch(r"[0-9.+*/() \t-]+",expr):
        raise ValueError("Только числа, + − × ÷ и скобки")
    def walk(node):
        if isinstance(node,ast.Constant) and type(node.value) in (int,float):
            result=Decimal(ast.get_source_segment(expr,node))
        elif isinstance(node,ast.UnaryOp) and type(node.op) in (ast.UAdd,ast.USub):
            result=walk(node.operand)
            if isinstance(node.op,ast.USub):result=-result
        elif isinstance(node,ast.BinOp) and type(node.op) in (ast.Add,ast.Sub,ast.Mult,ast.Div):
            a,b=walk(node.left),walk(node.right)
            if isinstance(node.op,ast.Add):result=a+b
            elif isinstance(node.op,ast.Sub):result=a-b
            elif isinstance(node.op,ast.Mult):result=a*b
            else:result=a/b
        else:raise ValueError("Недопустимая операция")
        if not result.is_finite() or abs(result)>Decimal("1e50"):raise ValueError("Число слишком большое")
        return result
    try:
        tree=ast.parse(expr,mode="eval")
        if sum(1 for _ in ast.walk(tree))>100:raise ValueError("Слишком сложное выражение")
        with localcontext() as ctx:
            ctx.prec=28
            result=walk(tree.body)
            return {"result":str(result.normalize()) if result else "0"}
    except (SyntaxError,DecimalException,OverflowError,RecursionError):
        raise ValueError("Неверное выражение или деление на ноль") from None
