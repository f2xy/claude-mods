# claude-mods

Mods for [Claude Code](https://docs.claude.com/en/docs/claude-code/overview). Each mod lives in its own folder under `plugins/` and is listed in `.claude-plugin/marketplace.json`, so this repository works as a plugin marketplace.

## Mods

| Mod | What it does |
| --- | --- |
| [summary-only](plugins/summary-only) | Hides tool calls, diffs and the text between tool calls so the transcript keeps your prompt and the final answer; pins your last prompt above the input and opens the session's changes as an HTML diff report. |

## Install a mod

At the prompt of a Claude Code terminal session:

```
/plugin install summary-only --marketplace f2xy/claude-mods
```

From a shell:

```
claude plugin install summary-only --marketplace f2xy/claude-mods
```

Claude Code asks once to add the marketplace (answer `y`), then for a scope. Once the marketplace is added, the other mods install by name: `/plugin install <mod>@claude-mods`.

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `f2xy/claude-mods`, then Add plugin.

## Adding a mod

1. Put the mod in `plugins/<mod>/`, with its manifest at `plugins/<mod>/.claude-plugin/plugin.json`.
2. Add an entry to `.claude-plugin/marketplace.json`: `{ "name": "<mod>", "source": "./plugins/<mod>", "description": "..." }`.
3. Add a row to the table above.
4. Check it: `claude plugin validate plugins/<mod>` and `claude plugin test plugins/<mod>`.

## License

MIT, see [LICENSE](LICENSE).
