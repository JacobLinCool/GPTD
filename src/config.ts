/**
 * Layout, palette, and simulation constants.
 * The game renders to a fixed DESIGN resolution that is uniformly scaled to fit the window,
 * so all gameplay code can work in stable "design pixels".
 */

export const DESIGN_W = 1280
export const DESIGN_H = 720

export const TILE = 48
export const GRID_COLS = 24
export const GRID_ROWS = 11
export const GRID_X = Math.round((DESIGN_W - GRID_COLS * TILE) / 2) // 64
export const GRID_Y = 96

export const HUD_H = 96
export const BUILDBAR_H = 96

/** Fixed simulation timestep (seconds). The sim is deterministic at this step. */
export const SIM_DT = 1 / 60
/** Max sim steps processed per rendered frame (prevents spiral-of-death). */
export const MAX_STEPS = 5

/** Pixel-art neon "data center at night" palette. */
export const COLORS = {
  bg: 0x0a0e14,
  bgGrid: 0x121a26,
  panel: 0x0e1622,
  panelEdge: 0x21304a,
  tile: 0x111c2b,
  tileBuild: 0x16263b,
  tileHover: 0x244064,
  tileBad: 0x4a2030,
  laneFloor: 0x0c1830,
  laneEdge: 0x1d3a66,
  laneGlow: 0x2b6cff,
  core: 0x5fd7ff,
  coreDark: 0x123a52,

  trust: 0x57e39b,
  sla: 0x5fd7ff,
  cash: 0xffd166,
  power: 0xff9f43,
  cooling: 0x59c2ff,
  data: 0xc792ea,

  text: 0xd7e3f4,
  textDim: 0x7a8aa3,
  textBright: 0xffffff,
  danger: 0xff5d5d,
  warn: 0xffb454,
  good: 0x57e39b,

  white: 0xffffff,
  black: 0x000000,
  shadow: 0x05080d,
} as const

/** Per-meter visual maxima for the HUD bars. */
export const METER_MAX = { trust: 100, sla: 100 }

/**
 * §6.6 real credit economy: 1 credit = $CREDIT_USD. All capex / $/GPU-hr / token
 * revenue use this single scale, so the bankruptcy threshold (cash<0) is in real
 * money. Build cost = capexUsd / CREDIT_USD; operating cost and income share it.
 */
export const CREDIT_USD = 1000

/**
 * §4.5 research data investment. Every authored research `dataCost` (the 22 infra
 * nodes + post-training method unlocks + red-team evals) is scaled by this so
 * unlocking a technique is a meaningful Data sink — real R&D, not pocket change.
 * Tuned against the autoplay depth gate (raising it slows the tech tree). Raised from 1.5×
 * so the tree is a real early-mid investment, not solved by ~wave 20
 * (the autoplay used to earn ~18k Data and spend <500 — Data was a dead resource).
 */
export const RESEARCH_DATA_SCALE = 4

/**
 * §4.5 research COMPUTE investment. Scales every research node's compute target so
 * unlocking the tree requisitions real FLOPs over real waves (a chunk of the fleet
 * goes offline to train, §C7) — research is paced by your compute, not free. Pairs
 * with RESEARCH_DATA_SCALE: data is the gate, compute is the wall-clock.
 */
export const RESEARCH_COMPUTE_SCALE = 3

/**
 * §1.4 post-training compute investment. Scales every Studio run's FLOP bill so a
 * training run requisitions a meaningful slice of the fleet for several waves —
 * making a checkpoint (and especially a STACKED one) a real compute commitment that
 * competes with serving, not a free action.
 */
export const POSTTRAIN_COMPUTE_SCALE = 2.0

/**
 * §6.6 traffic multiplier. Each request SPRITE stands for this many real traffic
 * streams, so the real $/Mtoken income on one sprite is meaningful against real
 * GPU capex/operating cost. Applied to BOTH token revenue AND the wall-clock
 * operating bill, keeping the real $/Mtoken identity exact (and idle racks bleed).
 */
export const TRAFFIC_SCALE = 100000

/**
 * §6.6 operating-cost calibration. The wall-clock $/GPU-hr bill is REAL, but the
 * full real $/Mtoken on a low-throughput rack is brutal ($2+/Mtok at ~100 tok/s);
 * billed at full TRAFFIC_SCALE it bankrupts any imperfect fleet. This factor
 * scales the operating bill down to a playable level WHILE preserving the key
 * property: the bill is fixed by WALL-CLOCK, so an idle / over-provisioned rack
 * still bleeds and the utilization penalty emerges (§6.6). Real watt-accurate
 * cost is P2; P1's bill is a calibrated real-rate proxy.
 */
export const OP_COST_SCALE = 0.036

/**
 * §6.6 clear-bonus rescale. The authored `WaveDef.clearBonus` values (70–1200)
 * were tuned for the old flat-points economy; in the real credit economy they are
 * scaled down so the clear bonus is a meaningful kicker but does NOT dwarf the
 * token-priced request revenue (which is the real economy now).
 */
export const CLEAR_BONUS_SCALE = 0.08

/**
 * §6.5 REAL power/cooling. The power system runs in real kW now: a rack draws its
 * aggregate `tdpWatts` (kW) and emits ≈that much heat (≈all electrical power → heat).
 * Base grid + chiller capacity (kW) is the substation/CRAC every datacenter has
 * before you build any Power Plant / Cooling Tower; calibrated so a starter Edge/
 * Standard fleet (L4 0.072 kW, L40S 0.35 kW, H100/H200 0.7 kW) lights up, and a
 * Power Plant / Cooling Tower each add a sizeable real block — an H100 node is ~10 kW
 * and an NVL72 ~72 kW (its 72×1000 W aggregate tdpWatts), so the meters read in kW.
 */
export const START = {
  cash: 300,
  trust: 100,
  sla: 100,
  data: 0,
  /** base electrical capacity in kW (the substation feed before any Power Plant). */
  basePower: 6,
  /** base heat-rejection capacity in kW (the house chillers before any Cooling Tower). */
  baseCooling: 6,
}

/**
 * §6.5 utilization factor on a rack's nameplate TDP: a serving rack rarely sits at
 * 100% of its TDP wall (decode is bandwidth-bound, idle slots draw less). Real PUE-
 * adjacent utilization is ~0.7–0.85; we use 0.8 so the meters track real datacenter
 * draw (an 8× H200 pod ~4.5 kW served, an NVL72 ~58 kW). serverPower() applies this
 * on top of the FP8/INT4/throughput/spec modifiers.
 */
export const RACK_UTILIZATION = 0.8

/**
 * Throttle floor: even fully overheated GPUs keep this fraction of speed. Set low
 * (0.2) so running racks hot WITHOUT enough cooling collapses serving to ~20% — a
 * real, painful penalty that forces buying Cooling rather than coasting on a soft dip.
 */
export const THROTTLE_FLOOR = 0.2
/**
 * Global multiplier converting a request's per-type tile speed into lane speed.
 * The four-ingress central-core map has shorter individual lanes than the old
 * single serpentine, so this keeps board travel time in the same playable band.
 */
export const LANE_SPEED = 0.75

/**
 * §0.4 dual-clock: one board second compresses this many REAL datacenter seconds.
 * Visual pacing only — SLO is always judged on the real-second axis (effLatency).
 */
export const SIM_TIME_SCALE = 10
/** §6.2 per-rack runtime VRAM overhead (framework, activations, CUDA graphs) before KV, in GB. */
export const FRAMEWORK_GB = 1.5
/**
 * §1.3 per-latency-class SLO in REAL milliseconds (MLPerf / IETF classes).
 *   IN — interactive (chat/completion): tight TTFT, tight per-token.
 *   NR — near-real-time (RAG/reasoning/enterprise): relaxed.
 *   TO — throughput/offline (bots/batch): no hard latency SLO.
 */
export const LAT_CLASS_SLO = {
  IN: { ttftMs: 400, tpotMs: 40 },
  NR: { ttftMs: 2000, tpotMs: 200 },
  TO: { ttftMs: Infinity, tpotMs: Infinity },
} as const
