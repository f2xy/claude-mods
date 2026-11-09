import type { DecisionItem, DecisionSet } from '../types'

const HEADING = /^\s{0,3}#{1,6}\s+\**\s*(decisions(?: needed)?|open decisions|kararlar|karar(?: gereken| bekleyen)? (?:noktalar|maddeler)|açık kararlar)\s*\**\s*:?\s*$/i
const ANY_HEADING = /^\s{0,3}#{1,6}\s/
const ITEM = /^\s{0,3}(\d+)[.)]\s+(.*)$/
const BOLD_LEAD = /^\*\*(.+?)\*\*/
const TITLE_ROOM = 120

export const UNANSWERED = '—'

const titleOf = (first: string): string => {
  const bold = BOLD_LEAD.exec(first)
  const title = (bold?.[1] ?? first).replace(/[:：]\s*$/, '').trim()

  return title.length > TITLE_ROOM ? `${title.slice(0, TITLE_ROOM - 1)}…` : title
}

export const parseDecisions = (answer: string, id: string): DecisionSet | null => {
  const lines = answer.split(/\r?\n/)
  let start = -1
  let heading = ''
  lines.forEach((line, index) => {
    const match = HEADING.exec(line)
    if (match) {
      start = index
      heading = match[1] ?? ''
    }
  })
  if (start < 0) return null

  const items: string[][] = []
  let isGap = false
  for (const line of lines.slice(start + 1)) {
    if (ANY_HEADING.test(line)) break
    const item = ITEM.exec(line)
    if (item) {
      items.push([item[2] ?? ''])
      isGap = false
      continue
    }
    const current = items[items.length - 1]
    if (line.trim() === '') {
      isGap = current !== undefined
      continue
    }
    if (current === undefined) continue
    const isNested = /^\s/.test(line) || /^[-*+]\s/.test(line)
    if (isGap && !isNested) break
    current.push(line.trim())
    isGap = false
  }
  if (items.length === 0) return null

  const decisions: DecisionItem[] = items.map(([first = '', ...rest]) => ({
    title: titleOf(first),
    text: [first, ...rest].join('\n'),
  }))

  return { id, heading: heading.charAt(0).toUpperCase() + heading.slice(1), items: decisions }
}

export const composeReply = (set: DecisionSet, answers: readonly string[]): string => {
  const lines = set.items.flatMap((item, index) => {
    const answer = (answers[index] ?? '').trim()
    const shown = answer === '' ? UNANSWERED : answer.replace(/\n/g, '\n     ')

    return [`${index + 1}. ${item.title}`, `   → ${shown}`]
  })

  return [`${set.heading}:`, ...lines].join('\n')
}
