import { GRID_COLS, GRID_ROWS, GRID_X, GRID_Y, TILE } from '../config'
import type { Vec2 } from '../core/types'

/**
 * The serving pipeline lane: a serpentine the requests walk from the off-screen
 * ingress (top-left) down to the Trust Core (bottom-right). Corner waypoints in
 * tile coordinates; the request "leaks" into the core when it reaches the end.
 */
const WP_TILES: [number, number][] = [
  [-1, 1],
  [1, 1],
  [22, 1],
  [22, 5],
  [1, 5],
  [1, 9],
  [23, 9],
]

export const CORE_TILE = { col: 23, row: 9 }

export function tileCenter(col: number, row: number): Vec2 {
  return { x: GRID_X + (col + 0.5) * TILE, y: GRID_Y + (row + 0.5) * TILE }
}

export const WAYPOINTS: Vec2[] = WP_TILES.map(([c, r]) => tileCenter(c, r))

interface Seg {
  a: Vec2
  b: Vec2
  len: number
  acc: number
}

const SEGMENTS: Seg[] = []
let total = 0
for (let i = 0; i < WAYPOINTS.length - 1; i++) {
  const a = WAYPOINTS[i]
  const b = WAYPOINTS[i + 1]
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  SEGMENTS.push({ a, b, len, acc: total })
  total += len
}

export const PATH_LENGTH = total
export const CORE_POS = WAYPOINTS[WAYPOINTS.length - 1]

/** World position at a given distance along the lane. */
export function posAt(dist: number): Vec2 {
  if (dist <= 0) return { x: WAYPOINTS[0].x, y: WAYPOINTS[0].y }
  if (dist >= total) return { x: CORE_POS.x, y: CORE_POS.y }
  for (let i = SEGMENTS.length - 1; i >= 0; i--) {
    const s = SEGMENTS[i]
    if (dist >= s.acc) {
      const t = (dist - s.acc) / s.len
      return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t }
    }
  }
  return { x: WAYPOINTS[0].x, y: WAYPOINTS[0].y }
}

// Rasterize path tiles for build validity.
const pathSet = new Set<string>()
const key = (c: number, r: number) => c + ',' + r
for (let i = 0; i < WP_TILES.length - 1; i++) {
  let [c, r] = WP_TILES[i]
  const [c1, r1] = WP_TILES[i + 1]
  const dc = Math.sign(c1 - c)
  const dr = Math.sign(r1 - r)
  pathSet.add(key(c, r))
  while (c !== c1 || r !== r1) {
    if (c !== c1) c += dc
    else if (r !== r1) r += dr
    pathSet.add(key(c, r))
  }
}
pathSet.add(key(CORE_TILE.col, CORE_TILE.row))

export function isPathTile(col: number, row: number): boolean {
  return pathSet.has(key(col, row))
}

export function inGrid(col: number, row: number): boolean {
  return col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS
}

export function isBuildable(col: number, row: number): boolean {
  return inGrid(col, row) && !isPathTile(col, row)
}

/** Convert a world (design-space) point to a grid tile. */
export function worldToTile(x: number, y: number): { col: number; row: number } {
  return { col: Math.floor((x - GRID_X) / TILE), row: Math.floor((y - GRID_Y) / TILE) }
}
