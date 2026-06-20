import { Application, TextureSource } from 'pixi.js'
import { COLORS, DESIGN_H, DESIGN_W } from './config'
import { Game } from './game'

// Crisp pixel art: nearest-neighbor by default for every texture source.
TextureSource.defaultOptions.scaleMode = 'nearest'

async function boot(): Promise<void> {
  const app = new Application()
  await app.init({
    background: COLORS.bg,
    antialias: false,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
    resizeTo: window,
    preference: 'webgl',
  })

  const host = document.getElementById('app')!
  host.appendChild(app.canvas)

  const game = new Game(app)
  app.stage.addChild(game.root)

  const fit = (): void => {
    const w = window.innerWidth
    const h = window.innerHeight
    const scale = Math.min(w / DESIGN_W, h / DESIGN_H)
    game.root.scale.set(scale)
    game.root.x = Math.round((w - DESIGN_W * scale) / 2)
    game.root.y = Math.round((h - DESIGN_H * scale) / 2)
  }
  window.addEventListener('resize', fit)
  fit()

  app.ticker.add((ticker) => game.tick(ticker.deltaMS))

  const resume = (): void => game.resumeAudio()
  window.addEventListener('pointerdown', resume)
  window.addEventListener('keydown', resume)

  document.getElementById('boot')?.remove()
  // expose for debugging / e2e
  ;(window as unknown as { __game: Game }).__game = game

  // Agent mode: ?agent=1 lets a local agent (via public/bridge.mjs) drive THIS
  // already-open tab. enterAgentMode defaults the display to Expert, dials the
  // connector out to the localhost relay, and hands the run to the bridge; the
  // human keeps watching the same board while the agent narrates in the Codex
  // bubble. (The title-screen AGENT button calls the same path.)
  if (new URLSearchParams(window.location.search).get('agent')) {
    game.enterAgentMode()
  }
}

void boot()
