import { type App, MarkdownView, normalizePath, TFile } from 'obsidian'
import type LeanSearchPlugin from './main'
import type { ResultNote } from './globals'

type OpenWhere = false | 'tab' | 'split'

function where(newPane: boolean, newLeaf: boolean): OpenWhere {
  if (newLeaf) return 'split'
  if (newPane) return 'tab'
  return false
}

export async function openNote(
  plugin: LeanSearchPlugin,
  item: ResultNote,
  offset = 0,
  newPane = false,
  newLeaf = false
): Promise<void> {
  const app = plugin.app
  await app.workspace.openLinkText(item.path, '', where(newPane, newLeaf))

  const view = app.workspace.getActiveViewOfType(MarkdownView)
  if (!view) return // e.g. an image/PDF — nothing to position

  if (offset > 0) {
    const pos = view.editor.offsetToPos(offset)
    view.editor.setCursor(pos)
    view.editor.scrollIntoView(
      {
        from: { line: Math.max(0, pos.line - 5), ch: 0 },
        to: { line: pos.line + 5, ch: 0 },
      },
      true
    )
    const match = item.matches?.find(m => m.offset === offset)
    if (match) {
      const end = view.editor.offsetToPos(offset + match.match.length)
      view.editor.setSelection(pos, end)
    }
  }
}

export async function createNote(
  app: App,
  name: string,
  newLeaf = false
): Promise<void> {
  let prefix = ''
  const vault = app.vault as unknown as { getConfig(k: string): unknown }
  switch (vault.getConfig('newFileLocation')) {
    case 'current':
      prefix = (app.workspace.getActiveFile()?.parent?.path ?? '') + '/'
      break
    case 'folder':
      prefix = (vault.getConfig('newFileFolderPath') as string) + '/'
      break
    default:
      prefix = ''
  }
  const path = normalizePath(`${prefix}${name}.md`)
  await app.workspace.openLinkText(path, '', newLeaf)
}

export function isMarkdownPath(path: string): boolean {
  const file = path
  return file.endsWith('.md')
}

export function fileFromPath(app: App, path: string): TFile | null {
  const f = app.vault.getAbstractFileByPath(path)
  return f instanceof TFile ? f : null
}
