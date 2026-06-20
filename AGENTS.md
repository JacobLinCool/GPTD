# AGENTS.md — working rules for this repo

This file is the contract for any agent or contributor changing **GigaPrompt Tower Defense (GPTD)**. Read it before editing. Its purpose is to keep the code, the docs, and the player-facing copy from ever drifting out of sync.

---

## 0. The golden rule — nothing goes stale

**Any change to behaviour, content, mechanics, balance, or UI text MUST be propagated to every document and locale it touches, in the same change.** A PR that updates the game but leaves the manual or design doc describing the old behaviour is incomplete.

When you change code, ask: *who describes this?* Then update all of them:

| If you change… | Also update… |
| --- | --- |
| A mechanic / serving rule / failure mode (any of the six outcomes) | `docs/BLUEPRINT.md` is the authoritative design spec and `docs/REFERENCE-DOSSIER.md` the real-world grounding — **cite them, do not contradict them**; `docs/DESIGN.md` (the canonical GDD — keep it current), `docs/manual/*.md`, in-game tutorial/tooltips if affected |
| A roster model (add/edit/correct) | **`docs/MODEL-CATALOG.md`** first (the fact-checked source-of-truth: real developer/release/license/link/benchmarks/lineage), then `ROSTER`; the **i18n strings** if the display name needs localizing |
| A request archetype / hardware / infra node / post-training recipe / guardrail / wave / incident (stats, cost, behaviour) | `docs/manual/*.md` tables, and the **i18n strings** for its name/description (both languages); confirm `docs/BLUEPRINT.md` still describes it correctly |
| The wave campaign (count, order, names) | `docs/manual/*.md`, the in-game menu/HUD copy |
| Any **player-facing string** | **both** `src/i18n/en.ts` and `src/i18n/zh-TW.ts` (never hardcode — see §4), and the manuals if they quote it |
| Controls / keybindings | `docs/manual/*.md` controls table, the in-game tutorial (Codex) |
| Tech stack / scripts / structure | `README.md` |

Docs in this repo and who they serve. **All documentation lives in `docs/`** (the player manual in `docs/manual/`); `README.md` and this `AGENTS.md` stay at the repo root. See `docs/README.md` for the index.

- **`docs/BLUEPRINT.md`** — the **authoritative design spec** (§0–§7: the unified data model, the serving spine, dual-clock/SLO physics, every subsystem). This is the single source of truth for current mechanics — **cite it, never contradict it**. The CODE is the ultimate truth; verify specifics against `src/sim/**` and `src/core/types.ts`.
- **`docs/REFERENCE-DOSSIER.md`** — the **real-world grounding** (real GPU specs, model figures, public benchmarks, serving-systems literature) the sim is calibrated against. The blueprint's `§ref` citations resolve here.
- **`docs/DESIGN.md`** — the **canonical Game Design Document** (the readable design of record). The blueprint is the deeper implementation spec; keep DESIGN.md current whenever a shipped behaviour shifts.
- **`docs/MATH.md`** — the math reference (every formula/constant/variable, extracted from the code). Refresh it when a formula or constant changes in `src/sim/**` or `src/config.ts`.
- **`docs/MODEL-CATALOG.md`** — the fact-checked model-roster reference (real developer/release/license/link/benchmarks/lineage) that `ROSTER` is drawn from.
- **`docs/REALISM.md`** — the realism ledger (mechanic → real-world basis, citations, known deviations), reconciled to the current code; `docs/REFERENCE-DOSSIER.md` holds the underlying citations. The sim is meant to be defensible in front of LLM-infra professionals (the slogan: *"the board is the metaphor, the numbers are real"*) — challenge every new technique against its real-world tradeoff directions.
- **`docs/manual/en.md`** — the player guide, **English (primary)**.
- **`docs/manual/zh-TW.md`** — the player guide, **Traditional Chinese (正體中文/台灣)**. Keep it in step with the English one.
- **`docs/AGENT-BRIDGE.md`** — the agent bridge: how a terminal agent (Claude Code / Codex) drives an already-open game tab over a localhost relay, the HTTP API, action vocabulary, and `/state` snapshot shape. Keep in sync with `public/bridge.mjs`, `src/agent/**`, and `Game.agentAct`/`agentSnapshot`.
- **`README.md`** (repo root) — developers landing on the repo. Stack, scripts, structure, links.

> If you are unsure whether a doc needs updating, it probably does. Grep for the term you changed across `*.md` and `src/i18n/`.

---

## 1. Run / build / test

```bash
pnpm install        # once
pnpm dev            # dev server (http://127.0.0.1:5173)
pnpm typecheck      # tsc --noEmit (must pass)
pnpm lint           # eslint (must be clean)
pnpm test           # vitest: sim unit tests + balance autoplay
pnpm build          # tsc + vite build (must pass)
pnpm preview        # serve the built dist on :4173
pnpm e2e            # headless Playwright playtest of the built game (needs preview running)
```

**Definition of done for any change:** `typecheck`, `lint`, `test`, and `build` all green, plus the doc updates from §0.

---

## 2. Architecture (where things live)

```
src/
  config.ts        layout, palette, and BALANCE CONSTANTS (CREDIT_USD, SIM_TIME_SCALE, LAT_CLASS_SLO, LANE_SPEED, START, …)
  mode.ts          Normal/Expert display mode (presentation-only; sim must NOT import/branch on it)
  core/            seeded RNG + shared types (the unified data model, §7 of the blueprint)
  sim/             DETERMINISTIC simulation — the only layer that is unit-tested
    content.ts     data-driven content: REQUEST_TYPES (9 archetypes), HARDWARE_DEFS (real GPU ladder), ROSTER/MODEL_DEFS, METHOD_RECIPES, INFRA_NODES, RESEARCH_DEFS, TOWER_DEFS (incl. guardrails), WAVES (=buildCampaign(CAMPAIGN_THEMES)), INCIDENTS, themedIncidentForWave
    campaign.ts    WaveTheme types + buildWave/buildCampaign (theme→WaveDef) + the tier* difficulty knobs (the WHOLE 100-wave curve is tuned here) + themedIncidentId
    campaign-data.ts  the 100 authored real-history waves (the theme table; generated from the timeline-research workflow, then balance-tuned)
    models.ts      resolveModel / deriveQuality / deriveModel — the Post-Training Studio engine (derived checkpoints + lineage)
    effects.ts     real roofline (prefill/decode), KV/VRAM budget, quality matching, infra-effect + $/Mtoken getters
    combat.ts      routing, cache aura, two-layer safety, server processing, serve resolution (six outcomes)
    safety.ts      guardrail recall / over-refusal, layer-1 intrinsic self-handling
    power.ts       real-watt power/cooling capacity, brownout, throttle, liquid-cooling gate
    research.ts    multi-track R&D (infra / post-training / eval) on a shared compute pool; applyInfraEffects
    endless.ts     procedural surges past wave 100 with climbing difficulty
    telemetry.ts   waveStats / lastReport (Goodput, TTFT/E2EL attainment, $/Mtoken)
    sim.ts         step(): orchestrates one fixed timestep + wave/incident/win-lose logic
    actions.ts     player actions (build, sell, deploy, upgrade rack, research, start wave, continue endless)
  render/          PixiJS: procedural pixel textures, world, FX (no game rules here)
  audio/           procedural Web Audio engine
  ui/              TopBar/HUD, build bar, inspect panels, LiveOps, model overview, lineage, TechLab+Studio, metrics, tooltips, charts, Codex, theme kit
  i18n/            translation system (see §4)
  tutorial.ts      Codex onboarding + contextual tips
  game.ts          orchestrator: wires sim + render + audio + ui, the state machine
  main.ts          bootstrap (PixiJS Application, fixed-timestep loop, resize)
tests/             vitest: sim.test.ts + metrics.test.ts (units) + playthrough.test.ts (balance autoplay)
scripts/           screenshot.mjs (headless E2E playtest)
```

### Non-negotiable invariants

- **The sim is deterministic.** `src/sim/**` must not use `Date.now()`, `Math.random()`, or wall-clock. Use the seeded `RNG` from `core/rng.ts`. Same seed + same inputs ⇒ identical results (a test asserts this).
- **The sim has no PixiJS / DOM imports.** Rendering, audio, and UI read sim state; they never own game rules.
- **Content is data-driven.** Add/balance request archetypes, hardware tiers, the model roster, post-training recipes, infra/eval research nodes, guardrails + other towers, and incidents by editing the `src/sim/content.ts` tables — not by branching logic elsewhere. **Waves live in `campaign-data.ts`** (the 100-row real-history theme table) and are expanded into `WaveDef`s by `campaign.ts`; the whole difficulty curve is tuned from the `tier*` knobs in `campaign.ts`. `qualityBy` is never hand-edited (it is auto-calibrated from benchmarks in `calibrate.ts`).
- **Display mode is presentation-only.** Normal/Expert mode lives in `src/mode.ts`; `src/sim/**` must never import or branch on it. The sim always collects its telemetry (`sim/telemetry.ts`, `waveStats` / `lastReport`) — Expert Mode merely chooses to show it. Both modes must stay winnable by definition, because they are the same game.
- **`RealModelMeta` (`m.real`) is display-only — the sim must never read it.** A model's real-world provenance (developer/license/release/`benchmarks`) lives on `ModelDef.real` purely so Expert Mode can show where a checkpoint came from. `qualityBy` is derived from those benchmarks once, at load, in `calibrate.ts`; the running sim reads only the calibrated `qualityBy` / arch fields, never `m.real`. Keeping it inert preserves both the determinism and the `sim/** must not import mode.ts` invariants.
- **Base models are free open weights; derived models are minted, not bought.** The 42 active roster checkpoints (frontier-tolerance-gated by `withinFrontierTolerance` from a ~98-model candidate pool: 30 hand-authored from the fact-checked `docs/MODEL-CATALOG.md` + 68 Pareto-selected in `roster.generated.ts`; see `docs/PARETO.md`) are owned from turn one and gated only by rack VRAM fit (it must hold `paramsTotalB`). Post-training in the Studio derives NEW named checkpoints into `s.derivedModels`, resolved via `resolveModel(s, id)`; a run costs Data up front and then GPU compute (the posttrain research track requisitions the strongest racks during waves, `sim/research.ts`). Never bill cash for deploying a checkpoint.
- **Directional fidelity.** Every technique ships its real-world tradeoff *directions*: numbers may be tuned for gameplay, but a real cost (power, VRAM, quality, latency) may be softened, never deleted — and benefits reality does not grant may not be invented. This is the slogan made law (*"the board is the metaphor, the numbers are real"*); challenge every new model / infra node / recipe / guardrail against `docs/BLUEPRINT.md` + `docs/REFERENCE-DOSSIER.md`.
- **The campaign is a 100-wave elimination gauntlet; difficulty never plateaus.** Waves 1–100 are authored (`campaign-data.ts`, real 2023→2026 history) with monotonically rising tier (1→12), so the run is *meant* to end mid-campaign for all but the apex play; clearing wave 100 (*The Age of Inference*) flips to endless mode, which generates surges procedurally (`sim/endless.ts`) with difficulty/volume/reward climbing per wave, seeded from the run's RNG so playthroughs stay reproducible. The model tree caps at 2T — every run is *supposed* to end eventually. The autoplay gate is therefore DEPTH + system-usage, not victory (`tests/playthrough.test.ts`, `GAUNTLET_FLOOR`).

---

## 3. How to make common changes

Everything below is a data edit in `src/sim/content.ts` (or `campaign-data.ts` for waves) against the types in `src/core/types.ts` — verify field shapes there. After **any** of these, re-run the full gate (§5); the autoplay in `tests/playthrough.test.ts` must still reach the gauntlet floor and exercise the systems (it is an elimination gauntlet — the bot is NOT expected to "win", only to get deep by playing well).

- **Add a request archetype:** add a `RequestTypeDef` to `REQUEST_TYPES` (stable `id`). It is defined by workload physics, not a costume: set `inputTokens` / `outputTokens` (the prefill/decode cost basis), `latClass` (`IN` 400/40 · `NR` 2000/200 · `TO` no-SLO; optional `ttftSloMs` / `e2elSloMs` overrides), `primaryAxis` (the `CapabilityAxis` combat judges) + a `difficulty` vector (per-axis threshold), `prefixShare` (cache friendliness), `cacheable`, `pricePerMtokIn` / `pricePerMtokOut` (real `$/Mtoken` income), and — if adversarial — a `hazards: SafetyProfile` (hazard→severity) the two-layer safety checks. There is **no scalar `complexity`** and no `affinity`/`thematic` field. Add `req.<id>.name` / `req.<id>.desc` to **both** locales; reference it from a wave's `mix` in `campaign-data.ts`; update the manuals.
- **Add a hardware tier:** add a real-GPU entry to `HW_SPECS` (per-GPU `bf16TflopsPerGpu` / `fp8TflopsPerGpu` / `hbmGbPerGpu` / `hbmTbsPerGpu` / `tdpWattsPerGpu`, `gpus`, `cooling: 'air' | 'liquid'`, `capexUsd`, `gpuHrUsdPerGpu`); the loader fills the aggregate fields and `cost = capexUsd/1000`. Insert its id into `HARDWARE_TIERS` for the in-place upgrade ladder. A `liquid` tier is HARD-gated behind a Liquid Cooling Loop facility (`power.ts`). Wire it to a buildable rack via a `TOWER_DEFS` entry (`hardwareId`).
- **Add a model:** Model benchmarks come from the **Artificial Analysis API** via `scripts/aa-sync.mjs` — they are NOT hand-typed. To add or refresh a model: (a) add its AA slug to **`data/roster-aa-map.json`** (the curated join map — pinned by slug because AA exposes many variants per model, so the slug is what fixes the right one); (b) run `node scripts/aa-sync.mjs snapshot && node scripts/aa-sync.mjs build` to regenerate **`src/sim/roster.bench.generated.ts`** (the AA-sourced bench cells); (c) add the `RosterEntry` to `ROSTER` in `content.ts` with the hand-authored fields AA does NOT provide — architecture (`paramsTotalB` for VRAM, `paramsActiveB` for compute, `layers` / `kvHeads` / `headDim` / `attn`), `license` / `openWeights` / `contextWindow`, `alignment` (an `AlignmentProfile` for layer-1 safety), `lineage`, and `desc` — plus a `bench` overlay that fills any cells AA lacks (the newest frontier often lacks `mmlu_pro` / `livecodebench`; `content.ts` merges AA **over** the manual `bench`, so the manual entry only fills the gaps AA leaves). The loader calls `qualityFromBenchmarks` to produce the 5-axis `qualityBy` — **never hand-write `qualityBy`** (that breaks the calibration invariant). Keep `docs/MODEL-CATALOG.md` as the fact-checked human reference (developer / release / official link / lineage / `confidence`; refreshed by the `gptd-model-catalog` + `gptd-newest-models` research workflows). The model's proper name + `desc` live in the roster (canonical English); the `model.<id>.*` keys are the localization hook (real product names usually stay in English, so most are intentionally untranslated). Update the manuals. There are no fixed finetuned model cards — players mint derived checkpoints in the Studio.
- **Add an infra tech:** add an `InfraNodeDef` via `infra({…})` in `INFRA_NODES` with an `InfraCategory`, a flat `effects` bag that `applyInfraEffects` (`sim/research.ts`) folds into typed `s.infra`, `requires` / optional `conflicts` (e.g. chunked ⟂ disagg), `dataCost` + `compute`. Each node auto-becomes a `ResearchDef` on the infra track. Read the new switch in the `effects.ts` serving getters off `s.infra` (never `s.upgrades`). Note: GQA/MLA/MoE/reasoning are MODEL properties, not research nodes, so they are not gated by a deploy node. Add `research.<id>.name` / `research.<id>.desc` locale strings (infra nodes render through the research panel).
- **Add a post-training method:** add a `MethodRecipe` to `METHOD_RECIPES_RAW` (`relation`, `allowedTargets`, `costData` / `costCompute`, the autoplay-calibratable `gainScale` / `gainCap` / `taxScale` / `forgetScale`, `reshapesDeployment`, and `requiresTech` pointing at a `pt_*` unlock). Add the matching unlock `ResearchDef` via `tech(...)` on the infra track. The Studio engine (`sim/models.ts` `deriveQuality` / `deriveModel`, started by `startPostTrain`) does the rest. Add `method.<id>` locale strings.
- **Add a guardrail or other tower:** add a `TowerDef` to `TOWER_DEFS` and an id to `BUILD_ORDER`. A guardrail carries a `GuardrailSpec` (`archetype` encoder/generative/moderation, `side` input/output/both, `catches: SafetyHazard[]`, `baseRecall`, and either a fixed `checkLatencyMs` or `runsOnRoofline: true` + `guardParamsActiveB` / `guardHardwareId` to run a real inference on its own tile). A new `kind` must be handled in `combat.ts` / `power.ts`, the inspect panel (`ui/panels.ts`), and a texture in `render/textures.ts`. Add `tower.<id>.*` locale strings.
- **Tune model-intrinsic safety:** edit a model's `AlignmentProfile` (`safety`, `refusalStyle`, `overRefusal`) in the roster — or, in-game, that is what the Studio's safety-targeted recipes (rlhf / cai / safety-SFT) modify. The alignment tax and serve-time self-handling live in `sim/safety.ts` / `effects.ts`.
- **Add / edit a wave:** edit the `CAMPAIGN_THEMES` row in `campaign-data.ts` (a `WaveTheme`: `era` / `name` / `realEvent` / `brief` / `teaches` / `mix` of `{typeId, weight}` / `volume` band / `tier` 1–12 / optional `special` / `boss`). `buildWave` (`campaign.ts`) expands it into a `WaveDef`; tune the OVERALL difficulty via the `tier*` knobs in `campaign.ts`, not per-wave spawn tables. Keep `tier` monotonically non-decreasing. Add `wave.<index>.name` / `wave.<index>.brief` to **both** locales (0-based index); **re-run `pnpm test`** — the autoplay must still reach `GAUNTLET_FLOOR`. Update the manuals' campaign section.
- **Add an incident:** edit `INCIDENTS` (a `mods` multiplier bag + optional `instant` one-shot + optional `concentrate` lane-funnel) — all applied live by `applyIncident` in `sim.ts` (during the build phase + the wave). To make a real-event wave force its signature incident, map its `special` → the incident id in `themedIncidentId` (`campaign.ts`); otherwise it joins the seeded random roll. Add `inc.<id>.name` / `inc.<id>.desc` locale strings; update the manuals. There are no cash upgrades — `UPGRADE_DEFS_RAW` is empty. Serving/safety improvements live in the `s.infra` research tree and the Studio.
- **Retune balance:** edit constants in `config.ts` / `content.ts` (e.g. the documented `OP_COST_SCALE` / `TRAFFIC_SCALE` calibration constants, the recipe gain/cost table). The autoplay test is the guard — if it can no longer win, you made the game unwinnable, not the test wrong.

---

## 4. Internationalization (i18n)

The app and manuals are multilingual. **Default language is English; Traditional Chinese (`zh-TW`) is the second.**

- **Never hardcode a player-facing string.** All UI text goes through `t(key, params?, fallback?)` from `src/i18n`. Add the key to **both** `src/i18n/en.ts` and `src/i18n/zh-TW.ts`.
- **Content** (request/tower/wave/incident/upgrade names & descriptions) keeps its canonical English in `src/sim/content.ts`; the display helpers fall back to it when a locale key is missing, so the English entries in `content.ts` are the source of truth for English. Add the `zh-TW` translations under the matching `*.<id>.*` keys in `src/i18n/zh-TW.ts`.
- Keep established term choices consistent with `docs/manual/zh-TW.md` (e.g. some technical terms stay in English: `SLA`, `GPU`, `Router`, `Cache`).
- Switching language at runtime must update the UI live (most text is re-read from `t()` each frame). The language toggle persists to `localStorage` (`gptd_lang`).
- **The manuals are separate files**, not generated: `docs/manual/en.md` (English) and `docs/manual/zh-TW.md`. Update both when content changes.

---

## 5. Verification checklist (before you call it done)

1. `pnpm typecheck` — clean.
2. `pnpm lint` — clean.
3. `pnpm test` — all pass, **including the autoplay winning the full campaign**.
4. `pnpm build` — succeeds.
5. Docs updated per §0 (consistent with `docs/BLUEPRINT.md` + `docs/REFERENCE-DOSSIER.md`; DESIGN.md header note, README, both manuals, both locales).
6. If UI changed: `pnpm preview` + `pnpm e2e` (or a manual screenshot) to confirm it renders — ideally in **both** languages.
