// Artificial Analysis cell resolution — the shared core of `aa-sync.mjs` and `gen-roster.mjs`.
//
// GPTD calibrates `qualityBy` from six canonical benchmark cells (GPQA-Diamond, IFBench, LCR,
// SciCode, Terminal-Bench Hard, HLE; see src/sim/calibrate.ts). Artificial Analysis re-runs and
// retires evals over time, so a per-benchmark % is NOT stable across snapshots on its own (the
// 2026-10 refresh re-scored LCR by +4.5 points on average and stopped publishing IFBench and
// TB-Hard for new models). Stability comes from this module:
//
//   1. REFERENCE SCALE — data/aa-reference-2026-06-21.json is the frozen snapshot the calibration
//      curves were quantile-fitted on. Every cell is expressed on that scale.
//   2. PINNING BY AA UUID — roster models are joined by AA model `id` (slugs are recycled: the
//      bare `deepseek-v4-flash` slug moved to a different checkpoint in 2026-07).
//   3. PER-CELL RESOLUTION, in order:
//        ref     the reference snapshot's value for that UUID (every pre-refresh model; exact)
//        latest  the latest snapshot's value for a cell AA froze (byte-identical on every overlap)
//        eq      the latest value of a re-scored cell, mapped back by mean-sigma equating fitted
//                on same-UUID pairs (lcr_ref = a + b·lcr_new)
//        bridge  an OLS bridge from MEASURED cells only (no chaining, except the documented
//                TB 2.1 stage for TB-Hard), clamped to the target's observed range
//   4. COMMITTED FITS — `aa-sync.mjs bridges` fits the equating + bridges and writes
//      data/aa-bridges.json; builds read that file, so a build is deterministic and the fits
//      are reviewable in diffs. The game itself only ever sees the resolved numbers.
//
// The successor cells (Terminal-Bench 2.1 / 4.0, tau-banking) are display + bridge predictors
// only — they never enter a blend.
//
// INSTANT MODE. A HYBRID checkpoint (data/model-thinking.json) is served thinking-off on
// interactive traffic, so it carries a second vector calibrated through the same resolution:
// its `instant` pin (AA's Non-reasoning row of the same checkpoint) resolves like any pin; a
// hybrid without one gets its instant cells from the per-cell PAIR FIT (instant = a + b·thinking,
// fitted on every pinned thinking/instant pair, clamped to [0, thinking]; `fitInstant`).

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const MAP_PATH = join(ROOT, 'data', 'roster-aa-map.json')
export const BRIDGES_PATH = join(ROOT, 'data', 'aa-bridges.json')
export const LATEST_PATH = join(ROOT, 'data', 'aa-snapshot.json')
export const ARCH_PATH = join(ROOT, 'data', 'model-arch.json')
export const THINKING_PATH = join(ROOT, 'data', 'model-thinking.json')

/** The six canonical AA eval keys (reference scale) — the calibration blend inputs. */
export const CANONICAL = ['gpqa', 'ifbench', 'lcr', 'scicode', 'terminalbench_hard', 'hle']
/** Display-only successor evals (also bridge predictors). AA key → BenchInputs field. */
export const SUCCESSOR = { terminalbench_v2_1: 'terminalBenchV21', terminalbench_v4_0: 'terminalBenchV40', tau_banking: 'tauBanking' }
/** Short labels for reports, provenance strings and the catalog. */
export const LABEL = {
  gpqa: 'GPQA-D', ifbench: 'IFBench', lcr: 'LCR', scicode: 'SciCode', terminalbench_hard: 'TB-Hard', hle: 'HLE',
  terminalbench_v2_1: 'TB-2.1', terminalbench_v4_0: 'TB-4.0', tau_banking: 'τ-bank',
}

/**
 * Bridge predictor preference per target (first set whose predictors are all MEASURED wins, as
 * long as its fit has ≥ MIN_N models). TB-Hard may use an era-imputed TB 2.1 (the one chain).
 */
export const BRIDGE_PREF = {
  gpqa: [['hle', 'lcr', 'scicode'], ['hle', 'lcr'], ['lcr'], ['hle']],
  scicode: [['hle', 'lcr', 'gpqa'], ['hle', 'lcr'], ['hle']],
  ifbench: [['lcr', 'hle', 'gpqa'], ['lcr', 'hle', 'scicode'], ['lcr', 'hle'], ['lcr'], ['hle']],
  terminalbench_hard: [['terminalbench_v2_1', 'hle', 'scicode'], ['terminalbench_v2_1', 'hle'], ['terminalbench_v2_1'], ['hle', 'scicode', 'lcr'], ['hle']],
}
/** Era-matched TB 2.1 imputation (fitted on releases from TB21_ERA onward) used before the TB-Hard bridge. */
export const TB21_PREF = [['hle', 'scicode', 'lcr'], ['hle', 'scicode'], ['hle']]
export const TB21_ERA = '2026-01'
export const MIN_N = 60
const EQ_MIN_N = 50
const EQ_MIN_R = 0.97
const RIDGE = 1e-6

const pct = (e, k) => (e && e[k] != null ? e[k] * 100 : null)

/** Load both snapshots, indexed by AA UUID and slug. */
export function loadSnapshots() {
  const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'))
  const refPath = join(ROOT, map.referenceSnapshot)
  if (!existsSync(refPath)) throw new Error(`reference snapshot missing: ${map.referenceSnapshot}`)
  if (!existsSync(LATEST_PATH)) throw new Error('no latest snapshot — run: node scripts/aa-sync.mjs snapshot')
  const ref = JSON.parse(readFileSync(refPath, 'utf8')).data
  const latest = JSON.parse(readFileSync(LATEST_PATH, 'utf8')).data
  const index = (rows) => ({ byId: new Map(rows.map((m) => [m.id, m])), bySlug: new Map(rows.map((m) => [m.slug, m])) })
  return { map, ref: index(ref), latest: index(latest), refRows: ref, latestRows: latest }
}

/** The AA record for a UUID (latest metadata wins; the reference copy is the fallback). */
export function recordOf(snaps, aaId) {
  return snaps.latest.byId.get(aaId) ?? snaps.ref.byId.get(aaId) ?? null
}

function meanSd(xs) {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  return [m, Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length)]
}

/**
 * Same-benchmark equating latest → reference per canonical cell, fitted on same-UUID pairs.
 * A cell whose every overlap is byte-identical is frozen (identity). A re-scored cell gets a
 * mean-sigma line; it is refused when the overlap is too small or too noisy to trust.
 */
export function fitEquating(snaps) {
  const out = {}
  for (const k of CANONICAL) {
    const xs = []
    const ys = []
    for (const o of snaps.refRows) {
      const n = snaps.latest.byId.get(o.id)
      const a = pct(o.evaluations, k)
      const b = pct(n?.evaluations, k)
      if (a != null && b != null) { xs.push(b); ys.push(a) }
    }
    const changed = xs.filter((x, i) => Math.abs(x - ys[i]) > 1e-9).length
    if (!xs.length || changed === 0) { out[k] = { kind: 'identity', n: xs.length, changed: 0 }; continue }
    const [mx, sx] = meanSd(xs)
    const [my, sy] = meanSd(ys)
    const r = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / (xs.length * sx * sy)
    if (xs.length < EQ_MIN_N || r < EQ_MIN_R) throw new Error(`equating ${k}: n=${xs.length} r=${r.toFixed(3)} below the trust floor (n≥${EQ_MIN_N}, r≥${EQ_MIN_R})`)
    const b = sy / sx
    const a = my - b * mx
    const sd = Math.sqrt(xs.reduce((s, x, i) => s + (ys[i] - (a + b * x)) ** 2, 0) / xs.length)
    out[k] = { kind: 'linear', a: round(a, 4), b: round(b, 4), n: xs.length, changed, r: round(r, 4), sd: round(sd, 2) }
  }
  return out
}

function round(v, d) {
  const f = 10 ** d
  return Math.round(v * f) / f
}

const equate = (eq, k, x) => (eq[k]?.kind === 'linear' ? Math.max(0, eq[k].a + eq[k].b * x) : x)

/**
 * The MEASURED row of a UUID on the reference scale: canonical cells (reference → latest/equated)
 * plus the successor cells (latest → reference). `src` records each cell's provenance.
 */
export function measuredRow(snaps, eq, aaId) {
  const oe = snaps.ref.byId.get(aaId)?.evaluations
  const ne = snaps.latest.byId.get(aaId)?.evaluations
  const row = {}
  const src = {}
  for (const k of CANONICAL) {
    const r = pct(oe, k)
    if (r != null) { row[k] = r; src[k] = 'ref'; continue }
    const n = pct(ne, k)
    if (n == null) continue
    row[k] = equate(eq, k, n)
    src[k] = eq[k]?.kind === 'linear' ? 'eq' : 'latest'
  }
  for (const k of Object.keys(SUCCESSOR)) {
    const v = pct(ne, k) ?? pct(oe, k)
    if (v != null) { row[k] = v; src[k] = pct(ne, k) != null ? 'latest' : 'ref' }
  }
  return { row, src }
}

/** OLS with a tiny ridge on the slopes; returns {beta, n, R, sd}. */
function fitOLS(rows, target, preds) {
  const data = []
  for (const r of rows) {
    if (r[target] == null || preds.some((k) => r[k] == null)) continue
    data.push([1, ...preds.map((k) => r[k]), r[target]])
  }
  const d = preds.length + 1
  if (data.length <= d) return { preds, beta: null, n: data.length }
  const XtX = Array.from({ length: d }, () => Array(d).fill(0))
  const Xty = Array(d).fill(0)
  for (const row of data) for (let i = 0; i < d; i++) { Xty[i] += row[i] * row[d]; for (let j = 0; j < d; j++) XtX[i][j] += row[i] * row[j] }
  for (let i = 1; i < d; i++) XtX[i][i] += RIDGE * data.length
  const beta = solve(XtX, Xty)
  const ys = data.map((r) => r[d])
  const my = ys.reduce((s, y) => s + y, 0) / ys.length
  const res = data.map((r) => r[d] - beta.reduce((s, b, i) => s + b * r[i], 0))
  const sse = res.reduce((s, x) => s + x * x, 0)
  const sst = ys.reduce((s, y) => s + (y - my) ** 2, 0)
  return {
    preds,
    beta: beta.map((b) => round(b, 5)),
    n: data.length,
    R: round(Math.sqrt(Math.max(0, 1 - sse / sst)), 3),
    sd: round(Math.sqrt(sse / Math.max(1, data.length - d)), 2),
  }
}

function solve(A, b) {
  const n = A.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    ;[M[c], M[piv]] = [M[piv], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((r, i) => r[n] / r[i])
}

/** Fit the equating + every bridge on the union of both snapshots (measured cells only). */
export function fitBridges(snaps) {
  const equating = fitEquating(snaps)
  const ids = [...new Set([...snaps.refRows.map((m) => m.id), ...snaps.latestRows.map((m) => m.id)])]
  const release = (id) => recordOf(snaps, id)?.release_date || '0000'
  const rows = ids.map((id) => ({ id, ...measuredRow(snaps, equating, id).row }))
  const ranges = {}
  for (const t of [...Object.keys(BRIDGE_PREF), 'terminalbench_v2_1']) {
    const v = rows.map((r) => r[t]).filter((x) => x != null)
    ranges[t] = [round(Math.min(...v), 2), round(Math.max(...v), 2)]
  }
  const bridges = {}
  for (const [t, prefs] of Object.entries(BRIDGE_PREF)) bridges[t] = prefs.map((ps) => fitOLS(rows, t, ps))
  const eraRows = rows.filter((r) => release(r.id) >= TB21_ERA)
  const tb21 = TB21_PREF.map((ps) => fitOLS(eraRows, 'terminalbench_v2_1', ps))
  return { equating, ranges, bridges, tb21Era: { since: TB21_ERA, fits: tb21 }, minN: MIN_N, instant: fitInstant(snaps, equating) }
}

/**
 * The instant-mode PAIR FIT: per canonical cell, an OLS line instant = a + b·thinking over every
 * pinned hybrid's (thinking row, instant row) pair, both cells MEASURED on the reference scale.
 * It estimates what switching thinking off costs a hybrid that AA timed in thinking mode only.
 */
export function fitInstant(snaps, equating) {
  const pairs = instantPins(snaps.map)
  const fits = {}
  for (const k of CANONICAL) {
    const pts = []
    for (const [, inst, pin] of pairs) {
      const t = measuredRow(snaps, equating, pin.aaId).row[k]
      const i = measuredRow(snaps, equating, inst.aaId).row[k]
      if (t != null && i != null) pts.push([t, i])
    }
    const f = fitOLS(pts.map(([t, i]) => ({ t, i })), 'i', ['t'])
    fits[k] = { a: f.beta?.[0] ?? 0, b: f.beta?.[1] ?? 1, n: f.n, R: f.R, sd: f.sd, range: [round(Math.min(...pts.map((p) => p[0])), 2), round(Math.max(...pts.map((p) => p[0])), 2)] }
  }
  return { pairs: pairs.length, fits }
}

/** Instant cells of a hybrid with no instant pin: the pair fit applied to its thinking cells, never above them. */
export function instantFromThinking(fit, cells) {
  const out = {}
  for (const k of CANONICAL) {
    const t = cells[k]
    if (t == null || !fit.fits[k]) continue
    const f = fit.fits[k]
    out[k] = Math.min(t, Math.max(0, f.a + f.b * t))
  }
  return out
}

/** Load the committed fits (data/aa-bridges.json). */
export function loadBridges() {
  if (!existsSync(BRIDGES_PATH)) throw new Error('no data/aa-bridges.json — run: node scripts/aa-sync.mjs bridges')
  return JSON.parse(readFileSync(BRIDGES_PATH, 'utf8'))
}

const clampTo = (v, [lo, hi]) => (v < lo ? lo : v > hi ? hi : v)
const predict = (fit, row) => fit.beta[0] + fit.preds.reduce((s, k, i) => s + fit.beta[i + 1] * row[k], 0)
const usable = (fit, row) => fit.beta && fit.n >= MIN_N && fit.preds.every((k) => row[k] != null)
const bridgeTag = (fit, chained = []) => `bridge:${fit.preds.map((k) => (chained.includes(k) ? `${LABEL[k]}≈` : LABEL[k])).join('+')}`

/**
 * Resolve one UUID to reference-scale cells: measured first, then the committed bridges for the
 * canonical cells AA no longer publishes. Returns { cells, src, sd } keyed by AA eval key.
 */
export function resolveCells(snaps, fits, aaId) {
  const { row, src } = measuredRow(snaps, fits.equating, aaId)
  const cells = { ...row }
  const sd = {}
  for (const t of ['gpqa', 'scicode', 'ifbench']) {
    if (cells[t] != null) continue
    const fit = fits.bridges[t].find((f) => usable(f, row))
    if (!fit) continue
    cells[t] = clampTo(predict(fit, row), fits.ranges[t])
    src[t] = bridgeTag(fit)
    sd[t] = fit.sd
  }
  if (cells.terminalbench_hard == null) {
    const tb = { ...row }
    const chained = []
    if (tb.terminalbench_v2_1 == null) {
      const f21 = fits.tb21Era.fits.find((f) => usable(f, row))
      if (f21) { tb.terminalbench_v2_1 = clampTo(predict(f21, row), fits.ranges.terminalbench_v2_1); chained.push('terminalbench_v2_1') }
    }
    const fit = fits.bridges.terminalbench_hard.find((f) => usable(f, tb))
    if (fit) {
      cells.terminalbench_hard = clampTo(predict(fit, tb), fits.ranges.terminalbench_hard)
      src.terminalbench_hard = bridgeTag(fit, chained)
      sd.terminalbench_hard = fit.sd
    }
  }
  return { cells, src, sd }
}

/**
 * Rounded emit value (0.1 %). A reference/latest cell is rounded from AA's raw 0..1 value exactly
 * as the pre-scheme pipeline did, so carried-forward cells stay byte-identical.
 */
export function emitCell(snaps, aaId, key, value, provenance) {
  if (provenance === 'ref' || provenance === 'latest') {
    const rec = provenance === 'ref' ? snaps.ref.byId.get(aaId) : snaps.latest.byId.get(aaId)
    const raw = rec?.evaluations?.[key]
    if (raw != null) return Math.round(raw * 1000) / 10
  }
  return Math.round(value * 10) / 10
}

/**
 * AA serving telemetry for a UUID on AA's standard 1K-token prompt: time to first token, time to
 * first ANSWER token (after hidden reasoning) and output tokens/s. Latest measurement first; a
 * zero means "no provider measured" and is treated as absent.
 */
export function perfOf(snaps, aaId) {
  for (const snap of [snaps.latest, snaps.ref]) {
    const m = snap.byId.get(aaId)
    const ttft = m?.median_time_to_first_token_seconds
    const ttfat = m?.median_time_to_first_answer_token
    const tps = m?.median_output_tokens_per_second
    if (ttft > 0 && ttfat > 0 && tps > 0) return { ttftS: ttft, ttfatS: ttfat, tps }
  }
  return null
}

/** The pinned roster map: id → { slug, aaId, instant? } (comment keys skipped). */
export function pinnedModels(map) {
  return Object.entries(map.models).filter(([id]) => !id.startsWith('_'))
}

/** The instant pins of hybrid checkpoints: [id, instant { slug, aaId }, the main pin]. */
export function instantPins(map) {
  return pinnedModels(map)
    .filter(([, p]) => p.instant)
    .map(([id, p]) => [id, p.instant, p])
}

/** AA's display name without its trailing mode tag: 'Qwen3.5 27B (Non-reasoning)' → 'Qwen3.5 27B'. */
const checkpointName = (name) => name.replace(/\s*\([^)]*\)\s*$/, '').trim()

function slugProblem(snaps, label, pin) {
  const bySlug = snaps.latest.bySlug.get(pin.slug)
  const byId = recordOf(snaps, pin.aaId)
  if (!byId) return `${label}: AA id ${pin.aaId} is in neither snapshot`
  if (bySlug && bySlug.id !== pin.aaId) return `${label}: slug '${pin.slug}' now names a different AA model ('${bySlug.name}', ${bySlug.id}) — recycled slug; the pinned model is '${byId.name}' (now slug '${byId.slug}')`
  if (!bySlug && snaps.latest.byId.has(pin.aaId)) return `${label}: AA renamed the pinned model's slug '${pin.slug}' → '${snaps.latest.byId.get(pin.aaId).slug}' — update the hint`
  return null
}

/**
 * Recycled-slug guard: every slug hint must still name its pinned UUID in the latest snapshot,
 * and an instant pin must be the SAME checkpoint as the main pin (AA name without the mode tag
 * and release date match — 'Hy3' is not its April preview). Null when consistent.
 */
export function pinProblem(snaps, id, pin) {
  const main = slugProblem(snaps, id, pin)
  if (main || !pin.instant) return main
  const inst = slugProblem(snaps, `${id} (instant)`, pin.instant)
  if (inst) return inst
  const a = recordOf(snaps, pin.aaId)
  const b = recordOf(snaps, pin.instant.aaId)
  if (checkpointName(a.name) !== checkpointName(b.name) || (a.release_date ?? '') !== (b.release_date ?? ''))
    return `${id}: instant pin '${b.name}' (${b.release_date}) is not the same checkpoint as '${a.name}' (${a.release_date})`
  return null
}

/**
 * Thinking support per AA UUID: the checkpoint (data/model-arch.json `aa`) and its mode from
 * data/model-thinking.json. Map aaId → { repo, mode }.
 */
export function thinkingByAaId() {
  const arch = JSON.parse(readFileSync(ARCH_PATH, 'utf8')).models
  const thinking = JSON.parse(readFileSync(THINKING_PATH, 'utf8')).models
  const out = new Map()
  for (const [repo, e] of Object.entries(arch)) {
    const mode = thinking[repo]?.mode
    if (!mode) throw new Error(`${repo}: no data/model-thinking.json entry`)
    for (const aaId of Object.values(e.aa ?? {})) out.set(aaId, { repo, mode })
  }
  return out
}
