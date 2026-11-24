import io,sys,tempfile,json
from pathlib import Path
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from cloud_client import Cloud,CloudError,parse_sse
from chat_store import ChatStore
from workspace import Workspace
from routing import Router

def event(text):
    return ("data: "+json.dumps({"choices":[{"index":0,"delta":{"content":text}}]},ensure_ascii=False)+"\n\n").encode()
assert list(parse_sse(io.BytesIO(event("Привет")+event(" мир")+b"data: [DONE]\n\n")))==["Привет"," мир"]
try:list(parse_sse(io.BytesIO(event("partial"))))
except CloudError:pass
else:raise AssertionError("unfinished stream")
with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"db.sqlite";c=ChatStore(p);w=Workspace(p);calls=[]
    def transport(method,path,key,payload=None):
        if path=="/models":return {"data":[{"id":"mock"}]}
        raise AssertionError("non-stream call")
    def stream(key,payload):
        calls.append(payload);assert payload["stream"] is True
        yield "Первая ";yield "часть"
    cloud=Cloud(p,transport,stream);cloud.save_key({"key":"test","persist":False});cloud.load_models();cloud.select({"model":"mock"})
    r=Router(c,w,cloud);req={"text":"Объясни неизвестную тему","request_id":str(uuid4())}
    plan=r.plan(req);assert not plan["sufficient"]
    emitted=[]
    result=r.execute({**req,"token":plan["token"],"cloud":True},emit=emitted.append)
    assert emitted==["Первая ","часть"] and result["route"]=="cloud"
    assert result["messages"][-1]["text"]=="Первая часть"
    assert r.execute({**req,"token":plan["token"],"cloud":True},emit=emitted.append)["duplicate"]
    assert len(calls)==1
print("SSE incremental decoding, incomplete stream rejection, consent and atomic persistence passed")
