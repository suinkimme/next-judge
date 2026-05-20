// BOJ 스타일 출력 정규화. 워커(브라우저)와 verify API 라우트(서버)에서 같은
// 규칙으로 비교해야 한다. 워커는 .js라 이 모듈을 import할 수 없으므로 같은
// 로직을 양쪽에 별도로 둔다 — 변경 시 둘 다 동시에 손볼 것 (public/python-judge-worker.js).
//
// 규칙:
//   1) 각 줄의 trailing 공백/탭 제거
//   2) trailing 빈 줄 제거
//   3) 그 외엔 그대로 유지 (대소문자 구분, 줄 사이 공백 유지)
export function normalizeOutput(s: string): string {
  const lines = s.split('\n').map((l) => l.replace(/[ \t\r]+$/, ''))
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}
