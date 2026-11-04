/* Python runner for the terminal (owner: terminal). A classic Web Worker: Pyodide + numpy.
 *
 *   in  { type: 'init' }                        out { type: 'ready', ok: true } | { type: 'ready', ok: false, error }
 *   in  { type: 'run', id, code, tests? }       out { type: 'result', id, stdout, stderr, error, errorLine, trace,
 *                                                     results: [{ name, passed, message, line, where, trace }], fatal? }
 *
 * The player's code runs in a fresh dict namespace with stdout/stderr captured, then the tests run in
 * that same namespace: every test_* function they define is called in order (a tests file without
 * test_* functions counts as one test). Assertion messages, or the last traceback line, become the
 * messages. Timeouts are the caller's job: it terminates this worker and starts a new one.
 *
 * Pinned to Pyodide 0.29.5: the 314.x line no longer runs in classic workers.
 */
'use strict';

const PYODIDE_VERSION = '0.29.5';
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const RUNNER = String.raw`
import builtins, io, json, sys, traceback, gc

_ETL_CODE = '<your code>'
_ETL_TESTS = '<tests>'
_ETL_CAP = 20000


class _EtlOut(io.TextIOBase):
    """A capped text sink, so a print loop cannot eat the page."""

    def __init__(self):
        self.parts, self.n, self.cut = [], 0, False

    def writable(self):
        return True

    def write(self, s):
        s = str(s)
        room = _ETL_CAP - self.n
        if room > 0:
            self.parts.append(s[:room])
            self.n += min(len(s), room)
        if len(s) > max(room, 0):
            self.cut = True
        return len(s)

    def flush(self):
        pass

    def value(self):
        return ''.join(self.parts) + ('\n…' if self.cut else '')


def _etl_frames(tb):
    return [(f.f_code.co_filename, n) for f, n in traceback.walk_tb(tb)]


def _etl_where(e, frames):
    """(file, line) of the deepest frame in the player's code, else in the tests."""
    if isinstance(e, SyntaxError) and e.filename in (_ETL_CODE, _ETL_TESTS):
        return e.filename, e.lineno
    for want in (_ETL_CODE, _ETL_TESTS):
        hits = [n for f, n in frames if f == want]
        if hits:
            return want, hits[-1]
    return None, None


def _etl_src_line(src, n):
    lines = src.splitlines()
    return lines[n - 1].strip() if n and 0 < n <= len(lines) else ''


def _etl_fail(e, code, tests):
    frames = _etl_frames(e.__traceback__)
    where, line = _etl_where(e, frames)
    if isinstance(e, AssertionError) and str(e).strip():
        msg = str(e).strip()
    elif isinstance(e, AssertionError):
        msg = _etl_src_line(code if where == _ETL_CODE else tests, line) or 'AssertionError'
    else:
        msg = traceback.format_exception_only(type(e), e)[-1].strip()
    # a short trace of the player's own frames, for a tooltip
    trace = [f'line {n}: {_etl_src_line(code, n)}' for f, n in frames if f == _ETL_CODE]
    if isinstance(e, SyntaxError) and e.filename == _ETL_CODE and e.lineno:
        trace = [f'line {e.lineno}: {_etl_src_line(code, e.lineno)}']
    return {
        'message': msg,
        'where': 'code' if where == _ETL_CODE else ('tests' if where == _ETL_TESTS else None),
        'line': line if where == _ETL_CODE else None,
        'trace': '\n'.join(trace[-6:]),
    }


def _etl_run(code, tests=None):
    code = code if isinstance(code, str) else ''
    tests = tests if isinstance(tests, str) else None   # JS null arrives as jsnull, not None
    out, err = _EtlOut(), _EtlOut()
    ns = {'__name__': '__main__', '__builtins__': builtins}
    res = {'stdout': '', 'stderr': '', 'error': None, 'errorLine': None, 'trace': '', 'results': []}
    saved = sys.stdout, sys.stderr, sys.stdin
    sys.stdout, sys.stderr, sys.stdin = out, err, io.StringIO('')
    try:
        try:
            exec(compile(code, _ETL_CODE, 'exec'), ns)
        except BaseException as e:
            f = _etl_fail(e, code, tests or '')
            res['error'], res['errorLine'], res['trace'] = f['message'], f['line'], f['trace']
        if res['error'] is None and tests is not None:
            res['results'] = _etl_tests(ns, code, tests)
    finally:
        sys.stdout, sys.stderr, sys.stdin = saved
        ns.clear()
        gc.collect()
    res['stdout'], res['stderr'] = out.value(), err.value()
    return json.dumps(res)


def _etl_tests(ns, code, tests):
    def is_test(k, v):
        return k.startswith('test_') and callable(v) and getattr(getattr(v, '__code__', None), 'co_filename', '') == _ETL_TESTS

    try:
        exec(compile(tests, _ETL_TESTS, 'exec'), ns)
    except BaseException as e:
        # plain top-level asserts: the whole file is one test
        f = _etl_fail(e, code, tests)
        return [{'name': 'tests', 'passed': False, 'message': f['message'], 'line': f['line'], 'where': f['where'], 'trace': f['trace']}]
    found = sorted(((k, v) for k, v in ns.items() if is_test(k, v)), key=lambda kv: kv[1].__code__.co_firstlineno)
    if not found:
        return [{'name': 'tests', 'passed': True, 'message': '', 'line': None, 'where': None, 'trace': ''}]
    results = []
    for name, fn in found:
        try:
            fn()
            results.append({'name': name, 'passed': True, 'message': '', 'line': None, 'where': None, 'trace': ''})
        except BaseException as e:
            f = _etl_fail(e, code, tests)
            results.append({'name': name, 'passed': False, 'message': f['message'], 'line': f['line'], 'where': f['where'], 'trace': f['trace']})
    return results


import numpy  # pay the import once, at load time
`;

let booting = null;
let py = null;

function boot() {
  if (!booting) {
    booting = (async () => {
      importScripts(`${INDEX_URL}pyodide.js`);
      const quiet = () => {};
      py = await self.loadPyodide({ indexURL: INDEX_URL, stdout: quiet, stderr: quiet });
      await py.loadPackage('numpy', { messageCallback: quiet, errorCallback: quiet });
      py.runPython(RUNNER);
      return py;
    })();
    booting.catch(() => { booting = null; });
  }
  return booting;
}

function errText(err) {
  const s = String((err && (err.message || err)) || 'error');
  return s.split('\n').filter(Boolean).pop()?.slice(0, 300) || 'error';
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type === 'init') {
    try {
      await boot();
      self.postMessage({ type: 'ready', ok: true, version: PYODIDE_VERSION });
    } catch (err) {
      self.postMessage({ type: 'ready', ok: false, error: errText(err) });
    }
    return;
  }
  if (msg.type !== 'run') return;
  const id = msg.id;
  try {
    await boot();
  } catch (err) {
    self.postMessage({ type: 'result', id, stdout: '', stderr: '', error: errText(err), errorLine: null, trace: '', results: [], offline: true });
    return;
  }
  let run = null;
  try {
    run = py.globals.get('_etl_run');
    const json = typeof msg.tests === 'string' ? run(String(msg.code ?? ''), msg.tests) : run(String(msg.code ?? ''));
    self.postMessage({ type: 'result', id, ...JSON.parse(json) });
  } catch (err) {
    // a Python-level problem is caught inside _etl_run, so this is the interpreter itself failing
    self.postMessage({ type: 'result', id, stdout: '', stderr: '', error: errText(err), errorLine: null, trace: '', results: [], fatal: true });
  } finally {
    try { run?.destroy?.(); } catch { /* already gone */ }
  }
};
