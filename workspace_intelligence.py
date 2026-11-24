"""Read-only garage and disk views over existing records. No extra database."""
import hashlib
import json
import re
from collections import defaultdict,Counter
from contextlib import closing
from datetime import date,datetime,timezone
from decimal import Decimal
from pathlib import Path
from tool_engine import fmt
from agent_engine import month_ok

class WorkspaceIntelligence:
    def __init__(self,router):
        self.router=router;self.workspace=router.workspace
    def tree(self):
        with closing(self.workspace.connect()) as db:
            rows=db.execute("""WITH RECURSIVE live(id,parent,name,kind,size,depth) AS (
              SELECT id,parent,name,kind,size,0 FROM disk_entries WHERE parent IS NULL AND trashed=0
              UNION ALL SELECT d.id,d.parent,d.name,d.kind,d.size,l.depth+1 FROM disk_entries d JOIN live l ON d.parent=l.id WHERE d.trashed=0 AND l.depth<100
              ) SELECT * FROM live ORDER BY depth,id LIMIT 1001""").fetchall()
        return {"items":[dict(r) for r in rows[:1000]],"truncated":len(rows)>1000,"note":"До 1000 видимых объектов, глубина до 100."}
    def preview(self,i):
        if type(i) is not int:raise ValueError("ID файла")
        path,title,size=self.workspace.download(i);ext=Path(title).suffix.casefold()
        if ext==".pdf":
            with path.open("rb") as f:
                if not f.read(5)==b"%PDF-":raise ValueError("Не распознан PDF")
            return {"id":i,"title":title,"kind":"pdf","note":"Открытие встроенным PDF-просмотрщиком браузера, если доступен. Текст PDF не извлекается."}
        if ext in (".csv",".xlsx"):
            p=self.router.cognitive.profile(i)
            return {"id":i,"title":title,"kind":"table","columns":[c["column"] for c in p["columns"]],"rows":p["preview"],"total_rows":p["rows"],"note":p["note"]}
        if size>256*1024:raise ValueError("Текстовый предпросмотр до 256 КиБ")
        body=self.router.cognitive.extract(path,title)
        if not body:raise ValueError("Текст не извлечён")
        return {"id":i,"title":title,"kind":"text","text":body[:16000],"truncated":len(body)>16000}
    def duplicates(self):
        # Size grouping avoids hashing unique-size files. Never delete originals.
        files=self.workspace.map_summary()["files"]
        bysize=defaultdict(list)
        for f in files:bysize[f["size"]].append(f)
        groups=defaultdict(list);skipped=[];count=0;used=0
        for size,items in sorted(bysize.items()):
            if len(items)<2:continue
            for f in items:
                if count>=80 or used+size>128*1024*1024:
                    skipped.append(f["id"]);continue
                count+=1;used+=size
                try:
                    path,_,_=self.workspace.download(f["id"]);before=path.stat()
                    sha=hashlib.sha256()
                    with path.open("rb") as stream:
                        while chunk:=stream.read(65536):sha.update(chunk)
                    after=path.stat()
                    if before.st_mtime_ns!=after.st_mtime_ns or before.st_size!=after.st_size:raise ValueError("Файл изменился")
                    groups[(size,sha.hexdigest())].append(f)
                except (OSError,ValueError):skipped.append(f["id"])
        return {"groups":[{"sha256":h,"size":s,"files":v} for (s,h),v in groups.items() if len(v)>1],"hashed":count,"bytes_read_upper_bound":used,"skipped_count":len(skipped),"skipped":skipped[:100],"note":"Совпадение содержимого SHA-256, ограниченный проход; ничего не удаляется."}
    def classify(self):
        files=self.workspace.map_summary()["files"];result=[]
        tags=[("Договор",r"договор|контракт|contract"),("ГСМ",r"топлив|гсм|заправ|fuel"),("Табель",r"табел|отработан|timesheet"),("Автопарк",r"автомобил|госномер|автопарк|vehicle"),("Счёт",r"счет|счёт|invoice")]
        for f in files[:100]:
            content=""
            try:
                p,title,size=self.workspace.download(f["id"])
                if size<=256*1024:content=self.router.cognitive.extract(p,title)[:12000]
            except (OSError,ValueError):pass
            matches=[]
            for label,pattern in tags:
                if re.search(pattern,f["name"],re.I):matches.append({"label":label,"basis":"название"})
                elif re.search(pattern,content,re.I):matches.append({"label":label,"basis":"текст"})
            result.append({**f,"tags":matches})
        return {"items":result,"truncated":len(files)>100,"note":"Предложения по словарным правилам, папки не перемещаются."}
    def garage(self,month):
        month=month_ok(month);records=self.workspace.work()["records"];active=[r for r in records if not r["archived"]]
        counts=Counter(r["kind"] for r in active);fuel=defaultdict(lambda:[Decimal(0),Decimal(0),0]);hours=defaultdict(lambda:[Decimal(0),set()]);daily=defaultdict(lambda:[Decimal(0),Decimal(0)])
        for r in active:
            f=r["fields"];k=r["kind"]
            if k=="fuel" and f["date"][:7]==month:
                g=fuel[f["vehicle"]];g[0]+=Decimal(str(f["liters"]));g[1]+=Decimal(str(f["cost"]));g[2]+=1
                day=daily[f["date"]];day[0]+=Decimal(str(f["liters"]));day[1]+=Decimal(str(f["cost"]))
            if k=="timesheet" and f["date"][:7]==month:
                g=hours[f["employee"]];g[0]+=Decimal(str(f["hours"]));g[1].add(f["date"])
        byid={r["id"]:r for r in records}
        with closing(self.workspace.connect()) as db:
            km={r["vehicle"]:Decimal(str(r["km"])) for r in db.execute("SELECT * FROM agent_mileage WHERE month=?",(month,))}
        def label(i,field):return str(byid.get(i,{}).get("fields",{}).get(field,"#"+str(i)))
        return {"month":month,"counts":dict(counts),"liters":fmt(sum((g[0] for g in fuel.values()),Decimal(0))),"cost":fmt(sum((g[1] for g in fuel.values()),Decimal(0))),"hours":fmt(sum((g[0] for g in hours.values()),Decimal(0))),"vehicles":[{"id":i,"name":label(i,"plate"),"liters":fmt(l),"cost":fmt(c),"operations":n,"liters_per_100km":fmt((l*100/km[i]).quantize(Decimal(".01"))) if km.get(i,0)>0 else None} for i,(l,c,n) in sorted(fuel.items())][:100],"staff":[{"id":i,"name":label(i,"name"),"hours":fmt(h),"days":len(days)} for i,(h,days) in sorted(hours.items())][:100],"daily":[{"date":d,"liters":fmt(v[0]),"cost":fmt(v[1])} for d,v in sorted(daily.items())],"anomalies":self.router.advanced.anomalies(),"note":"Активные записи; нормы л/100 км — оценка по заправкам и введённому пробегу, не измерение сгорания. Проверка аномалий и пробег читаются отдельно."}
    def record(self,i):
        if type(i) is not int:raise ValueError("ID записи")
        records=self.workspace.work()["records"];target=next((r for r in records if r["id"]==i),None)
        if not target:raise ValueError("Запись отсутствует")
        related=[]
        for r in records:
            f=r["fields"];kind=r["kind"]
            refs={"vehicles":["driver"],"cards":["vehicle"],"timesheet":["employee"],"fuel":["vehicle","card"]}.get(kind,[])
            if any(f.get(key)==i for key in refs):related.append(r)
        def masked(r):
            r={**r,"fields":dict(r["fields"])}
            if r["kind"]=="cards":r["fields"]["number"]="••••"+r["fields"]["number"][-4:]
            return r
        with closing(self.workspace.connect()) as db:
            versions=[]
            for row in db.execute("SELECT before_state,after_state,created FROM work_record_versions WHERE record_id=? ORDER BY id DESC LIMIT 50",(i,)):
                def convert(s):
                    raw=json.loads(s)
                    if not raw:return None
                    return masked({"id":raw["id"],"kind":raw["kind"],"archived":bool(raw["archived"]),"fields":json.loads(raw["payload"]),"updated":raw["updated"]})
                versions.append({"created":row["created"],"before":convert(row["before_state"]),"after":convert(row["after_state"])})
        return {"record":masked(target),"related":[masked(r) for r in related[-100:]],"related_total":len(related),"versions":versions,"note":"Связанные записи по текущим ссылкам, включая архив. Версии фиксируются с обновления 9.0."}
    def dispatch(self,v):
        if not isinstance(v,dict):raise ValueError("Некорректная операция")
        a=v.get("action")
        if a=="tree" and set(v)=={"action"}:return self.tree()
        if a=="duplicates" and set(v)=={"action"}:return self.duplicates()
        if a=="classify" and set(v)=={"action"}:return self.classify()
        if a=="preview" and set(v)=={"action","id"}:return self.preview(v["id"])
        if a=="garage" and set(v)=={"action","month"}:return self.garage(v["month"])
        if a=="record" and set(v)=={"action","id"}:return self.record(v["id"])
        raise ValueError("Неизвестная операция")
