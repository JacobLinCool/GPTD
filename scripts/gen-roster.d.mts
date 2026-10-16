// Types for scripts/gen-roster.mjs (imported by tests/models.test.ts).

/** The generated half of the pool, rebuilt from the data (nothing is written). */
export function generateRoster(): {
  /** the text of src/sim/roster.generated.ts */
  text: string
  /** how many generated entries it holds */
  entries: number
  /** `g_` pins the map still lacks (empty when data/roster-aa-map.json is current) */
  newPins: Record<string, { slug: string; aaId: string }>
  /** checkpoints with no usable AA row */
  skipped: string[]
  /** data/roster-aa-map.json, parsed */
  map: Record<string, unknown>
}
/** Absolute path of src/sim/roster.generated.ts. */
export const GENERATED: string
