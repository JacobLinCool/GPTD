/**
 * Board presentation rules that must hold without a GPU: a new run starts with a clean
 * lane layer, the comfort settings gate every flash and burst. Pixi display objects are
 * built for real (no renderer); bitmap text and textures are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pixi.js', async (importOriginal) => {
  const pixi = await importOriginal<typeof import('pixi.js')>()
  /** BitmapText needs an installed bitmap font; a plain container with a text field stands in. */
  class FakeBitmapText extends pixi.Container {
    text = ''
    constructor(opts?: { text?: string }) {
      super()
      this.text = opts?.text ?? ''
    }
  }
  return { ...pixi, BitmapText: FakeBitmapText }
})
vi.mock('../src/render/popups', () => ({ POP_FONT: 'test', ensurePopFont: () => {}, PopupLayer: class {} }))

import { Texture } from 'pixi.js'
import { CoreView } from '../src/render/core'
import { LaneLayer } from '../src/render/lanes'
import type { FxManager } from '../src/render/fx'
import type { TextureFactory } from '../src/render/textures'
import { updateSettings } from '../src/settings'
import { createState } from '../src/sim/state'

const factory = new Proxy({}, { get: () => () => Texture.WHITE }) as unknown as TextureFactory

function stubFx(): FxManager & { bursts: number } {
  const fx = {
    bursts: 0,
    particles: { spawn: () => {} },
    ring: () => {},
    burst: () => void fx.bursts++,
    shatter: () => {},
    glow: () => {},
  }
  return fx as unknown as FxManager & { bursts: number }
}

const a11y = {
  reducedMotion: false,
  screenShake: true,
  reduceFlashing: false,
  colorblind: false,
  fxLevel: 'full' as const,
}

beforeEach(() => updateSettings('a11y', { ...a11y }))

describe("render/lanes — a new run starts without the last run's surge", () => {
  it('reset() drops the SURGE tag and the dim/highlight strokes', () => {
    const lanes = new LaneLayer(factory, stubFx())
    const s = createState(3)
    s.phase = 'build'
    s.laneWindow = [2]
    lanes.sync(s, 1 / 60, 1)
    expect(lanes.highlighted).toEqual([2])
    lanes.reset()
    const fresh = createState(4)
    fresh.phase = 'build'
    lanes.sync(fresh, 1 / 60, 1)
    lanes.sync(fresh, 1 / 60, 1)
    expect(lanes.highlighted).toEqual([])
    const tags = (lanes as unknown as { surgeTags: { visible: boolean }[] }).surgeTags
    expect(tags.some((t) => t.visible)).toBe(false)
  })
})

describe('render/core — the core-hit border flash obeys the flash limiter', () => {
  /** Hit the core every 0.2 s for a second with shake off; count frames with the border lit. */
  function borderFlashes(): number {
    const core = new CoreView(factory, stubFx())
    const s = createState(5)
    s.phase = 'wave'
    s.meters.trust = 80
    let flashes = 0
    let wasLit = false
    for (let f = 0; f < 60; f++) {
      if (f % 12 === 0) core.hit(-2, false)
      core.sync(s, 1 / 60)
      const lit = core.edge.alpha >= 0.5
      if (lit && !wasLit) flashes++
      wasLit = lit
    }
    return flashes
  }

  it('never flashes the border under Reduce Flashing', () => {
    updateSettings('a11y', { ...a11y, screenShake: false, reduceFlashing: true })
    expect(borderFlashes()).toBe(0)
  })

  it('caps the border at three flashes a second otherwise', () => {
    updateSettings('a11y', { ...a11y, screenShake: false })
    const n = borderFlashes()
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(3)
  })
})

describe('render/fx — Reduced Motion removes the particle bursts', () => {
  it('the FX budget emits nothing under reduced motion and something at full FX', async () => {
    const { FxManager } = await import('../src/render/fx')
    const fx = Object.create(FxManager.prototype) as InstanceType<typeof FxManager>
    Object.assign(fx, { crowd: 0, speed: 1 })
    updateSettings('a11y', { ...a11y, reducedMotion: true })
    expect(fx.budget(40)).toBe(0)
    updateSettings('a11y', { ...a11y })
    expect(fx.budget(40)).toBe(40)
  })
})
