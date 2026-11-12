#!/usr/bin/env python3
"""Imperial Dashboard: a local study dashboard for the files in this folder.

Run:  python3 server.py            (opens http://127.0.0.1:8765 in your browser)
      python3 server.py --port 9000 --no-browser
Only uses the Python standard library (PyYAML is bundled in vendor/). Listens on this Mac only.
"""
import argparse
import datetime as dt
import json
import mimetypes
import os
import re
import sys
import threading
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, APP)
import mdstore  # noqa: E402
from mdstore import yaml  # noqa: E402  (bundled PyYAML if needed)
import planner  # noqa: E402

ROOT = os.path.abspath(os.environ.get('ICD_ROOT') or os.path.join(APP, '..', '..'))
STATIC = os.path.join(APP, 'static')
WRITE_LOCK = threading.Lock()

SHORT = {'PHYS50001': 'Lab', 'PHYS50002': 'TPSM', 'PHYS50003': 'DE&EM', 'PHYS50004': 'Quantum',
         'PHYS50006': 'SSP', 'PHYS50007': 'Maths Methods', 'EART60031': 'Space Mining',
         'student-essentials': 'Student Essentials', 'all': 'All modules'}
SHEET_STATUS_TEXT = {'not-started': 'not started', 'in-progress': 'in progress', 'done': 'done',
                     'submitted': 'submitted', 'locked': 'locked'}
SKIP_DIRS = {'_meta', '.git', '__pycache__'}
Q_STATUS = ('not-started', 'attempted', 'stuck', 'done')


def rel(p):
    return os.path.relpath(p, ROOT).replace(os.sep, '/')


def safe_path(relpath):
    p = os.path.realpath(os.path.join(ROOT, urllib.parse.unquote(relpath).lstrip('/')))
    if p != ROOT and not p.startswith(ROOT + os.sep):
        raise PermissionError('outside the dashboard folder')
    return p


def module_dirs():
    out = {}
    md = os.path.join(ROOT, 'modules')
    names = [d for d in os.listdir(md) if os.path.isdir(os.path.join(md, d)) and re.match(r'[A-Z]{4}\d{5}', d)]
    for d in sorted(names, key=lambda d: (not d.startswith('PHYS'), d)):  # physics modules first, I-Explore last
        out[d.split('-')[0]] = d
    return out


def read_md(relpath):
    p = safe_path(relpath)
    fm, body = mdstore.read(p)
    return {'path': rel(p), 'dir': rel(os.path.dirname(p)), 'fm': mdstore.plain(fm), 'body': body}


def maybe_md(relpath):
    p = os.path.join(ROOT, relpath)
    return read_md(relpath) if os.path.exists(p) else None


def tree(base, skip_txt=True):
    """List files under base (relative paths), grouped by sub-folder."""
    groups = {}
    for d, dirs, files in os.walk(base):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith('.'))
        for f in sorted(files):
            if f.startswith('.') or (skip_txt and f.endswith('.txt')):
                continue
            p = os.path.join(d, f)
            sub = os.path.relpath(d, base).replace(os.sep, '/')
            txt = os.path.splitext(p)[0] + '.txt'
            groups.setdefault('' if sub == '.' else sub, []).append({
                'name': f, 'path': rel(p), 'size': os.path.getsize(p),
                'text': rel(txt) if (not f.endswith('.md') and os.path.exists(txt)) else None})
    return [{'folder': k, 'files': v} for k, v in sorted(groups.items())]


def find_file(mod_dir, name):
    if not name:
        return None
    base = os.path.join(ROOT, 'modules', mod_dir)
    for sub in ('problem-sheets', ''):  # paths in indexes are relative to problem-sheets/
        p = os.path.join(base, sub, name)
        if os.path.isfile(p):
            return rel(p)
    leaf = os.path.basename(name)
    for d, dirs, files in os.walk(base):
        if leaf in files:
            return rel(os.path.join(d, leaf))
    return None


# ---------------------------------------------------------------- problem-sheet questions

def qfile(mod_dir, sid):
    """Path of the question-by-question file for a sheet, or None."""
    if not sid or not re.fullmatch(r'[A-Za-z0-9_.\-]+', str(sid)):
        return None
    p = os.path.join(ROOT, 'modules', mod_dir, 'problem-sheets', 'questions', '%s.md' % sid)
    return p if os.path.exists(p) else None


def q_counts(qs):
    c = {k: 0 for k in Q_STATUS}
    for q in qs:
        c[q.get('status') if q.get('status') in c else 'not-started'] += 1
    c['total'] = len(qs)
    return c


def q_summary(mod_dir, sid):
    p = qfile(mod_dir, sid)
    if not p:
        return None
    fm, _ = mdstore.read(p)
    qs = fm.get('questions') or []
    c = q_counts(qs)
    nxt = next((q for q in qs if q.get('status') != 'done' and re.fullmatch(r'\d+', str(q.get('n')))), None)
    c['next_n'] = str(nxt.get('n')) if nxt else None
    c['next_label'] = str(nxt.get('label') or nxt.get('n')) if nxt else None
    return c


def sheet_status_from(c):
    if c['total'] and c['done'] == c['total']:
        return 'done'
    if c['not-started'] == c['total']:
        return 'not-started'
    return 'in-progress'


def api_sheet(code, sid):
    d = module_dirs()[code]
    p = qfile(d, sid)
    if not p:
        raise KeyError('no question file for %s %s' % (code, sid))
    fm, body = mdstore.read(p)
    fm = mdstore.plain(fm)
    ps = 'modules/%s/problem-sheets' % d
    idx = maybe_md(ps + '/index.md') or {}
    sheet = next((s for s in idx.get('fm', {}).get('sheets') or [] if str(s.get('id')) == str(sid)), {})

    def resolve(name):
        if not name:
            return None
        if os.path.isfile(os.path.join(ROOT, ps, name)):
            return ps + '/' + name
        return find_file(d, os.path.basename(name))

    qs = fm.get('questions') or []
    qmap = {str(q.get('n')): q for q in qs}
    parts = re.split(r'^## (.+?)[ \t]*$', body, flags=re.M)
    sections = [{'key': parts[i].strip(), 'md': parts[i + 1].strip(), 'q': qmap.get(parts[i].strip())}
                for i in range(1, len(parts), 2)]
    return {'module': code, 'short': SHORT.get(code, code), 'dir': d, 'id': sid,
            'title': fm.get('title') or sid, 'note': fm.get('note'),
            'source_path': resolve(fm.get('source')), 'solutions_path': resolve(fm.get('solutions')),
            'solutions_name': fm.get('solutions'), 'sheet': sheet, 'lambda_set': fm.get('lambda_set'),
            'qdir': rel(os.path.dirname(p)), 'path': rel(p), 'intro': parts[0].strip(),
            'sections': sections, 'counts': q_counts(qs)}


# ---------------------------------------------------------------- API builders

def api_overview():
    mods = []
    for code, d in module_dirs().items():
        m = maybe_md('modules/%s/module.md' % d)
        fm = (m or {}).get('fm', {})
        mods.append({'code': code, 'dir': d, 'short': SHORT.get(code, code), 'title': fm.get('title') or d,
                     'ects': fm.get('ects'), 'terms': fm.get('terms'), 'assessment': fm.get('assessment'),
                     'canvas_url': fm.get('canvas_url'), 'grading': fm.get('grading')})
    dl = read_md('deadlines.md')
    items = []
    for i, it in enumerate(dl['fm'].get('items') or []):
        it = dict(it)
        it['index'] = i
        it['modules'] = [x for x in str(it.get('module') or '').split('+') if x]
        items.append(it)
    tt = read_md('calendar/timetable.md')
    plan = maybe_md('revision/revision-plan.md')
    sheets = []
    for code, d in module_dirs().items():
        idx = maybe_md('modules/%s/problem-sheets/index.md' % d)
        for s in (idx or {}).get('fm', {}).get('sheets') or []:
            s = dict(s)
            s['module'] = code
            s['path'] = find_file(d, s.get('file'))
            s['questions'] = q_summary(d, s.get('id'))
            sheets.append(s)
    cycles = []
    for code, d in module_dirs().items():
        ed = os.path.join(ROOT, 'modules', d, 'experiments')
        if not os.path.isdir(ed):
            continue
        for name in sorted(os.listdir(ed)):
            e = maybe_md('modules/%s/experiments/%s/experiment.md' % (d, name))
            dates = ((e or {}).get('fm') or {}).get('dates') or {}
            if dates.get('start'):
                cycles.append({'module': code, 'cycle': e['fm'].get('cycle'), 'name': e['fm'].get('experiment'),
                               'start': str(dates.get('start')), 'end': str(dates.get('end') or '')})
    # Last Canvas sync = newest last_synced among deadlines.md and the module files.
    # (The sync log also records app/tool changes, so its first heading isn't a reliable sync date.)
    synced = [str(dl['fm'].get('last_synced') or '')]
    for code, d in module_dirs().items():
        synced.append(str(((maybe_md('modules/%s/module.md' % d) or {}).get('fm') or {}).get('last_synced') or ''))
    synced = max(synced) or None
    return {
        'lab_cycles': cycles,
        'now': dt.datetime.now().replace(microsecond=0).isoformat(),
        'modules': mods, 'short': SHORT, 'deadlines': items,
        'deadlines_synced': dl['fm'].get('last_synced'),
        'timetable': tt['fm'], 'key_dates': read_md('year/key-dates.md')['fm'],
        'exams': read_md('year/exams.md')['fm'],
        'needs': (maybe_md('_meta/needs-from-you.md') or {}).get('body', ''),
        'plan': (plan or {}).get('fm'), 'sheets': sheets,
        'last_sync': synced,
    }


def api_module(code):
    d = module_dirs().get(code)
    if not d:
        raise KeyError('no module ' + code)
    base = 'modules/%s/' % d
    out = {'code': code, 'dir': d, 'short': SHORT.get(code, code),
           'module': maybe_md(base + 'module.md'), 'schedule': maybe_md(base + 'schedule.md'),
           'assessment': maybe_md(base + 'assessment.md'), 'sheets': maybe_md(base + 'problem-sheets/index.md')}
    if out['sheets']:
        for s in out['sheets']['fm'].get('sheets') or []:
            for k in ('file', 'solutions', 'slides'):
                s[k + '_path'] = find_file(d, s.get(k))
            s['questions'] = q_summary(d, s.get('id'))
    out['lambda_course'] = None
    qd = os.path.join(ROOT, base, 'problem-sheets', 'questions')
    if os.path.isdir(qd):
        for f in sorted(os.listdir(qd)):
            if f.endswith('.md'):
                ls = mdstore.read(os.path.join(qd, f))[0].get('lambda_set')
                if ls:
                    out['lambda_course'] = re.sub(r'/sets/.*$', '/sets', str(ls))
                    break
    sums = []
    sd = os.path.join(ROOT, base, 'lecture-summaries')
    if os.path.isdir(sd):
        for f in sorted(os.listdir(sd)):
            if f.endswith('.md'):
                fm, _ = mdstore.read(os.path.join(sd, f))
                sums.append({'path': base + 'lecture-summaries/' + f, 'title': fm.get('title') or f,
                             'course': fm.get('course'), 'lectures': fm.get('lectures'), 'chapter': fm.get('chapter'),
                             'week': fm.get('week')})
    out['summaries'] = sums
    exps = []
    ed = os.path.join(ROOT, base, 'experiments')
    if os.path.isdir(ed):
        for e in sorted(os.listdir(ed)):
            p = os.path.join(ed, e, 'experiment.md')
            if os.path.exists(p):
                exps.append(read_md(rel(p)))
    out['experiments'] = exps
    out['tree'] = tree(os.path.join(ROOT, base))
    return out


def api_year():
    docs = []
    for f in sorted(os.listdir(os.path.join(ROOT, 'year'))):
        if f.endswith('.md'):
            r = read_md('year/' + f)
            title = re.search(r'^# (.+)$', r['body'], re.M)
            docs.append({'path': r['path'], 'title': title.group(1) if title else f[:-3]})
    return {'docs': docs, 'tree': tree(os.path.join(ROOT, 'year')),
            'calendar': tree(os.path.join(ROOT, 'calendar'))}


def api_topics():
    t = read_md('revision/topic-tracker.md')
    idx = planner.summary_index(ROOT)
    topics = []
    for i, x in enumerate(t['fm'].get('topics') or []):
        x = dict(x)
        x['index'] = i
        if 'summary' not in x:  # the tracker's own summary (even null) wins over the filename guess
            s = planner.topic_summary(x, idx)
            x['summary'] = s['path'] if s else None
        topics.append(x)
    return {'topics': topics, 'note': t['fm'].get('note'), 'body': t['body']}


def api_grades():
    out = []
    for code, d in module_dirs().items():
        a = maybe_md('modules/%s/assessment.md' % d)
        if a:
            out.append({'code': code, 'short': SHORT.get(code, code), 'items': a['fm'].get('items') or [],
                        'module': (maybe_md('modules/%s/module.md' % d) or {}).get('fm', {}).get('assessment')})
    return out


# ---------------------------------------------------------------- search

_cache = {}


def _search_files():
    for d, dirs, files in os.walk(ROOT):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith('.'))
        for f in sorted(files):
            if f.endswith(('.md', '.txt')):
                yield os.path.join(d, f)


def _clean_hit(line, in_fm):
    """Turn a raw matching line into readable text: no YAML or markdown syntax."""
    if in_fm:
        m = re.match(r'-\s*(\{.*\})\s*$', line)
        if m:
            try:
                d = yaml.safe_load(m.group(1)) or {}
            except Exception:
                d = {}
            for k in ('topic', 'item', 'name', 'title', 'covers', 'what'):
                if d.get(k):
                    return str(d[k])
            return ''
        m = re.match(r'[\w-]+:\s*(.+)$', line)
        if m:
            return m.group(1).strip().strip('"\'')
        return ''
    line = re.sub(r'^\s*(#+|[-*+]|\d+\.|>)\s+', '', line)
    if line.startswith('|'):
        line = ' · '.join(c.strip() for c in line.strip('|').split('|') if c.strip() and not set(c.strip()) <= set('-: '))
    line = re.sub(r'\*\*(.+?)\*\*', r'\1', line)
    line = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])', r'\1', line)
    line = re.sub(r'`([^`]+)`', r'\1', line)
    line = re.sub(r'!?\[([^\]]*)\]\([^)]*\)', r'\1', line)
    return line.strip()


def _describe(path, text):
    """A friendly title, a kind and an in-app link for a search result."""
    parts = path.split('/')
    out = {'title': None, 'kind': None, 'module': None, 'link': None}
    if parts[0] == 'modules' and len(parts) > 1:
        out['module'] = parts[1].split('-')[0]
    fm = {}
    if path.endswith('.md'):
        m = re.match(r'---\n(.*?)\n---', text, re.S)
        if m:
            try:
                fm = yaml.safe_load(m.group(1)) or {}
            except Exception:
                fm = {}
        h1 = re.search(r'^# (.+)$', text, re.M)
        out['title'] = str(fm.get('title') or (h1.group(1) if h1 else parts[-1][:-3]))
    if '/problem-sheets/questions/' in path and path.endswith('.md'):
        out['kind'] = 'Problem sheet'
        out['labels'] = {str(q.get('n')): str(q.get('label') or q.get('n')) for q in fm.get('questions') or []}
        out['link'] = '#/sheet/%s/%s' % (out['module'], fm.get('sheet') or parts[-1][:-3])
    elif '/lecture-summaries/' in path:
        out['kind'] = 'Lecture summary'
        out['link'] = '#/module/%s/notes?s=%s' % (out['module'], urllib.parse.quote(path, safe=''))
    elif path.endswith('.md'):
        out['kind'] = 'Note'
        out['link'] = '#/doc?path=' + urllib.parse.quote(path, safe='')
    else:
        out['kind'] = 'PDF text'
        out['title'] = parts[-1][:-4]
    return out


def api_search(q, limit_files=60):
    q = q.strip()
    if len(q) < 2:
        return {'q': q, 'results': []}
    rx = re.compile(re.escape(q), re.I)
    res = []
    for p in _search_files():
        mt = os.path.getmtime(p)
        c = _cache.get(p)
        if not c or c[0] != mt:
            try:
                with open(p, encoding='utf-8', errors='replace') as f:
                    c = (mt, f.read())
            except OSError:
                continue
            _cache[p] = c
        text = c[1]
        hits, seen = [], set()
        fm_end = 0
        if p.endswith('.md') and text.startswith('---\n'):
            k = text.find('\n---', 4)
            fm_end = k + 4 if k > 0 else 0
        for m in rx.finditer(text):
            a = text.rfind('\n', 0, m.start()) + 1
            b = text.find('\n', m.end())
            b = len(text) if b < 0 else b
            line = _clean_hit(text[a:b].strip(), m.start() < fm_end)
            if not line or line in seen:
                continue
            seen.add(line)
            page = text.count('\f', 0, m.start()) + 1 if p.endswith('.txt') and '\f' in text else None
            sec = None
            if '/problem-sheets/questions/' in p and m.start() < fm_end:
                mn = re.search(r'\bn: "?([\w.]+)"?', text[a:b])
                sec = mn.group(1) if mn else None
            elif '/problem-sheets/questions/' in p:
                hs = list(re.finditer(r'^## (.+)$', text[:m.start()], re.M))
                sec = hs[-1].group(1).strip() if hs else None
            hits.append({'line': line[:240], 'page': page, 'section': sec})
            if len(hits) >= 3:
                break
        if hits:
            n = len(rx.findall(text)) if len(hits) == 3 else len(hits)
            src = None
            if p.endswith('.txt'):
                for ext in ('.pdf', '.docx', '.xlsx', '.html', '.zip'):
                    if os.path.exists(p[:-4] + ext):
                        src = rel(p[:-4] + ext)
                        break
            res.append(dict({'path': rel(p), 'source': src, 'count': n, 'hits': hits}, **_describe(rel(p), text)))
    def tier(r):
        path = r['path']
        if path.startswith('revision/'):
            return 3          # generated plan and tracker repeat topic names; keep them last
        if path.endswith('.md'):
            return 0 if 'lecture-summaries/' in path else 1
        return 2
    res.sort(key=lambda r: (tier(r), -r['count']))
    return {'q': q, 'results': res[:limit_files], 'total_files': len(res)}


# ---------------------------------------------------------------- edits

def edit_sheet(body):
    code, sid, status = body.get('module'), body.get('id'), body.get('status')
    if status not in SHEET_STATUS_TEXT:
        raise ValueError('unknown status')
    d = module_dirs()[code]
    p = os.path.join(ROOT, 'modules', d, 'problem-sheets', 'index.md')
    fm, _ = mdstore.read(p)
    idx = next(i for i, s in enumerate(fm.get('sheets') or []) if str(s.get('id')) == str(sid))
    return mdstore.update_list_item(p, 'sheets', idx, {'status': status},
                                    check=lambda s: str(s.get('id')) == str(sid),
                                    table_updates=(str(sid), {'status': SHEET_STATUS_TEXT[status]}))


def edit_question(body):
    code, sid, n, status = body.get('module'), body.get('sheet'), str(body.get('n')), body.get('status')
    if status not in Q_STATUS:
        raise ValueError('unknown status')
    d = module_dirs()[code]
    p = qfile(d, sid)
    if not p:
        raise KeyError('no question file')
    fm, _ = mdstore.read(p)
    idx = next(i for i, q in enumerate(fm.get('questions') or []) if str(q.get('n')) == n)
    mdstore.update_list_item(p, 'questions', idx, {'status': status}, check=lambda q: str(q.get('n')) == n)
    fm, _ = mdstore.read(p)
    c = q_counts(fm.get('questions') or [])
    # keep the sheet's own status in problem-sheets/index.md in step with its questions
    ip = os.path.join(ROOT, 'modules', d, 'problem-sheets', 'index.md')
    ifm, _ = mdstore.read(ip)
    sh = next((s for s in ifm.get('sheets') or [] if str(s.get('id')) == str(sid)), None)
    sheet_status = sh.get('status') if sh else None
    want = sheet_status_from(c)
    if sh and sheet_status in ('not-started', 'in-progress', 'done') and sheet_status != want:
        edit_sheet({'module': code, 'id': sid, 'status': want})
        sheet_status = want
    return {'n': n, 'status': status, 'counts': c, 'sheet_status': sheet_status}


def edit_topic(body):
    tid = body.get('id')
    p = os.path.join(ROOT, 'revision', 'topic-tracker.md')
    fm, _ = mdstore.read(p)
    idx = next(i for i, t in enumerate(fm.get('topics') or []) if t.get('id') == tid)
    upd, cells = {}, {}
    if 'confidence' in body:
        c = body['confidence']
        if c is not None and c not in (1, 2, 3, 4, 5):
            raise ValueError('confidence must be 1-5')
        upd['confidence'] = c
        cells['confidence'] = str(c) if c else '–'
    if body.get('reviewed'):
        today = dt.date.today().isoformat()
        upd['last_reviewed'] = today
        cells['last reviewed'] = dt.date.today().strftime('%-d %b')
    elif 'last_reviewed' in body:  # undo: put back the date it had before (or none)
        lr = body['last_reviewed']
        if lr is not None:
            try:
                lr = dt.date.fromisoformat(str(lr)[:10])
            except ValueError:
                raise ValueError('last_reviewed must be a date (YYYY-MM-DD) or null')
        upd['last_reviewed'] = lr.isoformat() if lr else None
        cells['last reviewed'] = lr.strftime('%-d %b') if lr else '–'
    if not upd:
        raise ValueError('nothing to change')
    return mdstore.update_list_item(p, 'topics', idx, upd, check=lambda t: t.get('id') == tid,
                                    table_updates=(tid, cells))


def edit_deadline(body):
    i, item, status = int(body.get('index')), body.get('item'), body.get('status')
    if status not in ('done', 'open', 'upcoming', 'submitted'):
        raise ValueError('unknown status')
    return mdstore.update_list_item(os.path.join(ROOT, 'deadlines.md'), 'items', i, {'status': status},
                                    check=lambda x: x.get('item') == item)


STORE_NAMES = {'flashcards', 'mocks', 'studylog'}     # small JSON files the pages keep in revision/ (flashcard schedule, mock exams)


def save_store(body):
    """Replace revision/<name>.json with the page's data (only the names above; written atomically)."""
    name, data = body.get('name'), body.get('data')
    if name not in STORE_NAMES:
        raise ValueError('unknown store')
    if not isinstance(data, dict):
        raise ValueError('data must be an object')
    text = json.dumps(data, ensure_ascii=False, indent=1)
    if len(text) > 4_000_000:
        raise ValueError('too large')
    mdstore._atomic_write(os.path.join(ROOT, 'revision', name + '.json'), text + '\n')
    return {'saved': name, 'bytes': len(text)}


def regenerate_plan():
    plan = planner.build(ROOT)
    planner.write(ROOT, plan, SHORT)
    return read_md('revision/revision-plan.md')['fm']


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = 'ImperialDashboard/1.0'

    def log_message(self, fmt, *args):
        if os.environ.get('ICD_VERBOSE'):
            sys.stderr.write(fmt % args + '\n')

    def _allowed(self):
        """Refuse requests that don't come from the dashboard's own page.

        The server only listens on this Mac, but any website open in the browser can still try to send
        requests to it. Two checks stop that: the Host header must be this server's own address (blocks
        "DNS rebinding", where a hostile site points its own name at 127.0.0.1 to read your files), and a
        request that says which page sent it (Origin) must have been sent by the dashboard itself (blocks
        other sites from ticking deadlines, marking topics or starting Claude behind your back).
        """
        def local(netloc):
            host = (netloc or '').strip().lower()
            host = host.rsplit(':', 1)[0] if not host.endswith(']') else host
            return host in ('127.0.0.1', 'localhost', '[::1]')
        if not local(self.headers.get('Host')):
            self._send(403, {'error': 'this dashboard only answers on 127.0.0.1'})
            return False
        origin = self.headers.get('Origin')
        if origin and origin != 'null' and not local(urllib.parse.urlparse(origin).netloc):
            self._send(403, {'error': 'requests from other sites are not allowed'})
            return False
        if origin == 'null' and self.command != 'GET':
            self._send(403, {'error': 'requests from other sites are not allowed'})
            return False
        return True

    def _send(self, code, payload, ctype='application/json; charset=utf-8'):
        data = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False, default=str).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def _file(self, p, download=False):
        if not os.path.isfile(p):
            return self._send(404, {'error': 'not found'})
        ctype = mimetypes.guess_type(p)[0] or 'application/octet-stream'
        if p.endswith(('.txt', '.md', '.py', '.tsv', '.csv')):
            ctype = 'text/plain; charset=utf-8'
        with open(p, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        if download:
            self.send_header('Content-Disposition', 'attachment; filename="%s"' % os.path.basename(p))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self._allowed():
            return
        u = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(u.query)
        path = u.path
        try:
            if path == '/' or path == '/index.html':
                return self._file(os.path.join(STATIC, 'index.html'))
            if path.startswith('/static/'):
                p = os.path.realpath(os.path.join(STATIC, path[len('/static/'):]))
                if not p.startswith(STATIC + os.sep):
                    return self._send(403, {'error': 'forbidden'})
                return self._file(p)
            if path == '/open':
                # a file named in a note: the exact path, else the same file name nearby, else anywhere
                want, base = qs.get('p', [''])[0], qs.get('base', [''])[0]
                cands = [want, os.path.join(base, want)]
                hit = next((c for c in cands if c and os.path.isfile(safe_path(c))), None)
                if not hit:
                    leaf = os.path.basename(want)
                    roots = [safe_path(base.split('/')[0] + '/' + base.split('/')[1]) if base.startswith('modules/') and base.count('/') >= 1 else None, ROOT]
                    for r0 in [r for r in roots if r]:
                        for d, dirs, files in os.walk(r0):
                            dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
                            if leaf in files:
                                hit = rel(os.path.join(d, leaf))
                                break
                        if hit:
                            break
                if not hit:
                    import html as _h
                    page = ('<!doctype html><meta charset="utf-8"><title>Not in your folder</title>'
                            '<body style="font:16px/1.5 -apple-system,sans-serif;max-width:560px;margin:80px auto;padding:0 20px">'
                            '<h1 style="font-weight:500;font-size:24px">%s isn\'t in your folder</h1><p>The note mentions this file, '
                            'but there is no copy of it in Imperial Dashboard yet. If it comes from Canvas, the next sync adds it.</p></body>') % _h.escape(os.path.basename(want))
                    data = page.encode()
                    self.send_response(404)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self.send_response(302)
                self.send_header('Location', '/file/' + urllib.parse.quote(rel(safe_path(hit))))
                self.end_headers()
                return
            if path.startswith('/file/'):
                return self._file(safe_path(path[len('/file/'):]), download='download' in qs)
            if path == '/api/overview':
                return self._send(200, api_overview())
            if path.startswith('/api/sheet/'):
                bits = path.split('/')
                if len(bits) < 5:
                    raise KeyError('a sheet needs a module and a sheet id')
                return self._send(200, api_sheet(urllib.parse.unquote(bits[3]), urllib.parse.unquote(bits[4])))
            if path.startswith('/api/module/'):
                return self._send(200, api_module(path.rsplit('/', 1)[1]))
            if path == '/api/md':
                return self._send(200, read_md(qs.get('path', [''])[0]))
            if path == '/api/year':
                return self._send(200, api_year())
            if path == '/api/topics':
                return self._send(200, api_topics())
            if path == '/api/grades':
                return self._send(200, api_grades())
            if path == '/api/plan':
                return self._send(200, (maybe_md('revision/revision-plan.md') or {}).get('fm') or {})
            if path == '/api/search':
                return self._send(200, api_search(qs.get('q', [''])[0]))
            return self._send(404, {'error': 'not found'})
        except PermissionError as e:
            return self._send(403, {'error': str(e)})
        except (KeyError, FileNotFoundError, IsADirectoryError, NotADirectoryError, StopIteration) as e:
            return self._send(404, {'error': 'not found: %s' % e})
        except Exception as e:  # keep serving
            return self._send(500, {'error': '%s: %s' % (type(e).__name__, e)})

    def do_POST(self):
        if not self._allowed():
            return
        path = urllib.parse.urlparse(self.path).path
        try:
            n = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(n) or b'{}')
            if not isinstance(body, dict):
                raise ValueError('expected a JSON object')
            with WRITE_LOCK:
                if path == '/api/sheet':
                    return self._send(200, edit_sheet(body))
                if path == '/api/question':
                    return self._send(200, edit_question(body))
                if path == '/api/topic':
                    return self._send(200, edit_topic(body))
                if path == '/api/deadline':
                    return self._send(200, edit_deadline(body))
                if path == '/api/plan/regenerate':
                    return self._send(200, regenerate_plan())
                if path == '/api/store':
                    return self._send(200, save_store(body))
            return self._send(404, {'error': 'not found'})
        except (ValueError, mdstore.EditError) as e:
            return self._send(400, {'error': str(e)})
        except (KeyError, StopIteration, TypeError):
            return self._send(404, {'error': 'item not found'})
        except Exception as e:
            return self._send(500, {'error': '%s: %s' % (type(e).__name__, e)})


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--no-browser', action='store_true')
    args = ap.parse_args()
    if not os.path.isdir(os.path.join(ROOT, 'modules')):
        sys.exit('Cannot find the dashboard data folder at %s' % ROOT)
    srv = None
    for port in range(args.port, args.port + 20):
        try:
            srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
            break
        except OSError:
            continue
    if srv is None:
        sys.exit('No free port near %d' % args.port)
    if not os.path.exists(os.path.join(ROOT, 'revision', 'revision-plan.md')):
        try:
            regenerate_plan()
            print('Made a first revision plan in revision/revision-plan.md')
        except Exception as e:
            print('Could not make the revision plan yet: %s' % e)
    url = 'http://127.0.0.1:%d/' % srv.server_address[1]
    print('Imperial Dashboard is running at %s  (press Ctrl+C to stop)' % url)
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')


if __name__ == '__main__':
    main()
