import type { FileDiff } from './diff'
import type { Note } from './notes'

export type PageFile = FileDiff & { summary?: string; notes?: Note[] }

export type PageInput = {
  root: string
  generatedAt: number
  files: PageFile[]
  isTrimmed: boolean
  summary: string
  notice: string
  css: string
  js: string
}

export const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

export const safeScript = (code: string) => code.replace(/<\/script/gi, '<\\/script')

export function renderPage(input: PageInput): string {
  const added = input.files.reduce((sum, file) => sum + file.added, 0)
  const removed = input.files.reduce((sum, file) => sum + file.removed, 0)
  const title = `Diff · ${input.files.length} file${input.files.length === 1 ? '' : 's'} · +${added} −${removed}`
  const data = {
    root: input.root,
    generatedAt: input.generatedAt,
    isTrimmed: input.isTrimmed,
    summary: input.summary,
    notice: input.notice,
    files: input.files,
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
    `<script type="application/json" id="diff-data">${safeJson(data)}</script>`,
    `<script>${safeScript(input.js)}</script>`,
    '</body>',
    '</html>',
  ].join('\n')
}
