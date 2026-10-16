# GigaPrompt Tower Defense

> The board is the metaphor; the numbers are real.

![status](https://img.shields.io/badge/status-playable-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)
![Vite](https://img.shields.io/badge/Vite-646CFF)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)
![PixiJS](https://img.shields.io/badge/PixiJS-v8-E91E63)

### ▶ Play it now: **<https://jacoblincool.github.io/GPTD/>**

No install — it runs entirely in your browser. (To run from source, see [Getting Started](#getting-started).)

**GigaPrompt Tower Defense** (GPTD) is a **tower-defense game built on real-world simulation** — a tower defense first, designed around real data-center LLM-inference engineering so every number has a real basis. The ingress lanes, racks, and the central Trust Core are the metaphor; underneath, the math is the real engineering an inference team does — the prefill/decode roofline, batching and the KV-cache budget, MoE total-vs-active parameters, thinking models' hidden tokens, Goodput against latency SLOs, $/Mtoken on real GPUs, post-training vs serving infrastructure, and a two-layer safety stack. Waves of user requests arrive from global entrances and converge on the core carrying real token counts, latency classes, and hazards. You do not kill them: you serve them fast enough, correctly, safely, and cheaply before they leak — and the board shows why each one succeeded or failed.

GPTD is built to be **defensible in front of LLM-infrastructure professionals**: every visible mechanic maps to a real serving decision and keeps its real tradeoff (small is fast, big is smart; thinking is smarter but slower; guards are safer but slower and over-refuse; batching trades per-user speed for throughput), and Expert Mode exposes the genuine SRE telemetry behind it.

## What We Built

**GigaPrompt Tower Defense** is a playable browser tower defense about operating an LLM inference platform under pressure. Instead of destroying enemies, you serve waves of AI user requests before they leak into the central Trust Core. You keep **Trust**, **SLA**, and **Cash** alive while you choose rack hardware, deploy open-weight models, manage power and cooling, add routers, caches, and guardrails, research serving infrastructure, and post-train new derived checkpoints.

The campaign is a 100-wave elimination gauntlet based on real 2023→2026 AI-infrastructure history. Normal Mode keeps the interface approachable and explains outcomes in plain words; Expert Mode exposes the serving telemetry an inference team would actually watch: Goodput, TTFT/TPOT/E2EL against SLO, roofline bottlenecks, KV-cache pressure, model lineage, power/cooling headroom, and $/Mtoken.

- **9 request archetypes defined by workload physics** — `embed`, `chat`, `comp`, `rag`, `summ`, `reason`, `agent`, `batch`, `jailbreak`. Each carries real input/output token counts (ISL/OSL) that grow with the era, a latency class (interactive / near-real-time / throughput), a per-axis difficulty, a prefix-cacheable share, how borderline its benign traffic is (its exposure to wrongful refusal), how much a thinking model thinks about it, and (for `agent` / `jailbreak`) safety hazards. A request is defined by what it costs to serve, not by its costume.
- **A real GPU ladder** — `L4 → L40S → H100 → H200 → DGX H200 → DGX B200 → GB200 NVL72`, each with real per-GPU VRAM, HBM bandwidth, compute, TDP, capex, and $/GPU-hour. A multi-GPU rack runs a model that fits one GPU as replicas (more concurrent users) and spans a bigger one with tensor parallelism (pipeline stages beyond eight GPUs), so a big box buys fit and concurrency, not per-user speed. Everything up to the DGX B200 is air-cooled; the NVL72 is liquid-cooled and **cannot run without a Liquid Cooling Loop**.
- **Real open-weight models, free to deploy** — a roster of real open-weight checkpoints, from sub-billion edge models to trillion-parameter MoEs (Qwen, Gemma, gpt-oss, Nemotron, MiniCPM, GLM, DeepSeek, MiniMax, MiMo, Kimi and more). Each one's architecture (KV layout, release precision, context window) is read from its Hugging Face `config.json`, and a frontier-tolerance gate keeps only the checkpoints still worth picking at their size ([docs/PARETO.md](./docs/PARETO.md)). Weights are a download, so deployment is **free**; a model is gated by whether its weights fit the rack at release precision or a researched lower one, and spanning several GPUs needs parallelism research. `qualityBy` is calibrated from Artificial Analysis benchmarks on one frozen reference scale — never hand-edited.
- **Thinking models** — each checkpoint's chat template decides whether it can think: a **hybrid** answers interactive traffic with thinking off and thinks on everything else, an **always**-thinker is sharp but slow to start on chat, and a **never**-thinker answers at once. Hidden reasoning tokens cost decode time, KV memory, and latency, and are never billed.
- **A Post-Training Studio** — derive your own checkpoints with a real method menu (continued pre-training, SFT, LoRA/QLoRA/DoRA, DPO, RLHF, Constitutional AI, GRPO, distillation, merging, QAT) × a capability target × an effort slider. Each run mints a new derived model with a snapshotted lineage; you can fine-tune a fine-tune, up to the ceiling its base body allows. A run costs Data and GPU time borrowed from serving.
- **An infra tech tree (serving only)** — continuous batching, multi-step scheduling, chunked prefill or P/D disaggregation (one or the other), PagedAttention, prefix caching, FlashAttention, FP8/INT4 KV cache, KV offload, speculative decoding, FP8/INT4/NVFP4 weight formats, tensor/pipeline/data/expert parallelism, KV-aware routing, multi-LoRA serving, and an engine choice (SGLang or TensorRT-LLM). Each node changes the serving physics along its real tradeoff; model architecture (GQA/MLA/MoE/thinking) lives on the model, not the tree.
- **Two-layer safety** — layer 1 is model-intrinsic alignment (baked in by RLHF/CAI/safety-SFT, zero serving latency, with a quality tax and an over-refusal risk); layer 2 is guardrail buildings that screen every request on the lanes they cover: a small **encoder** classifier on the prompt and a 12B **generative** judge that runs a real inference on its own GPU on both sides. Different guard families stack into defense in depth, every one adds latency and false positives, and late-era novel attacks slip past a classifier that a generative judge or a well-aligned model still stops.
- **A real economy** — income is `$/Mtoken` on the tokens actually processed, plus each wave's SLA contract paid in proportion to its Goodput; cost is a wall-clock bill in two lines, GPU-hours and energy, so **idle and over-provisioned racks bleed**. Every request ends in one of seven outcomes: `served`, `sloMiss` (right but late, paid half), `bad` (wrong, refunded), `unsafe`, `overRefused`, `unservable` (too long for the window or KV budget), and `leaked` (a 504).
- **Readable outcomes** — every request resolves on the board with its own glyph, colour (a colorblind palette included), cause tag (`LATE · TTFT`, `WRONG · Coding`, `REFUSED · GUARD`, …), and procedural sound; chips fly to the meter it moved, and the request inspector explains any packet you click. One outcome vocabulary drives the board, the HUD, the wave report, and the audio.

## How Codex helped

GPTD was developed with Codex as an agentic engineering partner across code, content, and documentation:

- **Implementation support** — translating the design into TypeScript systems for deterministic simulation, PixiJS rendering, UI panels, data-driven content tables, tests, and build scripts.
- **Research-to-game synthesis** — helping turn real LLM-serving concepts into playable mechanics: roofline prefill/decode limits, KV-cache pressure, GPU power/cooling, latency SLOs, model quality axes, post-training tradeoffs, and guardrail failure modes.
- **Content and documentation consistency** — keeping player-facing copy, manuals, i18n strings, design docs, and README text aligned when mechanics or terminology changed.
- **Verification workflows** — using typecheck, lint, unit tests, build checks, autoplay balance tests, and the local agent bridge to exercise the game as a browser-playable system rather than only as isolated code.

## How to play / controls

You watch four data-center ingress lanes converge on a central Trust Core and make provisioning calls in real time: build racks, deploy the right model onto each one, upgrade rack tiers in place, provision power and cooling, place routers, caches, and guardrails, and run research and post-training. Keep three meters alive — **Trust**, **SLA**, and **Cash** — through a campaign that dramatizes real 2023→2026 history **from the provider's seat**: every wave is a **demand shift** (the chatbot boom, the code-completion surge, everyone building RAG bots, the reasoning-demand flood, the coding-agent majority…) or an **operating shock** (the H100 shortage, undersea-cable cuts, grid heatwaves and water limits, chip export bans, major cloud outages, token price wars, the EU AI Act…), never a model or chip announcement. Difficulty climbs every wave, so most runs end mid-campaign; reaching the final boss is the apex, after which endless mode keeps climbing. Real-event **incidents** are telegraphed before a wave and bite through it: power-price spikes, grid curtailment, cooling failures, GPU/HBM shortages and export bans, regulatory audits, price wars, data poisoning, viral surges, and cable cuts that funnel every request through one ingress. The **NEXT WAVE** card forecasts each archetype against your fleet before you press START.

The title screen offers **Normal Mode** (friendly dashboards), **Expert Mode** (the full SRE console — rooflines, Goodput, $/Mtoken, KV budget, the model overview and lineage graph), a **Demo** button, and **Agent Mode** (below). Demo launches a fixed-seed Expert run at 12× played by the same heuristic the balance test runs: it reads the next-wave forecast, keeps a cash reserve, upgrades racks, researches the serving stack, trains specialists in the Studio, places guards, and picks every deployment from the same load forecast the deploy picker's ★ shows — and it gets deep into the gauntlet before it is knocked out. Viewers can still click racks, requests, model lists, and lab panels while the autoplayer owns every state-changing action.

| Action                               | Control                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Start the game / choose a mode       | **START** (or `Space` / `Enter`) on the title screen; **NORMAL** or **EXPERT** picks the display mode                      |
| Place a building                     | Pick it on the build bar (`Q` … `P`), then click a tile; drag to paint a row of support buildings (hold `Shift` for racks) |
| Drop the tool / deselect             | `Esc` or right-click (`Esc` again opens the system menu)                                                                   |
| Inspect a building                   | Click it; `,` / `.` step through racks; `[` / `]` switch its tabs (Overview / Deploy / Telemetry)                          |
| Deploy a model onto a rack           | **DEPLOY** tab → pick a checkpoint (★ = the best expected clean share of the coming wave)                                  |
| Roll a model out                     | `Shift`-click a checkpoint for every rack of that tier; add `Ctrl` / `⌘` for every rack it fits                            |
| Upgrade rack hardware                | `Z`, or **RACK →** in the inspect panel (**UPGRADE ALL** for every rack of the tier)                                       |
| Sell a building                      | `X` or **SELL**, pressed twice to confirm (Settings ▸ Gameplay can drop the confirm)                                       |
| Copy a rack's loadout                | `C`, then click tiles to place copies                                                                                      |
| Cycle a rack's prefill / decode role | `V` (after P/D Disaggregation research)                                                                                    |
| Show coverage rings                  | `G` toggles every ring; hold `Alt` to peek                                                                                 |
| Training Lab (research + Studio)     | `L` or **TRAIN ◆** in the build phase (needs a Training Lab on the board)                                                  |
| Model overview / telemetry (Expert)  | `K` / `` ` `` or `Tab`                                                                                                     |
| Start the next wave · pause / resume | `Space`                                                                                                                    |
| Game speed                           | `1` `2` `3` `6` `0` for 1× 2× 3× 6× 12×; `−` / `=` step; `F` toggles 1× and your last fast speed                           |
| Mute                                 | `M`                                                                                                                        |
| Every hotkey                         | `H` or `?` opens the hotkey sheet                                                                                          |

Keys follow their physical position, so the layout is the same on AZERTY or Dvorak. You build mostly in the Build phase, but emergency builds are allowed mid-wave. Model swaps, rack upgrades, rack roles, and weight formats change between waves, because loading new weights drains a rack (with Multi-LoRA Serving, an adapter of the loaded base can still swap in mid-wave). Research and Studio runs start in the Build phase and progress during waves on racks they borrow from serving.

## Design & grounding docs

All documentation lives in **[`docs/`](./docs/)** (see the **[docs index](./docs/README.md)**); the working rules for contributors are in **[AGENTS.md](./AGENTS.md)**.

- **[docs/DESIGN.md](./docs/DESIGN.md)** — the **canonical Game Design Document** (the readable design of record). Start here.
- **[docs/BLUEPRINT.md](./docs/BLUEPRINT.md)** — the **authoritative design spec** (the unified data model, the serving spine, the dual-clock/SLO physics, every subsystem) — the deeper implementation layer beneath the GDD.
- **[docs/MATH.md](./docs/MATH.md)** — the **math reference**: every formula, constant, and variable the sim uses (glossary + constants + formulas by subsystem), extracted from the code.
- **[docs/REFERENCE-DOSSIER.md](./docs/REFERENCE-DOSSIER.md)** — the **real-world grounding**: the GPU specs, model figures, benchmark numbers, and serving-systems literature the simulation is calibrated against.
- **[docs/REALISM.md](./docs/REALISM.md)** / **[docs/REALISM-MODELS.md](./docs/REALISM-MODELS.md)** — the realism ledgers (mechanic → real-world basis, citations, deviations).
- **[docs/MODEL-CATALOG.md](./docs/MODEL-CATALOG.md)** · **[docs/PARETO.md](./docs/PARETO.md)** — the fact-checked model reference (developer, license, benchmarks, lineage, serving facts) and the generated size ↔ capability analysis behind the active roster.
- **[docs/SYSTEM-MENU.md](./docs/SYSTEM-MENU.md)** — the system menu, settings (audio, display, accessibility, gameplay), content browsers, and persistence.
- **[docs/manual/en.md](./docs/manual/en.md)** · **[docs/manual/zh-TW.md](./docs/manual/zh-TW.md)** — the player manual (English primary, Traditional Chinese).
- **[docs/AGENT-BRIDGE.md](./docs/AGENT-BRIDGE.md)** — let a terminal agent (Claude Code / Codex) play the game in your open tab; protocol, action vocabulary, snapshot shape.

## Tech Stack

- **[Vite](https://vitejs.dev/)** — dev server and bundler
- **[TypeScript](https://www.typescriptlang.org/)** (strict) — game logic and deterministic simulation
- **[PixiJS v8](https://pixijs.com/)** — WebGL / WebGPU rendering
- **[Web Audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)** — procedural sound and adaptive music
- **[pnpm](https://pnpm.io/)** — package manager
- **[Vitest](https://vitest.dev/)** — unit tests + heuristic balance autoplay
- **[Playwright](https://playwright.dev/)** — headless E2E playtest, the offline audio check, and the render perf probe
- **[ESLint](https://eslint.org/) + [Prettier](https://prettier.io/)** — linting and formatting

## Getting Started

```bash
pnpm install       # install dependencies (npm also works — swap pnpm for npm run)
pnpm dev           # start the Vite dev server (http://127.0.0.1:5173)
pnpm typecheck     # tsc --noEmit (must pass)
pnpm lint          # eslint (must be clean)
pnpm test          # Vitest: sim, model-data, economy, forecast, UI-helper and audio unit tests + the balance autoplay
pnpm build         # tsc + vite production build
pnpm preview       # serve the built dist on :4173
pnpm e2e           # headless Playwright playtest of the built game, both languages × both modes (needs preview running)
pnpm audio:check   # offline loudness / clipping regression of the shipped mix in headless Chrome (--json, --wav DIR)
pnpm bridge        # agent bridge relay on :8799 — let a terminal agent play your open tab
pnpm format        # prettier --write .
```

Developer tools:

```bash
pnpm build && node scripts/perf-probe.mjs [--wave 85] [--stress] [--swift] [--budget 4]   # late-game frame-time probe
node scripts/agent-smoke.mjs http://127.0.0.1:5173/   # drive a real tab through the bridge (needs pnpm dev)
# URL flags: ?agent=1 (agent mode) · dev-only ?fxgallery=1 (board FX gallery) · ?soundboard (cue audition) · ?perf=1 (frame-time overlay)
```

The model data pipeline (only needed when adding or refreshing models; [AGENTS.md](./AGENTS.md) §3 has the full procedure):

```bash
node scripts/arch-sync.mjs fetch|extract|verify|build   # Hugging Face config.json → data/model-arch.json → src/sim/roster.arch.generated.ts (HF_TOKEN for gated repos)
node scripts/thinking-sync.mjs fetch|verify|report      # chat-template evidence for each checkpoint's thinking support (data/model-thinking.json)
node scripts/aa-sync.mjs snapshot|bridges|build|report|catalog|table   # Artificial Analysis → data/aa-*.json → src/sim/roster.bench.generated.ts (AA_API_KEY in .env)
node scripts/gen-roster.mjs                             # the generated candidate pool (src/sim/roster.generated.ts)
node scripts/roster-report.mjs pareto|catalog|table     # regenerate docs/PARETO.md and the MODEL-CATALOG roster lines
node scripts/resolve-arch.mjs guess|validate            # fallback architecture resolver for a gated or missing config
```

`verify` checks the committed data against the downloaded files and fails while anything is left unchecked (pass
`--allow-uncached` to accept a gated repo). The three generated `src/sim/roster.*.ts` files need no download to check:
`pnpm test` rebuilds them from `data/` and fails if they are stale.

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
`https://jacoblincool.github.io/GPTD/?agent=1` (or clicking **AGENT MODE** on the
title screen) shows an in-game panel with a one-liner to paste to their agent (it
downloads the relay — `bridge.mjs`, served from the same origin — and runs it).
Open with `?agent=auto` to get a random relay port so **several agents can play
different games at once on one machine**. See
**[docs/AGENT-BRIDGE.md](./docs/AGENT-BRIDGE.md)** for the player flow, full
protocol, action vocabulary, and snapshot shape.

## Project Structure

```text
GPTD/
├─ .github/workflows/
│  └─ pages.yml        # required gates (typecheck, lint, test) + Vite build + GitHub Pages deployment
├─ index.html
├─ vite.config.ts       # build + Vitest config
├─ tsconfig.json
├─ eslint.config.js
├─ src/
│  ├─ main.ts           # bootstrap: PixiJS Application, fixed-timestep loop, resize, dev flags
│  ├─ game.ts           # orchestrator: sim + render + audio + UI, input and hotkeys, the state machine, demo + agent hooks
│  ├─ config.ts         # layout, palette, and balance / physics constants (CREDIT_USD, SIM_TIME_SCALE, LAT_CLASS_SLO, …)
│  ├─ mode.ts           # Normal/Expert display mode (presentation-only; the sim never branches on it)
│  ├─ outcomes.ts       # OUTCOME_STYLE: one colour / glyph / sound / label per request outcome, shared by FX, HUD, reports, audio
│  ├─ settings.ts       # the player settings store (audio, accessibility, gameplay)
│  ├─ achievements.ts   # achievement definitions + tracker (reads the event stream; the sim never imports it)
│  ├─ tutorial.ts       # Codex onboarding + contextual tips
│  ├─ core/             # seeded RNG + shared types (the unified data model)
│  ├─ sim/              # deterministic simulation (the only unit-tested gameplay layer)
│  │  ├─ content.ts     # data-driven content: REQUEST_TYPES, hardware, ROSTER/MODEL_DEFS, METHOD_RECIPES, INFRA_NODES, TOWER_DEFS, WAVES, INCIDENTS
│  │  ├─ roster.*.generated.ts # generated model data: the candidate pool, architecture (MODEL_ARCH), benchmark cells (AA_BENCH)
│  │  ├─ calibrate.ts   # benchmarks → qualityBy curves, thinking budget, the frontier-tolerance roster gate
│  │  ├─ campaign.ts    # WaveTheme types + buildWave/buildCampaign + the difficulty curve (era token growth, step caps, contract)
│  │  ├─ campaign-data.ts # the 100 authored real-history waves
│  │  ├─ models.ts      # resolveModel / deriveQuality / deriveModel (the Post-Training Studio engine)
│  │  ├─ effects.ts     # serving physics getters: roofline, model-parallel groups, batching, KV/VRAM, weight formats, guard latency
│  │  ├─ combat.ts      # routing, cache, admission, prefill/decode per rack, answer quality, layer-1 safety
│  │  ├─ guards.ts      # guardrail screening by lane coverage (layer 2)
│  │  ├─ safety.ts      # guardrail recall / over-refusal / novel attacks, layer-1 self-handling
│  │  ├─ resolve.ts     # the seven terminal outcomes: pay, meters, ledgers, the outcome event
│  │  ├─ spawn.ts · movement.ts · pathing.ts # request spawning, lane movement + leaks, the board's lanes
│  │  ├─ power.ts       # real-watt power/cooling pools, brownout, throttle, the liquid-cooling gate
│  │  ├─ research.ts    # multi-track R&D (infra / post-training / eval) on racks lent from serving; applyInfraEffects
│  │  ├─ preview.ts     # the read-only next-wave preview (mix, tokens, hazards, surge lane, projected bill)
│  │  ├─ loadForecast.ts # the shared mixed-load forecast behind the deploy picker's ★, readiness, and the demo
│  │  ├─ demo.ts        # the production autoplay heuristic (the Demo button and the balance test)
│  │  ├─ endless.ts     # procedural surges past wave 100, resuming at its load
│  │  ├─ telemetry.ts   # waveStats / lastReport (Goodput, SLO attainment, ledgers, $/Mtoken)
│  │  ├─ state.ts       # createState
│  │  ├─ sim.ts         # step(): one fixed timestep + wave/incident/economy/win-lose logic
│  │  └─ actions.ts     # player actions (build, sell, deploy, upgrade rack, weight format, research, start wave, endless)
│  ├─ render/           # PixiJS board: world, lanes, racks, requests, token streams, Trust Core, FX, popups, banners, procedural textures; dev FX gallery + perf overlay
│  ├─ audio/            # procedural Web Audio: engine, director (events → cues), mixer, voice manager, recipes, cue catalog, adaptive music, ambience, UI sounds; dev soundboard + offline level-check harness
│  ├─ ui/               # HUD, build bar, inspect panel + deploy picker, NEXT WAVE card, wave report, request inspector, model overview + lineage, Training Lab + Studio, telemetry, notifications, hotkey sheet (help.ts), denied reasons, system menu + settings, Codex + chat assistant, zh-TW line breaking, theme kit
│  ├─ ai/               # the Codex chat assistant's game context + a bring-your-own-key OpenAI client
│  ├─ agent/            # agent bridge tab-side: connector.ts (dials out), snapshot.ts (JSON-safe /state), diagnose.ts (why a move was rejected)
│  └─ i18n/             # translation system (en + zh-TW)
├─ public/              # served verbatim: bridge.mjs (the zero-dep agent relay, downloadable on hosted builds)
├─ data/                # model data: Artificial Analysis snapshots (frozen reference + latest) and fits (aa-bridges.json),
│                       # model-arch.json (Hugging Face config.json facts), model-thinking.json (chat-template thinking support),
│                       # roster-aa-map.json (benchmark pins by Artificial Analysis UUID)
├─ docs/                # all documentation (see docs/README.md for the index)
│  ├─ README.md         # docs index: every doc, its audience, and its purpose
│  ├─ DESIGN.md         # canonical Game Design Document (readable design of record)
│  ├─ BLUEPRINT.md      # authoritative design spec (data model, serving spine, SLO physics)
│  ├─ MATH.md           # every formula, constant, and variable the sim uses
│  ├─ REFERENCE-DOSSIER.md # real-world grounding: GPU specs, model figures, benchmark numbers
│  ├─ REALISM.md · REALISM-MODELS.md # realism ledgers (mechanic → real-world basis)
│  ├─ MODEL-CATALOG.md · PARETO.md # fact-checked model reference + the generated roster analysis
│  ├─ SYSTEM-MENU.md    # system menu, settings, browsers, persistence
│  ├─ AGENT-BRIDGE.md   # let a terminal agent play your open tab (protocol + snapshot shape)
│  └─ manual/           # player manual: en.md, zh-TW.md, README.md (language index)
├─ AGENTS.md            # contributor working rules (kept at repo root for agent discovery)
├─ tests/               # Vitest: sim, metrics, models, economy, preview, forecast, panels, audio, render, i18n, achievements, agent, cjkWrap units + playthrough (balance autoplay)
└─ scripts/             # model data pipelines (aa-cells/aa-sync, arch-sync, thinking-sync, gen-roster, roster-report, resolve-arch),
                        # screenshot.mjs (E2E playtest), audio-check.mjs, perf-probe.mjs, agent-smoke.mjs (bridge E2E)
```

The `.cache/hf/` folder (gitignored) holds the Hugging Face files the architecture and thinking pipelines fetch. The balance test in `tests/playthrough.test.ts` is a depth gate, not a victory check: the production demo must get deep into the gauntlet on every gate seed and still be knocked out before the end, a naive build must fall early, and a fleet strong enough for the final wave must clear the first endless surges.

> All art and audio are generated procedurally at runtime — there are no binary asset files to ship.

## Contributing

GPTD's simulation is meant to stay defensible in front of inference engineers — challenge every change against [docs/REALISM.md](./docs/REALISM.md) §0 (directional fidelity) and propagate any mechanic/content/UI change to every doc and locale it touches (see [AGENTS.md](./AGENTS.md) §0). Ideas, balance questions, and mechanic critiques are all welcome.

## License

[MIT](./LICENSE)
