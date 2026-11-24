import io
import tempfile
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from workspace import Workspace

def fails(fn):
    try: fn()
    except ValueError: return
    raise AssertionError("invalid operation accepted")

with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"amatsureika.db"
    w=Workspace(p)
    staff=w.save_work({"kind":"staff","fields":{"name":"Иван Иванов","job":"Водитель","number":"1"}})["id"]
    car=w.save_work({"kind":"vehicles","fields":{"plate":"А123АА","model":"Toyota","driver":staff}})["id"]
    card=w.save_work({"kind":"cards","fields":{"number":"1234","provider":"АЗС","vehicle":car}})["id"]
    t={"kind":"timesheet","fields":{"employee":staff,"date":"2026-11-24","hours":8,"note":""}}
    w.save_work(t)
    fails(lambda:w.save_work(t))
    fails(lambda:w.save_work({"kind":"timesheet","fields":{**t["fields"],"hours":25}}))
    w.save_work({"kind":"fuel","fields":{"date":"2026-11-24","vehicle":car,"card":card,"kind":"ДТ","liters":35.5,"cost":3000,"note":""}})
    assert len(Workspace(p).work()["records"])==5
    w.save_work({"kind":"staff","id":staff,"archived":True})
    assert Workspace(p).work()["records"][0]["archived"]
    folder=w.disk_action({"action":"folder","parent":None,"name":"Договоры"})["id"]
    file=w.upload(folder,"договор.txt",io.BytesIO(b"hello"),5)["id"]
    assert w.download(file)[0].read_bytes()==b"hello"
    fails(lambda:w.upload(folder,"../secret",io.BytesIO(b"x"),1))
    fails(lambda:w.upload(folder,"ДОГОВОР.TXT",io.BytesIO(b"x"),1))
    fails(lambda:w.upload(folder,"broken.txt",io.BytesIO(b"x"),2))
    assert len(w.disk(folder)["entries"])==1
    w.disk_action({"action":"rename","id":file,"name":"новый.txt"})
    w.disk_action({"action":"trash","id":folder})
    assert not w.disk()["entries"] and w.disk(trash=True)["entries"][0]["id"]==folder
    fails(lambda:w.download(file))
    w.disk_action({"action":"restore","id":folder})
    assert Workspace(p).download(file)[1]=="новый.txt"
print("Work registers, references, validation, persistent disk, trash and upload safety passed")
