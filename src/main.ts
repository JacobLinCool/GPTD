import { Application, CanvasTextMetrics, TextureSource, type Container } from 'pixi.js'
import { COLORS, DESIGN_H, DESIGN_W } from './config'
import { Game } from './game'
import { installCjkWrap } from './ui/cjkWrap'

// Crisp pixel art: nearest-neighbor by default for every texture source.
TextureSource.defaultOptions.scaleMode = 'nearest'
// zh-TW copy breaks between Han characters, not only at spaces
installCjkWrap(CanvasTextMetrics)

async function boot(): Promise<void> {
  const app = new Application()
  await app.init({
    background: COLORS.bg,
    antialias: false,
    // snap sprite positions to whole device pixels so moving pixel art never shimmers
    roundPixels: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
    resizeTo: window,
    preference: 'webgl',
  })

  const host = document.getElementById('app')!
  host.appendChild(app.canvas)

  const params = new URLSearchParams(window.location.search)
  let root: Container
  if (params.get('fxgallery')) {
    // Dev-only FX gallery: the board renderer driven by synthetic contract events.
    const { FxGallery } = await import('./render/fxgallery')
    const gallery = new FxGallery(app)
    root = gallery.root
    app.ticker.add((ticker) => gallery.tick(ticker.deltaMS))
  } else {
    const game = new Game(app)
    root = game.root
    app.ticker.add((ticker) => game.tick(ticker.deltaMS))
    const resume = (): void => game.resumeAudio()
    window.addEventListener('pointerdown', resume)
    window.addEventListener('keydown', resume)
    // expose for debugging / e2e
    ;(window as unknown as { __game: Game }).__game = game
    if (params.get('perf')) {
      const { installPerfOverlay } = await import('./render/perf')
      installPerfOverlay(app, game.world, game)
    }
    // Agent mode: ?agent=1 lets a local agent (via public/bridge.mjs) drive THIS
    // already-open tab. enterAgentMode defaults the display to Expert, dials the
    // connector out to the localhost relay, and hands the run to the bridge; the
    // human keeps watching the same board while the agent narrates in the Codex
    // bubble. (The title-screen AGENT button calls the same path.)
    if (params.get('agent')) game.enterAgentMode()
  }
  app.stage.addChild(root)

  const fit = (): void => {
    const w = window.innerWidth
    const h = window.innerHeight
    const scale = Math.min(w / DESIGN_W, h / DESIGN_H)
    root.scale.set(scale)
    root.x = Math.round((w - DESIGN_W * scale) / 2)
    root.y = Math.round((h - DESIGN_H * scale) / 2)
  }
  window.addEventListener('resize', fit)
  fit()

  document.getElementById('boot')?.remove()
}

void boot()
