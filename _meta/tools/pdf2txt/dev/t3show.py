# Print Type3 glyph bitmaps as ASCII art: t3show.py file.pdf [maxglyphs]
import sys, re, zlib
from pdfminer.pdfparser import PDFParser
from pdfminer.pdfdocument import PDFDocument
from pdfminer.pdfpage import PDFPage
from pdfminer.pdftypes import resolve1
doc = PDFDocument(PDFParser(open(sys.argv[1], 'rb')))
seen = set()
for page in PDFPage.create_pages(doc):
    fd = resolve1(resolve1(page.resources).get('Font', {})) or {}
    for k, v in fd.items():
        v = resolve1(v)
        if str(v.get('Subtype')) != "/'Type3'": continue
        key = str(v.get('FontMatrix')) + str(v.get('Widths'))[:200]
        if key in seen: continue
        seen.add(key)
        enc = resolve1(v.get('Encoding')); diffs = resolve1(enc.get('Differences')) if isinstance(enc, dict) else []
        code = 0; names = {}
        for x in diffs:
            x = resolve1(x)
            if isinstance(x, int): code = x
            else: names[x.name] = code; code += 1
        for nm, cp in resolve1(v['CharProcs']).items():
            data = resolve1(cp).get_data()
            m = re.search(rb'BI(.*?)ID\s(.*)EI', data, re.S)
            if not m: print(k, nm, 'no inline image', data[:80]); continue
            hdr = m.group(1).decode('latin1'); img = m.group(2)
            W = int(re.search(r'/(?:W|Width)\s+(\d+)', hdr).group(1)); H = int(re.search(r'/(?:H|Height)\s+(\d+)', hdr).group(1))
            if '/Fl' in hdr or 'FlateDecode' in hdr:
                try: img = zlib.decompress(img)
                except Exception: pass
            rowb = (W + 7) // 8
            print('font', k, 'glyph', nm, 'code', names.get(nm), W, 'x', H, hdr.strip()[:60])
            for r in range(0, H, max(1, H // 24)):
                row = img[r*rowb:(r+1)*rowb]
                bits = ''.join(f'{b:08b}' for b in row)[:W]
                print('   ' + bits[::max(1, W // 40)].replace('1', '#').replace('0', '.'))
