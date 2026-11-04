export const MAX_HIDDEN = 400

export const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

export function isHiddenText(list: readonly string[], text: string) {
  const block = normalize(text)
  if (block === '') return false

  return list.some(raw => {
    const entry = normalize(raw)

    return entry === block || (block.length >= entry.length * 0.6 && entry.includes(block))
  })
}

export const merge = (older: readonly string[], newer: readonly string[]) =>
  [...older.filter(entry => !newer.includes(entry)), ...newer].slice(-MAX_HIDDEN)

export const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

export function clip(text: string, max: number) {
  const flat = normalize(text)
  const room = Math.max(max, 8)

  return flat.length <= room ? flat : `${flat.slice(0, room - 1).trimEnd()}…`
}
