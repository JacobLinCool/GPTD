// Types for scripts/arch-sync.mjs (imported by tests/models.test.ts).

/** data/model-arch.json, parsed. */
export function loadArch(): { models: Record<string, Record<string, unknown>> }
/** The roster-facing derived serving record of one data/model-arch.json entry. */
export function derive(entry: Record<string, unknown>): Record<string, unknown>
/** The text of src/sim/roster.arch.generated.ts rebuilt from the data, plus a log line per checkpoint. */
export function archSource(): { text: string; rows: string[] }
/** Absolute path of src/sim/roster.arch.generated.ts. */
export const GENERATED: string
