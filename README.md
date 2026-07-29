# Lean Search

A fast, lean search for Obsidian that **always surfaces the note you want** — built around precise matching and heavy *frecency*, like [`zoxide`](https://github.com/ajeetdsouza/zoxide) for your vault.

It started as a rethink of [Omnisearch](https://github.com/scambier/obsidian-omnisearch): same familiar modal, but with the parts that froze Obsidian, ballooned memory, and corrupted their cache removed — and with ranking that genuinely favors the notes you actually use.

## Why it's different

| Problem in the old approach | What Lean Search does |
| --- | --- |
| Kept **two full copies** of every note's text in RAM | Keeps only lightweight metadata + one inverted index; excerpts are read on demand |
| Serialized a fragile index into IndexedDB | A versioned plugin-local cache with validation, atomic replacement, and safe rebuild fallback |
| Re-indexed everything up front (freezes on big vaults) | Restores the previous index first, then refreshes only changed notes in the **background** |
| Recency used file *modification* time, weakly, and was off by default | **Frecency**: open-count × recency, tracked from `file-open` — recently/often opened notes win |
| Heading matches buried under body-text term-frequency | Explicit title/heading substring bonuses — heading hits reliably rise to the top |

## How ranking works (zoxide model)

Each result's final score is `base × field × recency × edit`:

1. **base (match)** — MiniSearch relevance. Terms are AND-combined with prefix matching; fuzzy is off by default for predictability.
2. **field** — exact title match, title/heading/alias substring hits get strong multipliers.
3. **recency (open-frecency)** — `1 + recencyWeight × ln(1 + frecency)`, where
   `frecency = open_count × recency_bucket` (4× within an hour, 2× within a day, 0.5× within a week, else 0.25×).
4. **edit** — an optional, gentle boost for files you *modified* recently (`1 + modifiedRecencyWeight × bucket`), independent of how often you open them.

The result: type a fragment of a note you opened recently and it jumps to **#1**. Leave the box empty and you get your most-frecent notes instantly, like `zoxide` with no argument.

Tune **Recency weight** and **Recently edited boost** in settings (both 0 = off). Turn on **Debug scoring** to see the full `match × field × recency × edit = final` breakdown under each result.

## Query syntax

| You type | Meaning |
| --- | --- |
| `foo bar` | both terms must match |
| `"foo bar"` | exact phrase |
| `#project` | must be tagged `#project` |
| `-draft` | must **not** contain `draft` |

## Keyboard

`↑↓` navigate · `Enter` open · `Ctrl/⌘ Enter` open in new pane · `Ctrl/⌘ ⌥ Enter` new split ·
`⌥ Enter` insert link · `Tab` search within the selected note · `⌥ ↑↓` query history · `Ctrl/⌘ O` open in background · `Esc` close.

## Build & install

```bash
npm install
npm run build      # outputs dist/main.js
npm test           # runs the frecency + query smoke test
```

Copy `dist/main.js`, `manifest.json`, and `styles.css` into
`<vault>/.obsidian/plugins/lean-search/`, then enable **Lean Search** in
Community Plugins. For development, `npm run dev` rebuilds on change.

### One-command install into your vault(s)

`scripts/install.sh` builds and copies the plugin into every vault listed in
`VAULT_PLUGIN_DIRS`. The convenience wrapper `install-plugin.sh` (machine-local,
gitignored) hardcodes your vault paths:

```bash
./install-plugin.sh          # build locally and install
npm run vault-install        # same thing
```

`scripts/release.sh` (via `npm run release -- <version>`) bumps versions, builds,
commits, and tags a release.

## Settings highlights

- **Recency weight**, **Recently edited boost**, and **Show recent notes on empty query** — the frecency behavior.
- **Index note body text** — turn off for the absolute leanest setup (titles/headings/tags only).
- **Persistent search index** — restored across Obsidian restarts, then reconciled lazily from file modification times.
- **Fuzziness** — keep on *Exact + prefix* for the most predictable results.
- **Field weights** — tune how much titles, headings, tags, etc. count.
- **Show image preview** — thumbnail of each result's first image (or frontmatter `cover`/`banner`/`image`). Reuses content already loaded for the visible results, so it doesn't slow search; recents stay instant.
- **Debug scoring** — show the `match × field × recency × edit = final` breakdown (and matched terms) under each result, for tuning.

## License

MIT.
