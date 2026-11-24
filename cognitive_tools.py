"""Bounded analytical and symbolic reasoning tools. No eval, no external actions."""
import io
import re
import math
import time
import statistics as stats
from collections import Counter
from contextlib import closing
from datetime import date,datetime,timezone
from pathlib import Path
from uuid import uuid4
from work_import import sheet_rows
from report_export import docx

def string(v,n=500):
    if not isinstance(v,str) or not v.strip() or len(v)>n:raise ValueError("Некорректный текст")
    return v.strip()
def number(v):
    if type(v) not in (float,int) or not math.isfinite(v) or abs(v)>1e12:raise ValueError("Некорректное число")
    return float(v)

def analyze(values):
    if not isinstance(values,list) or not 2<=len(values)<=500:raise ValueError("Нужно 2–500 чисел")
    xs=[number(v) for v in values];n=len(xs);mean=stats.mean(xs)
    xmean=(n-1)/2
    slope=sum((i-xmean)*(y-mean) for i,y in enumerate(xs))/sum((i-xmean)**2 for i in range(n))
    low,high=min(xs),max(xs)
    return {"count":n,"sum":sum(xs),"mean":mean,"median":stats.median(xs),"min":low,"max":high,"stdev":stats.stdev(xs),"slope_per_observation":slope,"next_linear_estimate":mean+slope*(n-xmean),"values":xs,"note":"Линейная оценка по порядку наблюдений; не гарантия прогноза и не причинный вывод."}

def triple(v):
    if not isinstance(v,list) or len(v)!=3:raise ValueError("Факт: [субъект, свойство, значение]")
    return tuple(string(x,250).casefold() for x in v)

def deduce(facts,rules):
    if not isinstance(facts,list) or len(facts)>100 or not isinstance(rules,list) or len(rules)>50:raise ValueError("Лимит фактов/правил")
    initial={triple(x) for x in facts};known=set(initial);proof=[]
    parsed=[]
    for r in rules:
        if not isinstance(r,dict) or set(r)!={"if","then"} or not isinstance(r["if"],list) or not 1<=len(r["if"])<=8:raise ValueError("Некорректное правило")
        parsed.append((set(triple(x) for x in r["if"]),triple(r["then"])))
    for _ in range(51):
        changed=False
        for i,(conditions,target) in enumerate(parsed):
            if conditions<=known and target not in known:
                known.add(target);proof.append({"rule":i+1,"premises":sorted(conditions),"conclusion":target});changed=True
        if not changed:break
    groups={}
    for s,p,v in known:groups.setdefault((s,p),set()).add(v)
    conflicts=[{"subject":s,"predicate":p,"values":sorted(v)} for (s,p),v in groups.items() if len(v)>1]
    return {"conclusions":sorted(known-initial),"proof":proof,"conflicts":conflicts,"untriggered_rules":[i+1 for i,(conditions,_) in enumerate(parsed) if not conditions<=known],"valid":not conflicts,"note":"Вывод следует только из введённых правил; исходные факты и правила требуют проверки. Разные значения отмечены как возможный конфликт, включая многозначные свойства."}

def decisions(options):
    if not isinstance(options,list) or not 2<=len(options)<=10:raise ValueError("Выберите 2–10 вариантов")
    results=[]
    for option in options:
        if not isinstance(option,dict) or set(option)!={"name","outcomes"} or not isinstance(option["outcomes"],list) or not 1<=len(option["outcomes"])<=20:raise ValueError("Некорректный вариант")
        name=string(option["name"],100);values=[]
        for out in option["outcomes"]:
            if not isinstance(out,dict) or set(out)!={"probability","value"}:raise ValueError("Нужны вероятность и результат")
            p,x=number(out["probability"]),number(out["value"])
            if not 0<=p<=1:raise ValueError("Вероятность 0–1")
            values.append((p,x))
        if abs(sum(p for p,x in values)-1)>1e-8:raise ValueError("Сумма вероятностей должна быть 1")
        expected=sum(p*x for p,x in values)
        results.append({"name":name,"expected":expected,"worst":min(x for p,x in values if p>0),"best":max(x for p,x in values if p>0),"loss_probability":sum(p for p,x in values if x<0),"outcomes":[{"probability":p,"value":x} for p,x in values]})
    results.sort(key=lambda r:r["expected"],reverse=True)
    return {"options":results,"note":"Оценка зависит от введённых вероятностей и значений; не автоматическое решение."}

class CognitiveTools:
    def __init__(self,workspace,knowledge,agent,extract):
        self.workspace,self.knowledge,self.agent,self.extract=workspace,knowledge,agent,extract
    def table(self,i):
        if type(i) is not int:raise ValueError("ID файла")
        path,title,_=self.workspace.download(i);rows=sheet_rows(path,title)
        if not rows or len(rows[0])>30:raise ValueError("Пустая или слишком широкая таблица")
        header=[x.strip() for x in rows[0]]
        if any(not x for x in header) or len(set(header))!=len(header):raise ValueError("Неоднозначные заголовки")
        if any(len(row)>len(header) for row in rows[1:]):raise ValueError("Лишние столбцы")
        return header,[dict(zip(header,row+[""]*(len(header)-len(row)))) for row in rows[1:]]
    def compare(self,a,b,key):
        key=string(key,250);ha,ra=self.table(a);hb,rb=self.table(b)
        if key not in ha or key not in hb:raise ValueError("Ключ отсутствует в таблице")
        def index(rows):
            by={};dups=set()
            for r in rows:
                k=r[key].strip()
                if not k or k in by:dups.add(k)
                by[k]=r
            return by,sorted(dups)
        x,dx=index(ra);y,dy=index(rb)
        if dx or dy:return {"valid":False,"duplicates_a":dx[:50],"duplicates_b":dy[:50],"note":"Сначала устраните пустые и повторяющиеся ключи"}
        added=sorted(y.keys()-x.keys());removed=sorted(x.keys()-y.keys());changed=[]
        for k in sorted(x.keys()&y.keys()):
            changes=[{"column":c,"before":x[k].get(c),"after":y[k].get(c)} for c in sorted(set(ha)|set(hb)) if x[k].get(c)!=y[k].get(c)]
            if changes:changed.append({"key":k,"changes":changes})
        return {"valid":True,"added_count":len(added),"removed_count":len(removed),"changed_count":len(changed),"added":added[:100],"removed":removed[:100],"changed":changed[:50],"columns_a":ha,"columns_b":hb}
    def document(self,i):
        if type(i) is not int:raise ValueError("ID файла")
        path,title,size=self.workspace.download(i)
        if size>256*1024:raise ValueError("Лимит документа 256 КиБ")
        body=self.extract(path,title)
        if not body:raise ValueError("Текст не извлечён")
        lines=body.splitlines();candidates=[];headings=[]
        for n,line in enumerate(lines,1):
            if re.match(r"^#{1,6}\s+",line):headings.append({"line":n,"text":line[:200]})
            m=re.fullmatch(r"\s*([^:\n]{2,80}):\s*(.{1,300})",line)
            if m:candidates.append({"line":n,"subject":m[1].strip(),"value":m[2].strip(),"state":"candidate"})
        counts=Counter(" ".join(x.casefold().split()) for x in lines if len(x.strip())>=10)
        return {"file":i,"title":title,"characters":len(body),"words":len(re.findall(r"\w+",body)),"lines":len(lines),"headings":headings[:50],"candidate_facts":candidates[:50],"repeated_lines":[{"text":x[:200],"count":n} for x,n in counts.items() if n>1][:50],"note":"Кандидаты извлечены из строк «поле: значение»; не подтверждённые факты."}
    def hypothesis(self,i):
        i=string(i,64)
        with closing(self.knowledge.chat.connect()) as db:
            h=db.execute("SELECT * FROM knowledge_items WHERE id=? AND state!='rejected'",(i,)).fetchone()
            if not h:raise ValueError("Гипотеза не найдена")
            rows=db.execute("""SELECT l.kind,l.strength,l.a,l.b,k.id,k.subject,k.predicate,k.value,k.state,k.expires,k.confidence
                FROM knowledge_links l JOIN knowledge_items k ON k.id=CASE WHEN l.a=? THEN l.b ELSE l.a END
                WHERE l.a=? OR l.b=? LIMIT 100""",(i,i,i)).fetchall()
        support=[];contradict=[];other=[]
        for r in rows:
            item=dict(r);item["usable"]=r["state"]=="confirmed" and (not r["expires"] or r["expires"]>=date.today().isoformat())
            (support if r["kind"]=="supports" and r["b"]==i else contradict if r["kind"]=="contradicts" else other).append(item)
        s=sum(x["usable"] for x in support);c=sum(x["usable"] for x in contradict)
        return {"hypothesis":dict(h),"support":support,"contradiction":contradict,"other":other,"confirmed_support":s,"confirmed_contradiction":c,"assessment":"есть конфликт" if c else "есть поддержка" if s else "недостаточно подтверждённых доказательств","note":"Связи заданы пользователем. Наличие поддержки не доказывает причинность; не исключены общие причины и альтернативы."}
    def transfer(self,query):
        q=string(query,250).casefold();words=set(re.findall(r"\w{2,}",q))
        with closing(self.knowledge.chat.connect()) as db:
            rows=db.execute("SELECT id,name,steps,created FROM agent_scenarios ORDER BY created DESC LIMIT 100").fetchall()
        matches=[]
        for r in rows:
            terms=set(re.findall(r"\w{2,}",r["name"].casefold()+" "+r["steps"].casefold()))
            score=len(words&terms)
            if score:matches.append({"id":r["id"],"name":r["name"],"score":score,"created":r["created"]})
        return {"scenarios":sorted(matches,key=lambda x:x["score"],reverse=True)[:10],"note":"Сходство названия и шагов; повтор запускается только явно."}
    def performance(self):
        with closing(self.knowledge.chat.connect()) as db:
            rows=db.execute("SELECT tool,status,COUNT(*) n,AVG(duration_ms) avg_ms,MAX(duration_ms) max_ms FROM agent_runs GROUP BY tool,status ORDER BY tool,status").fetchall()
        return {"metrics":[dict(r) for r in rows],"note":"По сохранённому журналу до 2000 записей, не полный исторический мониторинг."}
    def draft(self,title,body):
        title=string(title,150);body=string(body,4000)
        data=docx({"title":"ЧЕРНОВИК — "+title,"month":"","summary":["Текст предоставлен пользователем; требуется проверка",*body.splitlines()[:100]],"columns":["Статус"],"rows":[["Не утверждено"]],"total_rows":1,"generated":datetime.now(timezone.utc).isoformat()})
        name="draft-"+uuid4().hex[:12]+".docx";r=self.workspace.upload(None,name,io.BytesIO(data),len(data))
        return {**r,"name":name,"status":"draft"}
    def dispatch(self,v):
        if not isinstance(v,dict):raise ValueError("Некорректная операция")
        a=v.get("action");begin=time.monotonic()
        try:
            if a=="stats" and set(v)=={"action","values"}:r=analyze(v["values"])
            elif a=="column" and set(v)=={"action","file","column"}:
                header,rows=self.table(v["file"]);column=string(v["column"],250)
                if column not in header:raise ValueError("Столбец отсутствует")
                try:values=[float(x[column].replace(",",".")) for x in rows]
                except ValueError:raise ValueError("Нечисловые ячейки; очистите столбец") from None
                r=analyze(values)
            elif a=="compare" and set(v)=={"action","a","b","key"}:r=self.compare(v["a"],v["b"],v["key"])
            elif a=="document" and set(v)=={"action","file"}:r=self.document(v["file"])
            elif a=="deduce" and set(v)=={"action","facts","rules"}:r=deduce(v["facts"],v["rules"])
            elif a=="decisions" and set(v)=={"action","options"}:r=decisions(v["options"])
            elif a=="hypothesis" and set(v)=={"action","id"}:r=self.hypothesis(v["id"])
            elif a=="transfer" and set(v)=={"action","query"}:r=self.transfer(v["query"])
            elif a=="performance" and set(v)=={"action"}:r=self.performance()
            elif a=="draft" and set(v)=={"action","title","body","confirm"} and v["confirm"] is True:r=self.draft(v["title"],v["body"])
            else:raise ValueError("Инструмент или параметры не разрешены")
            self.agent.log("cognitive:"+a,"ok",begin,"Структура проверена")
            return r
        except (ValueError,RuntimeError,OSError) as e:
            self.agent.log("cognitive:"+str(a)[:40],"error",begin,type(e).__name__)
            raise
