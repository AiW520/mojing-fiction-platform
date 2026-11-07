"""Check built links, fragments, SVG XML, source evidence hashes and sensitive patterns."""
import json, os, re, sys, hashlib, posixpath
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import xml.etree.ElementTree as ET
BASE=Path(__file__).resolve().parents[1];DIST=BASE/'dist'
prefix=os.environ.get('SITE_BASE','/mojing-fiction-platform').rstrip('/')
class Page(HTMLParser):
 def __init__(self):super().__init__();self.refs=[];self.ids=set()
 def handle_starttag(self,tag,attrs):
  d=dict(attrs)
  if 'id' in d:self.ids.add(d['id'])
  for key in ('href','src'):
   if d.get(key):self.refs.append(d[key])
pages={};errors=[];checks=0
for p in DIST.rglob('*.html'):
 page=Page();page.feed(p.read_text(encoding='utf-8'));pages[p.relative_to(DIST).as_posix()]=page
for name,page in pages.items():
 urlpath=prefix+'/'+(name[:-10] if name.endswith('index.html') else name)
 for ref in page.refs:
  u=urlsplit(ref)
  if u.scheme or u.netloc or ref.startswith('data:'):continue
  dest=unquote(u.path)
  resolved=posixpath.normpath(dest if dest.startswith('/') else posixpath.join(posixpath.dirname(urlpath) if not urlpath.endswith('/') else urlpath,dest)) if dest else urlpath
  if prefix and not (resolved==prefix or resolved.startswith(prefix+'/')):
   errors.append(f'base escape {name}: {ref}');continue
  rel=resolved[len(prefix):].lstrip('/')
  p=DIST/rel
  if p.is_dir():p=p/'index.html'
  if not p.exists():errors.append(f'missing {name}: {ref}');continue
  checks+=1
  if u.fragment and p.suffix=='.html':
   target=pages.get(p.relative_to(DIST).as_posix())
   if target and unquote(u.fragment) not in target.ids:errors.append(f'fragment {name}: {ref}')
for p in (DIST/'diagrams').glob('*.svg'):
 ET.parse(p)
 if re.search(r'<script|onload=|javascript:',p.read_text(encoding='utf-8'),re.I):errors.append('unsafe SVG '+p.name)
patterns=[r'[A-Za-z]:[\\/](?:Users|工作|微信|OpenFox|作品|图片)',r'-----BEGIN [A-Z ]*PRIVATE KEY',r'gh[pousr]_[A-Za-z0-9]{20,}',r'(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{24,}']
for p in DIST.rglob('*'):
 if p.is_file() and p.suffix in {'.html','.js','.json','.txt','.svg'}:
  text=p.read_text(encoding='utf-8',errors='replace')
  for pattern in patterns:
   if re.search(pattern,text):errors.append('sensitive-pattern '+p.relative_to(DIST).as_posix());break
source_checks=0;source_drift=[]
if '--built-only' not in sys.argv:
 sources={x['id']:x for x in json.loads((BASE/'audit/sources.private.json').read_text(encoding='utf-8'))}
 for e in json.loads((BASE/'src/data/evidence.json').read_text(encoding='utf-8')):
  p=Path(sources[e['project']]['root'],e['path'])
  frozen=BASE/'audit/evidence-sources.private'/e['project']/e['sha256']
  raw=frozen.read_bytes() if frozen.exists() else p.read_bytes();lines=raw.decode('utf-8-sig').splitlines()
  if hashlib.sha256(raw).hexdigest()!=e['sha256']:errors.append('snapshot mismatch '+e['id'])
  if not p.exists() or hashlib.sha256(p.read_bytes()).hexdigest()!=e['sha256']:source_drift.append(e['id'])
  if hashlib.sha256('\n'.join(lines[e['start']-1:e['end']]).encode()).hexdigest()!=e['excerptSha256']:errors.append('excerpt mismatch '+e['id'])
  source_checks+=1
if not pages:errors.append('No built HTML pages')
result={'htmlPages':len(pages),'localLinksAndAssets':checks,'sourceEvidenceChecked':source_checks,'sourceDriftSinceEvidenceCapture':source_drift,'errors':errors,'status':'passed' if not errors else 'failed'}
(BASE/'audit').mkdir(exist_ok=True)
(BASE/'audit/verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2));sys.exit(bool(errors))
