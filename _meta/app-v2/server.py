#!/usr/bin/env python3
"""Imperial Dashboard v2: the new front end.

Runs the same data server as the original app (../app/server.py), so both read and
write the same files, but serves the pages in ./static instead. Default port 8766,
so the original site can keep running on 8765 at the same time.

Adds, for the "Ask" pill: GET /api/ask-claude/status and POST /api/ask-claude (see ask_claude.py),
and GET /api/server-version, which the Dock app uses to restart an out-of-date server.

Run:  python3 server.py              (opens http://127.0.0.1:8766)
      python3 server.py --port 9001 --no-browser
"""
import os
import sys
import urllib.parse

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'app'))
sys.path.append(HERE)
import server as base  # noqa: E402  (the original app's server, unchanged)
import ask_claude  # noqa: E402

SERVER_VERSION = '2026-11-10-fix3'      # change when this file or ask_claude.py changes; the Dock app restarts on a mismatch
base.STATIC = os.path.join(HERE, 'static')

# Always re-check the page's own files, so a refresh shows the latest version.
_end_headers = base.Handler.end_headers


def _end_headers_no_cache(self):
    path = self.path.split('?', 1)[0]
    if path in ('/', '/index.html') or path.startswith('/static/'):
        self.send_header('Cache-Control', 'no-cache')
    _end_headers(self)


base.Handler.end_headers = _end_headers_no_cache

_get, _post = base.Handler.do_GET, base.Handler.do_POST


def do_GET(self):
    path = urllib.parse.urlparse(self.path).path
    if path in ('/api/server-version', '/api/ask-claude/status') and not self._allowed():
        return      # (every other address is checked inside the original server's own do_GET)
    if path == '/api/server-version':
        return self._send(200, {'version': SERVER_VERSION})
    if path == '/api/ask-claude/status':
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        return self._send(200, _ask().status(force='force' in qs))
    return _get(self)


_ask_mtime = [os.path.getmtime(ask_claude.__file__)]


def _ask():
    """ask_claude.py, reloaded if it has changed, so changes to it don't need a server restart."""
    global ask_claude
    m = os.path.getmtime(ask_claude.__file__)
    if m != _ask_mtime[0]:
        import importlib
        ask_claude = importlib.reload(ask_claude)
        _ask_mtime[0] = m
    return ask_claude


def do_POST(self):
    if urllib.parse.urlparse(self.path).path == '/api/ask-claude':
        if not self._allowed():
            return
        return _ask().handle(self, base.ROOT)
    return _post(self)


base.Handler.do_GET = do_GET
base.Handler.do_POST = do_POST

if '--port' not in sys.argv:
    sys.argv[1:1] = ['--port', '8766']

if __name__ == '__main__':
    base.main()
