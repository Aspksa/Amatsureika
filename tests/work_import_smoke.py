import io,sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from workspace import Workspace
from work_import import Importer,parse_rows,sheet_rows
from report_export import xlsx
with tempfile.TemporaryDirectory() as d:
    w=Workspace(Path(d)/"db.sqlite");imp=Importer(w)
    raw="name;job;number\nИванов;Водитель;7\n".encode()
    f=w.upload(None,"staff.csv",io.BytesIO(raw),len(raw))["id"]
    p=imp.preview({"kind":"staff","file":f})
    assert not w.work()["records"] and p["count"]==1
    assert imp.commit({"token":p["token"],"confirm":True})["count"]==1
    assert imp.commit({"token":p["token"],"confirm":True})["duplicate"]
    staff=w.work()["records"][0]["id"]
    p=imp.fill({"employee":staff,"start":"2026-11-23","end":"2026-11-27","hours":8,"weekdays":True})
    assert p["count"]==5
    w.save_work({"kind":"timesheet","fields":{"employee":staff,"date":"2026-11-27","hours":8,"note":""}})
    try:imp.commit({"token":p["token"],"confirm":True})
    except ValueError:pass
    else:raise AssertionError("conflict accepted")
    assert len(w.work()["records"])==2
    p=imp.fill({"employee":staff,"start":"2026-11-23","end":"2026-11-26","hours":8,"weekdays":True})
    assert imp.commit({"token":p["token"],"confirm":True})["count"]==4
    from zipfile import ZipFile
    buf=io.BytesIO()
    with ZipFile(buf,"w") as z:
        z.writestr("xl/worksheets/sheet1.xml",'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c><c r="B1" t="inlineStr"><is><t>job</t></is></c><c r="C1" t="inlineStr"><is><t>number</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Петров</t></is></c><c r="B2" t="inlineStr"><is><t>Механик</t></is></c><c r="C2"><v>8</v></c></row></sheetData></worksheet>')
    raw=buf.getvalue();f=w.upload(None,"staff.xlsx",io.BytesIO(raw),len(raw))["id"]
    p=imp.preview({"kind":"staff","file":f});assert p["rows"][0]["name"]=="Петров"
    assert imp.commit({"token":p["token"],"confirm":True})["count"]==1
print("CSV preview, atomic import, idempotence, timesheet generation and conflict rollback passed")
