import sys,tempfile
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from chat_store import ChatStore
from workspace import Workspace
from routing import Router
from cloud_client import Cloud
from chat_intelligence import bounded_context, possible_conflicts
assert bounded_context(["A","a","B"],10)=="A\nB"
with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"db.sqlite";c=ChatStore(p);w=Workspace(p);r=Router(c,w,Cloud(p))
    def req(q):return {"text":q,"request_id":str(uuid4())}
    q=req("Пожалуйста, посчитай 2 + 3")
    plan=r.plan(q);assert plan["sufficient"] and "= 5" in plan["local"]
    out=r.execute({**q,"token":plan["token"],"cloud":False})
    assert out["messages"][-1]["metadata"]["tools"]==["calculator"]
    assert c.memory_snapshot()["messages"][-1]["metadata"]["tools"]==["calculator"]
    q=req("Статистика: 1 2 3");plan=r.plan(q);assert plan["metadata"]["series"]==[1,2,3]
    q=req("Найди в интернете тестовая тема")
    with patch.object(r.web,"dispatch",return_value={"pages":[{"title":"Test","url":"https://example.com/","text":"Evidence","published":""}]}) as web:
        plan=r.plan(q);assert not web.called
        offer=plan["web_offer"];assert offer["query"]=="тестовая тема"
        try:r.authorize_web({"token":plan["token"],"query":"other","action":offer["action"],"confirm":True})
        except ValueError:pass
        else:raise AssertionError("unbound query")
        assert not web.called
        plan=r.authorize_web({"token":plan["token"],**offer,"confirm":True})
        assert web.call_count==1 and "https://example.com/" in plan["context"]
        result=r.execute({**q,"token":plan["token"],"cloud":False})
        assert result["messages"][-1]["metadata"]["web_sources"]
    assert c.health()["ok"]
print("Chat intent, local calculator, charts, persistent metadata and exact web consent passed")
