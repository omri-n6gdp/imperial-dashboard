"""Ask a question, answered by Claude Code on this Mac (your Claude Pro plan).

The dashboard page sends the question plus the sources it found in your files; this runs
`claude -p` (Claude Code in non-interactive mode) in the dashboard folder with read-only tools
(Read, Grep, Glob), so Claude can open more of your notes if it needs to, and streams back what it
is reading and then the answer, one JSON object per line.

- Only runs on a Claude subscription login (Pro plan usage, shared with your chats). Before every question it
  checks `claude auth status` (no model call, nothing billed) and refuses if Claude Code would use an API key:
  an ANTHROPIC_API_KEY (environment or settings), an apiKeyHelper, a Console-account login ("/login managed key")
  or a cloud provider. As a second guard, a run is stopped the moment Claude Code reports an API key source.
  ANTHROPIC_API_KEY and similar variables are also removed from the environment it is started with.
- Nothing is written: only Read, Grep and Glob (plus WebSearch and WebFetch when the page asks for web
  access) are available; everything else is refused (--permission-mode dontAsk).
- Requests must carry the header X-ICD-Ask: 1, so other websites can't trigger it from your browser.

Endpoints (added to the v2 server by server.py):
  GET  /api/ask-claude/status   {found, path, version}
  POST /api/ask-claude          {prompt, system, system_mode?: 'replace', web?: bool, model?: sonnet|opus|haiku, effort?: low|medium|high}
                                -> application/x-ndjson stream:
       {"t":"start"} {"t":"tool","name":"Grep","what":"entropy"} {"t":"delta","text":"..."}
       {"t":"done","text":"...","seconds":12.3} or {"t":"error","text":"..."}
"""
import glob
import json
import os
import shutil
import subprocess
import threading
import time

TIMEOUT = 180            # seconds before a run is stopped
_status = {'at': 0, 'v': None}
_auth = {'at': 0, 'v': None}

SEARCH_PATHS = ['~/.local/bin/claude', '~/.claude/local/claude', '~/.npm-global/bin/claude',
                '/opt/homebrew/bin/claude', '/usr/local/bin/claude', '~/bin/claude']


def find_claude():
    for c in [shutil.which('claude')] + [os.path.expanduser(p) for p in SEARCH_PATHS]:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    for c in sorted(glob.glob(os.path.expanduser('~/.nvm/versions/node/*/bin/claude')), reverse=True):
        if os.access(c, os.X_OK):
            return c
    return None


def _env():
    env = dict(os.environ)
    for k in ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'):
        env.pop(k, None)
    extra = [os.path.expanduser('~/.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
    env['PATH'] = ':'.join(extra + [p for p in env.get('PATH', '').split(':') if p and p not in extra])
    return env


def auth(path=None, force=False, root=None):
    """How Claude Code on this Mac is signed in, and whether that is the subscription (never paid API credits).

    From `claude auth status --json`, which only reads the local login and calls no model:
      ok    = signed in with a Claude account (claude.ai) or a subscription token, with no API key source at all
      plan  = pro / max / team / enterprise when known
      why   = what is wrong otherwise (shown on the page)
    """
    if not force and _auth['v'] and time.time() - _auth['at'] < 60:
        return _auth['v']
    path = path or find_claude()
    v = {'ok': False, 'method': None, 'plan': None, 'key_source': None, 'email': None, 'why': None}
    if not path:
        v['why'] = 'Claude Code is not installed on this Mac.'
    else:
        try:
            out = subprocess.run([path, 'auth', 'status', '--json'], capture_output=True, text=True, timeout=20, env=_env(), cwd=root or None)
            d = json.loads(out.stdout or '{}')
        except Exception as e:  # noqa: BLE001
            d = {}
            v['why'] = "Couldn't check how Claude Code is signed in (%s)." % e
        v['method'], v['plan'], v['key_source'], v['email'] = d.get('authMethod'), d.get('subscriptionType'), d.get('apiKeySource'), d.get('email')
        if d and not d.get('loggedIn'):
            v['why'] = 'Claude Code is not signed in on this Mac.'
        elif d.get('apiKeySource'):
            v['why'] = 'Claude Code is set up to use an API key (%s), which bills API credits, not your Pro plan.' % (
                'from signing in with an Anthropic Console account' if d['apiKeySource'] == '/login managed key' else 'from ' + str(d['apiKeySource']))
        elif d.get('authMethod') in ('claude.ai', 'oauth_token'):
            v['ok'] = True
        elif d:
            v['why'] = {'api_key': 'Claude Code is signed in with an API key, which bills API credits.',
                        'api_key_helper': 'Claude Code gets an API key from an apiKeyHelper in its settings, which bills API credits.',
                        'third_party': 'Claude Code is set to use Bedrock or Vertex, which bills that cloud account.'}.get(d.get('authMethod'), 'Claude Code is signed in a way the dashboard does not recognise (%s), so it will not use it.' % d.get('authMethod'))
    _auth.update(at=time.time(), v=v)
    return v


def status(force=False):
    if not force and _status['v'] and time.time() - _status['at'] < 60:
        return _status['v']
    path = find_claude()
    v = {'found': bool(path), 'path': path, 'version': None}
    if path:
        try:
            out = subprocess.run([path, '--version'], capture_output=True, text=True, timeout=15, env=_env())
            v['version'] = (out.stdout or out.stderr).strip().splitlines()[0] if (out.stdout or out.stderr) else None
        except Exception as e:  # noqa: BLE001
            v['error'] = str(e)
        v['auth'] = auth(path, force=force)
    _status.update(at=time.time(), v=v)
    return v


def _what(name, inp):
    """A short description of a tool call, for the 'reading…' line."""
    inp = inp or {}
    if name == 'Read':
        return os.path.basename(str(inp.get('file_path', '')))
    if name == 'Grep':
        return str(inp.get('pattern', ''))[:60]
    if name == 'Glob':
        return str(inp.get('pattern', ''))[:60]
    if name == 'WebSearch':
        return str(inp.get('query', ''))[:80]
    if name == 'WebFetch':
        u = str(inp.get('url', ''))
        return u.split('/')[2] if '://' in u else u[:60]
    return ''


def handle(h, root):
    """Serve POST /api/ask-claude on the request handler h."""
    if h.headers.get('X-ICD-Ask') != '1':
        return h._send(403, {'error': 'missing header'})
    n = int(h.headers.get('Content-Length') or 0)
    try:
        body = json.loads(h.rfile.read(n) or b'{}')
    except ValueError:
        return h._send(400, {'error': 'bad json'})
    path = find_claude()
    if not path:
        return h._send(404, {'error': 'Claude Code is not installed on this Mac'})
    a = auth(path, force=True, root=root)        # checked before every question: never spend API credits
    if not a['ok']:
        return h._send(409, {'error': 'billing', 'auth': a, 'message': a['why']})
    tools = ['Read', 'Grep', 'Glob'] + (['WebSearch', 'WebFetch'] if body.get('web') else [])
    cmd = [path, '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
           '--tools', ','.join(tools), '--allowedTools', ','.join(tools), '--permission-mode', 'dontAsk',
           '--strict-mcp-config', '--no-session-persistence']
    if body.get('system'):
        cmd += ['--system-prompt' if body.get('system_mode') == 'replace' else '--append-system-prompt', str(body['system'])]
    if body.get('model') in ('sonnet', 'opus', 'haiku'):
        cmd += ['--model', body['model']]
    if body.get('effort') in ('low', 'medium', 'high'):
        cmd += ['--effort', body['effort']]

    h.send_response(200)
    h.send_header('Content-Type', 'application/x-ndjson; charset=utf-8')
    h.send_header('Cache-Control', 'no-store')
    h.send_header('Connection', 'close')
    h.end_headers()
    h.close_connection = True

    def emit(obj):
        h.wfile.write((json.dumps(obj, ensure_ascii=False) + '\n').encode('utf-8'))
        h.wfile.flush()

    t0 = time.time()
    try:
        p = subprocess.Popen(cmd, cwd=root, env=_env(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, bufsize=1)
    except OSError as e:
        return emit({'t': 'error', 'text': "Couldn't start Claude Code: %s" % e})
    killer = threading.Timer(TIMEOUT, p.kill)
    killer.start()
    err_lines = []
    threading.Thread(target=lambda: err_lines.extend(p.stderr.readlines()), daemon=True).start()
    done = False
    model = None
    try:
        emit({'t': 'start'})
        p.stdin.write(str(body.get('prompt', '')))
        p.stdin.close()
        for line in p.stdout:
            try:
                d = json.loads(line)
            except ValueError:
                continue
            t = d.get('type')
            if t == 'stream_event':
                e = d.get('event') or {}
                dl = e.get('delta') or {}
                if e.get('type') == 'content_block_delta' and dl.get('type') == 'text_delta':
                    emit({'t': 'delta', 'text': dl.get('text', '')})
                elif e.get('type') == 'message_start':
                    emit({'t': 'turn'})          # a new model turn: the page clears text from the previous one
            elif t == 'assistant':
                for c in (d.get('message') or {}).get('content') or []:
                    if c.get('type') == 'tool_use':
                        emit({'t': 'tool', 'name': c.get('name'), 'what': _what(c.get('name'), c.get('input')),
                              'path': (c.get('input') or {}).get('file_path')})
            elif t == 'system' and d.get('subtype') == 'init':
                if d.get('apiKeySource') not in (None, 'none'):          # second guard: stop before an API-billed answer
                    p.kill()
                    _auth.update(at=0, v=None)
                    done = True
                    emit({'t': 'error', 'billing': True, 'text': 'Stopped: Claude Code started with an API key (%s), which would bill API credits. Nothing was answered.' % d.get('apiKeySource')})
                    break
                model = d.get('model')
                emit({'t': 'model', 'model': model})
            elif t == 'result':
                done = True
                text = d.get('result') or ''
                u = d.get('usage') or {}
                usage = {'model': model, 'cost_usd': d.get('total_cost_usd'), 'turns': d.get('num_turns'),
                         'input': u.get('input_tokens'), 'output': u.get('output_tokens'),
                         'cache_read': u.get('cache_read_input_tokens'), 'cache_write': u.get('cache_creation_input_tokens')}
                if d.get('is_error') or d.get('subtype', 'success') != 'success':
                    emit({'t': 'error', 'text': text or d.get('subtype') or 'Claude Code stopped with an error.'})
                else:
                    emit({'t': 'done', 'text': text, 'seconds': round(time.time() - t0, 1), 'usage': usage})
        p.wait(timeout=10)
        if not done:
            msg = ''.join(err_lines[-6:]).strip()
            if time.time() - t0 >= TIMEOUT - 1:
                msg = 'Stopped after %d seconds.' % TIMEOUT
            emit({'t': 'error', 'text': msg or 'Claude Code ended without an answer (exit %s).' % p.returncode})
    except (BrokenPipeError, ConnectionResetError):
        p.kill()                                  # the page was closed or the question cancelled
    except Exception as e:  # noqa: BLE001
        try:
            emit({'t': 'error', 'text': '%s: %s' % (type(e).__name__, e)})
        except Exception:  # noqa: BLE001
            pass
    finally:
        killer.cancel()
        if p.poll() is None:
            p.kill()
