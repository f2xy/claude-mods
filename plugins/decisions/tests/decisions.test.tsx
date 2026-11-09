import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { composeReply, parseDecisions } from '../hooks/parse'

const ANSWER = [
  'Yaptığım değişiklikler:',
  '1. Parser eklendi',
  '2. Testler yazıldı',
  '',
  '## Kararlar',
  '',
  '1. **Varsayılan mod**: `ask` mı `form` mu olsun? Önerim `ask`.',
  '2. **Komut adı**: `/decisions` kalsın mı?',
  '   - Alternatif: `/kararlar`',
  '',
  'Not: bu satır listeye girmez.',
].join('\n')

const composeInput = (tools: string[]) => ({
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['terminal' as const],
  tools,
  outputStyle: null,
  traits: [],
})

const engineDraws = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

const BAND = {
  plugin: 'decisions',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const PANE = {
  plugin: 'decisions',
  component: 'Pane',
  requestId: 'decisions',
  props: {
    title: 'Kararlar (2)',
    isFocused: true,
    bodyColumns: 80,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('the Decisions section is parsed, a body list and a trailing note left out', () => {
  const set = parseDecisions(ANSWER, 't1')

  expect(set?.heading).toBe('Kararlar')
  expect(set?.items.map(item => item.title)).toEqual(['Varsayılan mod', 'Komut adı'])
  expect(set?.items[1]?.text).toContain('Alternatif')
  expect(set?.items[1]?.text).not.toContain('Not:')
})

test('an answer with no Decisions heading holds no decisions', () => {
  expect(parseDecisions('1. one\n2. two', 't1')).toBe(null)
  expect(parseDecisions('## Decisions\n\nnothing numbered', 't1')).toBe(null)
})

test('the reply lists each title with its answer and marks an empty one open', () => {
  const set = parseDecisions(ANSWER, 't1')
  if (set === null) throw new Error('no set')

  expect(composeReply(set, ['ask olsun', ''])).toBe(
    ['Kararlar:', '1. Varsayılan mod', '   → ask olsun', '2. Komut adı', '   → —'].join('\n'),
  )
})

test('the guide joins the system prompt only where the question tool is offered', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' as const }] }))

  const offered = await $.prompt.compose(composeInput(['AskUserQuestion', 'Bash']))
  expect(offered.sections.map(section => section.id)).toEqual(['intro', 'decisions:guide'])
  expect(offered.sections[1]?.text).toContain('AskUserQuestion tool instead')

  const withheld = await $.prompt.compose(composeInput(['Bash']))
  expect(withheld.sections.map(section => section.id)).toEqual(['intro'])
})

test('form mode asks for the Decisions heading and not the question tool', { options: { mode: 'form' } }, async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))

  const composed = await $.prompt.compose(composeInput(['AskUserQuestion']))
  expect(composed.sections[0]?.text).toContain('do not ask them with AskUserQuestion')
})

test('a turn that ends with decisions shows the band, and the form sends every answer', async ($, on) => {
  const sent: string[] = []
  engineDraws(on)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.focus', () => ({}))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })

  await $.turn.complete({ answer: ANSWER, turnId: 't1', reason: 'answer', durationMs: 1, isAborted: false })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect((await band.find({ type: 'Text', text: /decisions wait/ }))?.text).toContain('2 decisions wait')
    await band.unmount()
  }

  const form = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await form.input({ key: 'answer-0', text: 'ask olsun' })
  await form.input({ key: 'answer-1', text: '/decisions kalsın' })
  await form.unmount()

  expect(sent).toEqual([
    ['Kararlar:', '1. Varsayılan mod', '   → ask olsun', '2. Komut adı', '   → /decisions kalsın'].join('\n'),
  ])

  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /decisions wait/ })).toBe(undefined)
  await after.unmount()
})

test('a turn with no decisions clears the band', async ($, on) => {
  engineDraws(on)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.close', () => ({ value: undefined }))

  await $.turn.complete({ answer: ANSWER, turnId: 't1', reason: 'answer', durationMs: 1, isAborted: false })
  await $.turn.complete({ answer: 'Bitti.', turnId: 't2', reason: 'answer', durationMs: 1, isAborted: false })

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /decisions wait/ })).toBe(undefined)
  await band.unmount()
})
