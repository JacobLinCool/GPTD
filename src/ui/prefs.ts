/**
 * ui/prefs.ts — per-viewer panel memory (which tab was open, which card was
 * collapsed). A convenience only: it lives in this browser's localStorage under
 * its own key, every access is wrapped (private windows / blocked storage just
 * fall back to defaults), and the sim never reads it.
 */

const KEY = 'gptd_ui'

let cache: Record<string, unknown> | null = null

function load(): Record<string, unknown> {
  if (cache) return cache
  cache = {}
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object') cache = parsed as Record<string, unknown>
    }
  } catch {
    /* ignore — defaults */
  }
  return cache
}

/** Read a remembered value, falling back when it is missing or of the wrong type. */
export function getPref(key: string, fallback: boolean): boolean
export function getPref(key: string, fallback: number): number
export function getPref(key: string, fallback: string): string
export function getPref(key: string, fallback: string | number | boolean): string | number | boolean {
  const v = load()[key]
  return typeof v === typeof fallback ? (v as string | number | boolean) : fallback
}

/** Remember a value for the next visit (best effort). */
export function setPref(key: string, value: string | number | boolean): void {
  const p = load()
  if (p[key] === value) return
  p[key] = value
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* ignore (quota / private mode) */
  }
}
