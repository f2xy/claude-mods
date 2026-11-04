import { expect, mock, test } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'

const ROOT = 'D:\\dev\\proj'
const FILE = 'D:\\dev\\proj\\src\\app.ts'
const BAND = {
  plugin: 'summary-only',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const REVIEW = {
  summary: '`b` is now 3.',
  files: [
    {
      path: 'src/app.ts',
      summary: 'The constant changed.',
      notes: [{ side: 'new', line: 2, kind: 'risk', text: 'Tests that use `b` need updating.' }],
    },
  ],
}

function world(on: On, disk: Map<string, string>, reply?: ModelForkResult) {
  const written: { path: string; text: string }[] = []
  const launched: (readonly string[])[] = []
  const toasts: string[] = []
  const prompts: string[] = []

  mock.clock(on, { now: Date.UTC(2026, 9, 6, 12, 0, 0) })
  mock.env(on, { TEMP: 'C:\\Temp' })
  on('session.root', () => ({ value: ROOT }))
  on('fs.exists', ($, e) => ({ value: disk.has(e.path) || e.path.includes('assets') }))
  on('fs.read', ($, e) => {
    if (e.path.includes('assets')) return { value: e.path.endsWith('.css') ? 'body{}' : 'void 0' }
    const text = disk.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', ($, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    launched.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('model.fork', ($, e) => {
    prompts.push(e.prompt)
    return { value: reply ?? { isAnswered: true, text: JSON.stringify(REVIEW), usage: USAGE } }
  })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box' }))
  on('tool.call', { tool: ['Edit', 'Write'] }, ($, e) => {
    if (e.tool === 'Edit') {
      disk.set(e.file_path, (disk.get(e.file_path) ?? '').replace(e.old_string, e.new_string))
    } else if (e.tool === 'Write') {
      disk.set(e.file_path, e.content)
    }
    return { result: { ok: true }, text: 'ok' }
  })

  return { written, launched, toasts, prompts }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`band stays hidden until a file changes, then opens the annotated diff (${surface})`, async ($, on) => {
    const disk = new Map([[FILE, 'const a = 1\nconst b = 2\n']])
    const seen = world(on, disk)

    const empty = await $.ui.mount({ ...BAND, surface })
    expect(await empty.find({ key: 'open' })).toBeUndefined()
    await empty.unmount()

    await $.tool.call({ tool: 'Edit', file_path: FILE, old_string: 'const b = 2', new_string: 'const b = 3' })
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}\\src\\new.ts`, content: 'export {}\n' })

    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /2 files changed/ })) !== undefined).toBe(true)

    await ui.press({ key: 'open' })

    expect(seen.prompts).toHaveLength(1)
    expect(seen.prompts[0]).toContain('+ new 2 | const b = 3')
    expect(seen.written).toHaveLength(1)
    const report = seen.written[0]!
    expect(report.path).toBe('C:\\Temp\\claude-summary-only\\diff-2026-10-06T12-00-00-000Z.html')
    expect(report.text).toContain('"display":"src/app.ts"')
    expect(report.text).toContain('["-",["const b = 2"]],["+",["const b = 3"]]')
    expect(report.text).toContain('"status":"added"')
    expect(report.text).toContain('"summary":"`b` is now 3."')
    expect(report.text).toContain('"notes":[{"side":"new","line":2,"kind":"risk"')
    expect(seen.launched).toEqual([['rundll32.exe', 'url.dll,FileProtocolHandler', report.path]])
    expect(seen.toasts).toContain('Diff opened in the browser: 2 files, 1 note')

    await ui.press({ key: 'reset' })
    expect(await ui.find({ key: 'open' })).toBeUndefined()
    await ui.unmount()
  })
}

test('the flow button draws a diagram page', async ($, on) => {
  const disk = new Map([[FILE, 'x\n']])
  const flow = {
    title: 'Change',
    summary: 'x became y.',
    diagrams: [{ title: 'Flow', caption: '', mermaid: 'flowchart LR\n  A["x"]:::changed --> B["y"]' }],
    steps: ['x changes.'],
  }
  const seen = world(on, disk, { isAnswered: true, text: JSON.stringify(flow), usage: USAGE })

  await $.tool.call({ tool: 'Edit', file_path: FILE, old_string: 'x', new_string: 'y' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'flow' })

  expect(seen.prompts[0]).toContain('flow diagram')
  expect(seen.written).toHaveLength(1)
  const page = seen.written[0]!
  expect(page.path).toBe('C:\\Temp\\claude-summary-only\\flow-2026-10-06T12-00-00-000Z.html')
  expect(page.text).toContain('A[\\"x\\"]:::changed')
  expect(page.text).toContain('mermaid@11')
  expect(seen.launched).toEqual([['rundll32.exe', 'url.dll,FileProtocolHandler', page.path]])
  expect(seen.toasts).toContain('Flow diagram opened in the browser: 1 diagram')
  await ui.unmount()
})

test('the flow command says when the model drew nothing', async ($, on) => {
  const seen = world(on, new Map(), { isAnswered: true, text: 'I cannot draw it.', usage: USAGE })
  const ran = await $.command.run({
    command: 'summary-only',
    args: 'diff flow',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(ran).toMatchObject({ text: 'The flow diagram could not be read: the model returned no valid Mermaid diagram.' })
  expect(seen.prompts[0]).toContain('draw the diagram from the work in the conversation')
  expect(seen.written).toHaveLength(0)
})

test('the plain diff asks no model', async ($, on) => {
  const disk = new Map([[FILE, 'x\n']])
  const seen = world(on, disk)

  await $.tool.call({ tool: 'Edit', file_path: FILE, old_string: 'x', new_string: 'y' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'plain' })

  expect(seen.prompts).toHaveLength(0)
  expect(seen.written).toHaveLength(1)
  expect(seen.written[0]!.text).not.toContain('"notes"')
  expect(seen.toasts).toContain('Diff opened in the browser: 1 file')
  await ui.unmount()
})

test('a failed review still opens the diff and says why', async ($, on) => {
  const disk = new Map([[FILE, 'x\n']])
  const seen = world(on, disk, {
    isAnswered: false,
    reason: 'api-error',
    status: 529,
    error: 'overloaded',
    usage: USAGE,
  })

  await $.tool.call({ tool: 'Edit', file_path: FILE, old_string: 'x', new_string: 'y' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'open' })

  expect(seen.written).toHaveLength(1)
  expect(seen.written[0]!.text).toContain('"notice":"Notes could not be written (API error 529: overloaded)."')
  expect(seen.launched).toHaveLength(1)
  await ui.unmount()
})

test('a denied edit is not listed', async ($, on) => {
  const disk = new Map([[FILE, 'x\n']])
  world(on, disk)
  on('classic.PreToolUse', () => ({ deny: 'no' }))

  await $.tool.call({ tool: 'Edit', file_path: FILE, old_string: 'x', new_string: 'y' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'open' })).toBeUndefined()
  await ui.unmount()
})

test('the command reports when nothing changed', async ($, on) => {
  world(on, new Map())
  const ran = await $.command.run({
    command: 'summary-only',
    args: 'diff',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(ran).toMatchObject({ text: 'The tracked files have no changes.' })
})
