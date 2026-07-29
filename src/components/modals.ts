import { MarkdownView, Modal, type Modifier, TFile } from 'obsidian'
import { mount, unmount } from 'svelte'
import type LeanSearchPlugin from '../main'
import { Action, isInputComposition } from '../globals'
import { eventBus } from '../event-bus'
import ModalVault from './ModalVault.svelte'
import ModalInFile from './ModalInFile.svelte'

abstract class BaseModal extends Modal {
  protected plugin: LeanSearchPlugin

  protected constructor(plugin: LeanSearchPlugin) {
    super(plugin.app)
    this.plugin = plugin
    const settings = plugin.settings

    this.modalEl.replaceChildren()
    this.modalEl.addClass('lean-search-modal', 'prompt')
    this.modalEl.removeClass('modal')
    this.modalEl.tabIndex = -1

    // Up / down navigation
    this.scope.register([], 'ArrowDown', e => {
      e.preventDefault()
      eventBus.emit(Action.ArrowDown)
    })
    this.scope.register([], 'ArrowUp', e => {
      e.preventDefault()
      eventBus.emit(Action.ArrowUp)
    })
    const vimKeys: [string, Action][] = [
      ['J', Action.ArrowDown],
      ['K', Action.ArrowUp],
      ['N', Action.ArrowDown],
      ['P', Action.ArrowUp],
    ]
    for (const [key, action] of vimKeys) {
      for (const mod of ['Mod', 'Ctrl'] as Modifier[]) {
        this.scope.register([mod], key, e => {
          if (settings.vimLikeNavigation) {
            e.preventDefault()
            eventBus.emit(action)
          }
        })
      }
    }

    let openCurrent: Modifier[]
    let openNewPane: Modifier[]
    let createCurrent: Modifier[]
    let createNewPane: Modifier[]
    if (settings.openInNewPane) {
      openCurrent = ['Mod']
      openNewPane = []
      createCurrent = ['Mod', 'Shift']
      createNewPane = ['Shift']
    } else {
      openCurrent = []
      openNewPane = ['Mod']
      createCurrent = ['Shift']
      createNewPane = ['Mod', 'Shift']
    }

    this.scope.register(openNewPane, 'Enter', e => {
      e.preventDefault()
      eventBus.emit(Action.OpenInNewPane)
    })
    this.scope.register(['Mod', 'Alt'], 'Enter', e => {
      e.preventDefault()
      eventBus.emit(Action.OpenInNewLeaf)
    })
    this.scope.register(['Alt'], 'Enter', e => {
      e.preventDefault()
      eventBus.emit(Action.InsertLink)
    })
    this.scope.register(createCurrent, 'Enter', e => {
      e.preventDefault()
      eventBus.emit(Action.CreateNote)
    })
    this.scope.register(createNewPane, 'Enter', e => {
      e.preventDefault()
      eventBus.emit(Action.CreateNote, { newLeaf: true })
    })
    this.scope.register(openCurrent, 'Enter', e => {
      if (!isInputComposition()) {
        e.preventDefault()
        eventBus.emit(Action.Enter)
      }
    })
    this.scope.register(['Mod'], 'O', e => {
      if (!isInputComposition()) {
        e.preventDefault()
        eventBus.emit(Action.OpenInBackground)
      }
    })
    this.scope.register([], 'Tab', e => {
      e.preventDefault()
      eventBus.emit(Action.Tab)
    })
    this.scope.register(['Alt'], 'ArrowDown', e => {
      e.preventDefault()
      eventBus.emit(Action.NextSearchHistory)
    })
    this.scope.register(['Alt'], 'ArrowUp', e => {
      e.preventDefault()
      eventBus.emit(Action.PrevSearchHistory)
    })
  }
}

export class LeanSearchVaultModal extends BaseModal {
  constructor(plugin: LeanSearchPlugin, query?: string) {
    super(plugin)
    const selectedText = plugin.app.workspace
      .getActiveViewOfType(MarkdownView)
      ?.editor.getSelection()
    const previous = plugin.settings.showPreviousQueryResults
      ? plugin.searchHistory.get().filter(Boolean)[0]
      : ''

    const cmp = mount(ModalVault, {
      target: this.modalEl,
      props: {
        plugin,
        modal: this,
        previousQuery: query || selectedText || previous || '',
      },
    })
    this.onClose = () => {
      unmount(cmp)
    }
  }
}

export class LeanSearchInFileModal extends BaseModal {
  constructor(
    plugin: LeanSearchPlugin,
    file: TFile,
    searchQuery = '',
    parent?: Modal
  ) {
    super(plugin)
    const cmp = mount(ModalInFile, {
      target: this.modalEl,
      props: { plugin, modal: this, file, previousQuery: searchQuery },
    })
    if (parent) parent.containerEl.toggleVisibility(false)
    this.onClose = () => {
      if (parent) parent.containerEl.toggleVisibility(true)
      unmount(cmp)
    }
  }
}
