# GigaPrompt Tower Defense

> The board is the metaphor; the numbers are real.

![status](https://img.shields.io/badge/status-playable-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)
![Vite](https://img.shields.io/badge/Vite-646CFF)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)
![PixiJS](https://img.shields.io/badge/PixiJS-v8-E91E63)

### ▶ Play it now: **<https://jacoblincool.github.io/GPTD/>**

No install — it runs entirely in your browser. (To run from source, see [Getting Started](#getting-started).)

**GigaPrompt Tower Defense** (GPTD) is a **realistic data-center LLM-inference simulator delivered as a tower-defense game**. The four ingress lanes, racks, and the central Trust Core are the metaphor; underneath, the math is the real engineering an inference team actually does — prefill/decode roofline, MoE total-vs-active parameters, the KV-cache budget, Goodput against TTFT/E2EL SLOs, $/Mtoken on real GPUs, per-model post-training vs serving-layer infrastructure, and a two-layer safety stack. Waves of user requests arrive from global entrances and converge toward the core carrying real token counts, latency classes, and hazards; you do not kill them, you serve them fast, cheaply, correctly, and safely on real hardware before they leak.

GPTD is built to be **defensible in front of LLM-infrastructure professionals**: every visible mechanic maps to a real serving decision, and Expert Mode exposes the genuine SRE telemetry behind it.

## What it models

- **9 request archetypes by root property** — `embed`, `chat`, `comp`, `rag`, `summ`, `reason`, `agent`, `batch`, `jailbreak`. Each carries real input/output token counts (ISL/OSL), a latency class (interactive / near-real-time / throughput), a per-axis difficulty vector, a prefix-cacheability share, and (for `agent`/`jailbreak`) safety hazards. A request is defined by its workload physics, not its costume.
- **A real GPU ladder** — `L4 → L40S → H100 → H200 → DGX H200 → DGX B200 → GB200 NVL72`. Each rack carries real per-GPU VRAM, HBM bandwidth, TDP, and capex, scaled by GPU count. Air-cooled racks light up anywhere; the liquid-cooled multi-GPU clusters (DGX H200, DGX B200, GB200 NVL72) are **hard-gated behind a Liquid Cooling Loop** and cannot run without one.
- **Real open-weight models, free to deploy** — a curated 2025–2026 roster (Llama, Qwen3 dense + MoE, gpt-oss, Gemma 3, Phi-4, Mistral/Devstral, GLM-4.5-Air, DeepSeek-V3.1, Nemotron, Kimi K2). Weights are a download, so deployment is **free** — gated only by whether the model fits the rack's VRAM (`paramsTotalB` × bytes/param); there is no architecture deploy-unlock (MoE/reasoning are model attributes, not gates). `qualityBy` is calibrated from public benchmarks (Artificial Analysis / model cards), never hand-edited.
- **A Post-Training Studio** — derive your own checkpoints with a real method menu (SFT, LoRA/QLoRA/DoRA, DPO, RLHF, CAI, GRPO, distill, merge, QAT) × a capability target × an effort slider. Each run produces a new derived `ModelDef` with a snapshotted lineage, unlimited and iterative (fine-tune a fine-tune). The MoE total/active split and the un-saturated **agentic** axis mean a tiny fast MoE answers quickly but loses the SWE-grade lanes — exactly the real differentiation.
- **An infra tech tree (serving only)** — 22 nodes across continuous batching, PagedAttention, prefix cache, FP8/INT4 KV-quant, FlashAttention, KV offload, chunked prefill vs P/D disaggregation (hard-exclusive), speculative decoding, weight quant (FP8/INT4/NVFP4), tensor/pipeline/data/expert parallelism, KV-aware routing, multi-LoRA, and the engine tier (vLLM → SGLang → TensorRT-LLM). These write `s.infra` and change the real serving physics; model architecture (GQA/MLA/MoE/reasoning) lives on the model, not the tree.
- **Two-layer safety** — layer 1 is model-intrinsic alignment (baked in by RLHF/CAI/safety-SFT, zero serving latency, carrying a quality tax and an over-refusal risk); layer 2 is guardrail buildings (a millisecond BERT **encoder**, a full-inference 12B **generative** guardrail that runs on its own roofline, and a vendor-hosted **moderation** API). Threshold tuning trades recall against over-refusal — there is no free lunch.
- **A real economy** — income is `$/Mtoken` (input + output prices per archetype); cost is real operating spend (capex amortization + $/GPU-hr + power + cooling) billed by wall-clock, so **idle and over-provisioned racks bleed** and low utilization blows up your unit cost. Six request outcomes settle the books: `served`, `slo_miss`, `bad`, `unservable`, `unsafe`, `over_refused`.

## How it plays

You watch four data-center ingress lanes converge on a central Trust Core and make assignment and provisioning calls in real time: build racks, deploy the right model onto each one, upgrade rack tiers in place, provision power and cooling (and a liquid loop before any high-density rack), place a Router / Cache / guardrails, and run research and post-training between waves. Keep three meters alive — **Trust**, **SLA**, and **Cash** — through a **100-wave campaign** that dramatizes real 2023→2026 history **from the provider's seat** — every wave is a **demand shift** (the chatbot boom, the code-completion surge, everyone building RAG bots, the reasoning-demand flood, the coding-agent majority…) or an **operating shock** (the H100 shortage, undersea-cable cuts, grid heatwaves & water limits, chip export bans, major cloud outages, token price wars, the EU AI Act…), never a model/tech announcement — as an escalating **elimination gauntlet**. Difficulty climbs monotonically; most runs end mid-campaign; reaching wave 100 — the **Age of Inference** boss — is the apex, after which endless mode generates ever-harder surges. Between waves, real-event **incidents** bite live through the build phase and the wave: power-price spikes, cooling/grid failures, GPU/HBM shortages and export bans, regulatory audits, token price wars, data poisoning, viral demand surges, and undersea-cable cuts that funnel every request through one ingress. The title screen offers **Normal Mode** (friendly dashboards), **Expert Mode** (the full SRE console — rooflines, Goodput, $/Mtoken, KV budget, the model overview and lineage graph), and a small **Demo** button, which launches a fixed-seed Expert run driven by the same balance autoplayer that survives deep into the 100-wave gauntlet while exercising the major systems: build placement, rack upgrades through DGX H200, model deployment, infra/eval/post-training research, Studio-derived checkpoints, guardrails, power/cooling, liquid cooling, and P/D rack roles. Demo remains inspectable: viewers can click live racks, requests, model lists, and lab panels while the autoplayer owns state-changing actions.

## Design & grounding docs

All documentation lives in **[`docs/`](./docs/)** (see the **[docs index](./docs/README.md)**); the working rules for contributors are in **[AGENTS.md](./AGENTS.md)**.

- **[docs/DESIGN.md](./docs/DESIGN.md)** — the **canonical Game Design Document** (the readable design of record). Start here.
- **[docs/BLUEPRINT.md](./docs/BLUEPRINT.md)** — the **authoritative design spec** (the unified data model, the serving spine, the dual-clock/SLO physics, every subsystem) — the deeper implementation layer beneath the GDD.
- **[docs/MATH.md](./docs/MATH.md)** — the **math reference**: every formula, constant, and variable the sim uses (glossary + constants + formulas by subsystem), extracted from the code.
- **[docs/REFERENCE-DOSSIER.md](./docs/REFERENCE-DOSSIER.md)** — the **real-world grounding**: the GPU specs, model figures, benchmark numbers, and serving-systems literature the simulation is calibrated against.
- **[docs/REALISM.md](./docs/REALISM.md)** / **[docs/REALISM-MODELS.md](./docs/REALISM-MODELS.md)** — the realism ledgers (mechanic → real-world basis, citations, deviations).
- **[docs/MODEL-CATALOG.md](./docs/MODEL-CATALOG.md)** — the fact-checked model-roster reference (developer, license, benchmarks, lineage).
- **[docs/manual/en.md](./docs/manual/en.md)** · **[docs/manual/zh-TW.md](./docs/manual/zh-TW.md)** — the player manual (English primary, Traditional Chinese).
- **[docs/AGENT-BRIDGE.md](./docs/AGENT-BRIDGE.md)** — let a terminal agent (Claude Code / Codex) play the game in your open tab; protocol, action vocabulary, snapshot shape.

## Tech Stack

- **[Vite](https://vitejs.dev/)** — dev server and bundler
- **[TypeScript](https://www.typescriptlang.org/)** (strict) — game logic and deterministic simulation
- **[PixiJS v8](https://pixijs.com/)** — WebGL / WebGPU rendering
- **[Web Audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)** — sound and music
- **[pnpm](https://pnpm.io/)** — package manager
- **[Vitest](https://vitest.dev/)** — unit tests + heuristic balance autoplay
- **[Playwright](https://playwright.dev/)** — headless E2E playtest
- **[ESLint](https://eslint.org/) + [Prettier](https://prettier.io/)** — linting and formatting

## Getting Started

```bash
pnpm install      # install dependencies (npm also works — swap pnpm for npm run)
pnpm dev          # start the Vite dev server (http://127.0.0.1:5173)
pnpm typecheck    # tsc --noEmit (must pass)
pnpm test         # Vitest: sim unit tests + balance autoplay
pnpm build        # tsc + vite production build
pnpm preview      # serve the built dist on :4173
pnpm e2e          # headless Playwright playtest (needs preview running)
pnpm bridge       # agent bridge relay on :8799 — let a terminal agent play your open tab
```

## Let an AI agent play your open tab

Because the sim is driven entirely through a small action layer, a local terminal
agent (Claude Code, Codex, …) can **play the game in a browser tab you already
have open** — you watch the live board while every move is narrated in the in-game
Codex bubble. It uses **no CDP, no headless browser, and no MCP**: the tab dials
out to a tiny localhost relay, and the agent issues moves over plain HTTP.

```bash
pnpm dev                                   # serve the game
pnpm bridge                                # start the relay (the agent can do this itself)
# open http://127.0.0.1:5173/?agent=1 and watch; then, from the agent's terminal:
curl -s "http://127.0.0.1:8799/do?fn=startWave&reason=Open+the+first+wave"
```

On the **hosted** build a player only needs the URL: opening
`https://jacoblincool.github.io/GPTD/?agent=1` shows an in-game panel with a
one-liner to paste to their agent (it downloads the relay — `bridge.mjs`, served
from the same origin — and runs it). Open with `?agent=auto`
to get a random relay port so **several agents can play different games at once on
one machine**. See **[docs/AGENT-BRIDGE.md](./docs/AGENT-BRIDGE.md)** for the player flow,
full protocol, action vocabulary, and snapshot shape.

## Project Structure

```text
GPTD/
├─ .github/workflows/
│  └─ pages.yml        # required gates + Vite build + GitHub Pages deployment
├─ index.html
├─ vite.config.ts       # build + Vitest config
├─ tsconfig.json
├─ eslint.config.js
├─ src/
│  ├─ main.ts           # bootstrap: PixiJS Application, fixed-timestep loop, resize
│  ├─ game.ts           # orchestrator: sim + render + audio + UI, state machine
│  ├─ config.ts         # layout, palette, and balance constants (CREDIT_USD, SIM_TIME_SCALE, LAT_CLASS_SLO, …)
│  ├─ mode.ts           # Normal/Expert display mode (presentation-only; the sim never branches on it)
│  ├─ core/             # seeded RNG + shared types (the unified data model)
│  ├─ sim/              # deterministic simulation (the only unit-tested layer)
│  │  ├─ content.ts     # data-driven content: REQUEST_TYPES, HARDWARE_DEFS, ROSTER, METHOD_RECIPES, INFRA_NODES, TOWER_DEFS, WAVES (=buildCampaign), INCIDENTS
│  │  ├─ campaign.ts    # WaveTheme types + buildWave/buildCampaign builder + tier* difficulty knobs + themedIncidentId
│  │  ├─ campaign-data.ts # the 100 authored real-history waves (theme table; generated from research, balance-tuned)
│  │  ├─ models.ts      # resolveModel / deriveQuality / deriveModel (the Post-Training Studio engine)
│  │  ├─ effects.ts     # real roofline (prefill/decode), KV/VRAM budget, quality matching, $/Mtoken getters
│  │  ├─ combat.ts      # routing, cache aura, two-layer safety, serve resolution (six outcomes)
│  │  ├─ safety.ts      # guardrail recall / over-refusal / layer-1 self-handling
│  │  ├─ power.ts       # real-watt power/cooling capacity, brownout, throttle, liquid gate
│  │  ├─ research.ts    # multi-track R&D (infra / post-training / eval) on a shared compute pool
│  │  ├─ endless.ts     # procedural post-campaign surges (past wave 100)
│  │  ├─ telemetry.ts   # waveStats / lastReport (Goodput, TTFT/E2EL attainment, $/Mtoken)
│  │  ├─ sim.ts         # step(): one fixed timestep + wave/incident/win-lose logic
│  │  └─ actions.ts     # player actions (build, sell, deploy, upgrade rack, research, start wave)
│  ├─ render/           # PixiJS layer: procedural pixel textures, world, FX
│  ├─ ui/               # HUD/TopBar, build bar, inspect panels, LiveOps, model overview, lineage, TechLab+Studio, metrics, tooltips, charts
│  ├─ agent/            # agent bridge tab-side: connector.ts (dials out) + snapshot.ts (JSON-safe /state)
│  ├─ i18n/             # translation system (en + zh-TW)
│  └─ audio/            # procedural Web Audio engine
├─ public/              # served verbatim: bridge.mjs (the zero-dep agent relay, downloadable on hosted builds)
├─ docs/                # all documentation (see docs/README.md for the index)
│  ├─ README.md         # docs index: every doc, its audience, and its purpose
│  ├─ DESIGN.md         # canonical Game Design Document (readable design of record)
│  ├─ BLUEPRINT.md      # authoritative design spec (data model, serving spine, SLO physics)
│  ├─ REFERENCE-DOSSIER.md # real-world grounding: GPU specs, model figures, benchmark numbers
│  ├─ REALISM.md · REALISM-MODELS.md # realism ledgers (mechanic → real-world basis)
│  ├─ MODEL-CATALOG.md  # fact-checked model-roster reference
│  ├─ AGENT-BRIDGE.md   # let a terminal agent play your open tab (protocol + snapshot shape)
│  └─ manual/           # player manual: en.md, zh-TW.md, README.md (language index)
├─ AGENTS.md            # contributor working rules (kept at repo root for agent discovery)
├─ tests/               # Vitest: sim.test.ts, metrics.test.ts, playthrough.test.ts (balance autoplay)
└─ scripts/             # agent-smoke.mjs (bridge E2E) + headless Playwright playtest + screenshots
```

> All art and audio are generated procedurally at runtime — there are no binary asset files to ship.

## Contributing

GPTD's simulation is meant to stay defensible in front of inference engineers — challenge every change against [docs/REALISM.md](./docs/REALISM.md) §0 (directional fidelity) and propagate any mechanic/content/UI change to every doc and locale it touches (see [AGENTS.md](./AGENTS.md) §0). Ideas, balance questions, and mechanic critiques are all welcome.

## License

[MIT](./LICENSE)
