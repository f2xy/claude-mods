import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { SummaryOnlyHidden } from '../types'
import { DIFF_WORDS, diffRow, registerDiffTracking, resetBusy, runDiffCommand } from './diff-report'
import { clip, isHiddenText, merge, normalize, strings } from './match'

const COMMAND = 'summary-only'
const LABEL = 'summary-only'
const PROMPT_LABEL = '❯ Last prompt: '
const PROMPT_ROWS = 2
const PROMPT_BACKGROUND = '#3a3a3a'
const VISIBLE_TOOLS = ['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode']
const PERSON_ORIGINS = ['composer', 'bridge', 'sdk']
const ON_WORDS = ['on', 'aç', 'ac', 'açık', 'acik']
const OFF_WORDS = ['off', 'kapat', 'kapalı', 'kapali']
const STATUS_WORDS = ['status', 'durum']

const FINAL_PROMPT = [
  '# Summary-only view',
  'The person uses a condensed view: tool calls, their results, diffs and any text you write between tool calls are hidden from them.',
  'Only your final message of the turn is shown. Make that final message self-contained: what you did, the outcome,',
  'and anything that needs their decision or attention, without relying on earlier intermediate text.',
  'Keep text between tool calls to a minimum.',
].join(' ')

const isOn = atom({ plugin: 'summary-only', key: 'isOn' } as const, true)
const hidden = atom({ plugin: 'summary-only', key: 'hidden' } as const, [] as SummaryOnlyHidden)
const lastPrompt = atom({ plugin: 'summary-only', key: 'lastPrompt' } as const, null as string | null)

async function mark($: EngineInterface, texts: readonly string[]) {
  if (texts.length > 0) await update($, hidden, list => merge(list, texts))
}

async function unmark($: EngineInterface, texts: readonly string[]) {
  if (texts.length > 0) await update($, hidden, list => list.filter(entry => !texts.includes(entry)))
}

async function persist($: EngineInterface) {
  const saved = strings(await $.store.get('hidden'))
  await $.store.set('hidden', merge(saved, await read($, hidden)))
}

function nothing($: EngineInterface, e: RenderInput) {
  const { Box } = $.ui.resolve(e)

  return <Box />
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description:
        "Summary-only view: hides tool calls, diffs and intermediate text; 'diff' opens the session's changes as an HTML report",
      argumentHint: '[on | off | status | diff [plain | flow | reset]]',
      immediate: true,
    })
    await resetBusy($)

    const stored = await $.store.get('isOn')
    if (typeof stored === 'boolean') await update($, isOn, () => stored)

    const saved = strings(await $.store.get('hidden'))
    if (saved.length > 0) await update($, hidden, list => merge(saved, list))

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    const text = typeof result.text === 'string' ? result.text.trim() : ''
    if (!e.isMeta && e.command === undefined && PERSON_ORIGINS.includes(e.origin.kind) && text !== '') {
      try {
        await update($, lastPrompt, () => text)
      } catch {}
    }

    return result
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    const texts = new Map<number, string>()
    let marked: string[] = []
    let isKept = false
    let sawTool = false

    const markSeen = async () => {
      const fresh = [...texts.values()].map(normalize).filter(text => text !== '' && !marked.includes(text))
      marked = [...marked, ...fresh]
      await mark($, fresh)
    }

    for await (const chunk of next(e)) {
      yield chunk
      try {
        if (chunk.kind === 'text') {
          texts.set(chunk.index, (texts.get(chunk.index) ?? '') + chunk.text)
        } else if (chunk.kind === 'tool') {
          sawTool = true
          if (VISIBLE_TOOLS.includes(chunk.name)) {
            isKept = true
            await unmark($, marked)
            marked = []
          } else if (!isKept) {
            await markSeen()
          }
        }
      } catch {}
    }

    if (sawTool && !isKept) {
      try {
        await markSeen()
      } catch {}
    }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      try {
        await persist($)
      } catch {}
    }

    return result
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (e.traits.includes('teammate') || !(await read($, isOn))) return result

    return {
      ...result,
      sections: [...result.sections, { id: 'summary-only:final', text: FINAL_PROMPT, scope: 'session' as const }],
    }
  })

  registerDiffTracking(on)

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const [first = '', ...rest] = arg.split(/\s+/)
    if (DIFF_WORDS.includes(first)) return { text: await runDiffCommand($, rest.join(' ')) }

    const current = await read($, isOn)

    if (STATUS_WORDS.includes(arg)) {
      return { text: current ? 'Summary-only view is on.' : 'Summary-only view is off.' }
    }

    let want: boolean
    if (arg === '') want = !current
    else if (ON_WORDS.includes(arg)) want = true
    else if (OFF_WORDS.includes(arg)) want = false
    else {
      return {
        text: `Unknown argument: "${e.args.trim()}". Usage: /summary-only [on | off | status | diff [plain | flow | reset]]`,
      }
    }

    await update($, isOn, () => want)
    await $.store.set('isOn', want)

    return {
      text: want
        ? 'Summary-only view is on: tool calls, diffs and the text between them are hidden; only the final answer shows, and your last prompt stays above the input. ctrl+o shows the tool details, /summary-only off shows everything.'
        : 'Summary-only view is off: everything shows again.',
    }
  }).catch(() => ({ text: 'The summary-only setting could not be changed.' }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const isMainView = e.props.view.agentId === undefined
    const prompt = isMainView && (await read($, isOn)) ? await read($, lastPrompt) : null
    const changes = await diffRow($, e)
    if (prompt === null && changes === null) return next(e)

    const room = (e.props.bodyColumns - PROMPT_LABEL.length - 2) * PROMPT_ROWS
    const alt = await next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {prompt === null ? null : (
          <Box key="summary-only-prompt" flexDirection="row" backgroundColor={PROMPT_BACKGROUND} paddingX={1}>
            <Text bold color="suggestion">
              {PROMPT_LABEL}
            </Text>
            <Text bold color="text" wrap="wrap">
              {clip(prompt, room)}
            </Text>
          </Box>
        )}
        {changes}
        {alt}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    if (e.props.isSummary || isHiddenText(await read($, hidden), e.props.text)) return nothing($, e)

    return next(e)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.isExpanded || VISIBLE_TOOLS.includes(e.props.tool)) return next(e)
    if (!(await read($, isOn))) return next(e)

    return nothing($, e)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.isExpanded || VISIBLE_TOOLS.includes(e.props.tool)) return next(e)
    if (!(await read($, isOn))) return next(e)

    return nothing($, e)
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    if (!(await read($, isOn))) return next(e)

    return nothing($, e)
  })

  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'task-notification' } } }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    if (!(await read($, isOn))) return next(e)

    return nothing($, e)
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!(await read($, isOn)) || e.props.modes.includes(LABEL)) return next(e)

    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, LABEL] } })
  })
}
