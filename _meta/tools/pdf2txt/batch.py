# batch.py OUTDIR [max_seconds] : convert every PDF under the dashboard into OUTDIR/<relpath>.txt (skips done ones)
import os, sys, time, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdf2txt
root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
out = sys.argv[1]; limit = float(sys.argv[2]) if len(sys.argv) > 2 else 160
t0 = time.time(); done = 0
pdfs = []
for d, _, fs in os.walk(root):
    if '/_meta/' in d + '/': continue
    for f in fs:
        if f.lower().endswith('.pdf'): pdfs.append(os.path.join(d, f))
pdfs.sort(key=os.path.getsize)
for p in pdfs:
    rel = os.path.relpath(p, root)
    dst = os.path.join(out, rel[:-4] + '.txt')
    if os.path.exists(dst) or os.path.exists(dst + '.err'): continue
    if time.time() - t0 > limit: break
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    ts = time.time()
    try:
        txt = pdf2txt.convert_file(p)
        open(dst, 'w', encoding='utf-8').write(txt)
    except Exception:
        open(dst + '.err', 'w').write(traceback.format_exc())
    done += 1
    print('%6.1fs %s' % (time.time() - ts, rel), flush=True)
left = sum(1 for p in pdfs if not os.path.exists(os.path.join(out, os.path.relpath(p, root)[:-4] + '.txt')) and not os.path.exists(os.path.join(out, os.path.relpath(p, root)[:-4] + '.txt.err')))
print('done', done, 'remaining', left)
