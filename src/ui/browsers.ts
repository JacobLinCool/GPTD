/**
 * Content browsers (docs/SYSTEM-MENU.md §10) reached from the System menu hub:
 *   • HelpPanel    — How to Play: the loop, meters, requests, towers, hotkeys.
 *   • CodexBrowser — encyclopedia over the live game data (models / hardware /
 *                    requests / research) — GPTD's real-grounding showcase.
 *   • AboutPanel   — version, slogan, data-source credential, links.
 *
 * All three are read-only, scroll on the wheel, and share ContentPanel (dim +
 * panel + title + Back + a masked scrolling body). Layout is height-driven so
 * wrapped paragraphs never overlap the next row.
 */
import { Container, Graphics, Sprite, Text, type FederatedWheelEvent, type Texture } from 'pixi.js'
import { COLORS, DESIGN_H, DESIGN_W } from '../config'
import { modelName, reqDesc, reqName, t, towerDesc, towerName } from '../i18n'
import {
  BUILD_ORDER,
  HARDWARE_DEFS,
  HARDWARE_TIERS,
  MODEL_LIST,
  REQUEST_LIST,
  RESEARCH_LIST,
  sizeLabel,
  TOWER_DEFS,
} from '../sim/content'
import { eraTokenRange } from '../sim/campaign'
import type { TextureFactory } from '../render/textures'
import { drawPanel, label, UIButton } from './theme'

const r0 = (v: number): number => Math.round(v)
/** Compact token count: 1536 → "1.5K", 40180 → "40K", 512 → "512". */
const fmtTok = (v: number): string => (v >= 1000 ? (v / 1000).toFixed(v < 9500 ? 1 : 0) + 'K' : String(v))

const CODEX_REQ_NOTE =
  'Base values shown; later waves scale prompt + output length with the era — the end-of-campaign range is in parentheses.'

/** Full-screen reading surface with a masked, wheel-scrollable body. */
abstract class ContentPanel {
  readonly view = new Container()
  protected dim = new Graphics()
  protected panel = new Graphics()
  protected titleLbl = label('', 24, COLORS.textBright, 'bold')
  protected back: UIButton
  protected body = new Container()
  private maskG = new Graphics()
  protected px: number
  protected py: number
  protected PW = 1040
  protected PH = 620
  protected bodyTop: number
  protected bodyW: number
  private viewH: number
  private scrollY = 0
  private contentH = 0

  constructor(
    onBack: () => void,
    private titleKey: string,
    private titleFallback: string,
    bodyTopOffset = 78,
  ) {
    this.px = (DESIGN_W - this.PW) / 2
    this.py = (DESIGN_H - this.PH) / 2
    this.bodyTop = this.py + bodyTopOffset
    this.bodyW = this.PW - 56
    this.viewH = this.PH - bodyTopOffset - 24

    this.dim.rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0x05080d, alpha: 0.85 })
    this.dim.eventMode = 'static'
    drawPanel(this.panel, this.px, this.py, this.PW, this.PH, { alpha: 0.98, radius: 12 })
    this.titleLbl.x = this.px + 28
    this.titleLbl.y = this.py + 22
    this.back = new UIButton({ w: 120, h: 34, accent: COLORS.trust, onTap: onBack })
    this.back.x = this.px + this.PW - 28 - 120
    this.back.y = this.py + 20

    this.maskG.rect(this.px + 20, this.bodyTop, this.PW - 40, this.viewH).fill({ color: 0xffffff })
    this.body.x = this.px + 28
    this.body.y = this.bodyTop
    this.body.mask = this.maskG

    this.view.addChild(this.dim, this.panel, this.titleLbl, this.back, this.maskG, this.body)
    this.view.eventMode = 'static'
    this.view.on('wheel', (e: FederatedWheelEvent) => this.scrollBy(e.deltaY))
    this.view.visible = false
  }

  protected scrollBy(dy: number): void {
    const max = Math.max(0, this.contentH - this.viewH)
    this.scrollY = Math.max(0, Math.min(max, this.scrollY + dy))
    this.body.y = this.bodyTop - this.scrollY
  }
  protected setContentHeight(h: number): void {
    this.contentH = h
    this.scrollBy(0)
  }
  protected resetScroll(): void {
    this.scrollY = 0
    this.body.y = this.bodyTop
  }
  protected clearBody(): void {
    this.body.removeChildren()
  }

  // --- body helpers (local coords; x relative to body.x) ---
  /** Add a label; returns the Text so callers can read `.height`. */
  protected addText(str: string, size: number, color: number, x: number, y: number, bold = false, wrapW?: number): Text {
    const tl = label(str, size, color, bold ? 'bold' : 'normal')
    tl.x = x
    tl.y = y
    if (wrapW) {
      tl.style.wordWrap = true
      tl.style.wordWrapWidth = wrapW
      tl.style.lineHeight = size + 4
    }
    this.body.addChild(tl)
    return tl
  }
  /** Add a (possibly wrapped) paragraph; returns the bottom y. */
  protected para(str: string, size: number, color: number, x: number, y: number, wrapW?: number, bold = false): number {
    const tl = this.addText(str, size, color, x, y, bold, wrapW)
    return y + tl.height
  }
  protected sectionHeader(str: string, y: number): number {
    this.addText(str, 16, COLORS.sla, 0, y, true)
    const g = new Graphics()
    g.rect(0, y + 24, this.bodyW, 1).fill({ color: COLORS.panelEdge, alpha: 0.9 })
    this.body.addChild(g)
    return y + 36
  }
  protected addIcon(tex: Texture, x: number, y: number, size: number): void {
    const sp = new Sprite(tex)
    sp.width = size
    sp.height = size
    sp.x = x
    sp.y = y
    this.body.addChild(sp)
  }
  protected swatch(color: number, y: number, h = 42): void {
    const g = new Graphics()
    g.roundRect(0, y - 2, 6, h, 2).fill({ color })
    this.body.addChild(g)
  }
  /** A clickable external link (opens in a new tab); returns the bottom y. */
  protected link(text: string, url: string, x: number, y: number, size = 13): number {
    const tl = this.addText(text + '  ↗', size, COLORS.sla, x, y)
    tl.eventMode = 'static'
    tl.cursor = 'pointer'
    tl.on('pointertap', () => {
      try {
        window.open(url, '_blank', 'noopener,noreferrer')
      } catch {
        /* ignore */
      }
    })
    const u = new Graphics()
    u.rect(x, y + size + 3, tl.width, 1).fill({ color: COLORS.sla, alpha: 0.6 })
    this.body.addChild(u)
    return y + size + 10
  }

  show(): void {
    this.resetScroll()
    this.refresh()
    this.view.visible = true
  }
  hide(): void {
    this.view.visible = false
  }
  get visible(): boolean {
    return this.view.visible
  }

  /** Subclasses rebuild `body` and call setContentHeight(). */
  abstract refresh(): void

  protected refreshChrome(): void {
    this.titleLbl.text = t(this.titleKey, undefined, this.titleFallback)
    this.back.setTitle(t('set.back', undefined, 'Back')).layout(0, 0, true)
  }
}

// ------------------------------------------------------------------ Help -------

const HELP_LOOP =
  'Waves of AI user requests stream from four ingress lanes toward your central Trust Core. Build a serving platform — GPU racks, models, caches, routers, guardrails, power and cooling — to answer each request correctly, safely, and within its latency SLO before it reaches the core. A request that times out at the core hurts SLA and Trust.'

const HELP_METERS: [string, string][] = [
  ['help.meter.trust', 'Trust — your reputation. Unsafe answers and timeouts drain it. Hits zero → game over.'],
  ['help.meter.sla', 'SLA — service level. Late / wrong serves erode it.'],
  ['help.meter.cash', 'Cash — token revenue funds racks; idle / over-provisioned racks still bleed the operating bill.'],
  ['help.meter.power', 'Power (kW) — racks draw real power; over capacity browns out GPUs. Build Power Plants.'],
  ['help.meter.cooling', 'Cooling (kW) — racks emit heat; over capacity thermal-throttles them. Build Cooling Towers.'],
]

const HELP_KEYS: [string, string][] = [
  ['Space', 'Start the next wave (build) / pause (during a wave)'],
  ['1 2 3 6 0', 'Game speed: 1× 2× 3× 6× 12×'],
  ['M', 'Mute / unmute'],
  ['` / Tab', 'Toggle the telemetry panel (Expert)'],
  ['Esc', 'Open the system menu · back · cancel selection'],
]

export class HelpPanel extends ContentPanel {
  constructor(
    onBack: () => void,
    private factory: TextureFactory,
  ) {
    super(onBack, 'sys.help', 'How to Play')
  }

  refresh(): void {
    this.refreshChrome()
    this.clearBody()
    let y = 0

    y = this.sectionHeader(t('help.loop.h', undefined, 'The Loop'), y)
    y = this.para(t('help.loop.body', undefined, HELP_LOOP), 13, COLORS.text, 0, y, this.bodyW) + 16

    y = this.sectionHeader(t('help.meters.h', undefined, 'Meters'), y)
    for (const [key, fb] of HELP_METERS) {
      this.addText('•', 13, COLORS.sla, 0, y)
      y = this.para(t(key, undefined, fb), 13, COLORS.text, 18, y, this.bodyW - 18) + 8
    }
    y += 8

    y = this.sectionHeader(t('help.requests.h', undefined, 'Requests'), y)
    for (const d of REQUEST_LIST) {
      this.addIcon(this.factory.request(d), 0, y - 2, 26)
      this.addText(reqName(d), 13, COLORS.textBright, 38, y, true)
      this.addText(`${d.latClass} · ${d.inputTokens}→${d.outputTokens} tok`, 11, COLORS.textDim, 38, y + 18)
      const descBottom = this.para(reqDesc(d), 11, COLORS.textDim, 230, y, this.bodyW - 230)
      y = Math.max(y + 38, descBottom) + 10
    }
    y += 8

    y = this.sectionHeader(t('help.towers.h', undefined, 'Buildings'), y)
    for (const id of BUILD_ORDER) {
      const d = TOWER_DEFS[id]
      if (!d) continue
      this.addIcon(this.factory.tower(d), 0, y - 2, 28)
      this.addText(towerName(d), 13, COLORS.textBright, 40, y, true)
      y = this.para(towerDesc(d), 11, COLORS.textDim, 40, y + 18, this.bodyW - 40) + 12
    }
    y += 8

    y = this.sectionHeader(t('help.keys.h', undefined, 'Hotkeys'), y)
    for (const [k, fb] of HELP_KEYS) {
      this.addText(k, 13, COLORS.cash, 0, y, true)
      this.addText(t('help.key.' + k, undefined, fb), 13, COLORS.text, 130, y)
      y += 24
    }

    this.setContentHeight(y + 20)
  }
}

// ------------------------------------------------------------------ Codex ------

const CODEX_TABS = [
  { id: 'models', key: 'codex.tab.models', fallback: 'Models' },
  { id: 'hardware', key: 'codex.tab.hardware', fallback: 'Hardware' },
  { id: 'requests', key: 'codex.tab.requests', fallback: 'Requests' },
  { id: 'research', key: 'codex.tab.research', fallback: 'Research' },
] as const

/**
 * Plain-language "what this technique actually is" blurbs for the research tree.
 * The 22 infra nodes ship with an empty `desc` (the sim doesn't need one); these
 * are the encyclopedia explanations. Post-training / eval nodes keep their own
 * `desc` (used as the fallback). English source — zh-TW overrides via i18n.
 */
const CODEX_TECH: Record<string, string> = {
  inf_batching:
    'Continuous batching swaps finished sequences out and new ones in at every decode step instead of waiting for a whole batch to end — so the GPU never idles between requests. (vLLM / Orca.)',
  inf_multistep:
    'Multi-step scheduling runs several decode steps per scheduler iteration, amortizing CPU/Python scheduling overhead over many tokens to keep the GPU busy.',
  inf_chunked:
    'Chunked prefill splits a long prompt’s prefill into smaller pieces and interleaves them with ongoing decodes, so one big prompt doesn’t stall everyone else’s token stream.',
  inf_disagg:
    'Prefill/decode disaggregation runs the compute-bound prefill phase and the bandwidth-bound decode phase on separate GPU pools, so each gets hardware tuned to its bottleneck.',
  inf_spec:
    'Speculative decoding lets a small draft model propose several tokens that the big model verifies in one pass — accepting the correct prefix yields multiple tokens per step. (EAGLE.)',
  inf_par_tp:
    'Tensor parallelism shards each layer’s matrices across GPUs that compute one token together — lowers single-request latency but needs a fast interconnect (NVLink).',
  inf_par_pp:
    'Pipeline parallelism splits the model by layers across GPUs in a pipeline — works over cheap interconnect but adds latency from pipeline bubbles.',
  inf_par_dp:
    'Data parallelism replicates the whole model on each GPU and routes different requests to each replica — scales throughput, not single-request latency.',
  inf_par_ep:
    'Expert parallelism spreads an MoE model’s experts across GPUs so each holds a subset; every token is dispatched to whichever GPUs own its chosen experts.',
  inf_routing:
    'KV-aware routing sends each request to the replica that already holds its prefix in cache, maximizing KV reuse across a fleet. (NVIDIA Dynamo.)',
  inf_engine_sglang:
    'SGLang is a high-throughput serving engine built around RadixAttention prefix-cache reuse and a fast structured-output runtime.',
  inf_engine_trtllm:
    'TensorRT-LLM is NVIDIA’s compiled inference engine — fused kernels, in-flight batching, and FP8/FP4 — squeezing peak throughput out of NVIDIA GPUs.',
  inf_flash:
    'FlashAttention is an IO-aware attention kernel that tiles the math in on-chip SRAM, never materializing the full attention matrix in HBM — much faster and lighter on memory.',
  inf_kvquant_fp8:
    'FP8 KV cache stores attention keys/values in 8-bit floats, ~halving KV memory so you fit longer contexts or more concurrent sequences with minimal quality loss.',
  inf_kvquant_int4:
    'INT4 KV cache compresses keys/values to 4-bit integers — ~4× smaller KV, enabling very long context or high concurrency at some accuracy cost.',
  inf_offload:
    'KV offloading spills cold KV-cache blocks to CPU RAM / NVMe and streams them back on demand, extending effective cache far beyond GPU HBM. (LMCache.)',
  inf_paged:
    'PagedAttention manages the KV cache in fixed-size pages like OS virtual memory, eliminating fragmentation so far more sequences pack into HBM. (vLLM’s core idea.)',
  inf_prefix:
    'Prefix caching reuses the KV cache of a shared prompt prefix — system prompt, few-shot examples — across requests, skipping redundant prefill.',
  inf_wq_fp8:
    'FP8 weight quantization stores weights in 8-bit — half the VRAM and higher memory-bandwidth throughput, near-lossless on modern GPUs.',
  inf_wq_int4:
    'INT4 weight quantization compresses weights to 4-bit with activation-aware methods (AWQ / GPTQ), quartering weight memory so big models fit smaller GPUs.',
  inf_wq_nvfp4:
    'NVFP4 is Blackwell’s native 4-bit float with hardware microscaling — 4-bit weight memory at accuracy close to FP8.',
  inf_multilora:
    'Multi-LoRA serving runs many LoRA adapters over one shared base model, swapping adapters per request so hundreds of fine-tunes share a single deployment. (S-LoRA.)',
}

export class CodexBrowser extends ContentPanel {
  private tabBtns: UIButton[] = []
  private current = 0

  constructor(
    onBack: () => void,
    private factory: TextureFactory,
  ) {
    super(onBack, 'sys.codex', 'Codex', 112)
    const segW = 132
    const gap = 8
    for (let i = 0; i < CODEX_TABS.length; i++) {
      const btn = new UIButton({ w: segW, h: 30, accent: COLORS.data, onTap: () => this.selectTab(i) })
      btn.x = this.px + 28 + i * (segW + gap)
      btn.y = this.py + 64
      this.view.addChild(btn)
      this.tabBtns.push(btn)
    }
  }

  private selectTab(i: number): void {
    this.current = i
    this.resetScroll()
    this.refresh()
  }

  refresh(): void {
    this.refreshChrome()
    CODEX_TABS.forEach((tab, i) =>
      this.tabBtns[i].setTitle(t(tab.key, undefined, tab.fallback)).setActive(i === this.current).layout(0, 0, true),
    )
    this.clearBody()
    const id = CODEX_TABS[this.current].id
    if (id === 'models') this.buildModels()
    else if (id === 'hardware') this.buildHardware()
    else if (id === 'requests') this.buildRequests()
    else this.buildResearch()
  }

  private buildModels(): void {
    let y = 0
    // right column: a fixed left edge with single-line (non-wrapping) text so the
    // size/flags row and the quality row never collide with each other or the name.
    const rx = this.bodyW - 430
    for (const m of MODEL_LIST) {
      this.swatch(m.real ? COLORS.data : COLORS.textDim, y)
      const flags = [m.isMoE ? 'MoE' : '', m.isReasoning ? 'Reasoning' : ''].filter(Boolean).join(' · ')
      const size = m.isMoE ? `${sizeLabel(m.paramsTotalB)} / ${sizeLabel(m.paramsActiveB)} act` : sizeLabel(m.paramsTotalB)
      this.addText(modelName(m), 14, COLORS.textBright, 16, y, true)
      this.addText(size + (flags ? '  ·  ' + flags : ''), 12, COLORS.sla, rx, y)
      const real = m.real
      const prov = real ? `${real.developer} · ${real.released} · ${real.license} · ctx ${real.contextWindowK}k` : ''
      this.addText(prov, 11, COLORS.textDim, 16, y + 20)
      const q = m.qualityBy
      this.addText(
        `Q${r0(m.quality)}  ·  chat ${r0(q.chat)} · cod ${r0(q.coding)} · rea ${r0(q.reasoning)} · gen ${r0(q.general)} · agt ${r0(q.agentic)}`,
        11,
        COLORS.textDim,
        rx,
        y + 20,
      )
      y += 50
    }
    this.setContentHeight(y + 10)
  }

  private buildHardware(): void {
    let y = 0
    for (const id of HARDWARE_TIERS) {
      const h = HARDWARE_DEFS[id]
      if (!h) continue
      this.swatch(h.color ?? COLORS.power, y)
      this.addText(h.name, 14, COLORS.textBright, 16, y, true)
      this.addText(h.gpuModel, 12, COLORS.power, this.bodyW - 200, y, false, 200)
      const specs = `${h.gpus}× GPU · ${r0(h.hbmGb)} GB HBM · ${h.hbmTbs.toFixed(1)} TB/s · bf16 ${r0(h.bf16Tflops)} TF · ${(h.tdpWatts / 1000).toFixed(1)} kW · $${r0(h.capexUsd).toLocaleString()} · $${h.gpuHrUsd.toFixed(2)}/hr`
      this.addText(specs, 11, COLORS.textDim, 16, y + 20, false, this.bodyW - 16)
      y += 50
    }
    this.setContentHeight(y + 10)
  }

  private buildRequests(): void {
    let y = 0
    y = this.para(t('codex.req.note', undefined, CODEX_REQ_NOTE), 12, COLORS.textDim, 0, y, this.bodyW) + 14
    const lateLbl = t('codex.req.late', undefined, 'late')
    for (const d of REQUEST_LIST) {
      this.addIcon(this.factory.request(d), 0, y - 2, 28)
      this.addText(reqName(d), 14, COLORS.textBright, 40, y, true)
      const late = eraTokenRange(d)
      const meta = `${d.latClass} · ${d.primaryAxis} · ${d.inputTokens}→${d.outputTokens} tok  (${lateLbl} ~${fmtTok(late.input)}→${fmtTok(late.output)}) · $${d.pricePerMtokOut}/Mtok${d.toolUse ? ' · tools' : ''}${d.cacheable ? ' · cacheable' : ''}`
      this.addText(meta, 11, COLORS.sla, 40, y + 20)
      const descBottom = this.para(reqDesc(d), 11, COLORS.textDim, this.bodyW - 360, y, 360)
      y = Math.max(y + 44, descBottom) + 8
    }
    this.setContentHeight(y + 10)
  }

  private buildResearch(): void {
    let y = 0
    const kindColor: Record<string, number> = { model: COLORS.data, tech: COLORS.sla, eval: COLORS.warn }
    for (const d of RESEARCH_LIST) {
      this.swatch(kindColor[d.kind] ?? COLORS.textDim, y, 48)
      this.addText(d.name, 14, COLORS.textBright, 16, y, true)
      this.addText(`${d.kind} · ${d.dataCost} data`, 12, kindColor[d.kind] ?? COLORS.textDim, this.bodyW - 160, y)
      const explain = t('codex.tech.' + d.id, undefined, CODEX_TECH[d.id] ?? d.desc)
      y = this.para(explain, 12, COLORS.text, 16, y + 22, this.bodyW - 16) + 16
    }
    this.setContentHeight(y + 10)
  }
}

// ------------------------------------------------------------------ About ------

const GAME_VERSION = '0.1.0'

const ABOUT_DATA =
  'GPTD is a data-center LLM-inference simulator dressed as a tower defense. The roster is drawn from real open-weight models; each model’s capability vector is calibrated from public Artificial Analysis benchmark scores, and the serving math — rooflines, KV cache, power/cooling in real kW, token-priced revenue — is grounded in real hardware and pricing.'

const ABOUT_LINKS: { key: string; fallback: string; url: string }[] = [
  { key: 'about.link.aa', fallback: 'Artificial Analysis — the benchmark source', url: 'https://artificialanalysis.ai' },
  { key: 'about.link.repo', fallback: 'GitHub repository', url: 'https://github.com/JacobLinCool/GPTD' },
  { key: 'about.link.play', fallback: 'Play it online', url: 'https://jacoblincool.github.io/GPTD/' },
]

export class AboutPanel extends ContentPanel {
  constructor(onBack: () => void) {
    super(onBack, 'sys.about', 'About')
  }

  refresh(): void {
    this.refreshChrome()
    this.clearBody()
    let y = 0
    this.addText('GIGAPROMPT TOWER DEFENSE', 22, COLORS.textBright, 0, y, true)
    y += 34
    y = this.para(t('about.slogan', undefined, '“The board is the metaphor, the numbers are real.”'), 14, COLORS.sla, 0, y, this.bodyW) + 18

    y = this.sectionHeader(t('about.data.h', undefined, 'Where the numbers come from'), y)
    y = this.para(t('about.data.body', undefined, ABOUT_DATA), 13, COLORS.text, 0, y, this.bodyW) + 16
    this.addText(t('about.benchmarks', undefined, 'Artificial Analysis benchmarks:'), 12, COLORS.textBright, 0, y, true)
    y += 22
    y = this.para('MMLU-Pro · GPQA-Diamond · LiveCodeBench · SciCode · TerminalBench-Hard · IFBench · HLE · LCR', 12, COLORS.textDim, 0, y, this.bodyW) + 18

    y = this.sectionHeader(t('about.links.h', undefined, 'Links'), y)
    for (const l of ABOUT_LINKS) {
      y = this.link(t(l.key, undefined, l.fallback), l.url, 0, y) + 8
    }
    y += 8
    this.addText(
      t('about.build', { v: GAME_VERSION }, `Build ${GAME_VERSION} · Vite + TypeScript + PixiJS v8 + Web Audio`),
      11,
      COLORS.textDim,
      0,
      y,
    )
    this.setContentHeight(y + 30)
  }
}
