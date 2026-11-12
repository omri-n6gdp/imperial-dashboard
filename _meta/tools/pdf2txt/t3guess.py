# Guess the TeX encoding of unnamed Type 3 (bitmap) fonts from the codes they use.
import collections
import hashlib
from pdfminer.pdftypes import resolve1
from glyphs import TABLES

COMMON = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ()[]+=<>.,/')
GREEK = set('αβγδϵεζηθικλμνξπρστυϕφχψωϑϖϱς')
GOOD = set('∞∂∇√∫∑≈≤≥±→←⊙′∝∼≡·•')


def score(ch, fam):
    if ch in '−×':
        return 1.2
    if ch.isdigit():
        return 1.0 if fam == 'OT1' else -0.5
    if ch in COMMON or ch in GREEK:
        return 1.0
    if ch in 'ΓΔΘΛΞΠΣΥΦΨΩ':
        return 0.5
    if ch in ('ff', 'fi', 'fl', 'ffi', 'ffl'):
        return 0.6
    if ch in GOOD:
        return 0.5
    return -1.0


# Glyphs identified by eye (bitmap md5 -> character), see t3show.py
OVERRIDES = {
    '362bcbc9b71bb86bb733c9572594ff91': '∫', '28451145f077296a6b8835fce6a6d4a2': '∫',   # SSP notes integrals
    '1230ee4b1d21e23a6d5daa3c3dcd0445': '♂', 'b4d3dd695ce47fd4d8758bd8b64f9e18': '☿',   # SSP PS2: Mars, Mercury
    '0266641f7c1ca049e145d1b8cf742c56': '♇',                                             # SSP PS2: Pluto
}


def glyph_hash(font, cid):
    import fontfix
    spec = getattr(font, '_icd_spec', {}) or {}
    nm = fontfix.font_names(font).get(cid)
    cps = resolve1(spec.get('CharProcs')) or {}
    if nm and nm in cps:
        return hashlib.md5(resolve1(cps[nm]).get_data()).hexdigest()
    return None


def guess(t3, fonts=None):
    out = {}
    for k, cids in t3.items():
        cnt = collections.Counter(cids)
        ov = {}
        for c in cnt:
            h = (fonts or {}).get((k, c))
            if h in OVERRIDES:
                ov[c] = OVERRIDES[h]
        if len(ov) == len(cnt):
            out[k] = ov
            continue
        best = None
        for fam in ('OT1', 'OML', 'OMS'):
            sc = sum(n * score(TABLES[fam].get(c, '?'), fam) for c, n in cnt.items())
            if best is None or sc > best[0]:
                best = (sc, fam)
        out[k] = {c: TABLES[best[1]].get(c, '�') for c in cnt}
        out[k].update(ov)
    return out
