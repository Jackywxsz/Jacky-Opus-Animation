"""Create a silent timing fixture from the public built-in demo text; no API calls."""
from pathlib import Path
import json,re
root=Path(__file__).resolve().parents[1]
out=root/'projects/demo/voice/words.json'
if out.exists():
    raise SystemExit('Demo already exists; refusing to overwrite: projects/demo/voice/words.json')
source=(root/'src/scenes/demo.ts').read_text()
lines=re.findall(r'\{ zh: "([^"]+)"',source)
assert len(lines)==6,'Expected six demo narration lines'
words=[];sentences=[];t=0.8
for text in lines:
    start=t;first=len(words)
    for c in text:
        words.append({'w':c,'s':round(t,3),'e':round(t+.2,3)});t+=.2
    sentences.append({'text':text,'start':round(start,3),'end':round(t,3),'from':first,'to':len(words)})
    t+=.4
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps({'end':round(t+1,3),'words':words,'sentences':sentences},ensure_ascii=False,indent=2))
print('Created projects/demo/voice/words.json (synthetic timing; no speech audio)')
