/* Python runner for the terminal (owner: terminal). A classic Web Worker: Pyodide + numpy.
 *
 *   in  { type: 'init' }                        out { type: 'ready', ok: true } | { type: 'ready', ok: false, error }
 *   in  { type: 'run', id, code, tests? }       out { type: 'result', id, stdout, stderr, error, errorLine, trace,
 *                                                     results: [{ name, passed, message, line, where, trace }], fatal? }
 *
 * The player's code runs in a fresh dict namespace with stdout/stderr captured, then the tests run in
 * that same namespace: every test_* function they define is called in order (a tests file without
 * test_* functions counts as one test; an empty one, or one that asserts nothing, gives no results).
 * Assertion messages, or the last traceback line, become the messages. Before each run the shared
 * modules (builtins, math, numpy, numpy.random, numpy.linalg), the recursion limit, numpy's error and
 * print modes, the global RNG and the warning filters are put back as they were after loading, so one
 * run cannot change the next. Timeouts are the caller's job: it terminates this worker and starts a new one.
 *
 * Pinned to Pyodide 0.29.5: the 314.x line no longer runs in classic workers.
 */
'use strict';

const PYODIDE_VERSION = '0.29.5';
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const RUNNER = String.raw`
import ast, builtins, gc, io, json, math, sys, traceback, warnings
import numpy, numpy.linalg, numpy.random  # pay the imports once, at load time

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
    lines = src if isinstance(src, list) else src.splitlines()
    return lines[n - 1].strip() if n and 0 < n <= len(lines) else ''


def _etl_trace(frames, code_lines):
    """The player's own frames, newest last, at most 6; a frame repeated in a row (recursion) is said once, ×N."""
    rows = []
    for f, n in frames:
        if f != _ETL_CODE:
            continue
        if rows and rows[-1][0] == n:
            rows[-1][1] += 1
        else:
            rows.append([n, 1])
    return '\n'.join(f'line {n}: {_etl_src_line(code_lines, n)}' + (f'  ×{k}' if k > 1 else '') for n, k in rows[-6:])


def _etl_fail(e, code, tests):
    frames = _etl_frames(e.__traceback__)
    where, line = _etl_where(e, frames)
    code_lines = code.splitlines()
    if isinstance(e, AssertionError) and str(e).strip():
        msg = str(e).strip()
    elif isinstance(e, AssertionError):
        msg = _etl_src_line(code_lines if where == _ETL_CODE else tests, line) or 'AssertionError'
    else:
        msg = traceback.format_exception_only(type(e), e)[-1].strip()
    # a short trace of the player's own frames, for a tooltip
    trace = _etl_trace(frames, code_lines)
    if isinstance(e, SyntaxError) and e.filename == _ETL_CODE and e.lineno:
        trace = f'line {e.lineno}: {_etl_src_line(code_lines, e.lineno)}'
    return {
        'message': msg,
        'where': 'code' if where == _ETL_CODE else ('tests' if where == _ETL_TESTS else None),
        'line': line if where == _ETL_CODE else None,
        'trace': trace,
    }


# Every run starts from the interpreter as it was after loading: a run that monkeypatches numpy or
# builtins, raises the recursion limit, changes numpy's error mode or seeds the global RNG must not
# change how the next run (or the next terminal) behaves.
_ETL_SNAP = [(m, dict(vars(m))) for m in (builtins, math, numpy, numpy.random, numpy.linalg)]
_ETL_REC = sys.getrecursionlimit()
_ETL_SETREC = sys.setrecursionlimit
_ETL_ERR = numpy.geterr()
_ETL_PRINT = numpy.get_printoptions()
_ETL_RNG = numpy.random.get_state()
_ETL_WARN = list(warnings.filters)


def _etl_restore():
    for m, snap in _ETL_SNAP:
        d = vars(m)
        for k in [k for k in d if k not in snap]:
            del d[k]
        d.update(snap)
        sys.modules[m.__name__] = m
    _ETL_SETREC(_ETL_REC)
    for undo in (
        lambda: sys.settrace(None),
        lambda: sys.setprofile(None),
        lambda: numpy.seterr(**_ETL_ERR),
        lambda: numpy.set_printoptions(**_ETL_PRINT),
        lambda: numpy.random.set_state(_ETL_RNG),
        lambda: (warnings.resetwarnings(), warnings.filters.extend(_ETL_WARN)),
    ):
        try:
            undo()
        except Exception:
            pass


def _etl_run(code, tests=None):
    code = code if isinstance(code, str) else ''
    tests = tests if isinstance(tests, str) else None   # JS null arrives as jsnull, not None
    _etl_restore()
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


def _etl_checks_something(tests):
    try:
        return any(isinstance(n, (ast.Assert, ast.Raise)) for n in ast.walk(ast.parse(tests)))
    except Exception:
        return True


def _etl_tests(ns, code, tests):
    def is_test(k, v):
        return k.startswith('test_') and callable(v) and getattr(getattr(v, '__code__', None), 'co_filename', '') == _ETL_TESTS

    if not tests.strip():
        return []   # no tests is not a pass
    try:
        exec(compile(tests, _ETL_TESTS, 'exec'), ns)
    except BaseException as e:
        # plain top-level asserts: the whole file is one test
        f = _etl_fail(e, code, tests)
        return [{'name': 'tests', 'passed': False, 'message': f['message'], 'line': f['line'], 'where': f['where'], 'trace': f['trace']}]
    found = sorted(((k, v) for k, v in ns.items() if is_test(k, v)), key=lambda kv: kv[1].__code__.co_firstlineno)
    if not found:
        # plain top-level asserts that all held: one passing test (a file that checks nothing is no test)
        if not _etl_checks_something(tests):
            return []
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
