/**
 * The bill currently being processed.
 *
 * Lives in a store rather than being passed between routes because the router
 * renders by route name, and the capture screen hands off to the review screen
 * with a bill in flight.
 *
 * It holds raw state only. Every derived value (shares, gates, whether the
 * commit is allowed) is computed from it by the pure functions in split.ts,
 * which are the tested ones. Duplicating that logic here as reactive state
 * would mean two implementations that can disagree.
 */

import type { Extraction, ExtractedItem, AssignedItem } from './types'
import type { PreparedReceipt } from './image'

class DraftStore {
  /** The downscaled JPEG, kept so the review screen can show the photo the model actually saw. */
  photo = $state<PreparedReceipt | null>(null)
  /** Raw model output, kept whole so it can be stored for later auditing. */
  extraction = $state<Extraction | null>(null)
  items = $state<AssignedItem[]>([])
  roster = $state<string[]>([])
  notes = $state('')

  /** True while the model is reading the photo. */
  busy = $state(false)
  /** Whatever went wrong, shown verbatim. */
  error = $state<string | null>(null)

  get active(): boolean {
    return this.extraction !== null
  }

  /** Load a fresh extraction and reset everything the operator had entered. */
  start(photo: PreparedReceipt, extraction: Extraction): void {
    this.photo = photo
    this.extraction = extraction
    this.items = extraction.items.map((item: ExtractedItem, index: number) => ({
      ...item,
      position: index + 1,
      assigned_to: [],
    }))
    this.roster = []
    this.notes = ''
    this.error = null
  }

  reset(): void {
    this.photo = null
    this.extraction = null
    this.items = []
    this.roster = []
    this.notes = ''
    this.error = null
  }

  addPerson(name: string): void {
    const trimmed = name.trim()
    if (!trimmed || this.roster.includes(trimmed)) return
    this.roster.push(trimmed)
  }

  removePerson(name: string): void {
    this.roster = this.roster.filter((p) => p !== name)
    // Dropping someone from the roster must also drop them from every item, or
    // they would still count toward a split they are no longer part of.
    this.items = this.items.map((item) => ({
      ...item,
      assigned_to: item.assigned_to.filter((p) => p !== name),
    }))
  }

  toggleAssignee(position: number, person: string): void {
    this.items = this.items.map((item) => {
      if (item.position !== position) return item
      const has = item.assigned_to.includes(person)
      return {
        ...item,
        assigned_to: has
          ? item.assigned_to.filter((p) => p !== person)
          : [...item.assigned_to, person],
      }
    })
  }

  updateItem(position: number, patch: Partial<ExtractedItem>): void {
    this.items = this.items.map((item) =>
      item.position === position ? { ...item, ...patch } : item,
    )
  }

  updateHeader(patch: Partial<Extraction>): void {
    if (this.extraction) this.extraction = { ...this.extraction, ...patch }
  }
}

export const draft = new DraftStore()
