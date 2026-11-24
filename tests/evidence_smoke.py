import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from evidence import rank,evidence_links,missing_terms
score,matched=rank(["автомобили"],{"автомобиля"})
assert 0<score<1 and not matched
score,matched=rank(["топливо"],{"топливо","масло"})
assert score==1 and matched==["топливо"]
assert rank(["несуществующее"],{"машина"})[0]==0
hits=[{"source":"work","id":1,"matched":["топливо"]},{"source":"file","id":2,"matched":["топливо"]}]
assert evidence_links(hits)[0]["type"]=="shared_terms"
assert missing_terms(["топливо","пробег"],hits)==["пробег"]
print("Sparse lexical vector ranking, evidence intersections and missing terms passed")
