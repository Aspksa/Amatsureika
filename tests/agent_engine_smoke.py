import sys,tempfile
from pathlib import Path
from uuid import uuid4
from datetime import datetime,timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from chat_store import ChatStore
from workspace import Workspace
from cloud_client import Cloud
from routing import Router
from agent_engine import parse
with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"memory.db";c=ChatStore(p);w=Workspace(p)
    def no_cloud(*a):raise AssertionError("cloud")
    r=Router(c,w,Cloud(p,no_cloud));a=r.agent
    steps=parse("Сделай отчёт по ГСМ и табелю за 2026-11")
    assert len(steps)==2
    steps.append({"id":"summary","tool":"summary","month":"","depends":[x["id"] for x in steps]})
    out=a.run(steps)
    assert out["ok"] and len(out["steps"])==3
    assert "Литры: 0" in out["steps"][2]["text"]
    s=a.save_scenario({"name":"Месяц","steps":steps})["id"]
    assert a.scenario(s)==steps
    job=a.enqueue({"scenario":s,"due":datetime.now(timezone.utc).isoformat()})["id"]
    assert a.tick() and a.state()["jobs"][0]["status"]=="done"
    assert a.state()["runs"]
    for bad in ([{"id":"x","tool":"cloud","month":"","depends":[]}],[{"id":"x","tool":"summary","month":"","depends":["x"]}]):
        try:a.run(bad)
        except ValueError:pass
        else:raise AssertionError("unapproved tool")
    req={"text":"Сделай отчёт по ГСМ и табелю за 2026-11","request_id":str(uuid4())};plan=r.plan(req)
    assert plan["sufficient"] and "Локальный сценарий" in plan["local"]
    assert r.execute({**req,"token":plan["token"],"cloud":True})["route"]=="local"
    assert parse("А за прошлый месяц?",req["text"])[0]["month"]=="2026-10"
    assert c.health()["ok"]
print("Registry, parallel DAG, scenario replay, persistent queue, permissions, context and no cloud passed")
