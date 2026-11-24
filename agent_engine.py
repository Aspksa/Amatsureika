"""Local allowlisted agent workflows. SQLite persistence, no cloud or writes to work records."""
import json
import re
import time
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4
from tool_engine import TOOLS, command

def utc():
    return datetime.now(timezone.utc).isoformat()

def month_shift(month, delta):
    y,m=map(int,month.split("-"));index=y*12+m-1+delta
    return f"{index//12:04d}-{index%12+1:02d}"

def month_ok(value):
    if not isinstance(value,str) or not re.fullmatch(r"\d{4}-\d{2}",value):raise ValueError("Месяц ГГГГ-ММ")
    date.fromisoformat(value+"-01")
    return value

def registry():
    return [{"id":k,"title":v[0],"permission":"read_local","month":v[1]} for k,v in TOOLS.items()]+[
        {"id":"anomalies","title":"Аномалии","permission":"read_local","month":False},
        {"id":"fuel_forecast","title":"Прогноз ГСМ","permission":"read_local","month":True},
        {"id":"card_reconcile","title":"Сверка карт и ГСМ","permission":"read_local","month":True},
        {"id":"fuel_rate","title":"Литры на 100 км","permission":"read_local","month":True},
        {"id":"summary","title":"Сводка результатов","permission":"read_local","month":False},
        {"id":"work_edit","title":"Изменение записи","permission":"confirm_each","month":False},
        {"id":"cloud","title":"Cloud.ru","permission":"confirm_each","month":False},
        {"id":"web","title":"Интернет: поиск и чтение","permission":"confirm_each","month":False},
        {"id":"knowledge","title":"Структурированная память","permission":"confirm_each","month":False},
        {"id":"cognitive","title":"Аналитика и логические проверки","permission":"confirm_each","month":False}]

READ={r["id"]:r for r in registry() if r["permission"]=="read_local"}

def parse(text,previous=None):
    q=text.casefold().strip().replace("ё","е")
    m=re.fullmatch(r"(?:а\s+)?за\s+(?:прошлый месяц|(\d{4}-\d{2}))[?.]?",q)
    if m and previous:
        steps=parse(previous)
        if not steps:
            legacy=command(previous)
            if legacy and READ[legacy["tool"]]["month"]:steps=[{"id":"s1",**legacy,"depends":[]}]
        if steps and all(READ[s["tool"]]["month"] for s in steps):
            for s in steps:s["month"]=month_ok(m[1]) if m[1] else month_shift(s["month"],-1)
            return steps
    # Only explicit report-related requests, never execute arbitrary text.
    if not re.match(r"^(?:сформируй|сделай|подготовь|отчет|отчеты|сводка|прогноз|сверь|сверка|рассчитай|проверь)\b",q):return None
    month=re.findall(r"\b\d{4}-\d{2}\b",q)
    if len(set(month))>1:return None
    month=month_ok(month[0]) if month else date.today().strftime("%Y-%m")
    picks=[]
    for k,pattern in [("fuel_forecast",r"прогноз.*(?:гсм|топлив)"),("card_reconcile",r"свер(?:ь|ка).*карт"),("fuel_rate",r"(?:расход|литр).*100\s*км"),("anomalies",r"аномали"),("timesheet",r"табел"),("vehicles",r"автопарк|автомобил"),("staff",r"сотрудник"),("files",r"документ"),("health",r"памят"),("cards",r"карт"),("fuel",r"гсм|топлив")]:
        if re.search(pattern,q):
            if k=="fuel" and any(x in picks for x in ("fuel_forecast","fuel_rate","card_reconcile")):continue
            if k=="cards" and "card_reconcile" in picks:continue
            picks.append(k)
    # Keep exact legacy single commands on existing paths.
    if not picks or len(picks)==1 and picks[0] in TOOLS and not m:return None
    return [{"id":"s"+str(i+1),"tool":k,"month":month if READ[k]["month"] else "","depends":[]} for i,k in enumerate(picks)]

class Agent:
    def __init__(self,chat,workspace,reports,advanced):
        self.chat,self.workspace,self.reports,self.advanced=chat,workspace,reports,advanced
        self.stop=threading.Event()
        self.worker=None;self.next_rules_check=0;self.index_refresh=None
        with closing(chat.connect()) as db,db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS agent_runs(id TEXT PRIMARY KEY,tool TEXT NOT NULL,status TEXT NOT NULL,duration_ms INTEGER NOT NULL,detail TEXT NOT NULL,created TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS agent_scenarios(id TEXT PRIMARY KEY,name TEXT NOT NULL,steps TEXT NOT NULL,created TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS agent_jobs(id TEXT PRIMARY KEY,steps TEXT NOT NULL,status TEXT NOT NULL,due TEXT NOT NULL,result TEXT NOT NULL DEFAULT '',created TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS agent_job_due ON agent_jobs(status,due);
                CREATE TABLE IF NOT EXISTS agent_rules(
                    id TEXT PRIMARY KEY, scenario TEXT NOT NULL REFERENCES agent_scenarios(id),
                    steps TEXT NOT NULL, mode TEXT NOT NULL, interval_seconds INTEGER NOT NULL,
                    file_id INTEGER, file_version TEXT NOT NULL, next_check REAL NOT NULL,
                    enabled INTEGER NOT NULL, current_month INTEGER NOT NULL, draft INTEGER NOT NULL,
                    status TEXT NOT NULL, last_job TEXT NOT NULL DEFAULT '');
                CREATE INDEX IF NOT EXISTS agent_rules_due ON agent_rules(enabled,next_check);
                CREATE TABLE IF NOT EXISTS agent_rule_jobs(job_id TEXT PRIMARY KEY REFERENCES agent_jobs(id) ON DELETE CASCADE,rule_id TEXT NOT NULL REFERENCES agent_rules(id),draft INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS agent_mileage(vehicle INTEGER NOT NULL,month TEXT NOT NULL,km REAL NOT NULL,PRIMARY KEY(vehicle,month));
            """)

    def validate(self,steps):
        if not isinstance(steps,list) or not 1<=len(steps)<=12:raise ValueError("От 1 до 12 шагов")
        seen=set();clean=[]
        for s in steps:
            if not isinstance(s,dict) or set(s) not in ({"id","tool","month","depends"},{"id","tool","month","depends","condition"}):raise ValueError("Некорректный шаг")
            i,k,m,d=s["id"],s["tool"],s["month"],s["depends"]
            if not isinstance(i,str) or not re.fullmatch(r"[a-z0-9_]{1,24}",i) or i in seen or not isinstance(k,str) or k not in READ:raise ValueError("Инструмент не разрешён")
            if not isinstance(d,list) or any(not isinstance(x,str) or x not in seen for x in d) or len(set(d))!=len(d):raise ValueError("Зависимости только от предыдущих шагов")
            if k=="summary" and not d:raise ValueError("Сводке нужны источники")
            condition=s.get("condition","all_ok")
            if condition not in ("all_ok","any_error","always") or condition!="all_ok" and not d:raise ValueError("Некорректное условие")
            if k=="summary" and condition!="all_ok":raise ValueError("Сводка требует успешных источников")
            if READ[k]["month"]:month_ok(m)
            elif m!="":raise ValueError("Месяц не применяется")
            seen.add(i);clean.append(dict(s))
        return clean

    def preview(self,steps):
        steps=self.validate(steps);depth={}
        for s in steps:depth[s["id"]]=1+max((depth[i] for i in s["depends"]),default=-1)
        return {"steps":steps,"layers":[[s["id"] for s in steps if depth[s["id"]]==i] for i in range(max(depth.values())+1)],"permission":"read_local","note":"Структурная проверка без запуска; результаты и длительность неизвестны."}

    def log(self,tool,status,begin,detail):
        with closing(self.chat.connect()) as db,db:
            db.execute("INSERT INTO agent_runs VALUES(?,?,?,?,?,?)",(uuid4().hex,tool,status,int((time.monotonic()-begin)*1000),detail[:300],utc()))
            db.execute("DELETE FROM agent_runs WHERE id IN (SELECT id FROM agent_runs ORDER BY created DESC,id DESC LIMIT -1 OFFSET 2000)")

    def records(self):
        return self.workspace.work()["records"]

    def metric(self,kind,month):
        rows=self.records();byid={r["id"]:r for r in rows}
        active=[r for r in rows if not r["archived"]]
        fuel=[r for r in active if r["kind"]=="fuel" and r["fields"]["date"][:7]==month]
        sources=[{"source":"work","id":r["id"],"title":"ГСМ"} for r in fuel[:8]]
        if kind=="card_reconcile":
            issues=[]
            for r in fuel:
                f=r["fields"];card=byid.get(f["card"])
                if f["card"] is None:issues.append(f"#{r['id']}: карта не указана")
                elif not card or card["archived"] or card["kind"]!="cards":issues.append(f"#{r['id']}: карта недоступна")
                elif card["fields"]["vehicle"] not in (None,f["vehicle"]):issues.append(f"#{r['id']}: карта другого автомобиля")
            text=f"Операций за {month}: {len(fuel)}. Замечаний: {len(issues)}.\n"+"\n".join(issues[:30])+"\nСверка только внутреннего реестра, не банковской выписки."
        elif kind=="fuel_rate":
            with closing(self.chat.connect()) as db:
                km={r["vehicle"]:Decimal(str(r["km"])) for r in db.execute("SELECT * FROM agent_mileage WHERE month=?",(month,))}
            totals={}
            for r in fuel:
                f=r["fields"];totals[f["vehicle"]]=totals.get(f["vehicle"],Decimal(0))+Decimal(str(f["liters"]))
            lines=[];missing=0;rate_rows=[]
            for v,l in totals.items():
                plate=byid.get(v,{}).get("fields",{}).get("plate","#"+str(v))
                rate=round(l*100/km[v],2) if km.get(v,0)>0 else None
                if rate is None:missing+=1
                rate_rows.append([plate,str(l),str(km.get(v,0)),str(rate) if rate is not None else "нет пробега"])
                lines.append(f"{plate}: {l} л; "+(f"{rate} л/100 км" if rate is not None else "нет пробега"))
            text=f"Оценка по заправкам за {month} (не фактическое сгорание):\n"+"\n".join(lines[:50])
        else:
            months=[month_shift(month,-i) for i in (3,2,1)]
            sums={m:Decimal(0) for m in months};counts={m:0 for m in months}
            for r in active:
                if r["kind"]=="fuel":
                    f=r["fields"];m=f["date"][:7]
                    if m in sums:sums[m]+=Decimal(str(f["cost"]));counts[m]+=1
            sources=[{"source":"work","id":r["id"],"title":"ГСМ"} for r in active if r["kind"]=="fuel" and r["fields"]["date"][:7] in months][:8]
            if not all(counts.values()):text="Недостаточно истории: нужны операции во всех трёх предыдущих месяцах."
            else:text="Прогноз расходов на "+month+": "+str(round(sum(sums.values())/3,2))+" ₽. Простое среднее трёх месяцев, без оценки сезонности.\n"+"\n".join(f"{m}: {sums[m]} ₽" for m in months)
        return {"text":text,"sources":sources,**({"table":{"columns":["Автомобиль","Заправлено, л","Пробег, км","Оценка л/100 км"],"rows":rate_rows[:50],"total_rows":len(rate_rows)},"incomplete":bool(missing or not rate_rows)} if kind=="fuel_rate" else {})}

    def one(self,s,results):
        k=s["tool"];begin=time.monotonic()
        try:
            if k in TOOLS:
                r=self.reports.run({"tool":k,"month":s["month"]})
                if len(r["rows"])>r["total_rows"] or any(len(row)!=len(r["columns"]) for row in r["rows"]):raise RuntimeError("Некорректная структура отчёта")
                answer={"text":r["title"]+": "+"; ".join(r["summary"]),"sources":r["sources"]}
            elif k=="anomalies":
                r=self.advanced.anomalies();answer={"text":f"Проверено {r['checked']}; замечаний {r['total']}.\n"+"\n".join(x["text"] for x in r["issues"][:15]),"sources":[{"source":"work","id":i,"title":"Замечание"} for a in r["issues"] for i in a["ids"]][:8]}
            elif k=="summary":
                answer={"text":"\n".join(results[i]["text"] for i in s["depends"])[:8000],"sources":[h for i in s["depends"] for h in results[i]["sources"]][:8]}
            else:answer=self.metric(k,s["month"])
            self.log(k,"ok",begin,"Проверена структура")
            return {**answer,"status":"partial" if answer.get("incomplete") else "ok","duration_ms":int((time.monotonic()-begin)*1000)}
        except (ValueError,RuntimeError,OSError,sqlite3.Error) as e:
            self.log(k,"error",begin,type(e).__name__)
            # Only equivalent safe read-only fallback for inventory. Never retry
            # a paid request, mutation or pretend a count is a full report.
            if k in ("staff","vehicles","cards","files"):
                try:
                    snapshot=self.workspace.map_summary()
                    n=len(snapshot["files"]) if k=="files" else snapshot["work"].get(k,0)
                    self.log(k,"fallback",begin,"Только количество")
                    return {"text":"Основной отчёт недоступен. Резервный инструмент: активных записей "+str(n)+". Детализация отсутствует.","sources":[],"status":"partial"}
                except (ValueError,RuntimeError,OSError,sqlite3.Error):pass
            return {"text":"Ошибка инструмента: "+str(e),"sources":[],"status":"error"}

    def run(self,steps,progress=None):
        steps=self.validate(steps);results={};pending=list(steps)
        with ThreadPoolExecutor(max_workers=3) as pool:
            while pending:
                batch=[s for s in pending if all(i in results for i in s["depends"])]
                futures={}
                for s in batch:
                    condition=s.get("condition","all_ok")
                    deps=[results[i]["status"] for i in s["depends"]]
                    allowed=condition=="always" or condition=="any_error" and any(x in ("error","partial") for x in deps) or condition=="all_ok" and all(x=="ok" for x in deps)
                    if not allowed:
                        results[s["id"]]={"text":"Пропущено: условие не выполнено","status":"skipped","sources":[],"expected_skip":condition=="any_error" and all(x=="ok" for x in deps)}
                    else:
                        if progress:progress({"id":s["id"],"tool":s["tool"],"status":"scheduled"})
                        futures[pool.submit(self.one,s,{i:results[i] for i in s["depends"]})]=s
                for f in as_completed(futures):
                    s=futures[f];i=s["id"];results[i]=f.result()
                    if progress:progress({"id":i,"tool":s["tool"],"status":results[i]["status"]})
                if progress:
                    for s in batch:
                        if results[s["id"]]["status"]=="skipped":progress({"id":s["id"],"tool":s["tool"],"status":"skipped"})
                pending=[s for s in pending if s not in batch]
        return {"steps":[{"id":s["id"],"tool":s["tool"],"depends":s["depends"],**results[s["id"]]} for s in steps],"ok":all(v["status"]=="ok" or v.get("expected_skip") for v in results.values()),"completeness":{status:sum(v["status"]==status for v in results.values()) for status in ("ok","partial","error","skipped")},"snapshot":"Отдельные снимки SQLite; не единая транзакция"}

    def save_scenario(self,v):
        if not isinstance(v,dict) or set(v)!={"name","steps"} or not isinstance(v["name"],str) or not 1<=len(v["name"].strip())<=80:raise ValueError("Название сценария")
        steps=self.validate(v["steps"]);i=uuid4().hex
        with closing(self.chat.connect()) as db,db:
            if db.execute("SELECT COUNT(*) FROM agent_scenarios").fetchone()[0]>=100:raise ValueError("Лимит 100 сценариев")
            db.execute("INSERT INTO agent_scenarios VALUES(?,?,?,?)",(i,v["name"].strip(),json.dumps(steps),utc()))
        return {"id":i}

    def scenario(self,i):
        with closing(self.chat.connect()) as db:
            r=db.execute("SELECT steps FROM agent_scenarios WHERE id=?",(i,)).fetchone()
            if not r:raise ValueError("Сценарий не найден")
            return json.loads(r[0])

    def enqueue(self,v):
        if not isinstance(v,dict) or set(v)!={"scenario","due"} or not isinstance(v["scenario"],str) or not isinstance(v["due"],str):raise ValueError("Некорректная задача")
        steps=self.scenario(v["scenario"]);due=datetime.fromisoformat(v["due"])
        if due.tzinfo is None:raise ValueError("Нужен часовой пояс")
        due=due.astimezone(timezone.utc)
        if due>datetime.now(timezone.utc)+timedelta(days=366):raise ValueError("Лимит один год")
        i=uuid4().hex
        with closing(self.chat.connect()) as db,db:
            if db.execute("SELECT COUNT(*) FROM agent_jobs WHERE status IN ('queued','running')").fetchone()[0]>=50:raise ValueError("Лимит 50 задач")
            db.execute("INSERT INTO agent_jobs(id,steps,status,due,created) VALUES(?,?,'queued',?,?)",(i,json.dumps(steps),due.isoformat(),utc()))
        return {"id":i}

    def file_version(self,i):
        # Watch only an explicitly selected live file, never an entire directory.
        try:
            path,name,size=self.workspace.download(i)
            stat=path.stat()
            return json.dumps([name,size,stat.st_mtime_ns])
        except (ValueError,OSError):return ""
    def rules(self):
        with closing(self.chat.connect()) as db:
            return [dict(r) for r in db.execute("SELECT id,scenario,mode,interval_seconds,file_id,next_check,enabled,current_month,draft,status,last_job FROM agent_rules ORDER BY next_check")]
    def rule_action(self,v):
        if not isinstance(v,dict):raise ValueError("Некорректное правило")
        action=v.get("action")
        if action=="list" and set(v)=={"action"}:return {"rules":self.rules()}
        if v.get("confirm") is not True:raise ValueError("Нужно разрешение на автоматизацию")
        if action=="disable" and set(v)=={"action","id","confirm"}:
            if not isinstance(v["id"],str):raise ValueError("ID правила")
            with closing(self.chat.connect()) as db,db:
                db.execute("UPDATE agent_rules SET enabled=0,status='disabled' WHERE id=?",(v["id"],))
                db.execute("UPDATE agent_jobs SET status='cancelled' WHERE status='queued' AND id IN (SELECT job_id FROM agent_rule_jobs WHERE rule_id=?)",(v["id"],))
            return {"rules":self.rules()}
        if action=="cancel" and set(v)=={"action","id","confirm"}:
            if not isinstance(v["id"],str):raise ValueError("ID задачи")
            with closing(self.chat.connect()) as db,db:
                if db.execute("UPDATE agent_jobs SET status='cancelled' WHERE id=? AND status='queued'",(v["id"],)).rowcount!=1:raise ValueError("Отменить можно только ожидающую задачу")
            return {"ok":True}
        if action!="add" or set(v)!={"action","scenario","mode","minutes","file","current_month","draft","confirm"}:raise ValueError("Неизвестное действие")
        mode=v["mode"];minutes=v["minutes"];file=v["file"]
        if mode not in ("interval","file","new_files") or type(minutes) is not int or not 60<=minutes<=10080 or type(v["current_month"]) is not bool or type(v["draft"]) is not bool or not isinstance(v["scenario"],str):raise ValueError("Интервал 60–10080 минут")
        steps=self.validate(self.scenario(v["scenario"]))
        version=""
        if mode=="file":
            if type(file) is not int or file<1:raise ValueError("Выберите файл")
            version=self.file_version(file)
            if not version:raise ValueError("Файл недоступен")
        elif file is not None:raise ValueError("Файл нужен только для наблюдения")
        if mode=="new_files":
            with closing(self.chat.connect()) as db:version=str(db.execute("SELECT COALESCE(MAX(id),0) FROM disk_entries").fetchone()[0])
        i=uuid4().hex
        with closing(self.chat.connect()) as db,db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT COUNT(*) FROM agent_rules").fetchone()[0]>=30:raise ValueError("Лимит 30 правил")
            db.execute("INSERT INTO agent_rules(id,scenario,steps,mode,interval_seconds,file_id,file_version,next_check,enabled,current_month,draft,status) VALUES(?,?,?,?,?,?,?,?,1,?,?,?)",(i,v["scenario"],json.dumps(steps),mode,minutes*60,file,version,time.time()+minutes*60,int(v["current_month"]),int(v["draft"]),"waiting"))
        return {"id":i,"rules":self.rules()}
    def tick_rules(self,now=None):
        now=time.time() if now is None else now
        with closing(self.chat.connect()) as db:
            row=db.execute("SELECT * FROM agent_rules WHERE enabled=1 AND next_check<=? ORDER BY next_check LIMIT 1",(now,)).fetchone()
        if not row:return False
        version=self.file_version(row["file_id"]) if row["mode"]=="file" else ""
        with closing(self.chat.connect()) as db,db:
            db.execute("BEGIN IMMEDIATE")
            current=db.execute("SELECT * FROM agent_rules WHERE id=? AND enabled=1 AND next_check=?",(row["id"],row["next_check"])).fetchone()
            if not current:return False
            def status(s,delay=None):
                db.execute("UPDATE agent_rules SET next_check=?,status=? WHERE id=?",(now+(delay or row["interval_seconds"]),s,row["id"]))
            if row["mode"]=="new_files":
                new=db.execute("SELECT COALESCE(MAX(id),0) FROM disk_entries WHERE kind='file' AND trashed=0 AND id>?",(int(row["file_version"] or 0),)).fetchone()[0]
                if not new:status("unchanged");return True
                version=str(new)
            if row["mode"]=="file":
                if not version:status("file_unavailable");return True
                if version==row["file_version"]:status("unchanged");return True
            if db.execute("SELECT 1 FROM agent_rule_jobs l JOIN agent_jobs j ON j.id=l.job_id WHERE l.rule_id=? AND j.status IN ('queued','running')",(row["id"],)).fetchone():
                status("pending",60);return True
            if db.execute("SELECT COUNT(*) FROM agent_jobs WHERE status IN ('queued','running')").fetchone()[0]>=50:
                status("queue_full",60);return True
            steps=json.loads(row["steps"])
            if row["current_month"]:
                for s in steps:
                    if READ[s["tool"]]["month"]:s["month"]=date.today().strftime("%Y-%m")
            steps=self.validate(steps);job=uuid4().hex
            db.execute("INSERT INTO agent_jobs(id,steps,status,due,created) VALUES(?,?,'queued',?,?)",(job,json.dumps(steps),utc(),utc()))
            db.execute("INSERT INTO agent_rule_jobs VALUES(?,?,?)",(job,row["id"],row["draft"]))
            db.execute("UPDATE agent_rules SET file_version=?,last_job=?,next_check=?,status='queued' WHERE id=?",(version,job,now+row["interval_seconds"],row["id"]))
        return True
    def tick(self):
        with closing(self.chat.connect()) as db,db:
            db.execute("BEGIN IMMEDIATE")
            r=db.execute("SELECT id,steps FROM agent_jobs WHERE status='queued' AND due<=? ORDER BY due LIMIT 1",(utc(),)).fetchone()
            if not r:return False
            db.execute("UPDATE agent_jobs SET status='running' WHERE id=?",(r["id"],))
        try:
            result=self.run(json.loads(r["steps"]));status="done" if result["ok"] else "error"
        except Exception as e:
            result={"error":type(e).__name__};status="error"
        with closing(self.chat.connect()) as db,db:
            link=db.execute("SELECT * FROM agent_rule_jobs WHERE job_id=?",(r["id"],)).fetchone()
            if link:
                if link["draft"] and status=="done":result["draft"]="ЧЕРНОВИК · требуется проверка\n"+"\n\n".join(s["text"] for s in result["steps"])[:12000]
                db.execute("UPDATE agent_rules SET status=? WHERE id=? AND enabled=1 AND last_job=?",(status,link["rule_id"],r["id"]))
            db.execute("UPDATE agent_jobs SET status=?,result=? WHERE id=?",(status,json.dumps(result,ensure_ascii=False),r["id"]))
            db.execute("DELETE FROM agent_jobs WHERE status IN ('done','error','cancelled') AND id IN (SELECT id FROM agent_jobs WHERE status IN ('done','error','cancelled') ORDER BY created DESC,id DESC LIMIT -1 OFFSET 300)")
        return True

    def start(self):
        if self.worker:return
        with closing(self.chat.connect()) as db,db:
            db.execute("UPDATE agent_jobs SET status='queued' WHERE status='running'")
        def loop():
            while not self.stop.is_set():
                try:
                    if time.monotonic()>=self.next_rules_check:
                        self.next_rules_check=time.monotonic()+30
                        self.tick_rules()
                        if self.index_refresh:self.index_refresh()
                    self.tick()
                except Exception:pass
                self.stop.wait(2)
        self.worker=threading.Thread(target=loop,daemon=True);self.worker.start()

    def state(self):
        with closing(self.chat.connect()) as db:
            return {"rules":self.rules(),"registry":registry(),"scenarios":[dict(r) for r in db.execute("SELECT id,name,created FROM agent_scenarios ORDER BY created DESC")],"jobs":[{**dict(r),"result":json.loads(r["result"]) if r["result"] else None} for r in db.execute("SELECT id,status,due,result,created FROM agent_jobs ORDER BY CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END,due DESC LIMIT 100")],"runs":[dict(r) for r in db.execute("SELECT tool,status,duration_ms,detail,created FROM agent_runs ORDER BY created DESC LIMIT 100")]}

    def mileage(self,v):
        if not isinstance(v,dict) or set(v)!={"vehicle","month","km"} or type(v["vehicle"]) is not int or type(v["km"]) not in (int,float) or not 0<v["km"]<=1000000:raise ValueError("Некорректный пробег")
        month_ok(v["month"])
        with closing(self.chat.connect()) as db,db:
            db.execute("BEGIN IMMEDIATE")
            if not db.execute("SELECT 1 FROM work_records WHERE id=? AND kind='vehicles' AND archived=0",(v["vehicle"],)).fetchone():raise ValueError("Автомобиль недоступен")
            db.execute("INSERT INTO agent_mileage VALUES(?,?,?) ON CONFLICT(vehicle,month) DO UPDATE SET km=excluded.km",(v["vehicle"],v["month"],v["km"]))
        return {"saved":True}
