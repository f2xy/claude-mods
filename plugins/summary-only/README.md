# summary-only

A Claude Code mod for people who only read the result. While Claude works, the transcript keeps your prompt and Claude's final answer; tool calls, their output, file diffs and the text Claude writes between tool calls are hidden.

## What it does

- **Summary-only view.** Tool rows, tool results, folded tool groups, background task notices and the text between tool calls are hidden. Questions Claude asks you (`AskUserQuestion`) and plan approval stay visible, as do permission prompts.
- **A self-contained final answer.** While the view is on, Claude is told that you only see its final message, so it writes that message to stand on its own.
- **Last prompt pinned.** Your last prompt stays in a highlighted row just above the input box.
- **Diff report.** Once Claude edits files (`Edit`, `Write`, `NotebookEdit`), a row above the input shows how many files changed, with buttons that open the session's changes in your browser:
  - **Annotated diff** (`d`): the diff with review notes Claude writes from the session's context.
  - **Plain diff** (`p`): the diff alone, without asking the model.
  - **Flow diagram** (`f`): a Mermaid diagram of what the work does and how it connects (needs an internet connection to load Mermaid).
  - **Reset** (`r`): start tracking changes again from now.
- The footer shows a `summary-only` label while the view is on.

## Usage

```
/summary-only            toggle the view
/summary-only on | off   turn it on or off
/summary-only status     show whether it is on
/summary-only diff       open the annotated diff
/summary-only diff plain | flow | reset
```

`ctrl+o` still shows the full tool rows. The text between tool calls stays hidden there; run `/summary-only off` to see everything again. The diff row works whether the view is on or off.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install summary-only --marketplace f2xy/claude-mods
```

From a shell:

```
claude plugin install summary-only --marketplace f2xy/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `f2xy/claude-mods`, then Add plugin.

## Limits

- Text between tool calls can show for a moment while it streams, and disappears when the next tool call starts.
- Text written before the mod was installed is not hidden; only the tool rows are.
- The pinned prompt row uses a fixed dark grey background (`#3a3a3a`), chosen for dark terminal themes.
- Diff tracking covers files changed with `Edit`, `Write` and `NotebookEdit`, not files a shell command changed.

## License

MIT
