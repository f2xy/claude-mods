import { describe, expect, test } from 'claude-code/testing'

import { diffFile } from '../hooks/diff'
import { MERMAID_URL, buildFlowPrompt, parseFlow, renderFlowPage } from '../hooks/flow'

const diff = diffFile('D:\\proj\\src\\a.ts', 'src/a.ts', 'a\n', 'b\n')!
const CHART = 'flowchart LR\n  A["Button"]:::new --> B["Diff"]:::changed'

describe('buildFlowPrompt', () => {
  test('carries the diff when files changed', () => {
    const prompt = buildFlowPrompt([diff])
    expect(prompt).toContain('### src/a.ts (changed file, +1 −1)')
    expect(prompt).toContain(':::new')
  })

  test('falls back to the conversation when nothing was tracked', () => {
    expect(buildFlowPrompt([])).toContain('draw the diagram from the work in the conversation')
  })
})

describe('parseFlow', () => {
  test('reads the JSON reply and drops what is no diagram', () => {
    const reply = JSON.stringify({
      title: 'Diff button',
      summary: 'The button builds a diff.',
      diagrams: [
        { title: 'Flow', caption: 'From press to report.', mermaid: `\`\`\`mermaid\n${CHART}\n\`\`\`` },
        { title: 'Broken', mermaid: 'this is no diagram' },
        { mermaid: 'sequenceDiagram\n  User->>Mod: presses' },
      ],
      steps: ['The user presses the button.', '', 'The report opens.'],
    })
    expect(parseFlow(reply)).toEqual({
      title: 'Diff button',
      summary: 'The button builds a diff.',
      diagrams: [
        { title: 'Flow', caption: 'From press to report.', mermaid: CHART },
        { title: 'Diagram 3', caption: '', mermaid: 'sequenceDiagram\n  User->>Mod: presses' },
      ],
      steps: ['The user presses the button.', 'The report opens.'],
    })
  })

  test('takes fenced mermaid blocks when the reply is no JSON', () => {
    const flow = parseFlow(`Here it is:\n\`\`\`mermaid\n${CHART}\n\`\`\`\nDone.`)
    expect(flow?.diagrams).toEqual([{ title: 'Diagram 1', caption: '', mermaid: CHART }])
  })

  test('gives up when there is no diagram at all', () => {
    expect(parseFlow('I cannot draw it.')).toBeUndefined()
    expect(parseFlow('{"diagrams": []}')).toBeUndefined()
  })
})

describe('renderFlowPage', () => {
  test('loads mermaid and keeps the data inside its script tag', () => {
    const html = renderFlowPage({
      flow: { title: 'X</script>', summary: '', diagrams: [{ title: 'a', caption: '', mermaid: CHART }], steps: [] },
      files: [diff],
      root: 'D:/proj',
      generatedAt: 0,
      css: '',
      js: '',
    })
    expect(html).toContain(`<script src="${MERMAID_URL}"></script>`)
    expect(html).toContain('<title>Flow · X&lt;/script&gt;</title>')
    expect(html).not.toContain('"ops"')
    expect(html.match(/<\/script>/g)).toHaveLength(3)
  })
})
