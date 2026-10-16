import type { GameState, Request, Tower } from '../core/types'
import { HARDWARE_DEFS } from '../sim/content'
import { loadoutOf, serverPerUserDecodeTokS } from '../sim/effects'
import { fxDensity, fxLevel } from './anim'
import type { FxManager } from './fx'

/** Flight time of one token particle along a link (s). */
const FLIGHT = 0.22
/** Max particles alive per rack (rate × flight × links is clamped to this). */
const PER_RACK = 12

interface RackStream {
  acc: number
  pre: number
  rr: number
  tokS: number
  tokAt: number
  dotted: number
}

/** The ids a rack is working this tick, from the display fields (or the legacy fallback). */
export function rackActivity(t: Tower): { prefillId: number | null; decodeIds: readonly number[] } {
  if (t.decodeIds !== undefined || t.prefillId !== undefined)
    return { prefillId: t.prefillId ?? null, decodeIds: t.decodeIds ?? [] }
  // LEGACY-BRIDGE: before the sim publishes Tower.decodeIds/prefillId, a busy rack shows one
  // link to its front target. Delete with the legacy 'fire' event.
  return { prefillId: null, decodeIds: t.load > 0 && t.targetId != null ? [t.targetId] : [] }
}

/**
 * Token streams — the roofline in motion. During prefill, prompt tokens stream INTO
 * the rack from the one request it is ingesting (prefill is compute-bound and
 * serializes the rack: a single dense inbound stream). During decode, output tokens
 * stream OUT to every request in the batch (bandwidth-bound and batched: many thin
 * streams), at a rate that grows with the log of per-user tokens/s — a small fast
 * model sprays, a big slow one trickles. Outbound streams freeze while an unchunked
 * prefill stalls the batch. Replaces the old stale "fire" beam fan.
 */
export class StreamLayer {
  private racks = new Map<number, RackStream>()

  constructor(private fx: FxManager) {}

  reset(): void {
    this.racks.clear()
  }

  sync(
    s: GameState,
    dt: number,
    speed: number,
    posOf: (id: number) => { x: number; y: number } | null,
    byId: Map<number, Request>,
  ): void {
    const level = fxLevel()
    const density = fxDensity()
    const seen = new Set<number>()
    const pxTex = this.fx.frame('sq2')
    for (const t of s.towers) {
      if (t.def.kind !== 'server' || !t.online || t.training) continue
      const act = rackActivity(t)
      if (act.prefillId == null && act.decodeIds.length === 0) continue
      seen.add(t.id)
      let st = this.racks.get(t.id)
      if (!st) {
        st = { acc: 0, pre: 0, rr: 0, tokS: 0, tokAt: -1, dotted: 0 }
        this.racks.set(t.id, st)
      }
      const hwColor = (t.hwId && HARDWARE_DEFS[t.hwId]?.color) || t.def.color
      const stalled = act.prefillId != null && act.decodeIds.length > 0 && !s.infra.scheduling.chunked
      if (level === 'minimal') {
        // minimal FX: each link is a faint dotted line, refreshed at 4 Hz
        st.dotted -= dt
        if (st.dotted > 0) continue
        st.dotted = 0.25
        const links = act.prefillId != null ? [act.prefillId, ...act.decodeIds] : act.decodeIds
        for (const id of links) {
          const p = posOf(id)
          if (p)
            this.fx.line(
              t.x,
              t.y,
              p.x,
              p.y,
              id === act.prefillId ? (byId.get(id)?.def.color ?? hwColor) : hwColor,
              0.26,
              0.28,
            )
        }
        continue
      }
      // --- inbound prefill stream ---
      if (act.prefillId != null) {
        const p = posOf(act.prefillId)
        if (p) {
          st.pre += dt * 14 * density
          while (st.pre >= 1) {
            st.pre -= 1
            this.emit(pxTex, p.x, p.y, t.x, t.y, byId.get(act.prefillId)?.def.color ?? 0xffffff)
          }
        }
      }
      // --- outbound decode streams (frozen during a prefill stall) ---
      const n = act.decodeIds.length
      if (n === 0 || stalled) continue
      if (s.time - st.tokAt > 0.25 || st.tokAt < 0) {
        st.tokAt = s.time
        st.tokS = serverPerUserDecodeTokS(s, loadoutOf(s, t), Math.max(1, t.batch ?? n))
      }
      const perLink =
        Math.min(14, Math.max(2, 3 * Math.log2(1 + st.tokS / 8))) / Math.sqrt(Math.max(1, speed))
      const total = Math.min(PER_RACK / FLIGHT, perLink * n) * density
      st.acc += dt * total
      while (st.acc >= 1) {
        st.acc -= 1
        const id = act.decodeIds[st.rr++ % n]
        const p = posOf(id)
        if (p) this.emit(pxTex, t.x, t.y, p.x, p.y, hwColor)
      }
    }
    for (const id of this.racks.keys()) if (!seen.has(id)) this.racks.delete(id)
  }

  private emit(
    tex: ReturnType<FxManager['frame']>,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    tint: number,
  ): void {
    const jx = (Math.random() - 0.5) * 3
    const jy = (Math.random() - 0.5) * 3
    this.fx.particles.spawn(tex, x1 + jx, y1 + jy, {
      vx: (x2 - x1) / FLIGHT,
      vy: (y2 - y1) / FLIGHT,
      life: FLIGHT,
      s0: 1,
      s1: 0.8,
      alpha: 0.95,
      tint,
    })
  }
}
