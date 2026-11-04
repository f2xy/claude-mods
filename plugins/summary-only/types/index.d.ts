export type SummaryOnlyHidden = string[]
export type TrackedFile = { path: string; key: string }

declare module 'claude-code' {
  interface PluginState {
    'summary-only': {
      isOn: boolean
      hidden: SummaryOnlyHidden
      lastPrompt: string | null
      files: TrackedFile[]
      generation: number
      busy: string | null
      baseline: StateFamily<string | null>
    }
  }
}
