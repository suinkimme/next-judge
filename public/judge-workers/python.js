// Pyodide judge worker.
//
// Lifecycle:
//   1. importScripts loads Pyodide from CDN (~15MB on first visit, then cached).
//   2. Posts { type: 'ready' } once Pyodide is initialized.
//   3. On { type: 'run', code, cases }, runs each case sequentially.
//   4. Posts { type: 'result', caseIndex, result } per case.
//   5. Posts { type: 'done' } after the last case.
//   6. Posts { type: 'error', message } on catastrophic load failure.

importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.3/full/pyodide.js')

let pyodide = null

async function init() {
  try {
    // eslint-disable-next-line no-undef
    pyodide = await loadPyodide()
    self.postMessage({ type: 'ready' })
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e) })
  }
}

init()

// BOJ-style output normalization: trim trailing whitespace per line, drop
// trailing blank lines. Case-sensitive otherwise.
function normalizeOutput(s) {
  const lines = s.split('\n').map((l) => l.replace(/[ \t\r]+$/, ''))
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

async function runCase(code, input, expected, hidden) {
  // 비교는 정규화된 값으로, 결과에 담는 expected는 사용자가 입력한 원본 그대로.
  // 스냅샷 — 사용자가 채점 후 user case 입력을 수정해도 결과 탭은 채점 시점의
  // 값을 보여줘야 한다.
  // hidden=true이면 expected는 ''(서버에만 있음). 비교를 스킵하고 verdict는
  // 'AC' placeholder로 둔다 — 호출자(hook)가 서버 verify 응답으로 덮어쓴다.
  const expectedNormalized = hidden ? '' : normalizeOutput(expected)
  const start = performance.now()

  // Stream redirection happens in module-globals (sys.stdin/sys.stdout). We
  // back them up here and restore after each case so leftover state can't
  // pollute future runs.
  await pyodide.runPythonAsync(
    `import sys, io
_stdin_bak = sys.stdin
_stdout_bak = sys.stdout
sys.stdin = io.StringIO(${JSON.stringify(input)})
sys.stdout = io.StringIO()`,
  )

  try {
    // Run the user code in a fresh global namespace so variables/functions
    // from one case do not leak into the next. __builtins__ must be injected
    // explicitly because exec() with an empty globals dict has no builtins.
    await pyodide.runPythonAsync(
      `exec(compile(${JSON.stringify(
        code,
      )}, '<user>', 'exec'), {'__builtins__': __import__('builtins')})`,
    )

    const actual = normalizeOutput(
      await pyodide.runPythonAsync('sys.stdout.getvalue()'),
    )
    const elapsedMs = Math.round(performance.now() - start)
    // hidden 케이스는 비교를 안 한다. verdict='AC'는 임시값일 뿐, hook이 서버
    // verify 응답으로 덮어쓴다. RE/TLE는 그대로 client-side 결정.
    const verdict = hidden ? 'AC' : actual === expectedNormalized ? 'AC' : 'WA'

    return {
      verdict,
      elapsedMs,
      input,
      expected,
      actual,
      errorMessage: undefined,
      hidden,
    }
  } catch (e) {
    const elapsedMs = Math.round(performance.now() - start)
    const message = String(e)
    // Pyodide stringifies PythonError as a multi-line traceback; surface only
    // the most informative line (the final "ExceptionType: message" line).
    const lines = message.split('\n').filter((l) => l.trim())
    const errorMessage = lines[lines.length - 1] ?? message

    return {
      verdict: 'RE',
      elapsedMs,
      input,
      expected,
      actual: undefined,
      errorMessage,
      hidden,
    }
  } finally {
    try {
      await pyodide.runPythonAsync(
        'sys.stdin = _stdin_bak\nsys.stdout = _stdout_bak',
      )
    } catch (_) {
      // streams may not be backed up if init failed; ignore.
    }
  }
}

self.onmessage = async (event) => {
  const msg = event.data
  if (!msg || msg.type !== 'run') return
  if (!pyodide) {
    self.postMessage({ type: 'error', message: 'Pyodide not initialized' })
    return
  }

  const { code, cases } = msg
  for (let i = 0; i < cases.length; i++) {
    const { input, expected, hidden } = cases[i]
    const result = await runCase(code, input, expected, hidden === true)
    self.postMessage({ type: 'result', caseIndex: i, result })
  }
  self.postMessage({ type: 'done' })
}
