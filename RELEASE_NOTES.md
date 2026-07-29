# Lean Search 1.0.0

First release. A lean, fast vault search that always surfaces the note you want — precise matching plus heavy *frecency* (recently/frequently opened notes win), like `zoxide`.

## Highlights

- **Fast restarts.** A validated, versioned search index is restored across Obsidian restarts, then changed notes are refreshed lazily in the background. Invalid caches safely rebuild.
- **Frecency ranking.** Notes you open often and recently jump to the top. Empty query lists your most-frecent notes.
- **Reliable heading matches.** Explicit title/heading substring bonuses so heading hits surface instead of being buried under body text.
- **Predictable matching.** AND-combined terms, prefix on, fuzzy off by default.
- **Tiny footprint.** One inverted index in memory; excerpts read on demand.

## Query syntax

`foo bar` (all terms) · `"exact phrase"` · `#tag` · `-exclude`

## Keyboard

`↑↓` navigate · `Enter` open · `Ctrl/⌘ Enter` new pane · `Tab` search in file · `⌥ Enter` insert link · `⌥ ↑↓` history.
