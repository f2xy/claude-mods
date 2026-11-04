import { describe, expect, test } from 'claude-code/testing'

import { diffFile } from '../hooks/diff'
import { buildPrompt, numberedDiff, parseReview } from '../hooks/notes'

const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
const after = before.replace('line 10', 'line ten').replace('line 2\n', '')
const diff = diffFile('D:\\proj\\src\\a.ts', 'src/a.ts', before, after)!
const added = diffFile('D:\\proj\\src\\b.ts', 'src/b.ts', null, 'export {}\n')!

describe('numberedDiff', () => {
  test('numbers each side and hides far context', () => {
    const text = numberedDiff(diff)
    expect(text).toContain('- old 2 | line 2')
    expect(text).toContain('- old 10 | line 10')
    expect(text).toContain('+ new 9 | line ten')
    expect(text).toContain('  new 12 | line 13')
    expect(text).toContain('   ⋯')
    expect(text).not.toContain('line 20')
  })
})

describe('buildPrompt', () => {
  test('names every file the way the reply must name it', () => {
    const prompt = buildPrompt([diff, added])
    expect(prompt).toContain('### src/a.ts (changed file, +1 −2)')
    expect(prompt).toContain('### src/b.ts (new file, +1 −0)')
    expect(prompt).toContain('"side": "new"')
  })
})

describe('parseReview', () => {
  test('reads a fenced reply and keeps valid notes only', () => {
    const reply = [
      'Here are the notes:',
      '```json',
      JSON.stringify({
        summary: 'Line 10 was renamed.',
        files: [
          {
            path: 'src/a.ts',
            summary: 'One line was deleted, one changed.',
            notes: [
              { side: 'new', line: 9, kind: 'important', text: '`line ten` is the new name.' },
              { side: 'old', line: '2', kind: 'risk', text: 'Deleted line.' },
              { side: 'new', line: 3, kind: 'weird', text: 'Unknown kind.' },
              { side: 'new', line: 4, text: '' },
            ],
          },
          { path: 'D:/proj/src/b.ts', summary: 'New file.', notes: [] },
          { path: 'nowhere.ts', notes: [{ line: 1, text: 'x' }] },
        ],
      }),
      '```',
    ].join('\n')

    const review = parseReview(reply, [diff, added])!
    expect(review.summary).toBe('Line 10 was renamed.')
    expect(review.files.size).toBe(2)
    expect(review.files.get(diff.path)).toEqual({
      summary: 'One line was deleted, one changed.',
      notes: [
        { side: 'new', line: 9, kind: 'important', text: '`line ten` is the new name.' },
        { side: 'old', line: 2, kind: 'risk', text: 'Deleted line.' },
        { side: 'new', line: 3, kind: 'info', text: 'Unknown kind.' },
      ],
    })
    expect(review.files.get(added.path)?.summary).toBe('New file.')
  })

  test('gives up on a reply with no JSON', () => {
    expect(parseReview('Sorry, I cannot.', [diff])).toBeUndefined()
    expect(parseReview('{ broken', [diff])).toBeUndefined()
  })
})
