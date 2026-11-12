# Patch pdfminer so glyphs are decoded from font glyph names / TeX encodings
import re
from io import BytesIO
from pdfminer import pdffont
from pdfminer.pdftypes import resolve1, stream_value
from pdfminer.psparser import PSLiteral, literal_name
from glyphs import name_to_unicode, family_of, TABLES, SYMBOL, fix_pua

_orig_init = pdffont.PDFSimpleFont.__init__


def _init(self, descriptor, widths, spec):
    _orig_init(self, descriptor, widths, spec)
    self._icd_spec = spec


pdffont.PDFSimpleFont.__init__ = _init


def _builtin_names_type1(font):
    ff = getattr(font, 'fontfile', None)
    if ff is None:
        return {}
    try:
        data = ff.get_data()[:int(resolve1(ff['Length1']))].decode('latin1')
    except Exception:
        return {}
    return {int(c): n for c, n in re.findall(r'dup\s+(\d+)\s*/(\S+)\s+put', data)}


def _builtin_names_cff(font):
    desc = getattr(font, 'descriptor', None) or {}
    try:
        ff = resolve1(desc.get('FontFile3'))
    except Exception:
        return {}
    if ff is None:
        return {}
    try:
        from fontTools.cffLib import CFFFontSet
        cff = CFFFontSet()
        cff.decompile(BytesIO(stream_value(ff).get_data()), None)
        top = cff[cff.fontNames[0]]
        enc = top.Encoding
        if isinstance(enc, list):
            return {i: n for i, n in enumerate(enc) if n and n != '.notdef'}
    except Exception:
        pass
    return {}


def font_names(font):
    if hasattr(font, '_icd_names'):
        return font._icd_names
    names = {}
    spec = getattr(font, '_icd_spec', {}) or {}
    enc = resolve1(spec.get('Encoding'))
    if isinstance(enc, dict):
        diffs = resolve1(enc.get('Differences')) or []
        code = 0
        for x in diffs:
            x = resolve1(x)
            if isinstance(x, int):
                code = x
            elif isinstance(x, PSLiteral):
                names[code] = literal_name(x)
                code += 1
    if not names and 'Encoding' not in spec:
        names = _builtin_names_type1(font) or _builtin_names_cff(font)
    font._icd_names = names
    font._icd_goodnames = any(name_to_unicode(n) for n in list(names.values())[:60])
    return names


def basename(font):
    b = getattr(font, 'basefont', None) or getattr(font, 'fontname', '') or ''
    return str(b).split('+')[-1]


# Elsevier 'Adv' maths fonts name glyphs C<n>, with n laid out as the TeX font of the same role
ADVFAM = [('AdvP4C4E74', 'OMS'), ('AdvMacMthSyN', 'OMS'), ('AdvP4C4E46', 'OMX'), ('AdvP4C4E51', 'OML'), ('AdvP4C4E59', 'OT1')]
ADVFIX = {('OMS', 14): '°'}   # ring operator used as a degree sign
# Private-use glyphs identified by eye in specific fonts
FONTPUA = [('Wingdings2', '\uf09d', '⊙'),    # SSP L8 notes: solar symbol
           ('ArevSans', '\uebec', 'ℓ')]      # TPSM 2024 exam: latent heat ℓ
# Elsevier Math-Pi fonts reuse Latin codes for Greek/symbols (identified from context)
ADVPI = {('AdvPSMP13', 108): 'μ', ('AdvPSMP10', 113): 'ρ', ('AdvPSMP10', 112): 'π', ('AdvPi1', 52): '∼'}
# ... and their equation fonts map =, (, ), + onto Latin-1 letters
ADVLAT = {'¼': '=', 'ð': '(', 'Þ': ')', 'þ': '+', 'À': '−'}

BAD = re.compile(r'[\x00-\x08\x0b-\x1f\x7f�]')


def decode(font, cid):
    u = _decode(font, cid)
    bn = basename(font)
    for pre, ch, rep_ in FONTPUA:
        if u == ch and bn.startswith(pre):
            return rep_
    if bn.startswith('AdvP'):
        k = (bn, cid)
        if k in ADVPI:
            return ADVPI[k]
        if not bn.startswith('AdvPS') and u in ADVLAT:
            return ADVLAT[u]
    return u


def _decode(font, cid):
    names = font_names(font)
    bn = basename(font)
    um = getattr(font, 'unicode_map', None)
    if isinstance(font, pdffont.PDFType3Font) and not um and not font._icd_goodnames:
        raise pdffont.PDFUnicodeNotDefined(None, cid)  # resolved later (t3guess)
    if names and cid in names:
        u = name_to_unicode(names[cid])
        if u is not None:
            return u
        m = re.fullmatch(r'C(\d+)', names[cid])
        if m and bn.startswith('Adv'):
            n = int(m.group(1))
            fam = next((f for p, f in ADVFAM if p in bn), None)
            if fam:
                u = ADVFIX.get((fam, n)) or TABLES[fam].get(n)
                if u is not None:
                    return u
            if n >= 160:
                return SYMBOL.get(n) if 'Sym' in bn and n in SYMBOL else chr(n)
    fam = family_of(bn)
    if fam and not font._icd_goodnames and not um:
        u = TABLES[fam].get(cid)
        if u is not None:
            return u
    if um:
        try:
            u = fix_pua(um.get_unichr(cid))
            if u and not BAD.search(u):
                return u
        except KeyError:
            pass
    if fam:
        u = TABLES[fam].get(cid)
        if u is not None:
            return u
    if 'symbol' in bn.lower() and cid in SYMBOL:
        return SYMBOL[cid]
    try:
        u = fix_pua(font.cid2unicode[cid])
        if u and not BAD.search(u):
            return u
    except (KeyError, AttributeError):
        pass
    raise pdffont.PDFUnicodeNotDefined(None, cid)


pdffont.PDFSimpleFont.to_unichr = decode
_orig_cid = pdffont.PDFCIDFont.to_unichr


def _cid_to_unichr(self, cid):
    u = _orig_cid(self, cid)
    bn = basename(self)
    for pre, ch, rep_ in FONTPUA:
        if u == ch and bn.startswith(pre):
            return rep_
    u = fix_pua(u)
    if BAD.search(u):
        raise pdffont.PDFUnicodeNotDefined(None, cid)
    return u


pdffont.PDFCIDFont.to_unichr = _cid_to_unichr
