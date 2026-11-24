"""Bounded local CSV/XLSX import and timesheet fill; preview and atomic commit."""
import csv
import io
import json
import re
import threading
import time
import hashlib
from collections import OrderedDict
from contextlib import closing
from datetime import date,timedelta
from pathlib import Path
from uuid import uuid4
from zipfile import ZipFile,BadZipFile
import xml.etree.ElementTree as ET
from workspace import SCHEMA, now

MAX_ROWS=500
MAX_BYTES=2*1024*1024
NS="{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

def xml(z,name):
    info=z.getinfo(name)
    if info.file_size>MAX_BYTES:raise ValueError("Лист Excel слишком большой")
    raw=z.read(info)
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():raise ValueError("Недопустимый XML")
    return ET.fromstring(raw)

def sheet_rows(path,title):
    if path.stat().st_size>MAX_BYTES:raise ValueError("Лимит импорта 2 МиБ")
    suffix=Path(title).suffix.casefold()
    if suffix==".csv":
        raw=path.read_bytes()
        try:text=raw.decode("utf-8-sig")
        except UnicodeDecodeError:text=raw.decode("cp1251")
        try:dialect=csv.Sniffer().sniff(text[:8192],delimiters=";,\t")
        except csv.Error:dialect=csv.excel
        rows=[]
        for row in csv.reader(io.StringIO(text),dialect):
            if any(x.strip() for x in row):rows.append(row)
            if len(rows)>MAX_ROWS+1:raise ValueError("Лимит 500 записей")
        return rows
    if suffix!=".xlsx":raise ValueError("Только CSV или XLSX")
    try:
        with ZipFile(path) as z:
            # Fixed first worksheet, no relationships, macros, formulas or external reads.
            root=xml(z,"xl/worksheets/sheet1.xml")
            shared=[]
            if "xl/sharedStrings.xml" in z.namelist():
                shared=["".join(t.text or "" for t in si.iter(NS+"t")) for si in xml(z,"xl/sharedStrings.xml").iter(NS+"si")]
            rows=[]
            for row in root.iter(NS+"row"):
                cells={}
                for cell in row.findall(NS+"c"):
                    if cell.find(NS+"f") is not None:raise ValueError("Формулы не импортируются; сохраните значения")
                    ref=cell.get("r","")
                    m=re.fullmatch(r"([A-Z]{1,2})[1-9]\d*",ref)
                    if not m:raise ValueError("Неверный адрес ячейки")
                    col=0
                    for ch in m[1]:col=col*26+ord(ch)-64
                    if col>30:raise ValueError("Лимит 30 столбцов")
                    typ=cell.get("t","n");v=cell.findtext(NS+"v","")
                    if typ=="s":v=shared[int(v)]
                    elif typ=="inlineStr":v="".join(t.text or "" for t in cell.iter(NS+"t"))
                    elif typ not in ("n","str"):raise ValueError("Недопустимый тип ячейки")
                    cells[col-1]=v
                if cells and any(v.strip() for v in cells.values()):rows.append([cells.get(i,"") for i in range(max(cells)+1)])
                if len(rows)>MAX_ROWS+1:raise ValueError("Лимит 500 записей")
            return rows
    except (BadZipFile,KeyError,IndexError,ET.ParseError,UnicodeError,ValueError) as e:
        raise ValueError("Не удалось прочитать XLSX: "+str(e)) from None

def parse_rows(kind,rows):
    if not isinstance(kind,str) or kind not in SCHEMA:raise ValueError("Неизвестный раздел")
    if not rows:raise ValueError("Пустая таблица")
    header=[x.strip().casefold() for x in rows[0]]
    if len(set(header))!=len(header) or set(header)!=set(SCHEMA[kind]):
        raise ValueError("Заголовки должны быть: "+", ".join(SCHEMA[kind]))
    result=[]
    for i,row in enumerate(rows[1:],2):
        if len(row)>len(header):raise ValueError("Лишние столбцы в строке "+str(i))
        fields={}
        try:
            for k,v in zip(header,row+[""]*(len(header)-len(row))):
                t=SCHEMA[kind][k];v=v.strip()
                if t in ("positive","nonnegative","hours"):
                    if not re.fullmatch(r"\d{1,10}(?:[.,]\d{1,3})?",v):raise ValueError(k)
                    v=float(v.replace(",","."))
                elif t not in ("text","optional","date"):
                    if not v and t.endswith("?"):v=None
                    elif re.fullmatch(r"[1-9]\d{0,11}",v):v=int(v)
                    else:raise ValueError(k)
                fields[k]=v
        except ValueError as e:raise ValueError(f"Строка {i}: неверное поле {e}") from None
        result.append({"kind":kind,"fields":fields})
    if not result:raise ValueError("Нет записей")
    return result

class Importer:
    def __init__(self,w):
        self.w=w;self.lock=threading.RLock();self.plans=OrderedDict()
        with closing(w.connect()) as db,db:
            db.execute("CREATE TABLE IF NOT EXISTS work_import_audit(token TEXT PRIMARY KEY,kind TEXT NOT NULL,count INTEGER NOT NULL,created TEXT NOT NULL)")

    def preview(self,value):
        if not isinstance(value,dict) or set(value)!={"kind","file"} or type(value["file"]) is not int:raise ValueError("Выберите файл и раздел")
        path,title,_=self.w.download(value["file"])
        return self.stage(parse_rows(value["kind"],sheet_rows(path,title)),title)

    def fill(self,v):
        if not isinstance(v,dict) or set(v)!={"employee","start","end","hours","weekdays"} or type(v["employee"]) is not int or type(v["hours"]) not in (int,float) or type(v["weekdays"]) is not bool:raise ValueError("Некорректный табель")
        start,end=date.fromisoformat(v["start"]),date.fromisoformat(v["end"])
        if not 0<=(end-start).days<=62:raise ValueError("Период до 63 дней")
        rows=[]
        for i in range((end-start).days+1):
            d=start+timedelta(days=i)
            if not v["weekdays"] or d.weekday()<5:rows.append({"kind":"timesheet","fields":{"employee":v["employee"],"date":d.isoformat(),"hours":v["hours"],"note":"Заполнение по заданному графику"}})
        return self.stage(rows,"Табель по указанному графику (праздники не исключаются автоматически)")

    def stage(self,rows,title):
        if not 1<=len(rows)<=MAX_ROWS:raise ValueError("Лимит 1–500 строк")
        # Run the same validators as commit, including intra-batch conflicts.
        with closing(self.w.connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                for i,row in enumerate(rows,1):
                    try:self.w.save_work(row,connection=db)
                    except ValueError as e:raise ValueError(f"Запись {i}: {e}") from None
            finally:db.rollback()
        token=uuid4().hex
        with self.lock:
            while len(self.plans)>=16:self.plans.popitem(last=False)
            self.plans[token]=(time.monotonic(),rows)
        display=[]
        for row in rows:
            fields=dict(row["fields"])
            if row["kind"]=="cards":fields["number"]="••••"+str(fields["number"])[-4:]
            display.append(fields)
        return {"token":token,"kind":rows[0]["kind"],"title":title,"count":len(rows),"rows":display}

    def commit(self,v):
        if not isinstance(v,dict) or set(v)!={"token","confirm"} or v["confirm"] is not True or not isinstance(v["token"],str):raise ValueError("Нужно подтверждение")
        token=v["token"]
        with self.lock,closing(self.w.connect()) as db,db:
            db.execute("BEGIN IMMEDIATE")
            old=db.execute("SELECT count FROM work_import_audit WHERE token=?",(token,)).fetchone()
            if old:return {"count":old[0],"duplicate":True}
            item=self.plans.get(token)
            if not item or time.monotonic()-item[0]>300:raise ValueError("Предварительный просмотр устарел")
            rows=item[1]
            for i,row in enumerate(rows,1):
                try:self.w.save_work(row,connection=db)
                except ValueError as e:raise ValueError(f"Запись {i}: {e}. Импорт отменён полностью.") from None
            db.execute("INSERT INTO work_import_audit VALUES(?,?,?,?)",(token,rows[0]["kind"],len(rows),now()))
            return {"count":len(rows),"duplicate":False}
