import sys,tempfile
from pathlib import Path
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from routing import Router,calculate
from chat_store import ChatStore
from cloud_client import Cloud
from workspace import Workspace
from cognitive_tools import counterfactual
assert calculate({"expression":"liters*price","variables":{"liters":40,"price":"65.5"}})["result"]=="2.62E+3"
for expr in ("__import__('os')","x**9","x.real","x/0","0xff"):
    try:calculate({"expression":expr,"variables":{"x":1}})
    except ValueError:pass
    else:raise AssertionError(expr)
a=["машина","статус","неисправна"];b=["машина","действие","осмотр"]
result=counterfactual([a],[{"if":[a],"then":b}],[a],[],b)
assert result["baseline_reachable"] and not result["alternative_reachable"]
with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"db.sqlite";r=Router(ChatStore(p),Workspace(p),Cloud(p))
    req={"text":"Обзор гаража за 2026-11","request_id":str(uuid4())}
    plan=r.plan(req)
    assert plan["sufficient"] and "garage" in plan["metadata"]["tools"]
    assert r.execute({**req,"token":plan["token"],"cloud":False})["route"]=="local"
print("Bounded variable formulas, conditional counterfactual and garage chat route passed")
