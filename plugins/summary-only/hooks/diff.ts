export type OpKind = '=' | '-' | '+'
export type Op = [OpKind, string[]] | ['~', number]

export type FileStatus = 'added' | 'deleted' | 'modified'

export type FileDiff = {
  path: string
  display: string
  status: FileStatus
  ops: Op[]
  added: number
  removed: number
  isEolChanged: boolean
}

export const MAX_EDITS = 1500

export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function push(ops: Op[], kind: OpKind, lines: string[]): void {
  if (lines.length === 0) return
  const last = ops[ops.length - 1]
  if (last !== undefined && last[0] === kind) {
    for (const line of lines) last[1].push(line)
    return
  }
  ops.push([kind, [...lines]])
}

export function trimEqual(ops: Op[], keep: number): Op[] {
  return ops.flatMap((op, index): Op[] => {
    if (op[0] !== '=') return [op]
    const lines = op[1]
    const head = index === 0 ? 0 : keep
    const tail = index === ops.length - 1 ? 0 : keep
    if (lines.length <= head + tail + 1) return [op]
    const trimmed: Op[] = []
    if (head > 0) trimmed.push(['=', lines.slice(0, head)])
    trimmed.push(['~', lines.length - head - tail])
    if (tail > 0) trimmed.push(['=', lines.slice(lines.length - tail)])
    return trimmed
  })
}

function myers(a: string[], b: string[], maxEdits: number): Op[] | undefined {
  const n = a.length
  const m = b.length
  const limit = Math.min(n + m, maxEdits)
  const offset = limit + 1
  const v = new Int32Array(2 * limit + 3)
  const trace: Int32Array[] = []
  let found = -1

  for (let d = 0; d <= limit && found < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2))
    for (let k = -d; k <= d; k += 2) {
      const goesDown = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
      let x = goesDown ? v[offset + k + 1]! : v[offset + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
  }
  if (found < 0) return undefined

  const steps: [OpKind, string][] = []
  let x = n
  let y = m
  for (let d = found; d >= 0; d--) {
    const prev = trace[d]!
    const at = (k: number) => prev[k + d + 1]!
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = d === 0 ? 0 : at(prevK)
    const prevY = d === 0 ? 0 : prevX - prevK
    while (x > prevX && y > prevY) {
      steps.push(['=', a[x - 1]!])
      x--
      y--
    }
    if (d > 0) {
      if (x === prevX) steps.push(['+', b[prevY]!])
      else steps.push(['-', a[prevX]!])
    }
    x = prevX
    y = prevY
  }

  const ops: Op[] = []
  for (let i = steps.length - 1; i >= 0; i--) {
    const [kind, line] = steps[i]!
    push(ops, kind, [line])
  }
  return ops
}

export function diffLines(a: string[], b: string[], maxEdits = MAX_EDITS): Op[] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const ops: Op[] = []
  push(ops, '=', a.slice(0, start))
  const middle: Op[] = myers(midA, midB, maxEdits) ?? [
    ['-', midA],
    ['+', midB],
  ]
  for (const op of middle) if (op[0] !== '~') push(ops, op[0], op[1])
  push(ops, '=', a.slice(endA))
  return ops
}

const hasCrlf = (text: string) => text.includes('\r\n')

export function diffFile(
  path: string,
  display: string,
  before: string | null,
  after: string | null,
): FileDiff | undefined {
  if (before === after) return undefined
  if (before === null && after === null) return undefined

  const ops = diffLines(splitLines(before ?? ''), splitLines(after ?? ''))
  const count = (kind: OpKind) =>
    ops.reduce((sum, op) => (op[0] === kind ? sum + op[1].length : sum), 0)
  const status: FileStatus =
    before === null ? 'added' : after === null ? 'deleted' : 'modified'
  const isEolChanged =
    before !== null && after !== null && before !== '' && after !== '' && hasCrlf(before) !== hasCrlf(after)

  return {
    path,
    display,
    status,
    ops,
    added: count('+'),
    removed: count('-'),
    isEolChanged,
  }
}
