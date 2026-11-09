export type DecisionItem = { title: string; text: string }

export type DecisionSet = { id: string; heading: string; items: DecisionItem[] }

declare module 'claude-code' {
  interface PluginState {
    decisions: {
      current: Shaped<DecisionSet | null>
      answers: string[]
      isHidden: boolean
    }
  }
}
