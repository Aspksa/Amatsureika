import tempfile,sys
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from routing import Router
from workspace import Workspace
from chat_store import ChatStore
from cloud_client import Cloud
with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"db.sqlite";c=ChatStore(p);w=Workspace(p);r=Router(c,w,Cloud(p))
    q={"text":"Сформируй отчёт по ГСМ и табелю за 2026-11","request_id":str(uuid4())}
    with patch.object(r.agent,"run",wraps=r.agent.run) as run:
        preview=r.preview(q)
        assert preview["steps"] and not run.called
        try:r.plan(q,approved_steps=[])
        except ValueError:pass
        else:raise AssertionError("changed plan")
        events=[]
        plan=r.plan(q,progress=events.append,approved_steps=preview["steps"])
        assert run.call_count==1 and len(events)>=4
        assert any(e["status"]=="ok" for e in events)
    q={"text":"Отчёт по сотрудникам","request_id":str(uuid4())}
    w.save_work({"kind":"staff","fields":{"name":"Иванов","job":"Водитель","number":"1"}})
    plan=r.plan(q)
    result=r.execute({**q,"token":plan["token"],"cloud":False})
    i=result["messages"][-1]["id"]
    assert result["messages"][-1]["metadata"]["table"]["rows"]
    out=r.export_result({"message":i,"format":"xlsx","confirm":True})
    assert w.download(out["id"])[1].endswith(".xlsx")
    assert c.health()["ok"]
print("Preview, actual progress, immutable table export and memory integrity passed")
