"""Explicit public web research, bounded downloads and opt-in monitoring."""
import hashlib
import http.client
import io
import ipaddress
import json
import re
import socket
import ssl
import threading
import time
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urlsplit, urljoin, urlencode, parse_qs, unquote
from uuid import uuid4
import xml.etree.ElementTree as ET

MAX_PAGE=1024*1024
MAX_DOC=5*1024*1024
TTL=1800
UA="Amatsureika/5.0 (local research tool)"
def stamp():return datetime.now(timezone.utc).isoformat()

def public_target(url):
    if not isinstance(url,str) or len(url)>2048 or any(ord(c)<33 or ord(c)==127 for c in url):raise ValueError("Некорректный URL")
    p=urlsplit(url)
    if p.scheme!="https" or not p.hostname or p.username is not None or p.password is not None or p.port not in (None,443) or p.fragment:raise ValueError("Только публичный HTTPS без авторизации")
    host=p.hostname.encode("idna").decode("ascii")
    if not re.fullmatch(r"[a-zA-Z0-9.-]+",host) or "." not in host or host.endswith(".local"):raise ValueError("Недопустимый домен")
    ips=list(dict.fromkeys(x[4][0] for x in socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)))
    if not ips or any(not ipaddress.ip_address(i).is_global or ipaddress.ip_address(i).is_multicast for i in ips):raise ValueError("Частные и специальные адреса запрещены")
    return p,host,ips[0]

class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self,host,ip,timeout):
        super().__init__(host,443,timeout=timeout,context=ssl.create_default_context())
        self.ip=ip
    def connect(self):
        raw=socket.create_connection((self.ip,443),self.timeout)
        try:self.sock=self._context.wrap_socket(raw,server_hostname=self.host)
        except BaseException:raw.close();raise

def fetch_public(url,limit=MAX_PAGE):
    deadline=time.monotonic()+20
    for _ in range(4):
        p,host,ip=public_target(url)
        remaining=deadline-time.monotonic()
        if remaining<=0:raise ValueError("Истекло время запроса")
        conn=PinnedHTTPS(host,ip,min(remaining,8))
        try:
            conn.request("GET",p.path or "/" if not p.query else (p.path or "/")+"?"+p.query,headers={"User-Agent":UA,"Accept":"text/html,application/xhtml+xml,application/rss+xml,application/xml,application/pdf,text/plain,application/json;q=0.8","Accept-Encoding":"identity","Connection":"close"})
            r=conn.getresponse()
            if r.status in (301,302,303,307,308):
                dest=r.getheader("Location")
                if not dest:raise ValueError("Пустое перенаправление")
                url=urljoin(url,dest);continue
            if r.status!=200:raise ValueError("Сайт вернул HTTP "+str(r.status))
            if r.getheader("Content-Encoding","identity").lower()!="identity":raise ValueError("Сжатый ответ не поддерживается")
            length=r.getheader("Content-Length")
            if length and int(length)>limit:raise ValueError("Превышен лимит загрузки")
            chunks=[];n=0
            while True:
                if time.monotonic()>deadline:raise ValueError("Истекло время загрузки")
                part=r.read1(min(65536,limit-n+1))
                if not part:break
                chunks.append(part);n+=len(part)
                if n>limit:raise ValueError("Превышен лимит загрузки")
            return {"url":url,"mime":r.getheader("Content-Type","").split(";")[0].strip().lower(),"modified":r.getheader("Last-Modified",""),"body":b"".join(chunks)}
        finally:conn.close()
    raise ValueError("Слишком много перенаправлений")

class Reader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip=0;self.title=False;self.titles=[];self.parts=[];self.date="";self.links=[];self.anchor=None
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag in ("script","style","noscript","svg","template"):self.skip+=1
        if self.skip:return
        if tag=="title":self.title=True
        if tag=="meta" and (a.get("property") or a.get("name")) in ("article:published_time","datePublished","date","pubdate"):
            self.date=(a.get("content") or "")[:80]
        if tag=="time" and not self.date:self.date=(a.get("datetime") or "")[:80]
        if tag=="a" and a.get("href"):self.anchor=[a["href"],[]]
        if tag in ("p","li","h1","h2","h3","br","div","article","section"):self.parts.append("\n")
    def handle_endtag(self,tag):
        if tag in ("script","style","noscript","svg","template"):self.skip=max(0,self.skip-1);return
        if self.skip:return
        if tag=="title":self.title=False
        if tag=="a" and self.anchor:
            href,parts=self.anchor;self.links.append((href," ".join(parts).strip()));self.anchor=None
        if tag in ("p","li","article","section","div"):self.parts.append("\n")
    def handle_data(self,data):
        if self.skip:return
        if self.title:self.titles.append(data)
        self.parts.append(data)
        if self.anchor:self.anchor[1].append(data)

def decode(raw):
    try:return raw.decode("utf-8-sig")
    except UnicodeDecodeError:return raw.decode("cp1251",errors="replace")

def read_page(r):
    mime=r["mime"]
    if mime not in ("text/html","application/xhtml+xml","text/plain"):raise ValueError("Чтение доступно только для HTML или текста")
    raw=decode(r["body"]);title=r["url"];date=""
    if mime!="text/plain":
        p=Reader();p.feed(raw);title=" ".join(p.titles).strip()[:300] or title;date=p.date;raw="".join(p.parts)
    text="\n".join(line for line in (" ".join(x.split()) for x in raw.splitlines()) if line)[:24000]
    return {"url":r["url"],"title":title,"text":text,"published":date,"modified":r["modified"],"fetched":stamp(),"hash":hashlib.sha256(text.encode()).hexdigest()}

def safe_link(url):
    if not isinstance(url,str):return False
    try:
        p=urlsplit(url)
        return p.scheme=="https" and p.hostname and not p.username and not p.password and p.port in (None,443) and len(url)<=2048
    except ValueError:return False

def search_results(raw,news=False):
    results=[]
    if news:
        if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():raise ValueError("Небезопасный RSS")
        root=ET.fromstring(raw)
        for item in root.findall(".//item")[:15]:
            u=item.findtext("link","");title=item.findtext("title","")
            if safe_link(u) and title:results.append({"url":u,"title":title[:300],"published":item.findtext("pubDate","")[:80],"publisher":item.findtext("source","")[:150]})
    else:
        p=Reader();p.feed(decode(raw))
        for href,title in p.links:
            if not title:continue
            u=urljoin("https://html.duckduckgo.com/",href)
            q=urlsplit(u)
            if q.hostname in ("duckduckgo.com","html.duckduckgo.com") and q.path.startswith("/l/"):u=parse_qs(q.query).get("uddg",[""])[0]
            elif q.hostname in ("duckduckgo.com","html.duckduckgo.com"):continue
            if safe_link(u) and not any(x["url"]==u for x in results):results.append({"url":u,"title":title[:300],"published":"","publisher":urlsplit(u).hostname})
            if len(results)>=10:break
    return results

class WebResearch:
    def __init__(self,chat,workspace,fetch=fetch_public):
        self.chat,self.workspace,self.fetch=chat,workspace,fetch
        self.lock=threading.RLock();self.network=threading.BoundedSemaphore(2);self.stop=threading.Event();self.worker=None
        with closing(chat.connect()) as db,db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS web_cache(key TEXT PRIMARY KEY,value TEXT NOT NULL,stored REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS web_watches(id TEXT PRIMARY KEY,url TEXT UNIQUE NOT NULL,hash TEXT NOT NULL,next_check REAL NOT NULL,status TEXT NOT NULL,checked TEXT NOT NULL,enabled INTEGER NOT NULL);
            """)
    def request(self,url,limit=MAX_PAGE):
        if not self.network.acquire(timeout=2):raise ValueError("Интернет-инструменты заняты")
        try:return self.fetch(url,limit)
        except (OSError,ssl.SSLError,http.client.HTTPException,ET.ParseError) as e:raise ValueError("Сайт недоступен: "+type(e).__name__) from None
        finally:self.network.release()
    def cached(self,key,load,force=False):
        if not force:
            with closing(self.chat.connect()) as db:
                row=db.execute("SELECT value,stored FROM web_cache WHERE key=?",(key,)).fetchone()
                if row and time.time()-row["stored"]<TTL:return {**json.loads(row["value"]),"cached":True}
        value=load()
        with closing(self.chat.connect()) as db,db:
            db.execute("INSERT OR REPLACE INTO web_cache VALUES(?,?,?)",(key,json.dumps(value,ensure_ascii=False),time.time()))
            db.execute("DELETE FROM web_cache WHERE key IN (SELECT key FROM web_cache ORDER BY stored DESC LIMIT -1 OFFSET 200)")
        return {**value,"cached":False}
    def read(self,url,force=False):
        if not safe_link(url):raise ValueError("Нужен публичный HTTPS URL")
        return self.cached("page:"+url,lambda:read_page(self.request(url)),force)
    def search(self,q,news=False):
        if not isinstance(q,str) or not 2<=len(q.strip())<=250:raise ValueError("Запрос от 2 до 250 символов")
        q=" ".join(q.split())
        def load():
            base="https://news.google.com/rss/search?" if news else "https://html.duckduckgo.com/html/?"
            url=base+urlencode({"q":q+" when:7d","hl":"ru","gl":"RU","ceid":"RU:ru"} if news else {"q":q})
            raw=self.request(url)
            if news and raw["mime"] not in ("application/rss+xml","application/xml","text/xml"):raise ValueError("Поставщик не вернул RSS")
            try:items=search_results(raw["body"],news)
            except (ValueError,ET.ParseError) as e:raise ValueError("Не удалось прочитать результаты поиска") from None
            if not items:raise ValueError("Поставщик не вернул результаты; возможно, ограничил автоматический доступ")
            return {"query":q,"items":items,"fetched":stamp(),"provider":"Google News RSS" if news else "DuckDuckGo HTML"}
        return self.cached(("news:" if news else "search:")+q,load)
    def research(self,q):
        # Only the explicitly supplied public query is sent. No memory or cloud key.
        first=self.search(q);items=first["items"];queries=[q]
        # Bounded second query, deliberately lexical refinement.
        refined=" ".join(re.findall(r"[\w-]+",q)[:12])+" источники"
        if refined!=q and len(refined)<=250:
            try:
                second=self.search(refined);queries.append(refined)
                items=items+[x for x in second["items"] if x["url"] not in {y["url"] for y in items}]
            except ValueError:pass
        pages=[];errors=[];domains=set()
        for item in items:
            host=urlsplit(item["url"]).hostname
            if host in domains:continue
            domains.add(host)
            try:pages.append(self.read(item["url"]))
            except ValueError as e:errors.append({"url":item["url"],"error":str(e)})
            if len(pages)+len(errors)>=3:break
        terms=set(re.findall(r"\w{4,}",q.casefold()))
        overlaps=[]
        for i,a in enumerate(pages):
            for b in pages[i+1:]:
                shared=sorted(terms & set(re.findall(r"\w+",a["text"].casefold())) & set(re.findall(r"\w+",b["text"].casefold())))
                if shared:overlaps.append({"a":a["url"],"b":b["url"],"terms":shared})
        return {"queries":queries,"pages":[{**p,"text":p["text"][:4000]} for p in pages],"errors":errors,"overlaps":overlaps,"note":"Совпадение терминов не доказывает достоверность или независимость источников. Даты публикации извлечены из метаданных и не проверены."}
    def download(self,url):
        if not safe_link(url):raise ValueError("Нужен HTTPS URL")
        r=self.request(url,MAX_DOC);body=r["body"]
        extensions={"application/pdf":".pdf","text/plain":".txt","text/csv":".csv","application/json":".json"}
        ext=extensions.get(r["mime"])
        if not ext or ext==".pdf" and not body.startswith(b"%PDF-"):raise ValueError("Только PDF, TXT, CSV и JSON")
        title="web-"+uuid4().hex[:12]+ext
        result=self.workspace.upload(None,title,io.BytesIO(body),len(body))
        return {**result,"name":title,"url":r["url"],"size":len(body)}
    def watch(self,url):
        p=self.read(url,True)
        with closing(self.chat.connect()) as db,db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT COUNT(*) FROM web_watches").fetchone()[0]>=20:raise ValueError("Лимит 20 наблюдений")
            db.execute("INSERT INTO web_watches VALUES(?,?,?,?,?,?,1) ON CONFLICT(url) DO UPDATE SET enabled=1,hash=excluded.hash,next_check=excluded.next_check,status=excluded.status,checked=excluded.checked",(uuid4().hex,url,p["hash"],time.time()+3600,"baseline",stamp()))
        return {"status":"baseline","url":url}
    def watches(self):
        with closing(self.chat.connect()) as db:return [dict(r) for r in db.execute("SELECT * FROM web_watches ORDER BY checked DESC")]
    def disable(self,i):
        with closing(self.chat.connect()) as db,db:db.execute("UPDATE web_watches SET enabled=0 WHERE id=?",(i,))
        return {"ok":True}
    def tick(self):
        with self.lock,closing(self.chat.connect()) as db,db:
            row=db.execute("SELECT * FROM web_watches WHERE enabled=1 AND next_check<=? ORDER BY next_check LIMIT 1",(time.time(),)).fetchone()
            if not row:return
            db.execute("UPDATE web_watches SET next_check=? WHERE id=?",(time.time()+3600,row["id"]))
        try:
            p=self.read(row["url"],True);h=p["hash"];status="changed" if h!=row["hash"] else "unchanged"
        except ValueError:
            h=row["hash"];status="error"
        with closing(self.chat.connect()) as db,db:db.execute("UPDATE web_watches SET hash=?,status=?,checked=? WHERE id=? AND enabled=1",(h,status,stamp(),row["id"]))
    def start(self):
        if self.worker:return
        def loop():
            while not self.stop.wait(30):
                try:self.tick()
                except Exception:pass
        self.worker=threading.Thread(target=loop,daemon=True);self.worker.start()
    def dispatch(self,v):
        if not isinstance(v,dict) or v.get("confirm") is not True:raise ValueError("Нужно явное разрешение на интернет")
        action=v.get("action")
        if action in ("search","news","research") and set(v)=={"action","confirm","query"}:
            return self.research(v["query"]) if action=="research" else self.search(v["query"],action=="news")
        if action in ("read","download","watch") and set(v)=={"action","confirm","url"}:
            return {"read":self.read,"download":self.download,"watch":self.watch}[action](v["url"])
        if action=="watches" and set(v)=={"action","confirm"}:return {"items":self.watches()}
        if action=="disable" and set(v)=={"action","confirm","id"} and isinstance(v["id"],str):return self.disable(v["id"])
        raise ValueError("Неизвестная интернет-операция")
