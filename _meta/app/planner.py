"""Automatic revision timetable.

Reads revision/plan-settings.md (weekly study slots per phase of the year), the topic tracker
(confidence, last reviewed), module weightings, exam dates and deadlines, and writes
revision/revision-plan.md: one session per slot, each assigned to the topic that most needs it.

How a topic is chosen for a slot:
  weight  = module ECTS x exam share of the module mark x (lectures in topic / lectures covered so far)
  need    = (6 - confidence) / 5            (unrated topics count as confidence 2.5)
  spacing = how overdue the topic is for review (gaps grow as confidence grows: 3 days at 1 → 30 at 5)
  score   = weight x need x spacing, boosted for a module whose exam is in the next 10 days.
After a topic is scheduled, the planner assumes the session helped (+0.5 confidence) so topics rotate.
"""
import datetime as dt
import os
import re

import mdstore

DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
INTERVAL = {1: 3, 2: 5, 3: 9, 4: 16, 5: 30}

DEFAULT_SETTINGS = '''type: revision-settings
note: "Edit freely. slots = 'Day HH:MM minutes' separated by ';'. Day can be Mon..Sun, a range like Mon-Fri, or Daily. Then press Regenerate in the dashboard."
unrated_confidence: 2.5
skip_days_before_big_deadlines: 1
big_deadline: {points_at_least: 1000, weight_at_least: 30}
skip_dates: [2026-12-24, 2026-12-25, 2026-12-26, 2026-12-31, 2027-01-01]
phases:
  - {name: "Autumn term", from: 2026-10-26, to: 2026-12-11, slots: "Wed 14:00 60; Sat 10:00 120; Sun 14:00 120"}
  - {name: "Winter break", from: 2026-12-12, to: 2027-01-03, slots: "Mon-Fri 10:00 120"}
  - {name: "Spring term", from: 2027-01-04, to: 2027-03-19, slots: "Wed 14:00 120; Sat 10:00 120; Sun 14:00 120"}
  - {name: "Easter break", from: 2027-03-20, to: 2027-04-25, slots: "Mon-Fri 10:00 120; Mon-Fri 14:00 120; Sat 10:00 120"}
  - {name: "Exam period", from: 2027-04-26, to: 2027-05-11, slots: "Daily 10:00 120; Daily 14:00 120"}
'''

SETTINGS_BODY = '''# Revision settings

These settings drive the automatic revision timetable in `revision-plan.md`.

- **phases**: each part of the year has its own weekly slots. As set up: about 5 h a week in the autumn term, 10 h over the winter break, 6 h in the spring term, 22 h over Easter and 28 h a week during the exam period.
- **skip_dates**: days with no revision (Christmas and New Year by default).
- **skip_days_before_big_deadlines**: no revision on the day of, or this many days before, a big coursework deadline (lab reports, the Space Mining assignments).
- **unrated_confidence**: how a topic you haven't rated yet is treated (1 = lost, 5 = exam-ready).

Rate your topics on the Revision page of the dashboard, then press **Regenerate plan**.
'''


def as_date(v):
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    try:
        return dt.date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def as_dt(v):
    """Deadline due values: date, 'YYYY-MM-DDTHH:MM' or similar. Date-only means end of day."""
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        return v.replace(tzinfo=None)
    if isinstance(v, dt.date):
        return dt.datetime(v.year, v.month, v.day, 23, 59)
    s = str(v)
    m = re.match(r'(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?', s)
    if not m:
        return None
    d = dt.date.fromisoformat(m.group(1))
    if m.group(2):
        return dt.datetime(d.year, d.month, d.day, int(m.group(2)), int(m.group(3)))
    return dt.datetime(d.year, d.month, d.day, 23, 59)


def parse_slots(spec):
    out = []
    for part in str(spec or '').split(';'):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r'(Daily|[A-Z][a-z]{2}(?:-[A-Z][a-z]{2})?)\s+(\d{1,2}):(\d{2})\s+(\d+)', part)
        if not m:
            raise ValueError('cannot read slot "%s" (use e.g. "Wed 14:00 60")' % part)
        d = m.group(1)
        if d == 'Daily':
            days = list(range(7))
        elif '-' in d:
            a, b = d.split('-')
            days = list(range(DAYS.index(a), DAYS.index(b) + 1))
        else:
            days = [DAYS.index(d)]
        for wd in days:
            out.append((wd, int(m.group(2)), int(m.group(3)), int(m.group(4))))
    return out


def load_settings(root):
    p = os.path.join(root, 'revision', 'plan-settings.md')
    if not os.path.exists(p):
        mdstore.write_new(p, DEFAULT_SETTINGS, SETTINGS_BODY)
    data, _ = mdstore.read(p)
    return data


def _nums(s):
    m = re.search(r'(\d+)(?:\s*-\s*(\d+))?', str(s or ''))
    if not m:
        return set()
    a = int(m.group(1))
    b = int(m.group(2) or a)
    return set(range(a, b + 1))


def summary_index(root):
    """module -> list of {path, nums, course, kind, notes} for lecture summaries."""
    idx = {}
    mods = os.path.join(root, 'modules')
    for mdir in sorted(os.listdir(mods)):
        sd = os.path.join(mods, mdir, 'lecture-summaries')
        if not os.path.isdir(sd):
            continue
        for f in sorted(os.listdir(sd)):
            if not f.endswith('.md'):
                continue
            fm, _ = mdstore.read(os.path.join(sd, f))
            m = re.search(r'(ch|L)(\d+)(?:-(\d+))?', f)
            nums = set(range(int(m.group(2)), int(m.group(3) or m.group(2)) + 1)) if m else set()
            idx.setdefault(fm.get('module') or mdir.split('-')[0], []).append({
                'path': os.path.relpath(os.path.join(sd, f), root),
                'nums': nums, 'kind': m.group(1) if m else '', 'course': fm.get('course'),
                'title': fm.get('title'), 'notes': fm.get('notes'), 'mdir': mdir,
                'nlect': len(fm.get('lectures') or []) or 1,
            })
    return idx


def topic_summary(topic, idx):
    cands = idx.get(topic.get('module'), [])
    tn = _nums(topic.get('chapter')) if topic.get('chapter') is not None else _nums(topic.get('lectures'))
    course = (topic.get('course') or '').lower()
    best = None
    for c in cands:
        cc = (c['course'] or '').lower()
        if cc and course and not (cc[:5] in course or course[:5] in cc or
                                  ('thermo' in cc and 'thermo' in course) or ('structure' in cc and 'structure' in course)):
            continue
        ov = len(tn & c['nums'])
        if ov and (best is None or ov > best[0]):
            best = (ov, c)
    return best[1] if best else None


def module_weights(root):
    out = {}
    mods = os.path.join(root, 'modules')
    for mdir in os.listdir(mods):
        p = os.path.join(mods, mdir, 'module.md')
        if not os.path.exists(p):
            continue
        fm, _ = mdstore.read(p)
        a = fm.get('assessment') or {}
        exam = a.get('exam') if isinstance(a, dict) else None
        out[fm.get('code') or mdir.split('-')[0]] = {
            'ects': fm.get('ects') or 10, 'exam_frac': (exam if exam is not None else 80) / 100.0, 'dir': mdir}
    return out


def exam_dates(root):
    fm, _ = mdstore.read(os.path.join(root, 'year', 'exams.md'))
    default = as_date((fm.get('main_period') or {}).get('from')) or dt.date(2027, 4, 26)
    out = {}
    for e in fm.get('exams') or []:
        out[e.get('module')] = as_date(e.get('date')) or default
    return out, default


def big_deadline_days(deadlines, settings):
    rule = settings.get('big_deadline') or {}
    pmin = rule.get('points_at_least', 1000)
    wmin = rule.get('weight_at_least', 30)
    before = int(settings.get('skip_days_before_big_deadlines', 1) or 0)
    days = {}
    for d in deadlines:
        pts = d.get('points') or 0
        w = d.get('weight') or 0
        if (isinstance(pts, (int, float)) and pts >= pmin) or (isinstance(w, (int, float)) and w >= wmin):
            due = as_dt(d.get('due'))
            if not due or str(d.get('status')) in ('done', 'submitted'):
                continue
            for k in range(before + 1):
                days[due.date() - dt.timedelta(days=k)] = d.get('item')
    return days


def activity_for(conf):
    if conf is None or conf < 2.5:
        return 'Read the lecture summary and notes, then try the matching problem-sheet questions'
    if conf < 3.5:
        return 'Problem-sheet questions from memory, then check against the solutions'
    if conf < 4.5:
        return 'One past-paper question on this topic, timed'
    return 'Quick recall check: write out key results, then one past-paper part'


def build(root, now=None):
    now = now or dt.datetime.now()
    settings = load_settings(root)
    tfm, _ = mdstore.read(os.path.join(root, 'revision', 'topic-tracker.md'))
    topics = [t for t in (tfm.get('topics') or []) if t.get('id')]
    dfm, _ = mdstore.read(os.path.join(root, 'deadlines.md'))
    deadlines = dfm.get('items') or []
    mweights = module_weights(root)
    exams, exam_default = exam_dates(root)
    idx = summary_index(root)
    unrated = float(settings.get('unrated_confidence', 2.5))

    # Each topic is weighted by the number of lectures it covers, as a share of the lectures
    # covered so far in its module; the module's weight is its ECTS x exam share of the mark.
    lect = {}
    for t in topics:
        s = topic_summary(t, idx)
        n = s['nlect'] if s else max(1, len(_nums(t.get('lectures'))) or 1)
        lect[t['id']] = n
    mod_lect = {}
    for t in topics:
        mod_lect[t.get('module')] = mod_lect.get(t.get('module'), 0) + lect[t['id']]

    state = {}
    for t in topics:
        mw = mweights.get(t.get('module'), {'ects': 10, 'exam_frac': 0.8})
        conf = t.get('confidence')
        last = as_date(t.get('last_reviewed'))
        s = topic_summary(t, idx)
        notes = s.get('notes') if s else None
        if isinstance(notes, list):
            notes = notes[0] if notes else None
        if notes:
            notes = re.sub(r'\s*\(.*$', '', str(notes)).strip()
        if not notes or notes.lower() in ('null', 'none') or not notes.endswith('.pdf'):
            notes = None
        state[t['id']] = {
            'topic': t, 'weight': mw['ects'] * mw['exam_frac'] * lect[t['id']] / float(mod_lect[t.get('module')]),
            'conf': float(conf) if conf is not None else unrated, 'rated': conf is not None,
            'last': last, 'summary': s['path'] if s else None,
            'notes': ('modules/%s/%s' % (s['mdir'], notes) if notes else None),
        }

    skip = {as_date(x) for x in (settings.get('skip_dates') or [])}
    bigdays = big_deadline_days(deadlines, settings)
    exam_set = set(exams.values())

    sessions, skipped = [], []
    for ph in settings.get('phases') or []:
        start, end = as_date(ph.get('from')), as_date(ph.get('to'))
        slots = parse_slots(ph.get('slots'))
        d = max(start, now.date())
        while d <= end:
            for wd, hh, mm, mins in sorted(slots, key=lambda x: (x[1], x[2])):
                if wd != d.weekday():
                    continue
                t0 = dt.datetime(d.year, d.month, d.day, hh, mm)
                if t0 <= now:
                    continue
                if d in skip:
                    continue
                if d in bigdays:
                    skipped.append({'date': d.isoformat(), 'reason': 'Before deadline: %s' % bigdays[d]})
                    continue
                if d in exam_set:
                    continue
                best, bscore = None, -1
                for tid, st in state.items():
                    last = st['last']
                    gap = (d - last).days if last else 60
                    interval = INTERVAL[max(1, min(5, int(round(st['conf']))))]
                    spacing = min(1.5, max(0.05, gap / float(interval)))
                    score = st['weight'] * ((6 - st['conf']) / 5.0) * spacing
                    ed = exams.get(st['topic'].get('module'), exam_default)
                    days_to_exam = (ed - d).days
                    if 0 < days_to_exam <= 10:
                        score *= 3.0
                    elif days_to_exam <= 0 and ed in exam_set and ph.get('name') == 'Exam period':
                        score *= 0.2
                    if sessions and sessions[-1]['date'] == d.isoformat() and sessions[-1]['topic_id'] == tid:
                        score *= 0.1
                    if score > bscore:
                        best, bscore = tid, score
                if best is None:
                    continue
                st = state[best]
                t1 = t0 + dt.timedelta(minutes=mins)
                sessions.append({
                    'date': d.isoformat(), 'start': t0.strftime('%H:%M'), 'end': t1.strftime('%H:%M'), 'minutes': mins,
                    'phase': ph.get('name'), 'topic_id': best, 'module': st['topic'].get('module'),
                    'topic': st['topic'].get('topic'), 'rated': st['rated'],
                    'activity': activity_for(st['conf'] if st['rated'] or st['last'] else None),
                    'summary': st['summary'], 'notes': st['notes'],
                })
                st['last'] = d
                st['conf'] = min(5.0, st['conf'] + 0.5)
            d += dt.timedelta(days=1)
    return {'generated': now.replace(microsecond=0).isoformat(), 'sessions': sessions, 'skipped': skipped,
            'topics_rated': sum(1 for s in state.values() if s['rated']), 'topics_total': len(state)}


def write(root, plan, short_names=None):
    short_names = short_names or {}
    sess = plan['sessions']
    hours = sum(s['minutes'] for s in sess) / 60.0
    lines = ['type: revision-plan',
             'generated: "%s"' % plan['generated'],
             'settings: revision/plan-settings.md',
             'topics_rated: %d' % plan['topics_rated'],
             'topics_total: %d' % plan['topics_total'],
             'total_hours: %.1f' % hours,
             'sessions:']
    for s in sess:
        parts = []
        for k in ('date', 'start', 'end', 'minutes', 'phase', 'topic_id', 'module', 'topic', 'activity', 'summary', 'notes'):
            parts.append('%s: %s' % (k, mdstore._scalar(s.get(k))))
        lines.append('  - {' + ', '.join(parts) + '}')
    fm = '\n'.join(lines)

    by_mod = {}
    for s in sess:
        by_mod[s['module']] = by_mod.get(s['module'], 0) + s['minutes'] / 60.0
    body = ['# Revision plan', '',
            'Made automatically from your topic confidence, module weightings, exam dates and deadlines. '
            'Change the weekly hours in `plan-settings.md`, rate topics on the dashboard\'s Revision page, '
            'and press **Regenerate plan** to rebuild it.', '']
    if plan['topics_rated'] < plan['topics_total']:
        body += ['> %d of %d topics are still unrated, so they are all treated as middling. '
                 'Rating them makes the plan much sharper.' % (plan['topics_total'] - plan['topics_rated'], plan['topics_total']), '']
    body += ['**Total:** %.0f hours in %d sessions until the end of the exam period.' % (hours, len(sess)), '',
             '| Module | Hours |', '|---|---|']
    for m, h in sorted(by_mod.items(), key=lambda x: -x[1]):
        body.append('| %s | %.0f |' % (short_names.get(m, m), h))
    body += ['', '## Next four weeks', '', '| Date | Time | Module | Topic | What to do |', '|---|---|---|---|---|']
    if sess:
        first = dt.date.fromisoformat(sess[0]['date'])
        for s in sess:
            if dt.date.fromisoformat(s['date']) > first + dt.timedelta(days=28):
                break
            d = dt.date.fromisoformat(s['date'])
            body.append('| %s | %s–%s | %s | %s | %s |' % (d.strftime('%a %-d %b'), s['start'], s['end'],
                                                          short_names.get(s['module'], s['module']), s['topic'], s['activity']))
    mdstore.write_new(os.path.join(root, 'revision', 'revision-plan.md'), fm, '\n'.join(body) + '\n')
    return plan
