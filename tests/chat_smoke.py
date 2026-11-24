import json
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]

def get(url, suffix=""):
    with urlopen(url+"api/chat"+suffix, timeout=20) as r:
        return json.load(r)

def post(url, data):
    req = Request(url+"api/chat", data=json.dumps(data).encode(), headers={"Content-Type":"application/json"})
    with urlopen(req, timeout=20) as r:
        return json.load(r)

def start(directory):
    return subprocess.Popen([sys.executable,"-u",str(ROOT/"server.py"),"--no-browser","--data-dir",directory],cwd=ROOT,stdout=subprocess.PIPE,text=True)

with tempfile.TemporaryDirectory() as directory:
    with start(directory) as proc:
        try:
            url=proc.stdout.readline().strip()
            assert get(url)=={"clusters":[],"messages":[]}
            first={"text":"Привет","request_id":str(uuid4())}
            a=post(url,first)
            assert a["clusters"][0]["count"]==2 and len(a["messages"])==2
            assert post(url,first)["duplicate"] is True
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(lambda i:post(url,{"text":f"Test {i}","request_id":str(uuid4())}),range(99)))
            s=get(url)
            assert [c["count"] for c in s["clusters"]]==[200,0],s["clusters"]
            assert s["clusters"][1]["previous_id"]==s["clusters"][0]["id"]
            b=post(url,{"text":"Next","request_id":str(uuid4())})
            assert [c["count"] for c in b["clusters"]]==[200,2]
            assert len(get(url,"?cluster=1")["messages"])==200
            assert len(get(url,"?cluster=2")["messages"])==2
            try:
                post(url,{"text":"","request_id":str(uuid4())})
                raise AssertionError("empty accepted")
            except HTTPError as e: assert e.code==400
        finally:
            proc.terminate();proc.wait(timeout=10)
    with start(directory) as proc:
        try:
            s=get(proc.stdout.readline().strip())
            assert [c["count"] for c in s["clusters"]]==[200,2]
            assert len(s["messages"])==202
        finally:
            proc.terminate();proc.wait(timeout=10)
print("Chat memory rollover, concurrency, retry and restart passed")
