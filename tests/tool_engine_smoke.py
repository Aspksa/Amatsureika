import sys,tempfile,io
from pathlib import Path
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from chat_store import ChatStore
from workspace import Workspace
from cloud_client import Cloud
from routing import Router
from tool_engine import ToolEngine,command,catalog

with tempfile.TemporaryDirectory() as d:
    path=Path(d)/"memory.db";w=Workspace(path);c=ChatStore(path)
    def no_cloud(*args):raise AssertionError("Unexpected cloud call")
    router=Router(c,w,Cloud(path,no_cloud));tools=ToolEngine(w,c)
    def save(kind,fields):return w.save_work({"kind":kind,"fields":fields})["id"]
    employee=save("staff",{"name":"Петров","job":"Водитель","number":"7"})
    vehicle=save("vehicles",{"plate":"А123АА","model":"Тест","driver":employee})
    card=save("cards",{"number":"123456789012","provider":"АЗС","vehicle":vehicle})
    for month,liters,cost in [("2026-11",20,1000),("2026-11",30,1800),("2026-10",100,9000)]:
        save("fuel",{"date":month+"-01","vehicle":vehicle,"card":card,"kind":"ДТ","liters":liters,"cost":cost,"note":""})
    save("timesheet",{"employee":employee,"date":"2026-11-01","hours":7.5,"note":""})
    save("timesheet",{"employee":employee,"date":"2026-11-02","hours":8,"note":""})
    def report(k,month=""):return tools.run({"tool":k,"month":month})
    assert len(catalog())==7
    r=report("fuel","2026-11")
    assert r["rows"]==[["А123АА","2","50","2800","56"]],r
    assert report("timesheet","2026-11")["rows"]==[["Петров","2","15.5"]]
    assert report("cards")["rows"][0][0]=="••••9012"
    assert report("vehicles")["rows"][0][2]=="Петров"
    file=w.upload(None,"test.txt",io.BytesIO(b"hello"),5)["id"]
    assert report("files")["rows"]==[[".txt","1","5"]]
    w.disk_action({"action":"trash","id":file})
    assert not report("files")["rows"]
    assert report("health")["rows"][0]==["Целостность","OK"]
    assert command("Отчёт по ГСМ за 2026-11")=={"tool":"fuel","month":"2026-11"}
    req={"text":"Отчёт по ГСМ за 2026-11","request_id":str(uuid4())};p=router.plan(req)
    assert p["intent"]=="tool" and p["sufficient"] and "2800" in p["local"]
    assert router.execute({**req,"token":p["token"],"cloud":True})["route"]=="local"
    for invalid in [{"tool":"fuel","month":"2026-13"},{"tool":"unknown","month":""},{"tool":"files","month":"2026-11"}]:
        try:tools.run(invalid)
        except ValueError:pass
        else:raise AssertionError("Invalid parameters accepted")
print("Local report tools, dates, exact totals, card masking, trash, no cloud and routing passed")
