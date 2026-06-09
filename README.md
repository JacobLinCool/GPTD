# GigaPrompt Tower Defense

> Serve the flood. Defend the Trust Core. Don't let a single request leak.

![status](https://img.shields.io/badge/status-in--development-yellow)
![license](https://img.shields.io/badge/license-MIT-blue)
![Vite](https://img.shields.io/badge/Vite-646CFF)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)
![PixiJS](https://img.shields.io/badge/PixiJS-v8-E91E63)

**GigaPrompt Tower Defense** (GPTD) turns the real tension of running an AI-serving platform into real-time tower-defense decisions. Waves of user requests advance down the lane carrying deadlines, complexity, and safety risk — you don't kill them, you serve them fast, cheaply, correctly, and safely before they leak through. Models are your trainable ammunition, GPUs are your towers, and power and cooling are hard constraints you must physically provision. Every routing call, training investment, and rack placement is a tradeoff felt under live wave pressure, with three independent health bars in constant tension.

## Concept

- **Requests are enemies** — a flood of user requests advances down the lane carrying Work Required, Latency Deadline, Complexity, Safety Risk, Context Length, and Reward. They are served, never killed.
- **Models are weapons** — trained Model cards (Small / General / Frontier) loaded into Serving Towers decide how fast, correct, and safe your answers are.
- **GPUs are towers** — GPU Racks supply the inference throughput, but fire only when powered, cooled, networked, and loaded with a Model.
- **Power and cooling are constraints** — every rack must be provisioned or it Brownouts and Thermal Throttles itself useless.
- **Routing is the skill** — a good Router sends each request to the cheapest capable destination instead of brute-forcing everything through the Frontier.

```text
[Users]
   │
   ▼
API Gateway ──► Router ──► Inference ──► Safety ──► Response ──► Trust Core
                  │            │
                  │            ├── Cache / RAG
                  │            └── Model Serving (GPU Racks)
                  │
             Data / Training Lab
```

## Design Pillars

- **Requests are the enemies** — you do not kill demand, you serve it before it leaks.
- **Models are your weapons** — trainable stat-card ammunition loaded into Serving Towers, not towers themselves.
- **GPUs are your towers** — inference throughput that only fires when powered, cooled, networked, and loaded with a Model.
- **Power and cooling are hard constraints** — every Rack you place must be provisioned or it Brownouts and Throttles itself useless.
- **Data is upgrade material** — Raw Data is a dirty faucet, Clean Dataset is the safe input, and cleaning is a term in the quality formula.
- **Training is a tech tree** — between waves you reshape Model cards along four competing research paths that share the same resources.
- **Trust, SLA, and Cash Runway are three simultaneous health bars** — any one hitting zero ends the run, so they are always in tension.
- **Routing is the skill** — two players with identical buildings post wildly different results based purely on how well their Router sorts traffic.

## Gameplay Loop

1. **Build** — buy GPU Servers, raise Power and Cooling capacity, and place your Router, Cache, and Safety Gate.
2. **Train** — spend Clean Dataset, Compute Hours, and Cash in the Training Lab to reshape Model cards (Fine-tune, Distill, RLHF, Quantize).
3. **Survive the wave** — a themed flood of Requests arrives; the Router assigns each one, Serving Towers deplete the Work Required, and Safety Gates clear risky traffic.
4. **Handle an incident** — a random between-wave disaster (power-price spike, cooling failure, GPU shortage, bad dataset, model regression, bot swarm) attacks one axis and tests your build's flexibility.
5. **Repeat** — served requests pay out Cash and Data to fund the next, bigger wave.

The full loop: serve users → earn money and data → clean data → train models → improve serving → survive bigger waves.

## How It Plays

You watch a data-center lane fill with incoming Requests and make assignment and provisioning calls in real time. Place and wire GPU Servers, Power Plants, and Cooling Towers; tune the Router so cheap Small Models soak Simple Chat while the Frontier handles Reasoning; drop a Cache **over your servers** to auto-answer repeat traffic and a Safety Gate ahead of Jailbreaks. Click a building to inspect and upgrade it, open the Training Lab to retrain your Models between waves, and keep an eye on the HUD's three meters — **Trust**, **SLA**, and **Cash Runway** — plus the live Power and Heat capacity bars. The moment any one meter bottoms out, the run is over.

**Codex**, your on-call SRE, walks you through your first wave and pops up contextual tips (brownouts, throttling, jailbreaks). The campaign runs **20 escalating waves**, from Launch Day to the **Singularity Night** boss.

## Tech Stack

- **[Vite](https://vitejs.dev/)** — dev server and bundler
- **[TypeScript](https://www.typescriptlang.org/)** (strict) — game logic and deterministic simulation
- **[PixiJS v8](https://pixijs.com/)** — WebGL / WebGPU rendering
- **[Web Audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)** — sound and music
- **[pnpm](https://pnpm.io/)** — package manager
- **[Vitest](https://vitest.dev/)** — unit and smoke testing
- **[ESLint](https://eslint.org/) + [Prettier](https://prettier.io/)** — linting and formatting

## Getting Started

> [!NOTE]
> A playable browser build is **under active development**. The commands below are the real workflow; some may move or grow as the MVP milestones (see [Roadmap](#roadmap)) land.

```bash
pnpm install   # install dependencies
```

```bash
pnpm dev       # start the Vite dev server
```

```bash
pnpm build     # produce a production build
```

```bash
pnpm test      # run the Vitest suite
```

## Project Structure

```text
GPTD/
├─ index.html
├─ vite.config.ts       # build + Vitest config
├─ tsconfig.json
├─ eslint.config.js
├─ src/
│  ├─ main.ts           # bootstrap: PixiJS Application, fixed-timestep loop, resize
│  ├─ game.ts           # orchestrator: sim + render + audio + UI, state machine
│  ├─ config.ts         # layout, palette, and balance constants
│  ├─ core/             # seeded RNG + shared types
│  ├─ sim/              # deterministic simulation: content tables, combat, power, economy
│  ├─ render/           # PixiJS layer: procedural pixel textures, world, FX
│  ├─ ui/               # HUD, build bar, inspect/training/overlay panels, theme kit
│  └─ audio/            # procedural Web Audio engine (SFX + chiptune)
├─ tests/               # Vitest: sim unit tests + heuristic full-campaign autoplay
└─ scripts/             # headless Playwright E2E playtest + screenshots
```

> All art and audio are generated procedurally at runtime — there are no binary asset files to ship.

## Documentation

The complete design spec lives in [DESIGN.md](./DESIGN.md). Key sections:

- [§4 — Enemies: The Request Taxonomy](./DESIGN.md#4-enemies-the-request-taxonomy) — Request stats and types
- [§8 — Routing: The Core Skill](./DESIGN.md#8-routing-the-core-skill) — the skill-expression mechanic
- [§10 — Inference & Serving Systems](./DESIGN.md#10-inference--serving-systems) — batching, KV cache, speculative decoding, queues
- [§11 — Training Methods & The Four Tech-Tree Paths](./DESIGN.md#11-training-methods--the-four-tech-tree-paths) — Scale, Efficiency, Safety, Product
- [§20 — MVP Scope](./DESIGN.md#20-mvp-scope) — the minimal playable subset
- [§21 — Technical Architecture](./DESIGN.md#21-technical-architecture) — sim, render, audio, content, and data-driven balance

## Roadmap

| Milestone | Goal                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M0**    | Repo scaffold and tooling — Vite + TypeScript (strict) + PixiJS v8, ESLint/Prettier, Vitest + CI, Web Audio bootstrap, and a fixed-timestep (30 Hz) loop stub with seeded RNG. |
| **M1**    | A single playable lane where Requests spawn, advance, leak, and damage the Trust Core via a basic Serving Tower, with all three meters live and losable.                       |
| **M2**    | Power and cooling constraints — GPU Server, Power Plant, Cooling Tower with Brownout and Thermal Throttling failure states.                                                    |
| **M3**    | Routing and caching — Router, Cache, and Small/General/Frontier Models turn brute serving into a smart-assignment puzzle.                                                      |
| **M4**    | Data pipeline and Training Lab — Raw Data, Clean Dataset, Compute Hours, the four training methods, and the toy Scaling Law.                                                   |
| **M5**    | Safety, threat variety, and the full economy — Safety Gate, Jailbreak/Long Context/Enterprise Requests, the money economy, and themed campaign waves.                          |
| **M6**    | Depth, incidents, and the Singularity Night boss wave, plus Speculative Decoding, RAG, advanced routing, progression, save/load, and tutorials.                                |

See [DESIGN §22](./DESIGN.md#22-development-roadmap) for the detailed item breakdown per milestone.

## Contributing

GPTD is being actively built, so it's a great time to shape it. Ideas, balance questions, mechanic critiques, and code contributions are all welcome — open an issue or start a discussion. If you want to help land an MVP milestone or argue about scaling laws, jump in.

## License

[MIT](./LICENSE)
