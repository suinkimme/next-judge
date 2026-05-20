// C/C++ 채점 워커의 공통 로직. c.js / cpp.js 가 importScripts 로 로드한 뒤
// setupClangWorker({...}) 를 호출해 언어별 컴파일 플래그만 주입한다.
//
// 종속성:
//   - clang-shared.js  : binji/wasm-clang 의 패치본 (hostWrite 콜백을 (fd,str) 시그니처로 변경)
//   - /judge-workers/clang/{memfs, sysroot.tar}  : 동일 origin 정적 자산
//   - clang, lld 바이너리 : 우선 /judge-workers/clang/clang 으로 동일 origin 시도,
//                            config.json 이 있으면 그쪽 URL(Vercel Blob 등) 사용
//
// 워커 출력 메시지 프로토콜 (lib/judge/types.ts):
//   { type: 'ready' }
//   { type: 'result', caseIndex, result }
//   { type: 'done' }
//   { type: 'error', message }

/* global API */

const SMALL_BASE = '/judge-workers/clang/'

// shared.js 의 App 클래스가 글로벌 canvas / ctx2d 를 참조한다.
// Web Worker 환경에는 DOM 이 없으므로 미리 null 로 선언해 ReferenceError 회피.
self.canvas = null
self.ctx2d = null

// BOJ 출력 정규화 — lib/judge/normalize.ts 와 동일 규칙. python.js 와 sync 유지.
function normalizeOutput(s) {
  const lines = s.split('\n').map((l) => l.replace(/[ \t\r]+$/, ''))
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

// 컴파일러 진단/에러 메시지에서 ANSI 색상 코드 제거.
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

// 멀티라인 메시지에서 가장 정보가 있는 마지막 줄을 추출.
function lastInformativeLine(s) {
  const lines = stripAnsi(s).split('\n').map((l) => l.trim()).filter(Boolean)
  return lines[lines.length - 1] || ''
}

// 컴파일러 로그에서 사용자에게 보일 한 줄짜리 에러 메시지를 추출.
// clang 진단 라인("foo.c:5:3: error: ..."), 그 다음 lld 에러,
// 둘 다 없으면 App.run 에서 나온 메시지(예: "Error: process exited with code 1")는
// 잘라내고 그 직전 라인을 fallback 으로 사용한다.
function extractCompileError(compileLog) {
  const lines = stripAnsi(compileLog).split('\n').map((l) => l.trim()).filter(Boolean)
  for (const l of lines) {
    if (l.includes(' error:') || l.includes(' fatal error:')) return l
  }
  for (const l of lines) {
    if (l.startsWith('lld: error:')) return l
  }
  // App.run 의 "Error: process exited..." 라인은 정보가 없으므로 건너뛴다.
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (l.startsWith('Error: process exited')) continue
    if (l.startsWith('at ')) continue
    return l
  }
  return ''
}

// 동적으로 교체 가능한 hostWrite sink. 단계별로 다르게 동작:
//   - init  : 모든 출력 무시
//   - 컴파일 : 모든 출력을 compileLog 에 누적 (에러 시 진단 메시지로 사용)
//   - 실행  : fd===1 만 stdout 버퍼에 누적 (fd===2 는 무시)
let writeSink = (_fd, _str) => {}

// binji/wasm-clang 의 prebuilt libc++.a 가 long-double soft-float 비교 루틴
// `__lttf2` 를 import 하지만, sysroot 에 compiler-rt builtins 가 빠져 있어
// 사용자 코드가 std::sort 같은 stdlib 함수를 쓰면 lld 가 unresolved symbol 로
// 실패한다. 보통 BOJ 코드는 long double 을 안 쓰므로 호출되지 않을 가능성이
// 높지만 링크는 통과해야 하므로 더미 stub 을 별도 .o 로 컴파일해 함께 링크.
const STUB_SOURCE = `
int __lttf2(long double a, long double b) {
  // never expected to be called for typical BOJ programs (no 128-bit long double).
  // present only to satisfy lld's reference from libc++.a(algorithm.cpp.obj).
  return 0;
}
`
const STUB_FILE = 'judge-stubs.c'
const STUB_OBJ = 'judge-stubs.o'

function setupClangWorker(opts) {
  const { lang, stdFlag, linkLibs, sourceFile } = opts

  let api = null
  // ready 시점에 1회 컴파일된 stub .o — 이후 모든 컴파일에서 재사용.
  let stubsCompiled = false

  async function loadConfig() {
    // 큰 바이너리(clang, lld)의 위치를 동적으로 결정.
    // config.json이 있으면 그 안의 URL을 사용 (운영용 Vercel Blob),
    // 없으면 동일 origin의 SMALL_BASE에서 로드 (개발/로컬 fallback).
    let cfg = {}
    try {
      const res = await fetch(SMALL_BASE + 'config.json', { cache: 'no-store' })
      if (res.ok) cfg = await res.json()
    } catch (_) {
      // config 없음 — fallback 사용
    }
    return {
      clangUrl: cfg.clangUrl || SMALL_BASE + 'clang',
      lldUrl: cfg.lldUrl || SMALL_BASE + 'lld',
    }
  }

  async function init() {
    try {
      const { clangUrl, lldUrl } = await loadConfig()

      api = new API({
        readBuffer: async (url) => {
          const res = await fetch(url)
          if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`)
          return await res.arrayBuffer()
        },
        compileStreaming: async (url) => {
          // application/wasm 헤더가 없으면 instantiateStreaming은 실패하므로
          // arrayBuffer 후 compile 폴백을 함께 둔다.
          try {
            return await WebAssembly.compileStreaming(fetch(url))
          } catch (_) {
            const res = await fetch(url)
            if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`)
            return await WebAssembly.compile(await res.arrayBuffer())
          }
        },
        hostWrite: (fd, str) => writeSink(fd, str),
        memfs: SMALL_BASE + 'memfs',
        sysroot: SMALL_BASE + 'sysroot.tar',
        clang: clangUrl,
        lld: lldUrl,
      })

      await api.ready

      // clang/lld 사전 컴파일 — 첫 채점 시 다운로드/컴파일 지연을 ready 단계로 흡수.
      // 사용자는 'loading' 동안만 기다리고, 'ready' 이후 채점은 즉시 시작.
      await Promise.all([
        api.getModule(api.clangFilename),
        api.getModule(api.lldFilename),
      ])

      // libc++ 가 참조하지만 sysroot 에 없는 builtins 의 stub 을 한 번 컴파일.
      try {
        await compileStubs()
        stubsCompiled = true
      } catch (e) {
        // stubs 가 실패하면 std::sort 류는 못 쓰지만 나머지(printf, cin/cout) 는 동작.
        // 에러로 봉인하지 말고 ready 후 사용자가 stdlib 안 쓰는 코드는 정상 채점되도록 통과.
        console.warn('[clang-worker] stub compile failed:', e?.message || e)
      }

      self.postMessage({ type: 'ready' })
    } catch (e) {
      self.postMessage({
        type: 'error',
        message: stripAnsi(String(e?.message || e)),
      })
    }
  }

  // libc++ 가 참조하는 미해결 builtins 의 stub 을 미리 컴파일해 memfs 에 보관.
  async function compileStubs() {
    api.memfs.addFile(STUB_FILE, STUB_SOURCE)
    const clang = await api.getModule(api.clangFilename)
    await api.run(
      clang, 'clang', '-cc1', '-emit-obj',
      ...api.clangCommonArgs,
      '-O2',
      '-o', STUB_OBJ,
      '-x', 'c', STUB_FILE,
    )
  }

  // 사용자 코드를 .o → .wasm 로 컴파일 후 WebAssembly.Module 반환.
  // 실패 시 compileLog 의 마지막 정보 라인을 message 로 throw.
  async function compileSource(code) {
    const obj = 'prog.o'
    const wasm = 'prog.wasm'
    const libdir = 'lib/wasm32-wasi'

    api.memfs.addFile(sourceFile, code)

    let compileLog = ''
    writeSink = (_fd, str) => {
      compileLog += str
    }

    try {
      const clang = await api.getModule(api.clangFilename)
      await api.run(
        clang, 'clang', '-cc1', '-emit-obj',
        ...api.clangCommonArgs,
        stdFlag, '-O2',
        '-o', obj,
        '-x', lang, sourceFile,
      )

      const lld = await api.getModule(api.lldFilename)
      const linkInputs = [libdir + '/crt1.o', obj]
      if (stubsCompiled) linkInputs.push(STUB_OBJ)
      await api.run(
        lld, 'wasm-ld', '--no-threads', '--export-dynamic',
        '-z', 'stack-size=1048576',
        '-L' + libdir,
        ...linkInputs,
        ...linkLibs,
        '-o', wasm,
      )

      // memfs 의 내부 버퍼는 다음 작업에서 reallocate 될 수 있으므로 즉시 복사.
      const view = api.memfs.getFileContents(wasm)
      const bytes = new Uint8Array(view.length)
      bytes.set(view)
      return await WebAssembly.compile(bytes)
    } catch (e) {
      const fromLog = extractCompileError(compileLog)
      const fromExn = lastInformativeLine(String(e?.message || e))
      const message = fromLog || fromExn || '컴파일 실패'
      throw new Error(message)
    } finally {
      writeSink = (_fd, _str) => {}
    }
  }

  // 컴파일된 WebAssembly.Module 을 stdin 과 함께 1회 실행하고 stdout 캡처.
  async function runCase(compiledModule, input) {
    api.memfs.setStdinStr(input)

    let stdoutBuf = ''
    writeSink = (fd, str) => {
      // fd=1 : 사용자 프로그램 stdout — 채점 비교 대상
      // fd=2 : 사용자 stderr / App.run 의 에러 출력 — 무시
      if (fd === 1) stdoutBuf += str
    }

    try {
      await api.run(compiledModule, 'prog')
    } finally {
      writeSink = (_fd, _str) => {}
    }
    return stdoutBuf
  }

  self.onmessage = async (event) => {
    const msg = event.data
    if (!msg || msg.type !== 'run') return
    if (!api) {
      self.postMessage({ type: 'error', message: 'runtime not initialized' })
      return
    }

    const { code, cases } = msg

    // --- 컴파일 단계: run 1회당 1번만 ---
    let compiledModule = null
    let compileErrorMessage = null
    try {
      compiledModule = await compileSource(code)
    } catch (e) {
      compileErrorMessage = e?.message || '컴파일 실패'
    }

    if (compileErrorMessage) {
      // 컴파일 실패 → 모든 케이스를 RE 로 보고.
      for (let i = 0; i < cases.length; i++) {
        const { input, expected, hidden } = cases[i]
        self.postMessage({
          type: 'result',
          caseIndex: i,
          result: {
            verdict: 'RE',
            elapsedMs: undefined,
            input,
            expected,
            actual: undefined,
            errorMessage: compileErrorMessage,
            hidden,
          },
        })
      }
      self.postMessage({ type: 'done' })
      return
    }

    // --- 실행 단계: 케이스마다 새 instance 로 실행 ---
    for (let i = 0; i < cases.length; i++) {
      const { input, expected, hidden } = cases[i]
      const start = performance.now()

      try {
        const raw = await runCase(compiledModule, input)
        const actual = normalizeOutput(raw)
        const expectedNorm = hidden ? '' : normalizeOutput(expected)
        // hidden 케이스는 placeholder 'AC' — 호출자(useJudge)가 서버 verify 응답으로 덮어씀.
        const verdict = hidden
          ? 'AC'
          : actual === expectedNorm
            ? 'AC'
            : 'WA'
        const elapsedMs = Math.round(performance.now() - start)

        self.postMessage({
          type: 'result',
          caseIndex: i,
          result: {
            verdict,
            elapsedMs,
            input,
            expected,
            actual,
            errorMessage: undefined,
            hidden,
          },
        })
      } catch (e) {
        // ProcExit(non-0) / WASM trap / 메모리 오류 등 — RE 처리.
        const elapsedMs = Math.round(performance.now() - start)
        const errorMessage =
          lastInformativeLine(String(e?.message || e)) || 'runtime error'

        self.postMessage({
          type: 'result',
          caseIndex: i,
          result: {
            verdict: 'RE',
            elapsedMs,
            input,
            expected,
            actual: undefined,
            errorMessage,
            hidden,
          },
        })
      }
    }

    self.postMessage({ type: 'done' })
  }

  init()
}

// c.js / cpp.js 에서 호출.
self.setupClangWorker = setupClangWorker
