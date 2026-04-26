# Claude-specific notes

Inherits `AGENTS.md`. Claude-only addenda below.

## Editing

Prefer the `Edit` tool over `Write` for existing files — `Edit` sends the diff while `Write` rewrites the whole file. Only `Write` for genuinely new files.

## Skills worth using

- Run `/code-review` before merging a PR to main.
- Run `/simplify` before merging a PR to main.
- For UI changes, `/design-review` drives the UI in Playwright, captures real states, and critiques against Rams + Nielsen + Shneiderman + WCAG 2.0 AA. Run after every user-facing change.
