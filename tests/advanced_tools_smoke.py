import io,sys,tempfile
from pathlib import Path
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from chat_store import ChatStore
from workspace import Workspace
from cloud_client import Cloud
from routing import Router

with tempfile.TemporaryDirectory() as d:
    path=Path(d)/"db.sqlite";chat=ChatStore(path);w=Workspace(path)
    def no_cloud(*args):raise AssertionError("Unexpected cloud")
    r=Router(chat,w,Cloud(path,no_cloud))
    def save(kind,fields):return w.save_work({"kind":kind,"fields":fields})["id"]
    staff=save("staff",{"name":"Иванов","job":"Водитель","number":"1"})
    save("staff",{"name":"Петров","job":"Механик","number":"1"})
    def plan(text):
        req={"text":text,"request_id":str(uuid4())};return req,r.plan(req)
    def execute(req,p,approve=False):return r.execute({**req,"token":p["token"],"cloud":True,"approve_edit":approve})
    req,p=plan("Проверь аномалии")
    assert p["sufficient"] and "табельный номер" in p["local"]
    assert execute(req,p)["route"]=="local"
    req,p=plan("Комплексный отчёт за 2026-11")
    assert "Расход ГСМ" in p["local"] and "Проверка" in p["local"]
    assert execute(req,p)["route"]=="local"
    a=w.upload(None,"a.txt",io.BytesIO(b"old\n"),4)["id"]
    b=w.upload(None,"b.txt",io.BytesIO(b"new\n"),4)["id"]
    req,p=plan(f"Сравни документы #{a} и #{b}")
    assert "-old" in p["local"] and "+new" in p["local"]
    assert execute(req,p)["route"]=="local"
    req,p=plan(f"Измени должность сотрудника #{staff}: Старший водитель")
    assert p["mutation"]["before"]=="Водитель"
    execute(req,p)
    assert w.work()["records"][0]["fields"]["job"]=="Водитель"
    req,p=plan(f"Измени должность сотрудника #{staff}: Старший водитель")
    assert execute(req,p,True)["route"]=="local"
    assert w.work()["records"][0]["fields"]["job"]=="Старший водитель"
    assert w.edit_receipt(req["request_id"],req["text"])["after"]=="Старший водитель"
    assert execute(req,p,True)["duplicate"]
    req,p=plan(f"Измени запись #{staff} поле job: Начальник")
    w.save_work({"kind":"staff","id":staff,"fields":{"name":"Иванов","job":"Механик","number":"1"}})
    try:execute(req,p,True)
    except ValueError:pass
    else:raise AssertionError("stale edit accepted")
    assert w.work()["records"][0]["fields"]["job"]=="Механик"
    assert not w.edit_receipt(req["request_id"],req["text"])
    assert chat.health()["ok"]
print("Advanced workflows, anomalies, comparison, approval, stale version and audit passed")
