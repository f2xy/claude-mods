import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelForkResult, On, RenderInput } from 'claude-code'

import type { TrackedFile } from '../types'
import { diffFile, trimEqual } from './diff'
import type { FileDiff } from './diff'
import { buildFlowPrompt, parseFlow, renderFlowPage } from './flow'
import { buildPrompt, parseReview } from './notes'
import { renderPage } from './page'
import type { PageFile } from './page'

const MAX_REPORT_BYTES = 4 * 1024 * 1024 - 64 * 1024
const TRIM_KEEP = 10
const REPORT_DIR = 'claude-summary-only'
export const DIFF_WORDS = ['diff', 'fark']
const PLAIN_ARGS = ['yalın', 'yalin', 'hızlı', 'hizli', 'plain']
const RESET_ARGS = ['sıfırla', 'sifirla', 'reset']
const FLOW_ARGS = ['akış', 'akis', 'diyagram', 'flow']

const files = atom({ plugin: 'summary-only', key: 'files' } as const, [] as TrackedFile[])
const generation = atom({ plugin: 'summary-only', key: 'generation' } as const, 0)
const busy = atom({ plugin: 'summary-only', key: 'busy' } as const, null as string | null)
const BASELINE = { plugin: 'summary-only', key: 'baseline' } as const

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

const isWindowsPath = (path: string) => /^[A-Za-z]:[\\/]/.test(path)

export const normalizeKey = (path: string) => {
  const slashed = path.replace(/\\/g, '/')
  return isWindowsPath(path) ? slashed.toLowerCase() : slashed
}

export const displayPath = (root: string, path: string) => {
  const base = normalizeKey(root).replace(/\/$/, '')
  const isInside = normalizeKey(path).startsWith(`${base}/`)
  return (isInside ? path.slice(base.length + 1) : path).replace(/\\/g, '/')
}

const basename = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)

const baselineId = (gen: number, key: string) => `${gen}|${key}`

async function snapshot($: EngineInterface, path: string): Promise<string | null | undefined> {
  if (!(await $.fs.exists(path))) return null
  return $.fs.read(path).catch(() => undefined)
}

async function collect($: EngineInterface): Promise<FileDiff[]> {
  const list = await read($, files)
  const gen = await read($, generation)
  const root = await $.session.root()
  const diffs: FileDiff[] = []
  for (const file of list) {
    const held = await $.state.get({ ...BASELINE, id: baselineId(gen, file.key) })
    if (held.version === 0 || held.value === undefined) continue
    const after = await snapshot($, file.path)
    if (after === undefined) continue
    const diff = diffFile(file.path, displayPath(root, file.path), held.value, after)
    if (diff !== undefined) diffs.push(diff)
  }
  return diffs
}

const whyUnanswered = (reply: ModelForkResult) => {
  if (reply.isAnswered) return ''
  if (reply.reason === 'api-error') return `API error${reply.status === null ? '' : ` ${reply.status}`}: ${reply.error}`
  if (reply.reason === 'empty-reply') return 'the model returned an empty reply'
  if (reply.reason === 'aborted') return 'the request was interrupted'
  return 'the session has no reply yet'
}

async function ask($: EngineInterface, prompt: string, canAnswerAlone: boolean): Promise<ModelForkResult> {
  const reply = await $.model.fork({ prompt })
  if (reply.isAnswered || reply.reason !== 'nothing-to-fork' || !canAnswerAlone) return reply
  return $.model.complete({ model: await $.session.model(), prompt, maxTokens: 8000 })
}

type Annotated = { files: PageFile[]; summary: string; notice: string }

async function annotate($: EngineInterface, diffs: FileDiff[]): Promise<Annotated> {
  const reply = await ask($, buildPrompt(diffs), true)
  if (!reply.isAnswered) {
    return { files: diffs, summary: '', notice: `Notes could not be written (${whyUnanswered(reply)}).` }
  }

  const review = parseReview(reply.text, diffs)
  if (review === undefined) {
    return { files: diffs, summary: '', notice: 'Notes could not be read: the model returned no valid JSON.' }
  }
  return {
    files: diffs.map(diff => ({ ...diff, ...review.files.get(diff.path) })),
    summary: review.summary,
    notice: '',
  }
}

async function reportPath($: EngineInterface, now: number, prefix: string): Promise<string> {
  const temp = (await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp'
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  const separator = isWindowsPath(temp) ? '\\' : '/'
  return [temp.replace(/[\\/]$/, ''), REPORT_DIR, `${prefix}-${stamp}.html`].join(separator)
}

async function openInBrowser($: EngineInterface, target: string): Promise<void> {
  if (isWindowsPath(target)) {
    await $.process.run(['rundll32.exe', 'url.dll,FileProtocolHandler', target])
    return
  }
  const { stdout } = await $.process.run(['uname', '-s'])
  await $.process.run([stdout.trim() === 'Darwin' ? 'open' : 'xdg-open', target])
}

const byteLength = (text: string) => new TextEncoder().encode(text).length

async function exclusive($: EngineInterface, label: string, work: () => Promise<string>): Promise<string> {
  if ((await read($, busy)) !== null) return 'Another report is being prepared; try again when it is done.'
  await update($, busy, () => label)
  try {
    return await work()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.toast(`The report could not be built: ${reason}`)
    return `The report could not be built: ${reason}`
  } finally {
    await update($, busy, () => null)
  }
}

function fail($: EngineInterface, message: string) {
  $.ui.toast(message)
  return message
}

function generate($: EngineInterface, withNotes: boolean): Promise<string> {
  return exclusive($, 'Computing the diff…', async () => {
    const diffs = await collect($)
    if (diffs.length === 0) return fail($, 'The tracked files have no changes.')

    let annotated: Annotated = { files: diffs, summary: '', notice: '' }
    if (withNotes) {
      await update($, busy, () => 'Writing notes…')
      annotated = await annotate($, diffs)
    }

    const [css, js, root, now] = await Promise.all([
      $.fs.read(`${$.plugin.root}/assets/viewer.css`),
      $.fs.read(`${$.plugin.root}/assets/viewer.js`),
      $.session.root(),
      $.clock.now(),
    ])
    const build = (list: PageFile[], isTrimmed: boolean) =>
      renderPage({
        root,
        generatedAt: now,
        files: list,
        isTrimmed,
        summary: annotated.summary,
        notice: annotated.notice,
        css,
        js,
      })

    let html = build(annotated.files, false)
    if (byteLength(html) > MAX_REPORT_BYTES) {
      html = build(
        annotated.files.map(file => ({ ...file, ops: trimEqual(file.ops, TRIM_KEEP) })),
        true,
      )
    }
    if (byteLength(html) > MAX_REPORT_BYTES) {
      return fail($, 'The diff report is over the 4 MiB limit; narrow it with Reset first.')
    }

    const target = await reportPath($, now, 'diff')
    await $.fs.write(target, html)
    await openInBrowser($, target)

    const noteCount = annotated.files.reduce((sum, file) => sum + (file.notes?.length ?? 0), 0)
    const summary = withNotes
      ? `Diff opened in the browser: ${plural(diffs.length, 'file')}, ${plural(noteCount, 'note')}`
      : `Diff opened in the browser: ${plural(diffs.length, 'file')}`
    $.ui.toast(annotated.notice === '' ? summary : `${summary}. ${annotated.notice}`)
    return `${summary} → ${target}${annotated.notice === '' ? '' : `\n${annotated.notice}`}`
  })
}

function generateFlow($: EngineInterface): Promise<string> {
  return exclusive($, 'Drawing the flow diagram…', async () => {
    const diffs = await collect($)
    const reply = await ask($, buildFlowPrompt(diffs), diffs.length > 0)
    if (!reply.isAnswered) return fail($, `The flow diagram could not be made (${whyUnanswered(reply)}).`)

    const flow = parseFlow(reply.text)
    if (flow === undefined) {
      return fail($, 'The flow diagram could not be read: the model returned no valid Mermaid diagram.')
    }

    const [viewerCss, flowCss, js, root, now] = await Promise.all([
      $.fs.read(`${$.plugin.root}/assets/viewer.css`),
      $.fs.read(`${$.plugin.root}/assets/flow.css`),
      $.fs.read(`${$.plugin.root}/assets/flow.js`),
      $.session.root(),
      $.clock.now(),
    ])
    const html = renderFlowPage({ flow, files: diffs, root, generatedAt: now, css: `${viewerCss}\n${flowCss}`, js })

    const target = await reportPath($, now, 'flow')
    await $.fs.write(target, html)
    await openInBrowser($, target)

    const summary = `Flow diagram opened in the browser: ${plural(flow.diagrams.length, 'diagram')}`
    $.ui.toast(summary)
    return `${summary} → ${target}`
  })
}

async function reset($: EngineInterface): Promise<string> {
  await update($, generation, gen => gen + 1)
  await update($, files, () => [])
  $.ui.toast('Diff tracking was reset.')
  return 'Diff tracking was reset; changes from now on are tracked.'
}

export async function resetBusy($: EngineInterface) {
  await update($, busy, () => null)
}

export function runDiffCommand($: EngineInterface, arg: string): Promise<string> {
  if (RESET_ARGS.includes(arg)) return reset($)
  if (FLOW_ARGS.includes(arg)) return generateFlow($)
  return generate($, !PLAIN_ARGS.includes(arg))
}

export function registerDiffTracking(on: On) {
  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const path =
      e.tool === 'NotebookEdit' ? e.notebook_path : e.tool === 'Edit' || e.tool === 'Write' ? e.file_path : undefined
    if (path === undefined) return next(e)

    const key = normalizeKey(path)
    const id = baselineId(await read($, generation), key)
    const held = await $.state.get({ ...BASELINE, id })
    if (held.version === 0) {
      const before = await snapshot($, path)
      if (before === undefined) return next(e)
      await $.state.set({ ...BASELINE, id }, before, { ifVersion: 0 })
    }

    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await update($, files, list => (list.some(file => file.key === key) ? list : [...list, { path, key }]))
    }
    return ran
  }).catch(($, e, next) => next(e))
}

export async function diffRow($: EngineInterface, e: RenderInput<'AbovePrompt'>) {
  const list = await read($, files)
  if (list.length === 0) return null

  const working = await read($, busy)
  const { Box, Text, Button } = $.ui.resolve(e)
  const names = list.map(file => basename(file.path)).join(', ')

  return (
    <Box key="summary-only-diff" flexDirection="row" gap={1}>
      <Text color="diffAdded" bold>
        Δ {plural(list.length, 'file')} changed
      </Text>
      <Box flexShrink={1} flexGrow={1}>
        <Text dimColor wrap="truncate-end">
          {working ?? names}
        </Text>
      </Box>
      <Button
        key="open"
        label="Annotated diff"
        variant="primary"
        hotkey="d"
        onPress={async () => {
          await generate($, true)
        }}
      />
      <Button
        key="plain"
        label="Plain diff"
        hotkey="p"
        onPress={async () => {
          await generate($, false)
        }}
      />
      <Button
        key="flow"
        label="Flow diagram"
        hotkey="f"
        onPress={async () => {
          await generateFlow($)
        }}
      />
      <Button
        key="reset"
        label="Reset"
        dimColor
        hotkey="r"
        onPress={async () => {
          await reset($)
        }}
      />
    </Box>
  )
}
