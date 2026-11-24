"""Local sparse lexical vectors and explicit evidence links, never causal proof."""
from collections import Counter
import math
import re

def grams(word):
    word="^"+word+"$"
    return Counter(word[i:i+3] for i in range(len(word)-2))

def cosine(a,b):
    dot=sum(v*b.get(k,0) for k,v in a.items())
    norm=math.sqrt(sum(v*v for v in a.values())*sum(v*v for v in b.values()))
    return dot/norm if norm else 0

def rank(terms,words):
    # Only approximate variants of words returned by bounded candidate search.
    prefixes={t[:4] for t in terms if len(t)>=5 and t not in words}
    vectors={w:grams(w) for w in words if len(w)>=5 and w[:4] in prefixes}
    score=0;matched=[]
    for t in terms:
        if t in words:score+=1;matched.append(t);continue
        if len(t)<5:continue
        candidates=[v for w,v in vectors.items() if w[:4]==t[:4]]
        best=max((cosine(grams(t),v) for v in candidates),default=0)
        if best>=.45:score+=best*.65
    return score/max(1,len(terms)),matched

def evidence_links(hits):
    links=[]
    for i,a in enumerate(hits):
        for b in hits[i+1:]:
            if a["source"]==b["source"] and a["id"]==b["id"]:continue
            overlap=sorted(set(a.get("matched",[]))&set(b.get("matched",[])))
            if overlap:
                links.append({"from":f"{a['source']} #{a['id']}","to":f"{b['source']} #{b['id']}","terms":overlap,"type":"shared_terms"})
            if len(links)>=8:return links
    return links

def missing_terms(terms,hits):
    matched={t for h in hits for t in h.get("matched",[])}
    return [t for t in terms if t not in matched]
