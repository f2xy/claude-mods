import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DecisionSet } from '../types'
import { composeReply, parseDecisions, UNANSWERED } from './parse'

const PANE = 'decisions'
const COMMAND = 'decisions'
const SECTION_ID = 'decisions:guide'
const ASK_TOOL = 'AskUserQuestion'
const FIELD_WIDTH_GUESS = 76

const FORM_RULES = [
  'end your reply with a section headed `## Decisions`, written in the reply\'s language (`## Kararlar` in Turkish), and put nothing after it.',
  'Give each decision its own numbered item: a short bold title, then the question and its options in a sentence or two, your recommendation marked.',
  'The person answers each item in a form; their reply repeats each item\'s title with their answer after "→".',
  `An item answered "${UNANSWERED}" was left open: do not act on it, and ask it again when you finish.`,
].join(' ')

const SECTIONS = {
  ask: [
    '# Decisions for the person',
    'When your work leaves decisions that are the person\'s to make (choices you would otherwise list at the end of your reply, or open points that block the next step), do not end the turn with them as a list.',
    `Ask them with the ${ASK_TOOL} tool instead: one question per decision, in the order they matter, at most 4 questions per call, with further calls for the rest.`,
    'Give each question 2-4 concrete options, your recommended one first with " (Recommended)" after its label; the person can always type an answer of their own.',
    'Then carry on with the work according to the answers, in the same turn.',
    'Do not ask about choices with a conventional default or facts you can check yourself.',
    `If the person dismisses the question, or a decision cannot be put as options, ${FORM_RULES}`,
  ].join(' '),
  form: [
    '# Decisions for the person',
    `When your work leaves decisions that are the person's to make, or an open point blocks the next step, do not ask them with ${ASK_TOOL};`,
    FORM_RULES,
    'Do not list choices with a conventional default or facts you can check yourself.',
  ].join(' '),
}

const current = atom({ plugin: 'decisions', key: 'current' } as const, null as DecisionSet | null, {
  shape: 'set-1',
})
const answers = atom({ plugin: 'decisions', key: 'answers' } as const, [] as string[])
const isHidden = atom({ plugin: 'decisions', key: 'isHidden' } as const, false)

const fieldKey = (index: number) => `answer-${index}`

const paneRows = (set: DecisionSet) =>
  set.items.reduce(
    (rows, item) =>
      rows +
      item.text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / FIELD_WIDTH_GUESS)), 0) +
      2,
    2,
  )

const openForm = async ($: EngineInterface) => {
  const set = await read($, current)
  if (set === null) return false
  await update($, isHidden, () => false)
  await $.ui.open({
    id: PANE,
    title: `${set.heading} (${set.items.length})`,
    focus: true,
    closeOnEscape: true,
    holdToasts: true,
    rows: paneRows(set),
  })

  return true
}

const send = async ($: EngineInterface) => {
  const set = await read($, current)
  if (set === null) return
  const text = composeReply(set, await read($, answers))
  await update($, current, () => null)
  await update($, answers, () => [])
  await $.ui.close({ id: PANE })
  await $.prompt.submit({ text, asUser: true })
}

const setAnswer = ($: EngineInterface, index: number, value: string) =>
  update($, answers, list => {
    const next = [...list]
    while (next.length <= index) next.push('')
    next[index] = value

    return next
  })

export const register: Register = (on, options) => {
  const mode = options.mode === 'form' ? 'form' : 'ask'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Answer the decisions Claude listed, one field per item',
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const isOpened = await openForm($)

    return { text: isOpened ? 'Decisions form opened.' : 'No decisions are waiting for an answer.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.tools.includes(ASK_TOOL)) return composed

    return {
      ...composed,
      sections: [...composed.sections, { id: SECTION_ID, text: SECTIONS[mode], scope: 'session' as const }],
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined || e.reason !== 'answer') return next(e)

    const set = parseDecisions(e.answer, e.turnId)
    await update($, current, () => set)
    await update($, answers, () => [])
    await update($, isHidden, () => false)
    if (set === null) await $.ui.close({ id: PANE })

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isWorking || e.props.view.agentId !== undefined) return next(e)

    const set = await read($, current)
    if (set === null || (await read($, isHidden))) return next(e)

    const below = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const count = set.items.length

    return (
      <Box flexDirection="column">
        <Box key="decisions-band" flexDirection="row">
          <Text color="warning">◆ </Text>
          <Text>
            {count} {count === 1 ? 'decision waits' : 'decisions wait'} for your answer{' '}
          </Text>
          <Button key="answer" label="Answer" variant="primary" onPress={() => void openForm($)} />
          <Text> </Text>
          <Button key="hide" label="Hide" onPress={() => void update($, isHidden, () => true)} />
          <Text dimColor> /{COMMAND}</Text>
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Markdown, Text } = $.ui.resolve(e)
    const set = await read($, current)
    if (set === null) return <Text dimColor>No decisions are waiting for an answer.</Text>

    const values = await read($, answers)
    const last = set.items.length - 1

    return (
      <Box flexDirection="column">
        {set.items.map((item, index) => (
          <Box flexDirection="column" marginBottom={1}>
            <Box flexDirection="row">
              <Text bold>{index + 1}. </Text>
              <Markdown text={item.text} />
            </Box>
            <Input
              key={fieldKey(index)}
              label="→ "
              placeholder="your answer (empty leaves it open)"
              value={values[index] ?? ''}
              submitLabel={index === last ? 'send all' : 'next'}
              autoFocus={index === 0 ? true : undefined}
              onInput={value => void setAnswer($, index, value)}
              onSubmit={async value => {
                await setAnswer($, index, value)
                if (index === last) await send($)
                else await $.ui.focus({ requestId: PANE, key: fieldKey(index + 1) }).catch(() => undefined)
              }}
            />
          </Box>
        ))}
        <Box flexDirection="row">
          <Button key="send" label="Send answers" variant="primary" onPress={() => void send($)} />
          <Text> </Text>
          <Button key="close" label="Close" role="dismiss" onPress={() => void $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
