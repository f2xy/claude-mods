import { describe, expect, test } from 'claude-code/testing'

import { diffFile, diffLines, splitLines, trimEqual } from '../hooks/diff'
import type { Op } from '../hooks/diff'
import { renderPage } from '../hooks/page'

const apply = (ops: Op[]) => {
  const before: string[] = []
  const after: string[] = []
  for (const op of ops) {
    if (op[0] === '~') continue
    if (op[0] !== '+') before.push(...op[1])
    if (op[0] !== '-') after.push(...op[1])
  }
  return { before, after }
}

describe('diffLines', () => {
  test('rebuilds both sides from the ops', () => {
    const a = ['a', 'b', 'c', 'd', 'e', 'f']
    const b = ['a', 'x', 'c', 'd', 'y', 'f', 'g']
    const ops = diffLines(a, b)
    expect(apply(ops)).toEqual({ before: a, after: b })
    expect(ops).toEqual([
      ['=', ['a']],
      ['-', ['b']],
      ['+', ['x']],
      ['=', ['c', 'd']],
      ['-', ['e']],
      ['+', ['y']],
      ['=', ['f']],
      ['+', ['g']],
    ])
  })

  test('handles empty sides', () => {
    expect(diffLines([], ['x', 'y'])).toEqual([['+', ['x', 'y']]])
    expect(diffLines(['x'], [])).toEqual([['-', ['x']]])
    expect(diffLines([], [])).toEqual([])
  })

  test('finds a minimal diff in shuffled input', () => {
    const a = 'the quick brown fox jumps over the lazy dog'.split(' ')
    const b = 'a quick brown cat jumps under the lazy dog today'.split(' ')
    const ops = diffLines(a, b)
    expect(apply(ops)).toEqual({ before: a, after: b })
    const edits = ops.reduce((sum, op) => (op[0] === '=' || op[0] === '~' ? sum : sum + op[1].length), 0)
    expect(edits).toBe(7)
  })

  test('falls back to replace when the edit limit is passed', () => {
    const a = Array.from({ length: 50 }, (_, i) => `old ${i}`)
    const b = Array.from({ length: 50 }, (_, i) => `new ${i}`)
    const ops = diffLines(['head', ...a, 'tail'], ['head', ...b, 'tail'], 10)
    expect(ops).toEqual([
      ['=', ['head']],
      ['-', a],
      ['+', b],
      ['=', ['tail']],
    ])
  })
})

describe('diffFile', () => {
  test('marks new, deleted and modified files', () => {
    expect(diffFile('/p/a', 'a', null, 'x\ny\n')).toMatchObject({ status: 'added', added: 2, removed: 0 })
    expect(diffFile('/p/a', 'a', 'x\n', null)).toMatchObject({ status: 'deleted', added: 0, removed: 1 })
    expect(diffFile('/p/a', 'a', 'x\ny\n', 'x\nz\n')).toMatchObject({ status: 'modified', added: 1, removed: 1 })
    expect(diffFile('/p/a', 'a', 'same', 'same')).toBeUndefined()
  })

  test('notices a line ending change', () => {
    const diff = diffFile('/p/a', 'a', 'x\r\ny\r\n', 'x\ny\n')
    expect(diff).toMatchObject({ isEolChanged: true, added: 0, removed: 0 })
  })

  test('splits CRLF and drops the last empty line', () => {
    expect(splitLines('a\r\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('')).toEqual([])
  })
})

describe('trimEqual', () => {
  test('keeps context around changes and counts what it drops', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `l${i}`)
    const ops: Op[] = [
      ['=', lines],
      ['+', ['new']],
      ['=', lines],
      ['-', ['old']],
      ['=', lines],
    ]
    const trimmed = trimEqual(ops, 2)
    expect(trimmed).toEqual([
      ['~', 28],
      ['=', ['l28', 'l29']],
      ['+', ['new']],
      ['=', ['l0', 'l1']],
      ['~', 26],
      ['=', ['l28', 'l29']],
      ['-', ['old']],
      ['=', ['l0', 'l1']],
      ['~', 28],
    ])
  })
})

describe('renderPage', () => {
  test('embeds the data without breaking out of the script tag', () => {
    const diff = diffFile('/p/x.html', 'x.html', '<p>a</p>\n', '</script><b>b</b>\n')!
    const html = renderPage({
      root: '/p',
      generatedAt: 0,
      files: [diff],
      isTrimmed: false,
      summary: '',
      notice: '',
      css: '',
      js: '',
    })
    expect(html).toContain('<title>Diff · 1 file · +1 −1</title>')
    expect(html).toContain('\\u003c/script>\\u003cb>b\\u003c/b>')
    expect(html.match(/<\/script>/g)).toHaveLength(2)
  })
})
