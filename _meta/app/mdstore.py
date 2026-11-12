"""Read and safely update the Imperial Dashboard .md files.

Every .md file starts with a YAML frontmatter block between two '---' lines. Lists that the app
edits (problem sheets, topics, deadlines) keep one item per line in YAML flow style:
    - {id: P1, file: problems1.pdf, status: not-started}
Edits change only the values on that one line (plus the matching row of the human-readable
table, if there is one), re-parse the whole frontmatter to prove it is still valid YAML with
the intended values, and then replace the file atomically. Nothing else in the file moves.
"""
import datetime as dt
import json
import os
import re
import sys
import tempfile

try:
    import yaml  # noqa: F401
except ImportError:  # use the bundled pure-Python PyYAML
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vendor'))
    import yaml  # noqa: F401

FM_RE = re.compile(r'\A---\n(.*?)\n---[ \t]*\n?', re.S)


class EditError(Exception):
    pass


def read(path):
    """Return (frontmatter dict, body text) for an .md file."""
    with open(path, encoding='utf-8') as f:
        s = f.read()
    m = FM_RE.match(s)
    if not m:
        return {}, s
    try:
        data = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        data = {}
    return data, s[m.end():]


def plain(v):
    """Make YAML values JSON-friendly (dates become ISO strings)."""
    if isinstance(v, dict):
        return {str(k): plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [plain(x) for x in v]
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    return v


def _scalar(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v)
    if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 _.\-]*', s) and s.lower() not in ('null', 'true', 'false', 'yes', 'no', 'on', 'off', '~'):
        return s
    return json.dumps(s, ensure_ascii=False)


def _set_key(line, key, value):
    """Set key: value inside a single-line YAML flow mapping."""
    val = _scalar(value)
    pat = re.compile(r'(?<=[{,])(\s*)' + re.escape(key) + r'(\s*:\s*)("(?:[^"\\]|\\.)*"|\'[^\']*\'|\[[^\]]*\]|[^,}]*)')
    if pat.search(line):
        return pat.sub(lambda m: m.group(1) + key + m.group(2) + val, line, count=1)
    i = line.rstrip().rfind('}')
    if i < 0:
        raise EditError('not a flow mapping line')
    return line[:i].rstrip() + ', ' + key + ': ' + val + line[i:]


def _atomic_write(path, text):
    d = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(prefix='.tmp-', suffix='.md', dir=d)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(text)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def update_list_item(path, list_key, index, updates, check=None, table_updates=None):
    """Update item `index` of frontmatter list `list_key`.

    updates: {key: value} to set on that item's flow line.
    check(item) -> bool: must hold for the item before editing (guards against stale indexes).
    table_updates: (row_key, {column_header_substring: cell_text}) to also refresh the body table row
                   whose first cell equals row_key.
    """
    with open(path, encoding='utf-8') as f:
        s = f.read()
    m = FM_RE.match(s)
    if not m:
        raise EditError('no frontmatter in ' + path)
    fm_text = m.group(1)
    data = yaml.safe_load(fm_text) or {}
    items = data.get(list_key)
    if not isinstance(items, list) or not (0 <= index < len(items)):
        raise EditError('item not found')
    if check and not check(items[index]):
        raise EditError('the file changed since it was loaded; reload and try again')

    lines = fm_text.split('\n')
    try:
        start = next(i for i, l in enumerate(lines) if re.match(re.escape(list_key) + r'\s*:\s*$', l))
    except StopIteration:
        raise EditError('list %s is not in block style' % list_key)
    n = -1
    target = None
    for i in range(start + 1, len(lines)):
        l = lines[i]
        if re.match(r'\s*-\s', l):
            n += 1
            if n == index:
                target = i
                break
        elif l.strip() and not l.startswith(' ') and not l.startswith('\t'):
            break
    if target is None or not re.match(r'\s*-\s*\{.*\}\s*$', lines[target]):
        raise EditError('item is not on a single line; edit the file by hand')
    line = lines[target]
    for k, v in updates.items():
        line = _set_key(line, k, v)
    lines[target] = line
    new_fm = '\n'.join(lines)

    new_data = yaml.safe_load(new_fm) or {}
    got = new_data.get(list_key, [])[index]
    for k, v in updates.items():
        gv = got.get(k)
        if isinstance(gv, (dt.date, dt.datetime)):
            gv = gv.isoformat()
        if gv != v and str(gv) != str(v):
            raise EditError('verification failed for %s' % k)

    body = s[m.end():]
    if table_updates:
        body = _update_table_row(body, *table_updates)
    _atomic_write(path, s[:m.start(1)] + new_fm + s[m.end(1):m.end()] + body)
    return plain(got)


def _update_table_row(body, row_key, cells):
    lines = body.split('\n')
    header = None
    for i, l in enumerate(lines):
        if not l.lstrip().startswith('|'):
            header = None
            continue
        parts = [p.strip() for p in l.strip().strip('|').split('|')]
        if header is None:
            header = parts
            continue
        if set(''.join(parts)) <= set('-: '):
            continue
        if parts and parts[0] == row_key:
            for col_sub, text in cells.items():
                idx = next((j for j, h in enumerate(header) if col_sub.lower() in h.lower()), None)
                if idx is not None and idx < len(parts):
                    parts[idx] = text
            lines[i] = '| ' + ' | '.join(parts) + ' |'
    return '\n'.join(lines)


def write_new(path, frontmatter_text, body):
    """Write a whole generated file (e.g. the revision plan), validating the frontmatter first."""
    yaml.safe_load(frontmatter_text)
    _atomic_write(path, '---\n' + frontmatter_text.rstrip('\n') + '\n---\n\n' + body)
