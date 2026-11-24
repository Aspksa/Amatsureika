"""Bounded local workflows, document comparison, anomaly checks and edit previews."""
from collections import defaultdict
from contextlib import closing
from datetime import date, datetime
from decimal import Decimal
from difflib import unified_diff
import hashlib
import json
import re
from pathlib import Path
from statistics import median
from tool_engine import report_text, fmt

def parse_command(text):
    q=text.strip()
    if m:=re.fullmatch(r"(?:комплексный|общий)\s+отч[её]т(?:\s+по\s+гаражу)?(?:\s+за\s+(\d{4}-\d{2}))?[?.]?",q,re.I):
        return ("bundle",m[1] or date.today().strftime("%Y-%m"))
    if re.fullmatch(r"(?:проверь|найди)\s+аномалии(?:\s+в\s+работе)?[?.]?",q,re.I):
        return ("anomalies",None)
    if m:=re.fullmatch(r"сравни\s+(?:документы|файлы)\s+#?(\d{1,12})\s+(?:и|с)\s+#?(\d{1,12})[?.]?",q,re.I):
        return ("compare",(int(m[1]),int(m[2])))
    if m:=re.fullmatch(r"измени\s+(?:запись|поле записи)\s+#?(\d{1,12})\s+(?:поле\s+)?([a-z]+)\s*:\s*(.+)",q,re.I|re.S):
        return ("edit",(int(m[1]),m[2].lower(),m[3].strip()))
    if m:=re.fullmatch(r"измени\s+должность\s+сотрудника\s+#?(\d{1,12})\s*:\s*(.+)",q,re.I|re.S):
        return ("edit",(int(m[1]),"job",m[2].strip()))
    return None

EDITABLE={"staff":{"job","name"},"vehicles":{"model","plate"},"cards":{"provider"},"timesheet":{"hours","note"},"fuel":{"liters","cost","note"}}
FIELD_TITLES={"job":"Должность","name":"ФИО","model":"Модель","plate":"Госномер","provider":"Поставщик","hours":"Часы","liters":"Литры","cost":"Сумма, ₽","note":"Примечание"}

class AdvancedTools:
    def __init__(self,workspace,reports,extract):
        self.workspace,self.reports,self.extract=workspace,reports,extract

    def anomalies(self):
        with closing(self.workspace.connect()) as db:
            records=[{**dict(r),"fields":json.loads(r["payload"])} for r in db.execute("SELECT * FROM work_records ORDER BY id")]
        active=[r for r in records if not r["archived"]]
        byid={r["id"]:r for r in records}
        groups=defaultdict(list); issues=[];prices=defaultdict(list)
        def add(code,title,ids):
            issues.append({"code":code,"text":title,"ids":ids})
        for r in active:
            f=r["fields"];k=r["kind"];i=r["id"]
            if k=="staff":key=f["number"].strip().casefold()
            elif k=="vehicles":key=re.sub(r"\s+","",f["plate"]).casefold()
            elif k=="cards":key=f["number"].strip().casefold()
            elif k=="timesheet":key=(f["employee"],f["date"])
            else:key=None
            if key is not None:groups[(k,key)].append(i)
            refs={"vehicles":{"driver":"staff"},"cards":{"vehicle":"vehicles"},"timesheet":{"employee":"staff"},"fuel":{"vehicle":"vehicles","card":"cards"}}.get(k,{})
            for field,target in refs.items():
                rid=f.get(field)
                if rid is None:continue
                link=byid.get(rid)
                if not link or link["kind"]!=target or link["archived"]:
                    add("reference","Связь с отсутствующей, архивной или неподходящей записью: "+field,[i,rid])
            if k=="fuel":
                card=byid.get(f["card"])
                if card and card["kind"]=="cards" and card["fields"]["vehicle"] not in (None,f["vehicle"]):
                    add("card_vehicle","Карта закреплена за другим автомобилем",[i,card["id"]])
                liters=Decimal(str(f["liters"]));cost=Decimal(str(f["cost"]))
                if liters>0:prices[(f["kind"].casefold(),f["date"][:7])].append((i,cost/liters))
                if cost==0:add("zero_cost","Заправка с нулевой стоимостью — проверьте основание",[i])
        for (k,key),ids in groups.items():
            if len(ids)>1:add("duplicate","Повторяющийся ключ: "+{"staff":"табельный номер","vehicles":"госномер","cards":"номер карты","timesheet":"сотрудник и дата"}[k],ids)
        for (_,month),items in prices.items():
            if len(items)<5:continue
            baseline=median(p for _,p in items)
            if baseline<=0:continue
            for i,p in items:
                if p>baseline*Decimal("1.5") or p<baseline*Decimal(".5"):
                    add("price","Цена литра отличается от медианы группы за "+month+" более чем на 50% — проверить",[i])
        return {"issues":issues[:100],"total":len(issues),"checked":len(active)}

    def bundle(self,month):
        if not isinstance(month,str) or not re.fullmatch(r"\d{4}-\d{2}",month):raise ValueError("Укажите месяц ГГГГ-ММ")
        date.fromisoformat(month+"-01")
        reports=[self.reports.run({"tool":k,"month":month if k in ("fuel","timesheet") else ""}) for k in ("fuel","timesheet","vehicles","cards","staff","files","health")]
        check=self.anomalies()
        # Each stage reads its own snapshot and includes a generation timestamp.
        return {"month":month,"reports":reports,"anomalies":check,"steps":[r["title"] for r in reports]+["Проверка аномалий"]}

    def compare(self,a,b):
        if type(a) is not int or type(b) is not int or a<=0 or b<=0 or a==b:raise ValueError("Выберите два разных файла по ID")
        files=[]
        for rid in (a,b):
            path,title,size=self.workspace.download(rid)
            if Path(title).suffix.lower() not in (".txt",".md",".csv",".json",".log",".tsv",".docx"):
                raise ValueError("Для сравнения поддерживаются текстовые файлы и DOCX")
            if size>256*1024:raise ValueError("Файл превышает лимит сравнения 256 КиБ")
            text=self.extract(path,title)
            if not text and size:raise ValueError("Не удалось извлечь текст файла #"+str(rid))
            # Bound worst-case difflib runtime; not a semantic comparison.
            lines=text.splitlines()
            if len(lines)>2000:raise ValueError("Слишком много строк для сравнения (лимит 2000)")
            files.append((rid,title,lines))
        x,y=files
        diff=list(unified_diff(x[2],y[2],fromfile=x[1],tofile=y[1],lineterm="",n=2))
        shown=[];length=0
        for line in diff[:200]:
            if length+len(line)>16000:break
            shown.append(line);length+=len(line)
        return {"files":[{"id":f[0],"name":f[1],"lines":len(f[2])} for f in files],"equal":x[2]==y[2],"diff":"\n".join(shown),"truncated":len(shown)<len(diff),"diff_lines":len(diff)}

    def preview(self,rid,field,raw):
        with closing(self.workspace.connect()) as db:
            row=db.execute("SELECT * FROM work_records WHERE id=? AND archived=0",(rid,)).fetchone()
        if not row:raise ValueError("Активная запись не найдена")
        if field not in EDITABLE.get(row["kind"],set()):raise ValueError("Это поле нельзя менять через чат")
        f=json.loads(row["payload"])
        if field in ("hours","liters","cost"):
            try:
                if not re.fullmatch(r"\d{1,10}(?:[.,]\d{1,3})?",raw):raise ValueError()
                value=float(raw.replace(",","."))
                if value>1e9 or (field=="hours" and value>24) or (field=="liters" and value<=0):raise ValueError()
            except ValueError:raise ValueError("Недопустимое числовое значение") from None
        else:
            value=raw.strip()
            if len(value)>500 or (not value and field!="note"):raise ValueError("Недопустимый текст")
        if f[field]==value:raise ValueError("Значение уже установлено")
        return {"id":rid,"kind":row["kind"],"field":field,"label":FIELD_TITLES[field],"before":f[field],"after":value,"version":row["updated"]}

    def apply(self,mutation,request_id,text):
        # Workspace performs CAS, schema checks and audit in one transaction.
        with closing(self.workspace.connect()) as db:
            r=db.execute("SELECT payload FROM work_records WHERE id=? AND kind=?",(mutation["id"],mutation["kind"])).fetchone()
        if not r:raise ValueError("Запись недоступна")
        fields=json.loads(r["payload"]);fields[mutation["field"]]=mutation["after"]
        return self.workspace.save_work({"id":mutation["id"],"kind":mutation["kind"],"fields":fields},expected_updated=mutation["version"],audit={"request_id":request_id,"text":text,"mutation":mutation})

def anomaly_text(result):
    lines=[f"Локальная проверка аномалий: проверено {result['checked']} записей; замечаний {result['total']}."]
    for a in result["issues"][:30]:lines.append(a["text"]+" — записи "+", ".join("#"+str(i) for i in a["ids"]))
    if result["total"]>30:lines.append("Показано 30 замечаний.")
    lines.append("Замечания требуют проверки человеком; это не доказательство нарушения.")
    return "\n".join(lines)

def bundle_text(result):
    lines=["Комплексный локальный отчёт за "+result["month"]+" (последовательные снимки данных)"]
    for r in result["reports"]:lines.append(r["title"]+": "+"; ".join(r["summary"])+" · "+r["generated"][:19])
    lines.append(anomaly_text(result["anomalies"]))
    return "\n".join(lines)

def compare_text(result):
    a,b=result["files"]
    return "Сравнение извлечённого текста #"+str(a["id"])+" и #"+str(b["id"])+": "+("совпадает" if result["equal"] else "различается")+"\n"+result["diff"]+("\nВывод ограничен." if result["truncated"] else "")
