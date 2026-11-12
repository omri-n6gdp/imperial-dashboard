# ocr.py OUTDIR maxsec file.pdf ... : OCR scanned PDFs page by page with tesseract (resumable)
import os, sys, subprocess, time, tempfile
out, limit, files = sys.argv[1], float(sys.argv[2]), sys.argv[3:]
t0 = time.time()
for f in files:
    n = int(subprocess.run(['pdfinfo', f], capture_output=True, text=True).stdout.split('Pages:')[1].split()[0])
    d = os.path.join(out, os.path.basename(f) + '.pages'); os.makedirs(d, exist_ok=True)
    for p in range(1, n + 1):
        dst = os.path.join(d, '%04d.txt' % p)
        if os.path.exists(dst): continue
        if time.time() - t0 > limit: print('TIMEUP'); sys.exit(0)
        with tempfile.TemporaryDirectory() as td:
            subprocess.run(['pdftoppm', '-f', str(p), '-l', str(p), '-r', '300', '-gray', '-png', f, td + '/p'], check=True)
            png = [x for x in os.listdir(td) if x.endswith('.png')][0]
            txt = subprocess.run(['tesseract', os.path.join(td, png), '-', '--psm', '1'], capture_output=True, text=True).stdout
        open(dst, 'w').write(txt)
    pages = [open(os.path.join(d, '%04d.txt' % p)).read().rstrip() for p in range(1, n + 1)]
    open(os.path.join(out, os.path.basename(f)[:-4] + '.txt'), 'w').write('\n\f'.join(pages) + '\n')
    print('done', os.path.basename(f), n)
