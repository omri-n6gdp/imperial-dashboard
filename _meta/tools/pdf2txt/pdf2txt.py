#!/usr/bin/env python3
"""Font-aware, maths-aware PDF -> text.

Usage: pdf2txt.py in.pdf [out.txt|-] [pages,comma,separated]

Decodes glyphs from the fonts themselves (glyph names, TeX encodings, Symbol/Apple PUA),
re-attaches super/subscripts (x^2, k_B), linearises fractions (a/b) and radicals (√x),
joins accents (x̂), and keeps the page layout. Pages are separated by form feeds.
"""
import sys
import re
import logging
import statistics
logging.disable(logging.WARNING)
import fontfix as _ff  # noqa: patches pdfminer
from glyphs import family_of
from pdfminer.pdfinterp import PDFResourceManager, PDFPageInterpreter
from pdfminer.converter import PDFPageAggregator
from pdfminer.layout import LTChar, LTRect, LTLine, LTCurve, LTFigure, LTImage
from pdfminer.pdfpage import PDFPage
from pdfminer.pdffont import PDFType3Font
import t3guess


class Agg(PDFPageAggregator):
    def render_char(self, matrix, font, fontsize, scaling, rise, cid, ncs, graphicstate):
        adv = super().render_char(matrix, font, fontsize, scaling, rise, cid, ncs, graphicstate)
        it = self.cur_item._objs[-1]
        it.cid = cid
        it.font = font
        it.fs = fontsize
        return adv


class C:
    __slots__ = ('t', 'x0', 'x1', 'b', 's', 'top', 'bot', 'font', 'cid', 'tok', 'big', 'sp')

    def __init__(self, t, x0, x1, b, s, top=None, bot=None, font=None, cid=None, tok=False, big=False):
        self.t, self.x0, self.x1, self.b, self.s = t, x0, x1, b, s
        self.top = top if top is not None else b + 0.72 * s
        self.bot = bot if bot is not None else b - 0.22 * s
        self.font, self.cid, self.tok, self.big = font, cid, tok, big
        self.sp = False

    @property
    def xc(self):
        return (self.x0 + self.x1) / 2


ACCENTS = {'ˆ': '̂', '^': '̂', '˜': '̃', '~': '̃', '˙': '̇', '¨': '̈', '¯': '̄',
           '´': '́', '`': '̀', 'ˇ': '̌', '˘': '̆', '⃗': '⃗', '˚': '̊', '→': '⃗'}
RADS = set('√⎷')
BIGOPS = set('∑∏∫∮⋃⋂∐')
PICFONT = re.compile(r'^(LINE|LINEW|LCIRCLE|LCIRCLEW|LCIRCLE1)\d*$')
DELIMS = set('()[]{}|‖⟨⟩⌊⌋⌈⌉/\\⎛⎜⎝⎞⎟⎠⎡⎢⎣⎤⎥⎦⎧⎨⎩⎪⎫⎬⎭⏐')


def big_height(font, cid):
    """Height (in em) of TeX big delimiters/operators, which hang below their baseline."""
    if font is None or cid is None:
        return 0
    nm = _ff.font_names(font).get(cid, '').split('.')[0]
    if nm == 'radical':
        return 1.0
    if nm:
        for suf, h in (('Bigg', 3.0), ('bigg', 2.4), ('Big', 1.8), ('big', 1.2)):
            if nm.endswith(suf):
                return h
        if nm.endswith('display') or nm.endswith('display2'):
            return 2.2 if 'integral' in nm else 1.4
        if nm.endswith('text') or nm.endswith('text2'):
            return 1.1 if 'integral' in nm else 1.0
        return 0
    fam = family_of(_ff.basename(font))
    if fam == 'OMS' and cid == 112:
        return 1.0
    if fam == 'OMX':
        if cid <= 15:
            return 1.2
        if cid <= 17:
            return 1.8
        if cid <= 31:
            return 2.4
        if cid <= 47:
            return 3.0
        if 72 <= cid <= 95:
            if cid == 82:
                return 1.1
            if cid == 90:
                return 2.2
            return 1.0 if (cid - 72) % 16 < 8 else 1.4
    return 0


def collect(obj, chars, hrules, vrules, rot, st=None):
    if st is None:
        st = {'space': None}
    for o in obj:
        if isinstance(o, LTChar):
            m = o.matrix
            fs = getattr(o, 'fs', o.size) or o.size
            if abs(m[1]) > 0.1 * abs(m[0]) or m[0] <= 0 or m[3] <= 0:
                rot.append(o)
                continue
            s = fs * abs(m[3])
            t = o.get_text()
            if s <= 0.5:
                continue
            if not t.strip():
                st['space'] = (o.x0, m[5], s)
                continue
            fnt = getattr(o, 'font', None)
            if fnt is not None and PICFONT.match(_ff.basename(fnt)):
                continue
            b = m[5]
            tp = min(o.y1, b + 1.05 * s) if o.y1 - b < 3 * s else b + 0.75 * s
            bt = max(o.y0, b - 0.35 * s) if b - o.y0 < 3 * s else b - 0.25 * s
            if tp < bt:
                tp, bt = bt, tp
            H = big_height(getattr(o, 'font', None), getattr(o, 'cid', None))
            if H:
                tp = b + 0.04 * s
                bt = tp - H * s
                b = (tp + bt) / 2 - 0.25 * s
            ch = C(t, o.x0, o.x1, b, s, tp, bt, getattr(o, 'font', None), getattr(o, 'cid', None), big=bool(H))
            sp = st['space']
            if sp is not None and abs(sp[1] - m[5]) < 0.3 * s and o.x0 > sp[0] - 0.5:
                ch.sp = True
            st['space'] = None
            chars.append(ch)
        elif isinstance(o, (LTRect, LTLine, LTCurve)):
            w, h = o.x1 - o.x0, o.y1 - o.y0
            if h <= 1.6 and w >= 2.5 and w > 3 * h:
                hrules.append((o.x0, o.x1, (o.y0 + o.y1) / 2))
            elif w <= 1.6 and h >= 2.5:
                vrules.append(((o.x0 + o.x1) / 2, o.y0, o.y1))
        elif isinstance(o, LTImage):
            w, h = o.x1 - o.x0, o.y1 - o.y0
            if h <= 1.6 and w >= 2.5 and w > 3 * h:   # rules drawn as 1-px-high images
                hrules.append((o.x0, o.x1, (o.y0 + o.y1) / 2))
        elif isinstance(o, LTFigure):
            collect(o, chars, hrules, vrules, rot, st)


def dedupe(chars):
    seen = set()
    out = []
    for c in chars:
        k = (c.t, round(c.x0 * 2), round(c.b * 2))
        if k in seen:
            continue
        seen.add(k)
        out.append(c)
    return out


def attach_accents(chars):
    accs = [c for c in chars if c.t in ACCENTS]
    if not accs:
        return chars
    rm = set()
    for a in accs:
        best, bo = None, 0
        aw = max(a.x1 - a.x0, 0.1)
        for c in chars:
            if c is a or id(c) in rm or c.t in ACCENTS or c.t.isspace():
                continue
            if not (a.b - 1.0 * c.s <= c.b <= a.b + 0.1 * c.s):
                continue
            if a.t in ('^', '~', '→') and a.b - c.b < 0.3 * c.s:
                continue
            ov = min(a.x1, c.x1) - max(a.x0, c.x0)
            if ov > bo:
                best, bo = c, ov
        if best is not None and bo >= 0.45 * min(aw, best.x1 - best.x0 + 0.01):
            if a.t in ('^', '~', '→') and abs(a.xc - best.xc) > 0.6 * (best.x1 - best.x0):
                continue
            best.t = best.t + ACCENTS[a.t]
            best.top = max(best.top, a.top)
            rm.add(id(a))
    return [c for c in chars if id(c) not in rm]


def gap_offset(items):
    """Typical gap between adjacent letters in a line; negative when a PDF's glyph boxes overlap."""
    gs = [b.x0 - a.x1 for a, b in zip(items, items[1:])
          if not a.tok and not b.tok and len(a.t) == 1 and len(b.t) == 1 and a.t.isalpha() and b.t.isalpha()
          and abs(a.b - b.b) < 0.1 * a.s]
    if len(gs) < 6:
        return 0.0
    gs.sort()
    o = gs[len(gs) // 3]
    return o if o < -0.06 * statistics.median([c.s for c in items]) else 0.0


def simple_join(items):
    items = sorted(items, key=lambda c: c.x0)
    off = gap_offset(items)
    out = ''
    prev = None
    for c in items:
        if prev is not None:
            gap = c.x0 - prev.x1 - off
            if (gap > 0.15 * min(c.s, prev.s) or (c.sp and gap > -0.3 * c.s)) and not out.endswith(' '):
                out += ' '
        out += c.t
        prev = c
    return out


def cluster_rows(chars):
    rows = []
    bigs = [c for c in chars if c.big or c.t in BIGOPS]
    for c in sorted([c for c in chars if not (c.big or c.t in BIGOPS)], key=lambda c: (-c.b, c.x0)):
        for r in reversed(rows[-8:]):
            if abs(c.b - r['b']) <= 0.12 * min(c.s, r['s']):
                r['items'].append(c)
                break
        else:
            rows.append({'b': c.b, 's': c.s, 'items': [c]})
    for r in rows:
        r['s'] = statistics.median([c.s for c in r['items']])
        big = [c.b for c in r['items'] if c.s >= 0.9 * r['s']] or [r['b']]
        r['b'] = statistics.median(big)
    for c in bigs:
        tol = 0.7 * c.s if c.big else 1.6 * c.s
        near = [r for r in rows if r['s'] >= 0.75 * c.s and abs(r['b'] - c.b) < tol
                and any(abs(i.x0 - c.x1) < 1.5 * c.s or abs(c.x0 - i.x1) < 1.5 * c.s for i in r['items'])]
        if near:
            min(near, key=lambda r: (-round(r['s'], 1), abs(r['b'] - c.b)))['items'].append(c)
        else:
            rows.append({'b': c.b, 's': c.s, 'items': [c]})
    rows.sort(key=lambda r: -r['b'])
    return rows


def fmt_script(inner, sup):
    inner = inner.strip()
    if not inner:
        return ''
    if sup and all(ch in '′″‴\'' for ch in inner):
        return inner.replace("'", '′')
    if sup and inner in ('∗', '*'):
        return '*'
    if sup and inner in ('∘', '◦', '°'):
        return '°'
    mark = '^' if sup else '_'
    if len(inner) == 1 or re.fullmatch(r'[−\-+]?[0-9.]+|[A-Za-z0-9]{1,3}|[^\s(){}\[\]]', inner):
        return mark + inner
    return mark + '{' + inner + '}'


def split_runs(items, s):
    items = sorted(items, key=lambda c: c.x0)
    runs = [[items[0]]]
    for c in items[1:]:
        if c.x0 - runs[-1][-1].x1 > 0.6 * s:
            runs.append([c])
        else:
            runs[-1].append(c)
    return runs


def merge_scripts(rows):
    changed = True
    guard = 0
    while changed and guard < 6:
        changed = False
        guard += 1
        for r in sorted(rows, key=lambda r: r['s']):
            if not r['items']:
                continue
            for run in split_runs(r['items'], r['s']):
                if len(re.findall(r'[A-Za-z]{3,}', simple_join(run))) >= 3:
                    continue
                rs = statistics.median([c.s for c in run])
                rb = statistics.median([c.b for c in run])
                best = None
                rx1 = max(c.x1 for c in run)
                pre = None
                for h in rows:
                    if h is r or not h['items'] or h['s'] < 1.08 * rs or any(c.big for c in run):
                        continue
                    d = rb - h['b']
                    if not (-1.8 * h['s'] <= d <= 2.0 * h['s']):
                        continue
                    for hc in h['items']:
                        up, dn = 0.95 * h['s'], -0.62 * h['s']
                        hbig = hc.big or hc.t in BIGOPS
                        if hc.big:
                            up = max(up, hc.top - h['b'] + 0.35 * rs)
                            dn = min(dn, hc.bot - h['b'] - 0.35 * rs)
                        elif hbig:
                            up, dn = 1.45 * h['s'], -1.15 * h['s']
                        if not (dn <= d <= up):
                            continue
                        g = run[0].x0 - hc.x1
                        if -0.25 * h['s'] <= g <= 0.45 * h['s'] or (hbig and run[0].x0 < hc.x1 + 0.6 * h['s'] and rx1 > hc.x0):
                            score = abs(g) + abs(d) * 0.2
                            if best is None or score < best[0]:
                                best = (score, h, hc, d)
                        g2 = hc.x0 - rx1
                        if -0.1 * h['s'] <= g2 <= 0.35 * h['s'] and 0.15 * h['s'] <= d <= 0.95 * h['s']:
                            if pre is None or g2 < pre[0]:
                                pre = (g2, h, hc, d)
                if best is None and pre is not None:
                    _, h, hc, d = pre
                    tok = C(fmt_script(simple_join(run), True) + ' ', run[0].x0, hc.x0 - 0.001, h['b'], h['s'], tok=True)
                    h['items'].append(tok)
                    ids = set(map(id, run))
                    r['items'] = [c for c in r['items'] if id(c) not in ids]
                    changed = True
                    continue
                if best is None:
                    continue
                _, h, hc, d = best
                inner = simple_join(run)
                if d >= 0.1 * h['s']:
                    txt = fmt_script(inner, True)
                elif d <= -0.07 * h['s']:
                    txt = fmt_script(inner, False)
                else:
                    txt = inner
                tok = C(txt, hc.x1 + (0.001 if d >= 0 else 0.0005), max(c.x1 for c in run), h['b'], h['s'], tok=True)
                h['items'].append(tok)
                ids = set(map(id, run))
                r['items'] = [c for c in r['items'] if id(c) not in ids]
                changed = True
        rows[:] = [r for r in rows if r['items']]
    return rows


def lin(chars):
    if not chars:
        return ''
    rows = merge_scripts(cluster_rows(chars))
    rows.sort(key=lambda r: -r['b'])
    folded = []
    for r in rows:
        if folded and abs(folded[-1]['b'] - r['b']) < 0.5 * max(folded[-1]['s'], r['s']):
            folded[-1]['items'] = folded[-1]['items'] + r['items']
        else:
            folded.append({'b': r['b'], 's': r['s'], 'items': list(r['items'])})
    return ' '.join(simple_join(r['items']) for r in folded).strip()


def wrap(x):
    x = x.strip()
    if re.fullmatch(r'[\w.′∂ħℏ̀-ͯ⃗]+', x) or re.fullmatch(r'√?\([^()]*\)', x):
        return x
    return '(' + x + ')'


def structures(chars, hrules, vrules, pw):
    """Turn fraction bars and radical vincula into linear tokens (innermost first)."""
    used = set()
    used_rules = set()
    new = []
    for (x0, x1, y) in sorted(hrules, key=lambda r: r[1] - r[0]):
        w = x1 - x0
        if w > 0.45 * pw:
            continue
        pool = [c for c in chars if id(c) not in used] + [t for t in new if id(t) not in used]
        rad = None
        for c in pool:
            if c.t in RADS and x0 - 4 <= c.x1 <= x0 + 3 and c.bot - 1 <= y <= c.top + 0.9 * c.s:
                rad = c
                break
        if rad is not None:
            body = [c for c in pool if c is not rad and x0 - 0.5 <= c.xc <= x1 + 0.5 and c.top <= y + 0.35 * c.s
                    and c.bot >= rad.bot - 0.25 * c.s and c.b >= y - 2.6 * c.s]
            if not body:
                continue
            S = statistics.median([c.s for c in body])
            bb = statistics.median([c.b for c in body if c.s >= 0.9 * S] or [c.b for c in body])
            tok = C('√(' + lin(body) + ')', rad.x0, x1, bb, S, top=y, bot=min(c.bot for c in body), tok=True)
            for c in body + [rad]:
                used.add(id(c))
            new.append(tok)
            used_rules.add((x0, x1, y))
            continue
        if any((abs(vx - x0) < 2.5 or abs(vx - x1) < 2.5) and vy0 - 1.5 <= y <= vy1 + 1.5 for vx, vy0, vy1 in vrules):
            continue
        if w <= 25:
            under = [c for c in pool if x0 - 0.5 <= c.xc <= x1 + 0.5 and -0.6 * c.s <= c.top - y <= 0.25 * c.s]
            over = [c for c in pool if x0 - 0.5 <= c.xc <= x1 + 0.5 and 0 <= c.bot - y <= 0.5 * c.s]
            if under and not over and len(under) <= 3:
                for c in under:
                    c.t += '\u0305'
                used_rules.add((x0, x1, y))
                continue
        cand = [c for c in pool if x0 - 1.0 <= c.xc <= x1 + 1.0 and c.t not in RADS]
        above = [c for c in cand if c.bot >= y - 0.35 * c.s]
        below = [c for c in cand if c.top <= y + 0.35 * c.s]
        if not above or not below:
            continue
        na = min(above, key=lambda c: c.bot - y)
        nb = min(below, key=lambda c: y - c.top)
        S = statistics.median([na.s, nb.s])
        if na.bot - y > 0.85 * S or y - nb.top > 0.85 * S:
            continue
        num = [c for c in above if c.b <= y + 1.5 * S]
        den = [c for c in below if c.b >= y - 1.8 * S]
        if not num or not den:
            continue
        nw = max(c.x1 for c in num) - min(c.x0 for c in num)
        dw = max(c.x1 for c in den) - min(c.x0 for c in den)
        if w > max(nw, dw) + 1.6 * S or w < 0.55 * max(nw, dw):
            continue
        S = statistics.median([c.s for c in num + den])
        others = [r for r in hrules if r != (x0, x1, y) and r[1] - r[0] <= 0.45 * pw]

        def isolated(group):
            gb = statistics.median([c.b for c in group])
            gid = set(map(id, group))
            for c in pool:
                if id(c) in gid or abs(c.b - gb) > 0.25 * S or c.t in DELIMS or c.s < 0.9 * S:
                    continue
                if any(r[0] - 1 <= c.xc <= r[1] + 1 and abs(c.b - r[2]) < 1.6 * S for r in others):
                    continue
                if (x0 - 0.45 * S < c.x1 <= x0 + 0.5 and c.xc < x0) or (x1 - 0.5 <= c.x0 < x1 + 0.45 * S and c.xc > x1):
                    return False
            return True
        if not isolated(num) or not isolated(den):
            continue
        ids = set(map(id, num + den))
        side = [c.b for c in pool if id(c) not in ids and not c.big and (x0 - 3 * S < c.x1 <= x0 + 1 or x1 - 1 <= c.x0 < x1 + 3 * S)
                and y - 0.8 * S <= c.b <= y + 0.1 * S]
        fb = statistics.median(side) if side else y - 0.25 * S
        ftxt = wrap(lin(num)) + '/' + wrap(lin(den))
        nxt = any(id(c) not in ids and x1 - 1 <= c.x0 < x1 + 0.3 * S and abs(c.b - fb) < 0.3 * S
                  and (c.tok or c.t[:1].isalnum() or c.t[:1] in '(√') for c in pool)
        prv = any(id(c) not in ids and x0 - 0.3 * S < c.x1 <= x0 + 1 and abs(c.b - fb) < 0.3 * S
                  and (c.tok or c.t[-1:].isalnum() or c.t[-1:] in ')′') for c in pool)
        if nxt or prv:
            ftxt = '(' + ftxt + ')'
        tok = C(ftxt, x0, x1, fb, S, top=max(c.top for c in num), bot=min(c.bot for c in den), tok=True)
        for c in num + den:
            used.add(id(c))
        new.append(tok)
        used_rules.add((x0, x1, y))
    pool = [c for c in chars if id(c) not in used] + [t for t in new if id(t) not in used]
    for (x0, x1, y) in hrules:   # overlines (x̄) drawn as short rules
        if (x0, x1, y) in used_rules or x1 - x0 > 25:
            continue
        under = [c for c in pool if x0 - 0.5 <= c.xc <= x1 + 0.5 and -0.6 * c.s <= c.top - y <= 0.25 * c.s]
        over = [c for c in pool if x0 - 0.5 <= c.xc <= x1 + 0.5 and 0 <= c.bot - y <= 0.5 * c.s]
        if under and not over and len(under) <= 3:
            for c in under:
                c.t += '\u0305'
    return pool


def page_cw(chars):
    ws = [(c.x1 - c.x0) for c in chars if not c.tok and len(c.t) == 1 and c.t.isalnum() and c.x1 > c.x0]
    return statistics.median(ws) if len(ws) > 5 else 5.0


def render_rows(rows, left, cw):
    lines = []
    prev_b = prev_s = None
    for r in rows:
        items = sorted(r['items'], key=lambda c: c.x0)
        off = gap_offset(items)
        out = ''
        col = 0
        prev = None
        for c in items:
            target = max(0, int(round((c.x0 - left) / cw)))
            if prev is None:
                out = ' ' * target
                col = target
            else:
                gap = c.x0 - prev.x1 - off
                if gap > 1.8 * cw and target > col + 1:
                    out += ' ' * (target - col)
                    col = target
                elif gap > 0.15 * min(c.s, prev.s) or (c.sp and gap > -0.3 * c.s):
                    out += ' '
                    col += 1
            out += c.t
            col += len(c.t)
            prev = c
        if prev_b is not None and prev_b - r['b'] > 1.9 * max(prev_s, r['s']):
            lines.append('')
        lines.append(out.rstrip())
        prev_b, prev_s = r['b'], r['s']
    return lines


def two_columns(rows, pw, cw):
    if len(rows) < 12:
        return None
    lo, hi = int(0.28 * pw), int(0.72 * pw)
    cov = [0] * (hi - lo + 1)
    for r in rows:
        for run in split_runs(r['items'], max(r['s'], 2.5 * cw)):
            a, b = int(run[0].x0), int(max(c.x1 for c in run)) + 1
            for x in range(max(a, lo), min(b, hi) + 1):
                cov[x - lo] += 1
    best = (0, None)
    start = None
    for i, v in enumerate(cov + [10 ** 6]):
        if v <= max(1, 0.03 * len(rows)):
            if start is None:
                start = i
        else:
            if start is not None and i - start > best[0]:
                best = (i - start, start + lo + (i - start) / 2)
            start = None
    if best[0] < 6:
        return None
    g = best[1]
    lw = [max(c.x1 for c in r['items'] if c.x1 < g) - min(c.x0 for c in r['items'] if c.x1 < g)
          for r in rows if any(c.x1 < g for c in r['items'])]
    rw = [max(c.x1 for c in r['items'] if c.x0 > g) - min(c.x0 for c in r['items'] if c.x0 > g)
          for r in rows if any(c.x0 > g for c in r['items'])]
    if len(lw) < 0.3 * len(rows) or len(rw) < 0.3 * len(rows):
        return None
    if statistics.median(lw) < 0.28 * pw or statistics.median(rw) < 0.28 * pw:
        return None
    return g


T3HASH = {}


def t3key(font):
    spec = getattr(font, '_icd_spec', {}) or {}
    return str(spec.get('FontMatrix')) + str(spec.get('Widths'))[:400] + str(spec.get('FirstChar'))


def annot_chars(page):
    from pdfminer.pdftypes import resolve1
    from pdfminer.utils import decode_text
    out = []
    try:
        annots = resolve1(page.annots) or []
    except Exception:
        return out
    for a in annots:
        a = resolve1(a)
        if not isinstance(a, dict) or str(a.get('Subtype')) != "/'FreeText'":
            continue
        txt = resolve1(a.get('Contents'))
        if isinstance(txt, bytes):
            txt = decode_text(txt)
        if not txt:
            continue
        x0, y0, x1, y1 = [float(resolve1(v)) for v in resolve1(a.get('Rect'))]
        m = re.search(r'([\d.]+)\s+Tf', str(resolve1(a.get('DA')) or ''))
        fs = float(m.group(1)) if m else 10.0
        y = y1 - fs
        for line in txt.replace('\r', '\n').split('\n'):
            if line.strip():
                out.append(C(line.strip(), x0 + 2, x0 + 2 + 0.5 * fs * len(line.strip()), y, fs, tok=True))
            y -= 1.2 * fs
    return out


def process_page(lt, t3map, extra=None):
    chars, hr, vr, rot = [], [], [], []
    collect(lt, chars, hr, vr, rot)
    chars.extend(extra or [])
    t3 = {}
    for c in chars:
        if c.t.startswith('(cid:'):
            if isinstance(c.font, PDFType3Font):
                k = t3key(c.font)
                if (k, c.cid) not in T3HASH:
                    T3HASH[(k, c.cid)] = t3guess.glyph_hash(c.font, c.cid)
                t3.setdefault(k, []).append(c.cid)
                c.t = (t3map or {}).get(k, {}).get(c.cid, '�')
            else:
                c.t = '�'
    chars = [c for c in dedupe(chars) if c.t]
    lines = []
    if chars:
        chars = attach_accents(chars)
        pw = lt.width
        chars = structures(chars, hr, vr, pw)
        rows = merge_scripts(cluster_rows(chars))
        rows.sort(key=lambda r: -r['b'])
        cw = page_cw(chars)
        left = min(c.x0 for r in rows for c in r['items'])
        g = two_columns(rows, pw, cw)
        if g is None:
            lines = render_rows(rows, left, cw)
        else:
            Lb, Rb = [], []

            def flush():
                if Lb:
                    lines.extend(render_rows(Lb, left, cw))
                if Lb and Rb:
                    lines.append('')
                if Rb:
                    lines.extend(render_rows(Rb, min(c.x0 for r in Rb for c in r['items']), cw))
                Lb.clear()
                Rb.clear()
            for r in rows:
                Li = [c for c in r['items'] if c.xc < g]
                Ri = [c for c in r['items'] if c.xc >= g]
                span = any(c.x0 < g - 1 and c.x1 > g + 1 for c in r['items']) or \
                    (Li and Ri and min(c.x0 for c in Ri) - max(c.x1 for c in Li) < 1.2 * cw)
                if span:
                    flush()
                    lines.extend(render_rows([r], left, cw))
                else:
                    if Li:
                        Lb.append({'b': r['b'], 's': r['s'], 'items': Li})
                    if Ri:
                        Rb.append({'b': r['b'], 's': r['s'], 'items': Ri})
            flush()
    if rot:
        groups = {}
        for o in rot:
            groups.setdefault(round(o.x0 / 3), []).append(o)
        rl = []
        for k in sorted(groups):
            g = groups[k]
            up = sum(1 for o in g if o.matrix[1] > 0) >= len(g) / 2
            txt = ''.join(o.get_text() for o in sorted(g, key=lambda o: o.y0 if up else -o.y0)).strip()
            if txt and '(cid:' not in txt:
                rl.append(txt)
        if rl:
            lines += [''] + ['[rotated text] ' + t for t in rl]
    return lines, t3


def plain_math_letters(text):
    """Mathematical italic/bold letters (U+1D400–1D7FF) -> ordinary letters, so text stays searchable."""
    import unicodedata
    return ''.join(unicodedata.normalize('NFKC', ch) if 0x1D400 <= ord(ch) <= 0x1D7FF else ch for ch in text)


def post(text):
    text = plain_math_letters(text)
    text = text.replace('\u25efc', '\u00a9')   # big circle + c = copyright sign
    text = text.replace('\ufffd Imperial College London', '\u00a9 Imperial College London')
    text = text.replace('h̄', 'ħ').replace('¯h', 'ħ')
    text = re.sub(r'\n{4,}', '\n\n\n', text)
    return text


def convert(path, t3map=None, pages=None):
    rm = PDFResourceManager(caching=True)
    dev = Agg(rm, laparams=None)
    interp = PDFPageInterpreter(rm, dev)
    out = []
    t3all = {}
    with open(path, 'rb') as fp:
        for i, page in enumerate(PDFPage.get_pages(fp)):
            if pages and i + 1 not in pages:
                continue
            interp.process_page(page)
            lines, t3 = process_page(dev.get_result(), t3map, annot_chars(page))
            for k, v in t3.items():
                t3all.setdefault(k, []).extend(v)
            out.append('\n'.join(lines).rstrip('\n'))
    return post('\n\f'.join(out) + '\n'), t3all


def convert_file(src, pages=None):
    txt, t3 = convert(src, pages=pages)
    if t3:
        txt, _ = convert(src, t3guess.guess(t3, T3HASH), pages)
    return txt


if __name__ == '__main__':
    src = sys.argv[1]
    pages = set(int(x) for x in sys.argv[3].split(',')) if len(sys.argv) > 3 else None
    txt = convert_file(src, pages)
    if len(sys.argv) > 2 and sys.argv[2] != '-':
        open(sys.argv[2], 'w', encoding='utf-8').write(txt)
    else:
        sys.stdout.write(txt)
