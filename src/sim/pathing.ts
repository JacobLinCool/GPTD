import { GRID_COLS, GRID_ROWS, GRID_X, GRID_Y, TILE } from '../config'
import type { Vec2 } from '../core/types'

/**
 * Four global ingress lanes feed the central Trust Core. They represent requests
 * arriving from different regions instead of one local queue. Edge waypoints are
 * in tile coordinates; a request leaks when it reaches its lane's end.
 */
const LANE_TILE_PATHS: [number, number][][] = [
  [
    [0, 1],
    [22, 1],
    [22, 5],
    [11, 5],
  ],
  [
    [23, 0],
    [23, 1],
    [22, 1],
    [22, 7],
    [15, 7],
    [15, 5],
    [11, 5],
  ],
  [
    [23, 9],
    [22, 9],
    [1, 9],
    [1, 5],
    [11, 5],
  ],
  [
    [17, 10],
    [17, 9],
    [1, 9],
    [1, 5],
    [11, 5],
  ],
]

export const CORE_TILE = { col: 11, row: 5 }

export function tileCenter(col: number, row: number): Vec2 {
  return { x: GRID_X + (col + 0.5) * TILE, y: GRID_Y + (row + 0.5) * TILE }
}

export interface LaneSegment {
  a: Vec2
  b: Vec2
  len: number
  acc: number
}

export interface LanePath {
  id: number
  waypoints: Vec2[]
  segments: LaneSegment[]
  length: number
}

function buildLane(id: number, tiles: [number, number][]): LanePath {
  const waypoints = tiles.map(([c, r]) => tileCenter(c, r))
  const segments: LaneSegment[] = []
  let length = 0
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]
    const b = waypoints[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    segments.push({ a, b, len, acc: length })
    length += len
  }
  return { id, waypoints, segments, length }
}

export const LANE_PATHS: LanePath[] = LANE_TILE_PATHS.map((tiles, i) => buildLane(i, tiles))
export const LANE_COUNT = LANE_PATHS.length
export const CORE_POS = tileCenter(CORE_TILE.col, CORE_TILE.row)

export function pathLength(laneId: number): number {
  return LANE_PATHS[laneId]?.length ?? LANE_PATHS[0].length
}

export function remainingPath(laneId: number, dist: number): number {
  return Math.max(0, pathLength(laneId) - dist)
}

/** World position at a given distance along the lane. */
export function posAt(dist: number, laneId = 0): Vec2 {
  const lane = LANE_PATHS[laneId] ?? LANE_PATHS[0]
  if (dist <= 0) return { x: lane.waypoints[0].x, y: lane.waypoints[0].y }
  if (dist >= lane.length) return { x: CORE_POS.x, y: CORE_POS.y }
  for (let i = lane.segments.length - 1; i >= 0; i--) {
    const s = lane.segments[i]
    if (dist >= s.acc) {
      const t = (dist - s.acc) / s.len
      return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t }
    }
  }
  return { x: lane.waypoints[0].x, y: lane.waypoints[0].y }
}

// Rasterize path tiles for build validity.
const pathSet = new Set<string>()
const key = (c: number, r: number) => c + ',' + r
for (const tiles of LANE_TILE_PATHS) {
  for (let i = 0; i < tiles.length - 1; i++) {
    let [c, r] = tiles[i]
    const [c1, r1] = tiles[i + 1]
    const dc = Math.sign(c1 - c)
    const dr = Math.sign(r1 - r)
    pathSet.add(key(c, r))
    while (c !== c1 || r !== r1) {
      if (c !== c1) c += dc
      else if (r !== r1) r += dr
      pathSet.add(key(c, r))
    }
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
