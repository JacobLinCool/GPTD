/**
 * Dev soundboard (`?soundboard`) — a DOM panel over the game to audition every
 * cue, drive the music scenes by hand, run synthetic event streams through the
 * live voice manager, and run the offline level check in-browser. A developer
 * tool, loaded lazily only when the query flag is present; its labels are cue
 * ids and engineering terms, not player-facing copy.
 */
import type { GuardrailArchetype, LoseMeter, RefusedBy } from '../core/types'
import { CUE_IDS, CUE_SPECS, streakDegree, type CueGroup, type CueId, type CueParams } from './cues'
import type { AudioEngine } from './engine'
import type { MusicScene } from './music'

const CSS = `
.gptd-sb{position:fixed;top:8px;right:8px;width:380px;max-height:calc(100vh - 16px);overflow:auto;z-index:9999;
  background:#0e1622f2;border:1px solid #21304a;border-radius:10px;padding:10px 12px;color:#cfe3ff;
  font:12px/1.4 ui-monospace,"SF Mono",Menlo,Consolas,monospace;box-shadow:0 8px 30px #000a}
.gptd-sb h2{font-size:13px;margin:0 0 6px;display:flex;justify-content:space-between;align-items:center;color:#fff}
.gptd-sb h3{font-size:11px;margin:10px 0 4px;color:#8fb3e8;text-transform:uppercase;letter-spacing:.06em}
.gptd-sb button{background:#16263b;color:#e6f0ff;border:1px solid #2b4466;border-radius:5px;padding:3px 6px;margin:2px;
  font:inherit;cursor:pointer}
.gptd-sb button:hover{border-color:#5fd7ff}.gptd-sb button.on{border-color:#57e39b;color:#57e39b}
.gptd-sb label{display:flex;align-items:center;gap:6px;margin:2px 0}.gptd-sb label span{width:84px;color:#9fb3cc}
.gptd-sb input[type=range]{flex:1}.gptd-sb select{background:#16263b;color:#e6f0ff;border:1px solid #2b4466;font:inherit}
.gptd-sb pre{white-space:pre-wrap;background:#0a0e14;border:1px solid #21304a;border-radius:6px;padding:6px;margin:4px 0;
  max-height:320px;overflow:auto;font-size:11px}
.gptd-sb .stat{color:#9fb3cc;font-size:11px}
`

const GROUPS: { id: CueGroup; title: string }[] = [
  { id: 'outcome', title: 'Outcomes' },
  { id: 'world', title: 'Saves' },
  { id: 'action', title: 'Actions' },
  { id: 'state', title: 'State' },
  { id: 'stinger', title: 'Stingers' },
  { id: 'ui', title: 'Interface' },
]

const STREAM_RATES: Partial<Record<CueId, number>> = {
  'serve.clean': 8,
  'cache.hit': 6,
  'guard.catch': 0.8,
  'model.selfHandle': 0.5,
  'serve.late': 0.3,
  'serve.wrong': 0.2,
  'serve.refused': 0.3,
  'serve.leak': 0.1,
  'serve.unsafe': 0.05,
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  Object.assign(e, props)
  for (const k of kids) e.append(k)
  return e
}

export function mountSoundboard(engine: AudioEngine): void {
  if (document.querySelector('.gptd-sb')) return
  document.head.append(el('style', { textContent: CSS }))
  const root = el('div', { className: 'gptd-sb' })

  // ---- knobs shared by every cue ----
  const knobs = {
    pan: 0,
    degree: 0,
    size: 0.5,
    goodput: 96,
    by: 'model' as RefusedBy,
    archetype: 'encoder' as GuardrailArchetype,
    meter: 'trust' as LoseMeter,
    liquid: false,
    posttrain: false,
    support: false,
    pool: false,
  }
  const range = (
    name: string,
    min: number,
    max: number,
    step: number,
    value: number,
    on: (v: number) => void,
  ): HTMLElement => {
    const out = el('em', { textContent: String(value) })
    const inp = el('input', {
      type: 'range',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(value),
    })
    inp.oninput = () => {
      on(Number(inp.value))
      out.textContent = inp.value
    }
    return el('label', {}, el('span', { textContent: name }), inp, out)
  }
  const select = <T extends string>(name: string, opts: T[], on: (v: T) => void): HTMLElement => {
    const s = el('select')
    for (const o of opts) s.append(el('option', { value: o, textContent: o }))
    s.onchange = () => on(s.value as T)
    return el('label', {}, el('span', { textContent: name }), s)
  }
  const check = (name: string, on: (v: boolean) => void): HTMLElement => {
    const c = el('input', { type: 'checkbox' })
    c.onchange = () => on(c.checked)
    return el('label', {}, el('span', { textContent: name }), c)
  }
  const params = (): CueParams => ({
    pan: knobs.pan,
    degree: knobs.degree,
    size: knobs.size,
    goodput: knobs.goodput,
    by: knobs.by,
    archetype: knobs.archetype,
    meter: knobs.meter,
    liquid: knobs.liquid,
    posttrain: knobs.posttrain,
    rack: !knobs.support,
    intensity: knobs.size,
    value: knobs.size,
    speed: 6,
    on: true,
  })

  const close = el('button', { textContent: '×', title: 'close' })
  close.onclick = () => {
    engine.setMusicOverride(null)
    root.remove()
  }
  root.append(el('h2', {}, 'GPTD soundboard', close))
  root.append(
    range('pan', -1, 1, 0.05, 0, (v) => (knobs.pan = v)),
    range('degree', 0, 9, 1, 0, (v) => (knobs.degree = v)),
    range('size/tier', 0, 1, 0.05, 0.5, (v) => (knobs.size = v)),
    range('goodput %', 0, 100, 1, 96, (v) => (knobs.goodput = v)),
    select<RefusedBy>('refused by', ['model', 'guard'], (v) => (knobs.by = v)),
    select<GuardrailArchetype>(
      'guard kind',
      ['encoder', 'generative', 'moderation'],
      (v) => (knobs.archetype = v),
    ),
    select<LoseMeter>('lose meter', ['trust', 'sla', 'cash'], (v) => (knobs.meter = v)),
    check('liquid tier', (v) => (knobs.liquid = v)),
    check('post-train', (v) => (knobs.posttrain = v)),
    check('support bldg', (v) => (knobs.support = v)),
    check('voice pool', (v) => (knobs.pool = v)),
  )

  // ---- every cue, by group ----
  for (const g of GROUPS) {
    root.append(el('h3', { textContent: g.title }))
    const row = el('div')
    for (const id of CUE_IDS) {
      if (CUE_SPECS[id].group !== g.id) continue
      const b = el('button', { textContent: id })
      b.onclick = () => engine.audition(id, params(), knobs.pool)
      row.append(b)
    }
    root.append(row)
  }

  // ---- sequences through the live voice manager ----
  root.append(el('h3', { textContent: 'Sequences (voice pool)' }))
  const seqRow = el('div')
  const streakBtn = el('button', { textContent: 'streak ×24 → wrong' })
  streakBtn.onclick = () => {
    let n = 0
    const tick = (): void => {
      n++
      if (n <= 24) {
        engine.audition('serve.clean', { pan: knobs.pan, degree: streakDegree(n) }, true)
        setTimeout(tick, 120)
      } else engine.audition('serve.wrong', { pan: knobs.pan }, true)
    }
    tick()
  }
  const leakBtn = el('button', { textContent: '8 leaks in one frame' })
  leakBtn.onclick = () => {
    for (let i = 0; i < 8; i++) engine.audition('serve.leak', {}, true)
    const flush = (k: number): void => {
      engine.frame()
      if (k > 0) requestAnimationFrame(() => flush(k - 1))
    }
    flush(30)
  }
  const speedSel = el('select')
  for (const sp of [1, 3, 6, 12])
    speedSel.append(el('option', { value: String(sp), textContent: `${sp}×`, selected: sp === 12 }))
  const streamBtn = el('button', { textContent: 'late-game stream 5 s' })
  streamBtn.onclick = () => {
    const speed = Number(speedSel.value)
    const acc: Partial<Record<CueId, number>> = {}
    let streak = 0
    const t0 = performance.now()
    let last = t0
    const frame = (now: number): void => {
      const boardDt = ((now - last) / 1000) * speed
      last = now
      for (const [id, rate] of Object.entries(STREAM_RATES) as [CueId, number][]) {
        acc[id] = (acc[id] ?? 0) + rate * boardDt
        while ((acc[id] ?? 0) >= 1) {
          acc[id] = (acc[id] ?? 0) - 1
          if (id === 'serve.clean') streak++
          else if (id.startsWith('serve.')) streak = 0
          engine.audition(id, { x: 64 + Math.random() * 1152, degree: streakDegree(streak) }, true)
        }
      }
      engine.frame()
      if (now - t0 < 5000) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }
  seqRow.append(streakBtn, leakBtn, speedSel, streamBtn)
  root.append(seqRow)

  // ---- music scenes ----
  root.append(el('h3', { textContent: 'Music' }))
  const music = { scene: null as MusicScene | null, intensity: 0.6, danger: 0, muffle: false }
  const applyMusic = (): void => {
    engine.resume()
    engine.setMusicOverride(
      music.scene
        ? { scene: music.scene, intensity: music.intensity, danger: music.danger, muffle: music.muffle }
        : null,
    )
  }
  const sceneRow = el('div')
  const sceneBtns: HTMLButtonElement[] = []
  for (const sc of ['game', 'title', 'build', 'wave', 'boss', 'won', 'lost'] as const) {
    const b = el('button', { textContent: sc, className: sc === 'game' ? 'on' : '' })
    b.onclick = () => {
      music.scene = sc === 'game' ? null : sc
      for (const x of sceneBtns) x.classList.toggle('on', x === b)
      applyMusic()
    }
    sceneBtns.push(b)
    sceneRow.append(b)
  }
  root.append(
    sceneRow,
    range('intensity', 0, 1, 0.05, 0.6, (v) => {
      music.intensity = v
      if (music.scene) applyMusic()
    }),
    range('danger', 0, 1, 0.05, 0, (v) => {
      music.danger = v
      if (music.scene) applyMusic()
    }),
    check('muffle', (v) => {
      music.muffle = v
      if (music.scene) applyMusic()
    }),
  )

  // ---- offline level check ----
  root.append(el('h3', { textContent: 'Level check (offline render)' }))
  const out = el('pre', { textContent: 'Renders every cue, 1×–12× streams and the music scenes; ~10–20 s.' })
  const run = el('button', { textContent: 'run level check' })
  run.onclick = async () => {
    run.disabled = true
    out.textContent = 'rendering…'
    try {
      const { runLevelCheck } = await import('./harness')
      const r = await runLevelCheck()
      const lines: string[] = []
      lines.push('cue                  peak dBFS  LUFS(M)')
      for (const c of r.cues)
        lines.push(`${c.id.padEnd(20)} ${String(c.peakDb).padStart(8)} ${String(c.lufsM).padStart(8)}`)
      lines.push('', 'stream            played  LUFS   peak  clip  lift')
      for (const s of r.streams)
        lines.push(
          `${s.label.padEnd(17)} ${String(s.played).padStart(5)} ${String(s.lufs).padStart(6)} ${String(s.peakDb).padStart(6)} ${String(s.clipped).padStart(4)} ${String(s.failureLift ?? '–').padStart(5)}`,
        )
      lines.push('', 'music scene    LUFS   peak')
      for (const m of r.music)
        lines.push(
          `${`${m.scene}@${m.intensity}`.padEnd(12)} ${String(m.lufs).padStart(6)} ${String(m.peakDb).padStart(6)}`,
        )
      lines.push('')
      for (const c of r.checks) lines.push(`${c.pass ? 'PASS' : 'FAIL'} ${c.name} — ${c.detail}`)
      out.textContent = lines.join('\n')
    } catch (e) {
      out.textContent = 'level check failed: ' + (e instanceof Error ? e.message : String(e))
    } finally {
      run.disabled = false
    }
  }
  root.append(run, out)

  const stat = el('div', { className: 'stat' })
  root.append(stat)
  setInterval(() => {
    const s = engine.stats
    stat.textContent = `ctx ${s.state} · live voices ${s.live} · deferred ${s.deferred} · pending serves ${s.pendingServes}`
  }, 250)

  document.body.append(root)
}
