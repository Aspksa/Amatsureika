"""Local-first retrieval and explicitly approved, bounded cloud context."""
import json
import io
from report_export import xlsx, docx
from workspace_intelligence import WorkspaceIntelligence
from tool_engine import ToolEngine, catalog, command, report_text
from advanced_tools import AdvancedTools, parse_command, anomaly_text, bundle_text, compare_text
from agent_engine import Agent, parse as agent_parse
from work_import import Importer
from web_research import WebResearch
from knowledge_store import Knowledge
from cognitive_tools import CognitiveTools
from chat_intelligence import intent as chat_intent, normalize_request, bounded_context, web_evidence, possible_conflicts, verify_reply
from evidence import rank as sparse_rank, evidence_links, missing_terms
import ast
from decimal import Decimal, localcontext, DecimalException
import re
import sqlite3
import threading
import time
from collections import OrderedDict
from contextlib import closing
from datetime import date, datetime, timezone
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
        self.knowledge=Knowledge(chat,cloud)
        self.cognitive=CognitiveTools(workspace,self.knowledge,self.agent,extract)
        self.workspace_intelligence=WorkspaceIntelligence(self)
        self.lock=threading.RLock()
        self.plans=OrderedDict();self.inflight=set();self.web_inflight=set();self.next_index=0;self.agent.index_refresh=self.background_index
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

    def refresh_index(self,db,sources):
        metadata={(source,i) for source,i,*_ in sources}
        versions={(r[0],r[1]):r[2] for r in db.execute("SELECT * FROM routing_workspace_versions")}
        for source,i,title,body,stamp,version,path in sources:
            if versions.get((source,i))==version: continue
            if path is not None: body=extract(path,title)
            db.execute("DELETE FROM routing_workspace_fts WHERE source=? AND item_id=?",(source,i))
            db.execute("INSERT INTO routing_workspace_fts(source,item_id,title,body) VALUES(?,?,?,?)",(source,i,title,body))
            db.execute("INSERT OR REPLACE INTO routing_workspace_versions VALUES(?,?,?)",(source,i,version))
        for source,i in versions.keys()-metadata:
            db.execute("DELETE FROM routing_workspace_fts WHERE source=? AND item_id=?",(source,i))
            db.execute("DELETE FROM routing_workspace_versions WHERE source=? AND item_id=?",(source,i))

    def background_index(self):
        if not self.fts or time.monotonic()<self.next_index:return
        self.next_index=time.monotonic()+120
        with closing(self.chat.connect()) as db,db:
            db.execute("BEGIN IMMEDIATE")
            self.refresh_index(db,self.sources(db))

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
                self.refresh_index(db,sources)
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
                if r["role"]=="assistant" and r["text"].startswith(("Сообщение сохранено","Локальный поиск","Найдено в локальной памяти","Недостаточно данных","Локальный подсчёт","Локальный отчёт SQLite","Комплексный локальный отчёт","Локальная проверка аномалий","Сравнение извлечённого текста","Изменение сохранено локально","Изменение уже сохранено","Изменение не выполнено","Локальный сценарий:","Локальная статистика:","Диагностика инструментов:")): continue
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

    def repair_index(self,value):
        if value!={"confirm":True} or value.get("confirm") is not True:raise ValueError("Подтвердите восстановление поискового индекса")
        if not self.fts:raise ValueError("FTS5 недоступен")
        with closing(self.chat.connect()) as db,db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("INSERT INTO routing_chat_fts(routing_chat_fts) VALUES('rebuild')")
            db.execute("DELETE FROM routing_workspace_fts")
            db.execute("DELETE FROM routing_workspace_versions")
            self.refresh_index(db,self.sources(db))
        return {"ok":True,"note":"Восстановлены только производные индексы; исходные записи сохранены."}

    def search_tool(self,value):
        if not isinstance(value,dict) or set(value)!={"text","scope"} or value["scope"] not in ("all","memory","work","file"):
            raise ValueError("Некорректная область поиска")
        q=value["text"]
        if not isinstance(q,str) or not q.strip() or len(q)>1000: raise ValueError("Некорректный поиск")
        return {"hits":self.search(q, value["scope"]),"fts":self.fts}

    def preview(self,value):
        req=validate(value);q=normalize_request(req["text"])
        with closing(self.chat.connect()) as db:
            previous=db.execute("SELECT text FROM chat_messages WHERE role='user' AND request_id!=? ORDER BY id DESC LIMIT 1",(req["request_id"],)).fetchone()
        attachment_ids=list(dict.fromkeys(int(x) for x in re.findall(r"(?m)^\[Документ #(\d{1,12})\]$",q)))
        steps=agent_parse(q,previous[0] if previous else None) if not attachment_ids and not parse_command(q) else None
        return {"steps":self.agent.validate(steps) if steps else [],"note":"Предварительный план только чтения; данные будут рассчитаны после запуска."}

    def export_result(self,v):
        if not isinstance(v,dict) or set(v)!={"message","format","confirm"} or v["confirm"] is not True or type(v["message"]) is not int or v["format"] not in ("xlsx","docx"):raise ValueError("Подтвердите экспорт")
        with closing(self.chat.connect()) as db:
            row=db.execute("SELECT m.id,m.created_at,r.payload FROM chat_messages m JOIN chat_result_meta r USING(request_id) WHERE m.id=? AND m.role='assistant'",(v["message"],)).fetchone()
        if not row:raise ValueError("Сохранённая таблица отсутствует")
        meta=json.loads(row["payload"]);table=meta.get("table")
        if not table:raise ValueError("В ответе нет структурированной таблицы")
        report={"title":"Результат ответа #"+str(row["id"]),"month":"","summary":["Снимок сохранённого результата, не пересчёт"],"columns":table["columns"],"rows":table["rows"],"total_rows":table["total_rows"],"generated":row["created_at"]}
        data=(xlsx if v["format"]=="xlsx" else docx)(report)
        name="chat-"+str(row["id"])+"-"+uuid4().hex[:8]+"."+v["format"]
        return {**self.workspace.upload(None,name,io.BytesIO(data),len(data)),"name":name}

    def plan(self,value,progress=None,approved_steps=None):
        value=validate(value)
        original=value["text"]
        q=normalize_request(original)
        hints=chat_intent(q)
        meta={"style":hints["style"],"tools":[],"warnings":[]}
        attachment_ids=list(dict.fromkeys(int(x) for x in re.findall(r"(?m)^\[Документ #(\d{1,12})\]$",q)))
        if len(attachment_ids)>3:raise ValueError("До трёх вложений")
        question=re.sub(r"(?m)^\[Документ #\d{1,12}\]$","",q).strip()
        task=parse_command(q) if not attachment_ids else None
        if task and task[0]=="edit" and q!=original:task=None # never infer a mutation from indirect phrasing
        advanced_answer=None;advanced_sources=[];mutation=None
        with closing(self.chat.connect()) as db:
            previous=db.execute("SELECT text FROM chat_messages WHERE role='user' AND request_id!=? ORDER BY id DESC LIMIT 1",(value["request_id"],)).fetchone()
        agent_steps=agent_parse(q,previous[0] if previous else None) if not task and not attachment_ids else None
        if approved_steps is not None and (agent_steps or [])!=approved_steps:raise ValueError("План изменился; запросите предварительный просмотр заново")
        receipt=self.workspace.edit_receipt(value["request_id"],original)
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
        # Explicit deterministic analytical commands, before generic retrieval.
        if advanced_answer is None and not attachment_ids and re.fullmatch(r"(?:сравни|сопоставь)\s+(?:файлы|документы)[?.]?",q,re.I):
            advanced_answer="Прикрепите два или три документа для сравнения.";meta["tools"].append("clarification")
        if advanced_answer is None and attachment_ids and re.match(r"^(?:сравни|сопоставь)\b",question,re.I):
            if len(attachment_ids)<2:
                advanced_answer="Для сравнения прикрепите минимум два документа."
            else:
                parts=[]
                for a,b in zip(attachment_ids,attachment_ids[1:]):
                    try:
                        _,name_a,_=self.workspace.download(a);_,name_b,_=self.workspace.download(b)
                        if Path(name_a).suffix.lower() in (".csv",".xlsx") and Path(name_b).suffix.lower() in (".csv",".xlsx"):
                            key_match=re.search(r"(?:ключ|по столбцу)\s*[:=]\s*([^\n]{1,100})",question,re.I)
                            if not key_match:parts.append(f"#{a} / #{b}: укажите «ключ: название столбца».")
                            else:
                                result=self.cognitive.dispatch({"action":"compare","a":a,"b":b,"key":key_match[1].strip()})
                                parts.append(f"#{a} / #{b}: "+json.dumps(result,ensure_ascii=False)[:4000])
                        else:parts.append(compare_text(self.advanced.compare(a,b)))
                    except ValueError as e:parts.append(f"#{a} / #{b}: {e}")
                advanced_answer="Сравнение вложений:\n"+"\n\n".join(parts)[:12000]
                meta["tools"].append("compare")
        elif advanced_answer is None and attachment_ids and re.match(r"^(?:проанализируй|изучи|прочитай)\b",question,re.I):
            parts=[]
            for i in attachment_ids:
                try:
                    out=self.cognitive.dispatch({"action":"document","file":i})
                    parts.append(f"#{i} {out['title']}: {out['words']} слов, {out['lines']} строк. Кандидаты фактов: "+ "; ".join(x["subject"]+": "+x["value"] for x in out["candidate_facts"][:10]))
                except ValueError as e:parts.append(f"#{i}: {e}")
            # Structure is evidence, not a substitute for semantic analysis.
            meta["tools"].append("document")
            meta["document_summary"]="\n".join(parts)[:3000]
        if advanced_answer is None and not attachment_ids:
            garage_match=re.fullmatch(r"(?:обзор|сводка)\s+гаража(?:\s+за\s+(\d{4}-\d{2}))?[?.]?",q,re.I)
            if garage_match:
                data=self.workspace_intelligence.garage(garage_match[1] or date.today().strftime("%Y-%m"))
                advanced_answer=f"Обзор гаража за {data['month']}: {data['liters']} л, {data['cost']} ₽, {data['hours']} ч. Замечаний: {data['anomalies']['total']}.\n"+data["note"]
                meta["tools"].append("garage")
                meta["table"]={"columns":["Автомобиль","Литры","Рубли","л/100 км (оценка)"],"rows":[[v["name"],v["liters"],v["cost"],v["liters_per_100km"] or "нет пробега"] for v in data["vehicles"][:30]],"total_rows":len(data["vehicles"])}
                advanced_sources=[{"source":"work","id":v["id"],"title":v["name"]} for v in data["vehicles"][:8]]
            calc=re.fullmatch(r"(?:посчитай|вычисли|сколько будет)\s+(.+)",q,re.I)
            if calc and re.fullmatch(r"[0-9.,+*/() ×÷−-]+[?]?",calc[1]):
                expression=calc[1].rstrip("?")
                out=calculate({"expression":expression})
                advanced_answer="Локальный расчёт: "+expression+" = "+out["result"]
                meta["tools"].append("calculator")
            numeric=re.fullmatch(r"(?:статистика|анализ чисел)\s*:\s*([-+0-9.,;\s]+)",q,re.I)
            if numeric:
                try:values=[float(x.replace(",",".")) for x in re.split(r"[;\s]+",numeric[1].strip())]
                except ValueError:raise ValueError("Разделяйте числа пробелом или точкой с запятой")
                out=self.cognitive.dispatch({"action":"stats","values":values})
                meta["tools"].append("stats");meta["series"]=out["values"]
                advanced_answer="Локальная статистика:\n"+"\n".join(f"{k}: {out[k]:.6g}" for k in ("count","sum","mean","median","min","max","stdev","slope_per_observation","next_linear_estimate"))+"\n"+out["note"]
            elif re.fullmatch(r"диагностика инструментов[?.]?",q,re.I):
                out=self.cognitive.dispatch({"action":"performance"})
                advanced_answer="Диагностика инструментов:\n"+"\n".join(f"{r['tool']} · {r['status']} · {r['n']} запусков · {r['avg_ms']:.1f} мс" for r in out["metrics"][:50])+"\n"+out["note"]
        if agent_steps and advanced_answer is None:
            run=self.agent.run(agent_steps,progress=progress)
            if not run['ok']:meta['warnings'].append('Не все шаги выполнены; результат неполный.')
            meta["tools"].extend(s["tool"] for s in run["steps"]);meta["steps"]=[{"tool":s["tool"],"status":s["status"]} for s in run["steps"]]
            if run["ok"]:meta["verified_steps"]=agent_steps
            advanced_answer="Локальный сценарий:\n"+"\n\n".join(s["text"] for s in run["steps"])+"\n"+run["snapshot"]
            advanced_sources=[h for s in run["steps"] for h in s["sources"]]
        tool=command(q) if advanced_answer is None and not attachment_ids else None
        report=self.tools.run(tool) if tool else None
        hits=self.search(question) if report is None and advanced_answer is None else []
        if report is None and advanced_answer is None and not attachment_ids and not hits:
            # Only lexical fallback; no cloud, no external side effects.
            shorter=" ".join(tokens(question)[:4])
            if shorter and shorter!=question:
                hits=self.search(shorter)
                meta["search_passes"]=2
        meta.setdefault("search_passes",1 if report is None and advanced_answer is None else 0)
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
            meta["tools"].append(report["tool"])
            meta["table"]={"columns":report["columns"],"rows":[[str(x)[:200] for x in row] for row in report["rows"][:30]],"total_rows":report["total_rows"]}
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
        conflicts=[];conflict_pairs=[]
        for i,a in enumerate(hits):
            for b in hits[i+1:]:
                if a["source"]==b["source"]=="work" and a["title"]==b["title"] and a["coverage"]==b["coverage"]==1 and a["text"]!=b["text"]:
                    conflicts.append("Несколько разных рабочих записей: "+a["title"]);conflict_pairs.append([f"work #{a['id']}",f"work #{b['id']}"]);break
        conflicts=list(dict.fromkeys(conflicts))[:3]
        sufficient=count_answer is not None or (lookup and bool(hits) and hits[0]["coverage"]>=.75 and not conflicts)
        links=evidence_links(hits) if count_answer is None else []
        missing=missing_terms(tokens(question),hits) if count_answer is None else []
        context_parts=[]
        if meta.get("document_summary"):context_parts.append("[Структурный анализ вложений; кандидаты, не факты] "+meta["document_summary"])
        if hints["style"]!="normal":context_parts.append("[Пожелание пользователя] "+("Краткий ответ." if hints["style"]=="short" else "Подробный ответ с проверяемыми основаниями."))
        for h in hits:
            part=f"[{h['source']} #{h['id']}; {h['title']}; дата {h['updated'][:10]}] {h['text']}"
            if len("\n".join(context_parts+[part]))>CONTEXT_LIMIT: break
            context_parts.append(part)
        if not sufficient and not mutation:
            # Reserve space for verified user knowledge and recent context.
            context_parts=[bounded_context(context_parts,3500)] if context_parts else []
            followup=bool(re.fullmatch(r"(?:а\s+)?(?:почему|подробнее|продолжи|а дальше|что дальше|как именно)[?.!\s]*",question,re.I))
            knowledge_query=(previous[0][:380]+" "+question)[:500] if followup and previous else question
            for part in self.knowledge.context(knowledge_query):
                if len("\n".join(context_parts+[part]))<=CONTEXT_LIMIT:context_parts.append(part)
            with closing(self.chat.connect()) as db:
                recent=db.execute("SELECT id,role,text FROM chat_messages WHERE request_id!=? ORDER BY id DESC LIMIT ?",(value["request_id"],12 if hints["style"]=="deep" else 6)).fetchall()[::-1]
            for r in recent:
                part="[Недавний диалог #"+str(r["id"])+"; "+r["role"]+"] "+r["text"][:300]
                if len("\n".join(context_parts+[part]))<=CONTEXT_LIMIT:context_parts.append(part)
        context=bounded_context(context_parts,CONTEXT_LIMIT)
        lines=[f"[{h['source']} #{h['id']}] {h['title']} ({h['updated'][:10]}): {h['text']}" for h in hits]
        local=("Найдено в локальной памяти (цитаты, не проверенные факты):\n"+"\n\n".join(lines)) if hits else "Недостаточно данных в локальной памяти. Запрос сохраню; для рассуждения можно явно разрешить Cloud.ru."
        if hits and not sufficient: local="Локальный поиск: найденные сведения могут быть неполными или устаревшими.\n"+"\n\n".join(lines)
        if any(h["age_days"]>365 for h in hits): local+="\nНекоторые источники старше года; актуальность не подтверждена."
        if conflicts: local+="\nВозможные расхождения: "+"; ".join(conflicts)
        if count_answer is not None: local=count_answer;conflicts=[]
        else:
            if missing:local+="\nБез точного подтверждения в найденных выдержках: "+", ".join(missing)+"."
            if links:local+="\nПересечения источников (общие слова, не причинность): "+"; ".join(x["from"]+" ↔ "+x["to"]+": "+", ".join(x["terms"]) for x in links[:4])
        if meta.get("document_summary") and count_answer is None:local=meta["document_summary"]+"\n\n"+local
        meta["sources"]=[{"source":h["source"],"id":h["id"],"title":h["title"]} for h in hits[:8]]
        meta["links"]=links[:8];meta["missing"]=missing;meta["conflicts"]=conflicts;meta["conflict_pairs"]=conflict_pairs[:3] if conflicts else []
        meta["evidence_status"]="local_result" if count_answer is not None else "retrieval_only" if hits else "insufficient"
        meta["source_groups"]={kind:sum(h["source"]==kind for h in hits) for kind in ("memory","work","file")}
        if missing:meta["warnings"].append("Неподтверждённые термины: "+", ".join(missing))
        if conflicts:meta["warnings"].extend(conflicts)
        plan={"web_offer":hints["web"] if not mutation and not attachment_ids else None,"metadata":meta,"token":uuid4().hex,"hits":hits,"intent":"edit" if mutation else "workflow" if advanced_answer is not None else "tool" if report is not None else "count" if count_answer is not None else "lookup" if lookup else "reasoning","sufficient":sufficient,"conflicts":conflicts,"context":context,"local":local,"fts":self.fts,"mutation":mutation,"missing":missing,"links":links}
        with self.lock:
            now=time.monotonic()
            for k in list(self.plans):
                if now-self.plans[k][0]>PLAN_TTL and k not in self.web_inflight: del self.plans[k]
            while len(self.plans)>=64:
                victim=next((k for k in self.plans if k not in self.web_inflight),None)
                if victim is None:raise RuntimeError("Слишком много активных планов")
                del self.plans[victim]
            self.plans[plan["token"]]=(now,value,plan)
        return plan

    def correction(self,value):
        if not isinstance(value,dict) or set(value)!={"message","text","confirm"} or value["confirm"] is not True or type(value["message"]) is not int or not isinstance(value["text"],str) or not 1<=len(value["text"].strip())<=1000:raise ValueError("Введите исправление")
        with closing(self.chat.connect()) as db,db:
            db.execute("BEGIN IMMEDIATE")
            row=db.execute("SELECT id,text FROM chat_messages WHERE id=? AND role='assistant'",(value["message"],)).fetchone()
            if not row:raise ValueError("Ответ не найден")
            i=self.knowledge.put(db,"context","Исправление ответа #"+str(row["id"]),"уточнение пользователя",value["text"].strip(),row["text"][:500],"assistant_correction",row["id"])
        return {"id":i,"state":"candidate"}

    def authorize_web(self,value):
        if not isinstance(value,dict) or set(value)!={"token","query","action","confirm"} or value["confirm"] is not True:raise ValueError("Нужно подтверждение интернета")
        if not isinstance(value["token"],str):raise ValueError("Некорректный план")
        with self.lock:
            item=self.plans.get(value["token"])
            if not item or time.monotonic()-item[0]>PLAN_TTL:raise ValueError("План устарел")
            plan=item[2];offer=plan.get("web_offer")
            if not offer or value["query"]!=offer["query"] or value["action"]!=offer["action"]:raise ValueError("Запрос изменился")
            plan["web_offer"]=None # one attempt; no automatic external retry
            self.web_inflight.add(value["token"])
        try:
            data=self.web.dispatch({"action":offer["action"],"query":offer["query"],"confirm":True})
        except BaseException:
            with self.lock:self.web_inflight.discard(value["token"])
            raise
        with self.lock:
            self.web_inflight.discard(value["token"])
            sources=web_evidence(data);meta=plan["metadata"];meta["web_sources"]=sources;meta["tools"].append("web")
            conflicts=possible_conflicts(plan["hits"],sources)
            plan["conflicts"]=(plan["conflicts"]+conflicts)[:6]
            meta["conflicts"]=plan["conflicts"];meta["warnings"].extend(conflicts)
            for note in conflicts:
                match=re.search(r"(work|file) #(\d+)",note)
                if match:meta.setdefault("conflict_pairs",[]).append([match[0],"web"])
            parts=["[Интернет-источник; непроверенная выдержка; "+p["url"]+"; дата "+(p["date"] or "не указана")+"] "+p["title"]+" "+p["excerpt"] for p in sources]
            plan["context"]=bounded_context([plan["context"][:2300]]+parts,CONTEXT_LIMIT)
            # No hallucinated synthesis offline. Preserve local results and show excerpts.
            plan["local"]+="\n\nИнтернет-результаты (не проверенные утверждения):\n"+"\n\n".join(parts)
            if not sources:plan["local"]+="\nНет доступных выдержек."
            if conflicts:plan["local"]+="\n"+"\n".join(conflicts)
            meta["evidence_status"]="external_excerpts" if sources else "insufficient"
            plan["sufficient"]=False
            # Allow time for the subsequent independent cloud consent.
            self.plans[value["token"]]=(time.monotonic(),item[1],plan)
            return plan

    def execute(self,value,emit=None):
        if not isinstance(value,dict) or set(value) not in ({"token","request_id","text","cloud"},{"token","request_id","text","cloud","approve_edit"}) or type(value["cloud"]) is not bool or type(value.get("approve_edit",False)) is not bool:
            raise ValueError("Некорректное подтверждение")
        req=validate({"text":value["text"],"request_id":value["request_id"]})
        existing=self.chat.existing_request(req)
        if existing:return existing
        with self.lock:
            if req["request_id"] in self.inflight:raise RuntimeError("Запрос уже выполняется")
            if len(self.inflight)>=4:raise RuntimeError("Слишком много активных запросов")
            if not isinstance(value["token"],str):raise ValueError("Некорректный план")
            if value["token"] in self.web_inflight:raise RuntimeError("Интернет-запрос ещё выполняется")
            item=self.plans.get(value["token"])
            if not item or time.monotonic()-item[0]>PLAN_TTL or item[1]!=req:
                raise ValueError("План поиска устарел; повторите поиск")
            if not self.chat.startup_health["ok"]:raise RuntimeError("Memory integrity failure")
            plan=item[2];mutation=plan.get("mutation")
            if value.get("approve_edit") and not mutation:raise ValueError("Нет изменения для подтверждения")
            paid=value["cloud"] and not plan["sufficient"]
            # Reserve request and consume the exact plan before any external I/O.
            self.inflight.add(req["request_id"]);del self.plans[value["token"]]
        try:
            existing=self.chat.existing_request(req)
            if existing:return existing
            if paid:
                with self.cloud.send_lock:
                    existing=self.chat.existing_request(req)
                    if existing:return existing
                    reply=self.cloud.complete_stream(req["text"],plan["context"],emit) if emit is not None else self.cloud.complete(req["text"],plan["context"])
                    meta=plan["metadata"];meta["warnings"]+=verify_reply(reply,meta)
                    result=self.chat.memory_append(req,reply,meta)
            else:
                answer=plan["local"]
                if mutation and value.get("approve_edit"):
                    self.advanced.apply(mutation,req["request_id"],req["text"])
                    answer="Изменение сохранено локально: запись #"+str(mutation["id"])+" · "+mutation["label"]+": "+str(mutation["before"])+" → "+str(mutation["after"])
                meta=plan["metadata"];meta["warnings"]+=verify_reply(answer,meta)
                result=self.chat.memory_append(req,answer,meta)
            return {**result,"route":"cloud" if paid else "local"}
        finally:
            with self.lock:self.inflight.discard(req["request_id"])


def calculate(value):
    if not isinstance(value,dict) or set(value) not in ({"expression"},{"expression","variables"}):
        raise ValueError("Некорректное выражение")
    expr=value["expression"]
    if not isinstance(expr,str) or not expr.strip() or len(expr)>160:
        raise ValueError("Введите выражение до 160 символов")
    expr=expr.strip().replace("×","*").replace("÷","/").replace("−","-").replace(",",".")
    variables=value.get("variables",{})
    if not isinstance(variables,dict) or len(variables)>20:raise ValueError("До 20 переменных")
    clean={}
    for key,v in variables.items():
        if not isinstance(key,str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,19}",key) or type(v) not in (str,int,float) or len(str(v))>40:raise ValueError("Некорректная переменная")
        try:n=Decimal(str(v))
        except DecimalException:raise ValueError("Некорректное число") from None
        if not n.is_finite() or abs(n)>Decimal("1e50"):raise ValueError("Число слишком большое")
        clean[key]=n
    if not re.fullmatch(r"[A-Za-z0-9_.+*/() \t-]+",expr):raise ValueError("Только числа, переменные, + − × ÷ и скобки")
    def walk(node):
        if isinstance(node,ast.Constant) and type(node.value) in (int,float) and re.fullmatch(r"[0-9.]+",ast.get_source_segment(expr,node) or ""):
            result=Decimal(ast.get_source_segment(expr,node))
        elif isinstance(node,ast.Name) and node.id in clean:result=clean[node.id]
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
