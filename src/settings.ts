import { App, PluginSettingTab, Setting } from 'obsidian'
import type LeanSearchPlugin from './main'
import { setVerbose } from './utils'

export interface LeanSearchSettings {
  // --- Matching ---
  /** Index note body text (in the background) in addition to titles/headings/tags. */
  indexBody: boolean
  /** Fuzzy tolerance for long terms. 0 = exact + prefix only (most precise). */
  fuzziness: 0 | 0.1 | 0.2
  /** Ignore accents/diacritics when matching. */
  ignoreDiacritics: boolean
  /** Split camelCase and snake/hyphen tokens into extra searchable words. */
  splitCompoundWords: boolean

  // --- Frecency (zoxide-like recency) ---
  /**
   * How hard to favor recently/frequently opened notes.
   * 0 = off, ~1.5 = strong (default), higher = recency dominates more.
   */
  recencyWeight: number
  /**
   * How hard to favor recently *edited* notes (by file modification time),
   * independent of how often they're opened. 0 = off.
   */
  modifiedRecencyWeight: number
  /** With an empty query, list your most-frecent notes (like `zoxide` with no arg). */
  showFrecentOnEmpty: boolean

  // --- Field weights ---
  weightTitle: number
  weightHeadings: number
  weightTags: number
  weightAliases: number
  weightDirectory: number
  weightBody: number

  // --- UI / behavior ---
  maxResults: number
  showExcerpt: boolean
  /** Show a thumbnail of each result's first image (or frontmatter cover). */
  showImagePreview: boolean
  highlight: boolean
  openInNewPane: boolean
  vimLikeNavigation: boolean
  ribbonIcon: boolean
  showPreviousQueryResults: boolean
  /** Show each result's score breakdown (match × field × recency × edit). */
  debugScoring: boolean

  // --- Indexing scope ---
  extraExtensions: string[]

  verboseLogging: boolean
}

export const DEFAULT_SETTINGS: LeanSearchSettings = {
  indexBody: true,
  fuzziness: 0,
  ignoreDiacritics: true,
  splitCompoundWords: true,

  recencyWeight: 1.5,
  modifiedRecencyWeight: 0.5,
  showFrecentOnEmpty: true,

  weightTitle: 12,
  weightHeadings: 8,
  weightTags: 6,
  weightAliases: 6,
  weightDirectory: 2,
  weightBody: 1,

  maxResults: 50,
  showExcerpt: true,
  showImagePreview: false,
  highlight: true,
  openInNewPane: false,
  vimLikeNavigation: false,
  ribbonIcon: true,
  showPreviousQueryResults: true,
  debugScoring: false,

  extraExtensions: [],

  verboseLogging: false,
}

export class LeanSearchSettingTab extends PluginSettingTab {
  plugin: LeanSearchPlugin

  constructor(app: App, plugin: LeanSearchPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  private save = async () => {
    await this.plugin.saveSettings()
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    const s = this.plugin.settings

    new Setting(containerEl).setName('Recency (frecency)').setHeading()

    new Setting(containerEl)
      .setName('Recency weight')
      .setDesc(
        'How strongly to favor notes you opened recently or often, like zoxide. ' +
          '0 disables it; 1.5 is a strong default; higher makes recency dominate.'
      )
      .addSlider(sl =>
        sl
          .setLimits(0, 4, 0.1)
          .setValue(s.recencyWeight)
          .setDynamicTooltip()
          .onChange(async v => {
            s.recencyWeight = v
            await this.save()
          })
      )

    new Setting(containerEl)
      .setName('Recently edited boost')
      .setDesc(
        'Also lift notes you edited recently (by file modification time), ' +
          'independent of how often you open them. 0 disables it.'
      )
      .addSlider(sl =>
        sl
          .setLimits(0, 4, 0.1)
          .setValue(s.modifiedRecencyWeight)
          .setDynamicTooltip()
          .onChange(async v => {
            s.modifiedRecencyWeight = v
            await this.save()
          })
      )

    new Setting(containerEl)
      .setName('Show recent notes on empty query')
      .setDesc(
        'When the search box is empty, list your most recently/frequently opened notes.'
      )
      .addToggle(t =>
        t.setValue(s.showFrecentOnEmpty).onChange(async v => {
          s.showFrecentOnEmpty = v
          await this.save()
        })
      )

    new Setting(containerEl)
      .setName('Reset recency data')
      .setDesc('Forget all open-history used for frecency ranking.')
      .addButton(b =>
        b.setButtonText('Reset').onClick(async () => {
          this.plugin.frecency.clear()
          await this.save()
        })
      )

    new Setting(containerEl).setName('Matching').setHeading()

    new Setting(containerEl)
      .setName('Index note body text')
      .setDesc(
        'Search inside note contents (indexed in the background). ' +
          'Titles, headings, tags and aliases are always indexed instantly. ' +
          'Turn off for the leanest, fastest setup.'
      )
      .addToggle(t =>
        t.setValue(s.indexBody).onChange(async v => {
          s.indexBody = v
          await this.save()
          this.plugin.rebuildIndex()
        })
      )

    new Setting(containerEl)
      .setName('Fuzziness')
      .setDesc(
        'Exact is the most predictable (recommended). Higher tolerates typos in long words but can surface unrelated content.'
      )
      .addDropdown(d =>
        d
          .addOption('0', 'Exact + prefix (recommended)')
          .addOption('0.1', 'Slight')
          .addOption('0.2', 'Loose')
          .setValue(String(s.fuzziness))
          .onChange(async v => {
            s.fuzziness = Number(v) as LeanSearchSettings['fuzziness']
            await this.save()
          })
      )

    new Setting(containerEl)
      .setName('Ignore diacritics')
      .setDesc('Match "café" when you type "cafe", and vice versa.')
      .addToggle(t =>
        t.setValue(s.ignoreDiacritics).onChange(async v => {
          s.ignoreDiacritics = v
          await this.save()
          this.plugin.rebuildIndex()
        })
      )

    new Setting(containerEl)
      .setName('Split compound words')
      .setDesc(
        'Make "leanSearch" and "lean-search" findable by typing "lean" or "search".'
      )
      .addToggle(t =>
        t.setValue(s.splitCompoundWords).onChange(async v => {
          s.splitCompoundWords = v
          await this.save()
          this.plugin.rebuildIndex()
        })
      )

    new Setting(containerEl).setName('Field weights').setHeading()
    const weight = (
      name: string,
      key: keyof LeanSearchSettings,
      desc = ''
    ) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addSlider(sl =>
          sl
            .setLimits(0, 20, 1)
            .setValue(s[key] as number)
            .setDynamicTooltip()
            .onChange(async v => {
              ;(s[key] as number) = v
              await this.save()
            })
        )
    }
    weight('Title', 'weightTitle')
    weight('Headings', 'weightHeadings', 'Higher = heading matches win more.')
    weight('Tags', 'weightTags')
    weight('Aliases', 'weightAliases')
    weight('Folder / path', 'weightDirectory')
    weight('Body', 'weightBody')

    new Setting(containerEl).setName('Interface').setHeading()

    new Setting(containerEl)
      .setName('Max results')
      .addSlider(sl =>
        sl
          .setLimits(10, 100, 5)
          .setValue(s.maxResults)
          .setDynamicTooltip()
          .onChange(async v => {
            s.maxResults = v
            await this.save()
          })
      )

    new Setting(containerEl)
      .setName('Show excerpts')
      .addToggle(t =>
        t.setValue(s.showExcerpt).onChange(async v => {
          s.showExcerpt = v
          await this.save()
        })
      )

    new Setting(containerEl)
      .setName('Show image preview')
      .setDesc(
        "Show a thumbnail of the note's first image (or frontmatter cover) " +
          'next to each result. Uses content already loaded for the visible ' +
          'results, so it does not slow searches; the empty-query recents list ' +
          'stays instant.'
      )
      .addToggle(t =>
        t.setValue(s.showImagePreview).onChange(async v => {
          s.showImagePreview = v
          await this.save()
        })
      )

    new Setting(containerEl)
      .setName('Highlight matches')
      .addToggle(t =>
        t.setValue(s.highlight).onChange(async v => {
          s.highlight = v
          await this.save()
        })
      )

    new Setting(containerEl)
      .setName('Open results in a new pane by default')
      .setDesc('Swaps Enter and Ctrl/Cmd+Enter behavior.')
      .addToggle(t =>
        t.setValue(s.openInNewPane).onChange(async v => {
          s.openInNewPane = v
          await this.save()
        })
      )

    new Setting(containerEl)
      .setName('Vim-like navigation (Ctrl+J/K, Ctrl+N/P)')
      .addToggle(t =>
        t.setValue(s.vimLikeNavigation).onChange(async v => {
          s.vimLikeNavigation = v
          await this.save()
        })
      )

    new Setting(containerEl)
      .setName('Ribbon icon')
      .addToggle(t =>
        t.setValue(s.ribbonIcon).onChange(async v => {
          s.ribbonIcon = v
          await this.save()
          this.plugin.refreshRibbon()
        })
      )

    new Setting(containerEl)
      .setName('Restore last query on open')
      .addToggle(t =>
        t.setValue(s.showPreviousQueryResults).onChange(async v => {
          s.showPreviousQueryResults = v
          await this.save()
        })
      )

    new Setting(containerEl).setName('Indexing scope').setHeading()

    new Setting(containerEl)
      .setName('Extra file extensions')
      .setDesc(
        'Comma-separated, in addition to .md (e.g. "txt, csv"). Plain-text files only.'
      )
      .addText(t =>
        t
          .setPlaceholder('txt, csv')
          .setValue(s.extraExtensions.join(', '))
          .onChange(async v => {
            s.extraExtensions = v
              .split(',')
              .map(e => e.trim().replace(/^\./, '').toLowerCase())
              .filter(Boolean)
            await this.save()
          })
      )
      .addExtraButton(b =>
        b
          .setIcon('refresh-cw')
          .setTooltip('Rebuild index')
          .onClick(() => this.plugin.rebuildIndex())
      )

    new Setting(containerEl)
      .setName('Debug scoring')
      .setDesc(
        'Show each result\'s score breakdown — match × field × recency × edit ' +
          '— under the result. Useful for tuning the weights above.'
      )
      .addToggle(t =>
        t.setValue(s.debugScoring).onChange(async v => {
          s.debugScoring = v
          await this.save()
        })
      )

    new Setting(containerEl)
      .setName('Verbose logging')
      .setDesc('Log diagnostics to the developer console.')
      .addToggle(t =>
        t.setValue(s.verboseLogging).onChange(async v => {
          s.verboseLogging = v
          setVerbose(v)
          await this.save()
        })
      )
  }
}
