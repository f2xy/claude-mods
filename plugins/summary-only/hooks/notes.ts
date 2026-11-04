import type { FileDiff } from './diff'

export type NoteKind = 'important' | 'risk' | 'info'
export type NoteSide = 'new' | 'old'
export type Note = { side: NoteSide; line: number; kind: NoteKind; text: string }
export type FileReview = { summary: string; notes: Note[] }
export type Review = { summary: string; files: Map<string, FileReview> }

const CONTEXT = 3
const MAX_PROMPT_DIFF_CHARS = 80_000
const MAX_NOTES_PER_FILE = 8
const KINDS: readonly NoteKind[] = ['important', 'risk', 'info']

type Row = { t: '=' | '-' | '+'; a?: number; b?: number; text: string } | { t: '~'; count: number }

function toRows(diff: FileDiff): Row[] {
  const rows: Row[] = []
  let a = 1
  let b = 1
  for (const op of diff.ops) {
    if (op[0] === '~') {
      rows.push({ t: '~', count: op[1] })
      a += op[1]
      b += op[1]
      continue
    }
    for (const text of op[1]) {
      if (op[0] === '=') rows.push({ t: '=', a: a++, b: b++, text })
      else if (op[0] === '-') rows.push({ t: '-', a: a++, text })
      else rows.push({ t: '+', b: b++, text })
    }
  }
  return rows
}

export function numberedDiff(diff: FileDiff, context = CONTEXT): string {
  const rows = toRows(diff)
  const isChange = (row: Row) => row.t === '-' || row.t === '+'
  const visible = rows.map(() => false)
  let last = -Infinity
  rows.forEach((row, i) => {
    if (isChange(row)) last = i
    visible[i] = i - last <= context
  })
  let next = Infinity
  for (let i = rows.length - 1; i >= 0; i--) {
    if (isChange(rows[i]!)) next = i
    if (next - i <= context) visible[i] = true
  }

  const lines: string[] = []
  let isGap = false
  rows.forEach((row, i) => {
    if (!visible[i] || row.t === '~') {
      if (!isGap) lines.push('   ⋯')
      isGap = true
      return
    }
    isGap = false
    if (row.t === '-') lines.push(`- old ${row.a} | ${row.text}`)
    else if (row.t === '+') lines.push(`+ new ${row.b} | ${row.text}`)
    else lines.push(`  new ${row.b} | ${row.text}`)
  })
  return lines.join('\n')
}

const STATUS_TEXT = { added: 'new file', deleted: 'deleted file', modified: 'changed file' } as const

export function diffSections(diffs: FileDiff[], maxChars: number): string {
  let budget = maxChars
  return diffs
    .map(diff => {
      const body = numberedDiff(diff)
      const room = Math.max(0, budget)
      const cut = body.length > room ? `${body.slice(0, room)}\n   ⋯ (diff cut here)` : body
      budget -= cut.length
      return `### ${diff.display} (${STATUS_TEXT[diff.status]}, +${diff.added} −${diff.removed})\n${cut}`
    })
    .join('\n\n')
}

export function buildPrompt(diffs: FileDiff[]): string {
  return [
    'I will show the files changed by the work we did in this session in an HTML diff report.',
    'Add review notes beside the diff lines so a developer reading the report understands the important points.',
    'Use the context you know from the conversation: explain the purpose of the change, the design decisions made and why.',
    '',
    'Rules:',
    '- Do not note every line; only the important points: a change in behaviour, a design decision, a risk of breakage, a place that needs attention or testing.',
    `- At most ${MAX_NOTES_PER_FILE} notes per file; an unimportant file may have none.`,
    '- Write the notes in the language the person uses in the conversation; keep them short (1-3 sentences) and concrete; put code names in `backticks`.',
    '- "line" is the line number shown in the diff: side "new" for "+ new N" and "  new N" lines, side "old" for "- old N" lines.',
    '- kind: "important" (a key decision or behaviour), "risk" (a possible bug, breakage, caution), "info" (background).',
    '- Write the file path in "path" exactly as it appears in the heading below.',
    '- Use no tools. Return only a valid JSON object in the shape below; add no code fence or other text.',
    '',
    '{"summary": "a 2-4 sentence summary of the work", "files": [{"path": "...", "summary": "what changed in the file, one sentence", "notes": [{"side": "new", "line": 42, "kind": "important", "text": "..."}]}]}',
    '',
    'Diff (line format: sign, side, line number | code):',
    '',
    diffSections(diffs, MAX_PROMPT_DIFF_CHARS),
  ].join('\n')
}

export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

const slashed = (path: string) => path.replace(/\\/g, '/').toLowerCase()

function matchFile(path: string, diffs: FileDiff[]): FileDiff | undefined {
  const wanted = slashed(path)
  return (
    diffs.find(diff => slashed(diff.display) === wanted) ??
    diffs.find(diff => slashed(diff.path) === wanted) ??
    diffs.find(diff => slashed(diff.path).endsWith(`/${wanted}`) || wanted.endsWith(`/${slashed(diff.display)}`))
  )
}

const asText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

function toNote(value: unknown): Note | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const text = asText(raw.text)
  const line = typeof raw.line === 'number' ? raw.line : Number(raw.line)
  if (text === '') return undefined
  const kind = KINDS.find(one => one === raw.kind) ?? 'info'
  const side: NoteSide = raw.side === 'old' ? 'old' : 'new'
  return { side, line: Number.isInteger(line) && line > 0 ? line : 0, kind, text }
}

export function parseReview(text: string, diffs: FileDiff[]): Review | undefined {
  const parsed = extractJson(text)
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const raw = parsed as Record<string, unknown>
  const files = new Map<string, FileReview>()

  for (const entry of Array.isArray(raw.files) ? raw.files : []) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as Record<string, unknown>
    const diff = matchFile(asText(item.path), diffs)
    if (diff === undefined) continue
    const notes = (Array.isArray(item.notes) ? item.notes : [])
      .map(toNote)
      .filter((note): note is Note => note !== undefined)
      .slice(0, MAX_NOTES_PER_FILE)
    const held = files.get(diff.path)
    files.set(diff.path, {
      summary: held?.summary || asText(item.summary),
      notes: [...(held?.notes ?? []), ...notes],
    })
  }

  const summary = asText(raw.summary)
  if (summary === '' && files.size === 0) return undefined
  return { summary, files }
}
