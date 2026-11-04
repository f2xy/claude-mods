import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { clip, isHiddenText, merge } from '../hooks/match'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

type World = { isOn: boolean; hidden: string[]; lastPrompt: string | null }

function world(on: On, state: World) {
  const rest: Record<string, unknown> = { files: [], generation: 0, busy: null }
  on('state.get', ($, e) => ({
    value: { value: e.key in state ? state[e.key as keyof World] : rest[e.key], version: 1 },
  }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
}

const toolUse = (tool: string, isExpanded = false) => ({
  plugin: 'summary-only',
  component: 'ToolUse' as const,
  requestId: 'toolu_1',
  props: {
    tool_use_id: 'toolu_1',
    tool,
    input: {},
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
    isExpanded,
  },
})

const assistant = (text: string) => ({
  plugin: 'summary-only',
  component: 'AssistantMessage' as const,
  requestId: 'msg_1',
  props: { text, isFirstOfReply: true },
})

const band = (agentId?: string) => ({
  plugin: 'summary-only',
  component: 'AbovePrompt' as const,
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 60,
    scroll: { offset: 0, bodyRows: 10 },
    view: agentId === undefined ? {} : { agentId },
  },
})

describe('matching', () => {
  test('the same text and a trimmed copy are hidden, a short fragment is not', async () => {
    const list = ['Reading  the files,\nthen fixing them.']
    expect(isHiddenText(list, 'Reading the files, then fixing them.')).toBe(true)
    expect(isHiddenText(list, 'Reading the files, then')).toBe(true)
    expect(isHiddenText(list, 'files')).toBe(false)
    expect(isHiddenText(list, 'Done: three files fixed.')).toBe(false)
    expect(isHiddenText(list, '   ')).toBe(false)
  })

  test('merging drops duplicates and puts the newest last', async () => {
    expect(merge(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  test('a long prompt is flattened to one line and clipped', async () => {
    expect(clip('short\n prompt', 40)).toBe('short prompt')
    const long = clip('x'.repeat(100), 20)
    expect(long.length).toBe(20)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('drawing', () => {
  test('a tool row is hidden while the view is on', async ($, on) => {
    world(on, { isOn: true, hidden: [], lastPrompt: null })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...toolUse('Edit'), surface })
      expect(await ui.find({ type: 'Text', text: /engine/ })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('the row stays in the ctrl+o view and for the question tool', async ($, on) => {
    world(on, { isOn: true, hidden: [], lastPrompt: null })
    for (const props of [toolUse('Bash', true), toolUse('AskUserQuestion')]) {
      const ui = await $.ui.mount({ ...props, surface: 'terminal' })
      expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
      await ui.unmount()
    }
  })

  test('a tool row shows while the view is off', async ($, on) => {
    world(on, { isOn: false, hidden: [], lastPrompt: null })
    const ui = await $.ui.mount({ ...toolUse('Edit'), surface: 'terminal' })
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    await ui.unmount()
  })

  test('text between tool calls is hidden, the final answer shows', async ($, on) => {
    world(on, { isOn: true, hidden: ['Looking at the files first.'], lastPrompt: null })

    const between = await $.ui.mount({ ...assistant('Looking at the files first.'), surface: 'terminal' })
    expect(await between.find({ type: 'Text', text: /engine/ })).toBeUndefined()
    await between.unmount()

    const final = await $.ui.mount({ ...assistant('Done: two files updated.'), surface: 'terminal' })
    expect((await final.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    await final.unmount()
  })

  test('the last prompt sits in the band, other plugins rows below it', async ($, on) => {
    world(on, { isOn: true, hidden: [], lastPrompt: 'rename the\nmod please' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...band(), surface })
      expect((await ui.find({ type: 'Text', text: /mod please/ }))?.text).toBe('rename the mod please')
      expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
      await ui.unmount()
    }
  })

  test('the band shows no prompt while the view is off or in an agent view', async ($, on) => {
    const state = { isOn: false, hidden: [], lastPrompt: 'a prompt' }
    world(on, state)
    const off = await $.ui.mount({ ...band(), surface: 'terminal' })
    expect(await off.find({ type: 'Text', text: /a prompt/ })).toBeUndefined()
    await off.unmount()

    state.isOn = true
    const agent = await $.ui.mount({ ...band('agent_1'), surface: 'terminal' })
    expect(await agent.find({ type: 'Text', text: /a prompt/ })).toBeUndefined()
    await agent.unmount()
  })
})
