type Handler = (...args: any[]) => void

/**
 * Tiny scoped event bus used to bridge Obsidian's keyboard scope (in the modal)
 * with the Svelte components rendered inside it.
 */
export class EventBus {
  private handlers: Record<string, { ctx: string; fn: Handler }[]> = {}
  private disabledContexts = new Set<string>()

  on(ctx: string, event: string, fn: Handler): void {
    ;(this.handlers[event] ??= []).push({ ctx, fn })
  }

  emit(event: string, ...args: any[]): void {
    for (const { ctx, fn } of this.handlers[event] ?? []) {
      if (!this.disabledContexts.has(ctx)) fn(...args)
    }
  }

  enable(ctx: string): void {
    this.disabledContexts.delete(ctx)
  }

  disable(ctx: string): void {
    this.disabledContexts.add(ctx)
    // Drop handlers for this context so destroyed components don't leak.
    for (const event of Object.keys(this.handlers)) {
      this.handlers[event] = this.handlers[event]!.filter(h => h.ctx !== ctx)
    }
  }
}

export const eventBus = new EventBus()
