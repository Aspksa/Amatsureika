import sys,tempfile,threading,io
from pathlib import Path
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from routing import Router
from workspace import Workspace
from chat_store import ChatStore
from cloud_client import Cloud
with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"db.sqlite";c=ChatStore(p);w=Workspace(p);r=Router(c,w,Cloud(p))
    def req(q):return {"text":q,"request_id":str(uuid4())}
    q=req("неизвестная тема");plan=r.plan(q)
    entered=threading.Event();release=threading.Event()
    def slow(*args):
        entered.set()
        assert release.wait(5)
        return "Тестовый ответ"
    with patch.object(r.cloud,"complete",side_effect=slow),ThreadPoolExecutor(max_workers=2) as pool:
        f=pool.submit(r.execute,{**q,"token":plan["token"],"cloud":True})
        assert entered.wait(5)
        try:
            local=req("Посчитай 2+2");lp=r.plan(local)
            assert pool.submit(r.execute,{**local,"token":lp["token"],"cloud":False}).result(timeout=3)["route"]=="local"
            try:r.execute({**q,"token":plan["token"],"cloud":True})
            except RuntimeError:pass
            else:raise AssertionError("duplicate active request")
        finally:release.set()
        assert f.result()["route"]=="cloud"
    class SlowUpload(io.BytesIO):
        def read(self,n=-1):
            assert w.save_work({"kind":"staff","fields":{"name":"Тест","job":"Водитель","number":"9"}})
            return super().read(n)
    w.upload(None,"a.txt",SlowUpload(b"hello"),5)
    assert c.health()["ok"]
print("Local request during remote request, duplicate protection and nonblocking upload passed")
