"""Read-only, allowlisted local report tools. No network, no dynamic SQL."""
from collections import defaultdict
from contextlib import closing
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
import json
import re

TOOLS={
    "fuel":("Расход ГСМ",True,["Автомобиль","Операций","Литры","Сумма, ₽","₽/л"]),
    "timesheet":("Табель",True,["Сотрудник","Дней","Часов"]),
    "vehicles":("Автопарк",False,["Госномер","Модель","Водитель"]),
    "cards":("Топливные карты",False,["Карта (последние 4)","Поставщик","Автомобиль"]),
    "staff":("Сотрудники",False,["ФИО","Должность","Табельный номер"]),
    "files":("Документы",False,["Тип файла","Файлов","Байт"]),
    "health":("Целостность памяти",False,["Показатель","Значение"]),
}
MAX_ROWS=500

def catalog():
    return [{"id":k,"title":v[0],"monthly":v[1]} for k,v in TOOLS.items()]

def num(v):
    return Decimal(str(v))

def fmt(v):
    return format(v.normalize(),"f") if v else "0"

def command(text):
    q=text.strip().casefold().replace("ё","е")
    m=re.fullmatch(r"(?:отчет|отчеты|сводка)\s+(?:по\s+)?(гсм|топливу|табелю|табель|автопарку|автопарк|автомобилям|картам|топливным картам|сотрудникам|документам|памяти)(?:\s+за\s+(\d{4}-\d{2}))?[?.]?",q)
    if not m:return None
    names={"гсм":"fuel","топливу":"fuel","табелю":"timesheet","табель":"timesheet","автопарку":"vehicles","автопарк":"vehicles","автомобилям":"vehicles","картам":"cards","топливным картам":"cards","сотрудникам":"staff","документам":"files","памяти":"health"}
    k=names[m[1]]
    return {"tool":k,"month":m[2] or (date.today().strftime("%Y-%m") if TOOLS[k][1] else "")}

class ToolEngine:
    def __init__(self,workspace,chat):
        self.workspace,self.chat=workspace,chat

    def run(self,value):
        if not isinstance(value,dict) or set(value)!={"tool","month"}:raise ValueError("Некорректные параметры инструмента")
        kind,month=value["tool"],value["month"]
        if not isinstance(kind,str) or kind not in TOOLS or not isinstance(month,str):raise ValueError("Неизвестный инструмент")
        title,monthly,columns=TOOLS[kind]
        if monthly:
            if not re.fullmatch(r"\d{4}-\d{2}",month):raise ValueError("Укажите месяц ГГГГ-ММ")
            date.fromisoformat(month+"-01")
        elif month:raise ValueError("Этот отчёт не требует месяца")
        rows=[];source=[];summary=[]
        if kind=="files":
            files=self.workspace.map_summary()["files"];groups=defaultdict(lambda:[0,0])
            for f in files:
                ext=Path(f["name"]).suffix.casefold() or "(без расширения)"
                groups[ext][0]+=1;groups[ext][1]+=f["size"]
            rows=[[ext,str(n),str(size)] for ext,(n,size) in sorted(groups.items())]
            summary=[f"Файлов: {len(files)}",f"Объём: {sum(f['size'] for f in files)} байт"]
            source=[{"source":"file","id":f["id"],"title":f["name"]} for f in files[:8]]
        elif kind=="health":
            h=self.chat.health()
            rows=[["Целостность","OK" if h["ok"] else "Ошибка"],["Сообщений",str(h["messages"])],["Физических страниц",str(h["clusters"])],["Визуальных блоков",str((h["messages"]+499)//500)],["Проблемы",", ".join(h["issues"]) or "Нет"]]
            summary=["Проверка SQLite и цепочки переписки"]
        else:
            with closing(self.workspace.connect()) as db:
                db.execute("BEGIN")
                records=[{**dict(r),"fields":json.loads(r["payload"])} for r in db.execute("SELECT * FROM work_records ORDER BY id")]
            byid={r["id"]:r for r in records}
            def ref(i,key):
                if i is None:return "—"
                r=byid.get(i)
                if not r:return "#"+str(i)+" (нет записи)"
                return str(r["fields"].get(key,"#"+str(i)))+(" (архив)" if r["archived"] else "")
            active=[r for r in records if not r["archived"] and r["kind"]==kind]
            if monthly:active=[r for r in active if r["fields"]["date"][:7]==month]
            source=[{"source":"work","id":r["id"],"title":title} for r in active[:8]]
            if kind=="fuel":
                groups=defaultdict(lambda:[0,Decimal(0),Decimal(0)])
                for r in active:
                    f=r["fields"];g=groups[f["vehicle"]];g[0]+=1;g[1]+=num(f["liters"]);g[2]+=num(f["cost"])
                for i,(n,l,c) in sorted(groups.items(),key=lambda x:ref(x[0],"plate")):
                    rows.append([ref(i,"plate"),str(n),fmt(l),fmt(c),fmt((c/l).quantize(Decimal(".01"))) if l else "—"])
                summary=[f"Операций: {len(active)}",f"Литры: {fmt(sum((g[1] for g in groups.values()),Decimal(0)))}",f"Сумма, ₽: {fmt(sum((g[2] for g in groups.values()),Decimal(0)))}"]
            elif kind=="timesheet":
                groups=defaultdict(lambda:[set(),Decimal(0)])
                for r in active:
                    f=r["fields"];g=groups[f["employee"]];g[0].add(f["date"]);g[1]+=num(f["hours"])
                rows=[[ref(i,"name"),str(len(days)),fmt(hours)] for i,(days,hours) in sorted(groups.items(),key=lambda x:ref(x[0],"name"))]
                summary=[f"Записей: {len(active)}",f"Часов: {fmt(sum((g[1] for g in groups.values()),Decimal(0)))}"]
            else:
                for r in active:
                    f=r["fields"]
                    if kind=="vehicles":rows.append([f["plate"],f["model"],ref(f["driver"],"name")])
                    elif kind=="cards":rows.append(["••••"+str(f["number"])[-4:],f["provider"],ref(f["vehicle"],"plate")])
                    else:rows.append([f["name"],f["job"],f["number"]])
                summary=[f"Активных записей: {len(active)}"]
        return {"tool":kind,"title":title,"month":month,"columns":columns,"rows":rows[:MAX_ROWS],"total_rows":len(rows),"summary":summary,"sources":source,"generated":datetime.now().astimezone().isoformat()}

def report_text(report):
    # Chat answer is deliberately bounded, complete totals and honest truncation.
    lines=["Локальный отчёт SQLite: "+report["title"]+(" · "+report["month"] if report["month"] else ""),*report["summary"]," | ".join(report["columns"])]
    for row in report["rows"][:30]:lines.append(" | ".join(row))
    if report["total_rows"]>30:lines.append(f"Показано 30 из {report['total_rows']} строк. Откройте инструмент «Отчёты» для таблицы.")
    if not report["rows"]:lines.append("Нет записей за выбранный период.")
    lines.append("Результат на момент формирования: "+report["generated"][:19])
    return "\n".join(lines)
