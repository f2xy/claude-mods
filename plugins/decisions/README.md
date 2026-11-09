# decisions

When Claude finishes a piece of work and leaves decisions for you, this mod makes you answer them one by one instead of replying to a list.

## Modes

- **ask** (default): Claude asks each decision with the question dialog (AskUserQuestion), one question per decision, its recommendation first. You pick an option or type your own answer, and Claude carries on with your answers in the same turn.
- **form**: Claude ends its reply with a `## Decisions` section (`## Kararlar` in Turkish), one numbered item per decision. A band above the prompt says how many are waiting; **Answer** (or `/decisions`) opens a form with one field under each item. Enter moves to the next field, Enter on the last one (or **Send answers**) sends them all as one message:

  ```
  Kararlar:
  1. Varsayılan mod
     → ask olsun
  2. Komut adı
     → —
  ```

  An item left empty is sent as `—`, and Claude treats it as still open.

In **ask** mode the form is still there for decisions Claude could not put as options, or when you dismiss the dialog.

The mode is the plugin's `mode` option (`/plugin` → decisions → configure, or the config menu while developing). A change reaches the system prompt in a new session or after `/clear`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install decisions --marketplace f2xy/claude-mods
```

From a shell:

```
claude plugin install decisions --marketplace f2xy/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `f2xy/claude-mods`, then Add plugin.

## Limits

- The system prompt part (asking with the question dialog, or the Decisions heading in form mode) starts in the next session or after `/clear`; the band and the form work as soon as the mod loads.
- The band appears only when Claude's final message ends with a Decisions section (`## Decisions`, `## Kararlar`, and a few variants), so a plain numbered list elsewhere in the reply is never picked up.

## License

MIT
