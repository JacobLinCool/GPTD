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

/** Starting economy / meters. */
export const START = {
  cash: 320,
  trust: 100,
  sla: 100,
  data: 0,
  basePower: 10,
  baseCooling: 10,
}

/**
 * Cash drained per second per unit of power drawn, while a wave is running.
 * A modest operating cost (running GPUs is not free) — not a bankruptcy timer.
 */
export const POWER_PRICE = 0.08
/** Throttle floor: even fully overheated GPUs keep this fraction of speed. */
export const THROTTLE_FLOOR = 0.35
/**
 * Global multiplier converting a request's per-type tile speed into lane speed.
 * Tuned so the long serpentine takes a sensible time to traverse at 1× game speed.
 */
export const LANE_SPEED = 1.6
