/**
 * Dev-only perf overlay (`?perf=1`): FPS, frame-time avg/p95, game tick and renderer
 * CPU time, GL draw calls per frame, and live board object counts. A plain DOM
 * readout (developer diagnostics, not player-facing), refreshed twice a second.
 */
import type { Application } from 'pixi.js'
import type { WorldRenderer } from './world'

export function installPerfOverlay(
  app: Application,
  world: WorldRenderer,
  tickHost: { tick(ms: number): void },
): void {
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;left:6px;bottom:6px;z-index:9999;padding:4px 6px;background:rgba(5,8,13,.82);color:#9fe8ff;' +
    'font:11px/1.35 ui-monospace,Menlo,monospace;white-space:pre;pointer-events:none'
  document.body.appendChild(el)
  const frames: number[] = []
  const ticks: number[] = []
  const renders: number[] = []
  let draws = 0
  let drawsPerFrame = 0
  // count GL draw calls (WebGL renderer only)
  const gl = (app.renderer as unknown as { gl?: WebGL2RenderingContext }).gl
  if (gl) {
    const de = gl.drawElements.bind(gl)
    const da = gl.drawArrays.bind(gl)
    gl.drawElements = (...a: Parameters<WebGL2RenderingContext['drawElements']>) => {
      draws++
      de(...a)
    }
    gl.drawArrays = (...a: Parameters<WebGL2RenderingContext['drawArrays']>) => {
      draws++
      da(...a)
    }
  }
  const origTick = tickHost.tick.bind(tickHost)
  tickHost.tick = (ms: number) => {
    const t0 = performance.now()
    origTick(ms)
    ticks.push(performance.now() - t0)
  }
  const r = app.renderer as unknown as { render: (...a: unknown[]) => unknown }
  const origRender = r.render.bind(r)
  r.render = (...a: unknown[]) => {
    const t0 = performance.now()
    draws = 0
    const out = origRender(...a)
    renders.push(performance.now() - t0)
    drawsPerFrame = draws
    return out
  }
  let last = performance.now()
  app.ticker.add(() => {
    const now = performance.now()
    frames.push(now - last)
    last = now
    for (const a of [frames, ticks, renders]) if (a.length > 120) a.splice(0, a.length - 120)
  })
  const stat = (a: number[]) => {
    if (!a.length) return '0.0/0.0'
    const b = [...a].sort((x, y) => x - y)
    const avg = a.reduce((x, y) => x + y, 0) / a.length
    return `${avg.toFixed(1)}/${b[Math.floor(b.length * 0.95)].toFixed(1)}`
  }
  setInterval(() => {
    const avg = frames.reduce((x, y) => x + y, 0) / Math.max(1, frames.length)
    const st = world.stats()
    el.textContent =
      `fps ${(1000 / Math.max(1, avg)).toFixed(0)}  frame ${stat(frames)} ms (avg/p95)\n` +
      `tick ${stat(ticks)}  render ${stat(renders)}  draws ${drawsPerFrame}\n` +
      `req ${st.requests}  towers ${st.towers}  particles ${st.particles}  popups ${st.popups}  stamps ${st.stamps}`
  }, 500)
}
