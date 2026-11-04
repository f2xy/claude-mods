import type { FileDiff } from './diff'
import { diffSections, extractJson } from './notes'
import { escapeHtml, safeJson, safeScript } from './page'

export type Diagram = { title: string; caption: string; mermaid: string }
export type Flow = { title: string; summary: string; diagrams: Diagram[]; steps: string[] }

export const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js'

const MAX_FLOW_DIFF_CHARS = 40_000
const MAX_DIAGRAMS = 3
const MAX_STEPS = 12
const DIAGRAM_START =
  /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|mindmap|timeline|block-beta)\b/

export function buildFlowPrompt(diffs: FileDiff[]): string {
  const changes =
    diffs.length === 0
      ? 'No file changes were recorded with Edit/Write in this session; draw the diagram from the work in the conversation.'
      : ['Changed files and diff (line format: sign, side, line number | code):', '', diffSections(diffs, MAX_FLOW_DIFF_CHARS)].join(
          '\n',
        )

  return [
    'Prepare a visual flow diagram that shows the work we did in this session in its context; it will be drawn with Mermaid in an HTML page.',
    'Goal: a reader understands at a glance how the work functions, which parts were added or changed, and how they connect to the existing system.',
    'Use the context you know from the conversation; draw only components and flows that really exist, invent nothing.',
    '',
    'Diagrams:',
    '- 1 main diagram (required): `flowchart LR` or `flowchart TD`, showing the flow from trigger to result.',
    `- At most ${MAX_DIAGRAMS - 1} extra diagrams (optional, only where they add information): a flowchart for component relations or a sequenceDiagram for the order of interactions.`,
    '',
    'Mermaid rules (a syntax error breaks the diagram, take care):',
    '- Node ids hold only ASCII letters, digits and underscores: no accented letters, no spaces.',
    '- Put every label in double quotes: `A["Label"]`, `B{"Decision?"}`, `C(["Start"])`; use no double quote inside a label, write <br/> to break a line.',
    '- Edge labels are quoted too: `A -->|"yes"| B`.',
    '- Group layers or services with `subgraph id["Title"]` ... `end`.',
    '- Add `:::new` to nodes this work added, `:::changed` to changed ones and `:::removed` to removed ones; unchanged context nodes get no class. Write no classDef: the page adds the colours.',
    '- At most 25 nodes per diagram; labels short and in the language the person uses in the conversation, with file and function names shortened.',
    '',
    'Answer: use no tools. Return only a valid JSON object in the shape below; escape the line breaks of the Mermaid code as \\n inside the JSON, and add no code fence or other text.',
    '',
    '{"title": "a short name for the work", "summary": "a 2-4 sentence summary", "diagrams": [{"title": "...", "caption": "what the diagram shows, 1-2 sentences", "mermaid": "flowchart LR\\n  A[\\"...\\"]:::new --> B[\\"...\\"]"}], "steps": ["the flow explained step by step, one sentence per item"]}',
    '',
    changes,
  ].join('\n')
}

const asText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const unfence = (code: string) =>
  code
    .replace(/^\s*```(?:mermaid)?[ \t]*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .trim()

function toDiagram(value: unknown, index: number): Diagram | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const mermaid = unfence(asText(raw.mermaid))
  if (!DIAGRAM_START.test(mermaid)) return undefined
  return { title: asText(raw.title) || `Diagram ${index + 1}`, caption: asText(raw.caption), mermaid }
}

function fencedDiagrams(text: string): Diagram[] {
  const found: Diagram[] = []
  for (const match of text.matchAll(/```mermaid[ \t]*\n([\s\S]*?)```/gi)) {
    const mermaid = (match[1] ?? '').trim()
    if (DIAGRAM_START.test(mermaid)) found.push({ title: `Diagram ${found.length + 1}`, caption: '', mermaid })
  }
  return found
}

export function parseFlow(text: string): Flow | undefined {
  const parsed = extractJson(text)
  if (typeof parsed === 'object' && parsed !== null) {
    const raw = parsed as Record<string, unknown>
    const diagrams = (Array.isArray(raw.diagrams) ? raw.diagrams : [])
      .map(toDiagram)
      .filter((diagram): diagram is Diagram => diagram !== undefined)
      .slice(0, MAX_DIAGRAMS)
    if (diagrams.length > 0) {
      return {
        title: asText(raw.title),
        summary: asText(raw.summary),
        diagrams,
        steps: (Array.isArray(raw.steps) ? raw.steps : []).map(asText).filter(Boolean).slice(0, MAX_STEPS),
      }
    }
  }

  const diagrams = fencedDiagrams(text).slice(0, MAX_DIAGRAMS)
  return diagrams.length === 0 ? undefined : { title: '', summary: '', diagrams, steps: [] }
}

export type FlowFile = Pick<FileDiff, 'display' | 'status' | 'added' | 'removed'>

export type FlowPageInput = {
  flow: Flow
  files: FlowFile[]
  root: string
  generatedAt: number
  css: string
  js: string
}

export function renderFlowPage(input: FlowPageInput): string {
  const title = input.flow.title === '' ? 'Flow diagram' : `Flow · ${input.flow.title}`
  const data = {
    ...input.flow,
    files: input.files.map(({ display, status, added, removed }) => ({ display, status, added, removed })),
    root: input.root,
    generatedAt: input.generatedAt,
  }

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${input.css}</style>`,
    '</head>',
    '<body>',
    '<div id="app"></div>',
    `<script type="application/json" id="flow-data">${safeJson(data)}</script>`,
    `<script src="${MERMAID_URL}"></script>`,
    `<script>${safeScript(input.js)}</script>`,
    '</body>',
    '</html>',
  ].join('\n')
}
