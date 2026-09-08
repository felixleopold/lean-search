# Lean Search 1.0.1

- Stop obsolete searches after the current read batch when the query changes or the search modal closes, reducing wasted reads and text processing during rapid typing.
- Preserve keyboard selection when excerpts finish loading.
- Speed up tokenization by checking for CJK characters without allocating a character array for every token.
- Remove redundant regular-expression compilation during highlighting.

Search ranking, matching, excerpts, and image previews retain their existing behavior.

Validation: core and cache tests, focused search cancellation and mixed-language tokenization tests, Svelte checks, production build, and the 5,000-note synthetic benchmark.
