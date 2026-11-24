import io,sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from workspace import Workspace
from work_import import Importer,parse_rows
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
print("CSV preview, atomic import, idempotence, timesheet generation and conflict rollback passed")
