"""Chat orchestration: bounded intent hints, exact consent, local tool results."""
import re
import math
from datetime import datetime, timezone
from contextlib import closing

def intent(q):
    q=q.strip()
    style="short" if re.search(r"\b(?:кратко|коротко|без подробностей)\b",q,re.I) else "deep" if re.search(r"\b(?:подробно|детально|обоснуй|исследуй|пошагово)\b",q,re.I) else "normal"
    m=re.fullmatch(r"(?:найди в интернете|поищи в сети|проверь в интернете|интернет-поиск|новости|исследуй в интернете)\s*[:—-]?\s+(.+)",q,re.I|re.S)
    web=None
    if m and len(m[1].strip())<=250:
        web={"query":m[1].strip(),"action":"news" if q.casefold().startswith("новости") else "research"}
    elif re.search(r"\b(?:сегодня|свежие новости|актуальные новости|последние новости|текущая цена)\b",q,re.I) and len(q)<=250 and "Документ #" not in q:
        web={"query":q,"action":"research"}
    return {"style":style,"web":web,"correction":bool(re.match(r"^(?:исправление|поправка)\s*:",q,re.I))}

def normalize_request(q):
    # Conservative courtesy and indirect phrasing, never convert arbitrary text to edits.
    return re.sub(r"^(?:(?:пожалуйста|будь добра|можешь|не могла бы ты|могла бы ты)\s*[, :]?\s+)+","",q,flags=re.I).strip()

def bounded_context(parts,limit):
    out=[];seen=set();length=0
    for p in parts:
        p=p.strip();key=" ".join(p.casefold().split())
        if not key or key in seen:continue
        if length+len(p)+1>limit:continue
        out.append(p);seen.add(key);length+=len(p)+1
    return "\n".join(out)

def web_evidence(data):
    pages=data.get("pages",[])
    items=data.get("items",[])
    if pages:
        return [{"title":p["title"][:200],"url":p["url"],"date":p.get("published",""),"excerpt":p["text"][:1200]} for p in pages[:3]]
    return [{"title":p["title"][:200],"url":p["url"],"date":p.get("published",""),"excerpt":"Заголовок поисковой выдачи, содержание не проверено."} for p in items[:5]]

def possible_conflicts(hits,pages):
    # Exact overlapping named field and different values only; never infer from topical similarity.
    def fields(s):
        result={}
        for line in s.splitlines():
            m=re.fullmatch(r"\s*([^:\n]{2,60}):\s*(.{1,120})",line)
            if m:result[m[1].strip().casefold()]=m[2].strip()
        return result
    notes=[]
    for hit in hits:
        if hit.get("source") not in ("work","file"):continue
        a=fields(hit.get("text",""))
        for p in pages:
            b=fields(p["excerpt"])
            for key in a.keys()&b.keys():
                if a[key].casefold()!=b[key].casefold():
                    notes.append(f"Возможное расхождение поля «{key}»: {hit['source']} #{hit['id']} и {p['url']}. Проверьте, что речь об одном объекте.")
                    if len(notes)>=3:return notes
    return notes

def verify_reply(reply,meta):
    # Structural check, not proof of factual accuracy.
    if not isinstance(reply,str) or not reply.strip() or len(reply)>100000:raise ValueError("Пустой или слишком большой ответ")
    warnings=[]
    allowed={x["url"].rstrip(".,;)") for x in meta.get("web_sources",[])}
    if allowed:
        unknown=[u for u in re.findall(r"https://[^\s<>\]]+",reply) if u.rstrip(".,;)") not in allowed]
        if unknown:warnings.append("Ответ содержит ссылки вне полученных интернет-источников; они не проверены.")
    return warnings
