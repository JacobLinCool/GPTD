# GPTD Real-Model Grounding

> **Single source of truth for the model system.** GPTD's roster, capability calibration, serving footprint and thinking behaviour are grounded in **real open-weight checkpoints**, their **released configs and chat templates**, and **real public benchmarks**. The design spec is [BLUEPRINT.md](./BLUEPRINT.md) (grounded by [REFERENCE-DOSSIER.md](./REFERENCE-DOSSIER.md)); this document is the **real-model grounding view**: where every model number comes from, how it is resolved, and what it is allowed to mean. Reconciled to the current code; where this doc and the code disagree, the code wins. Companion to [REALISM.md](./REALISM.md) §1–§3.

**Code anchors.** Roster + loader: `src/sim/content.ts` (`ROSTER`, `QUALITY_FLOOR`, `DEFAULT_MODEL_ID`); benchmark → quality, the gate and the thinking budget: `src/sim/calibrate.ts`; generated tables: `src/sim/roster.bench.generated.ts` (AA cells, provenance, telemetry, instant cells), `src/sim/roster.arch.generated.ts` (architecture + thinking support), `src/sim/roster.generated.ts` (the generated half of the pool); the data: `data/aa-reference-2026-06-21.json`, `data/aa-snapshot.json`, `data/aa-bridges.json`, `data/roster-aa-map.json`, `data/model-arch.json`, `data/model-thinking.json`; the pipeline: `scripts/aa-cells.mjs`, `aa-sync.mjs`, `arch-sync.mjs`, `thinking-sync.mjs`, `gen-roster.mjs`, `roster-report.mjs`, `resolve-arch.mjs`; where the model is consumed: `src/sim/effects.ts` (fit, KV, roofline, answer mode), `src/sim/combat.ts` (judging), `src/sim/models.ts` (derived checkpoints).

---

## 0. The model system at a glance

The game needs four kinds of fact about every checkpoint, and each comes from the source that actually owns it:

| Fact | Source of truth | Generated into | Read by the sim as |
|---|---|---|---|
| **Capability** — six benchmark cells per checkpoint (and the non-reasoning row of a hybrid) | Artificial Analysis snapshots, resolved on one frozen reference scale | `roster.bench.generated.ts` (`AA_BENCH`, `AA_BENCH_INSTANT`) | `qualityBy`, `qualityByInstant`, `longCtx` |
| **Serving telemetry** — time to first token / first answer token, output speed | Artificial Analysis (the pinned thinking variant) | `AA_META` | `thinkTokens` |
| **Architecture & release** — params, KV layout, release precision, window, licence, lineage edge | each Hugging Face repo's `config.json` + safetensors metadata | `roster.arch.generated.ts` (`MODEL_ARCH`) | `paramsTotalB/ActiveB`, `kvBytesPerToken`, `kvStateMbPerReq`, `nativeWeightBytes`, `contextWindowK` |
| **Thinking support** — can thinking be switched off, and how | each repo's chat template / card / encoding script | `MODEL_ARCH.thinking` | `thinking` (always / hybrid / never) |
| **Identity & judgement** — name, lane label, alignment profile, lineage, description | hand-authored `ROSTER` (from the fact-checked [MODEL-CATALOG.md](MODEL-CATALOG.md)) or the generated pool | `content.ts` / `roster.generated.ts` | `alignment`, `instructFollow`, `lineage` |

On top of that data sit four structural mechanics:

1. **Free deploy, real fit.** Every active checkpoint is owned from turn one (open weights are a download); the gate is whether a copy fits a GPU group of the rack at its release precision (and the parallelism research a multi-GPU copy needs).
2. **`qualityBy` is calibrated, never hand-edited.** A six-cell blend through per-axis curves, on a frozen reference scale.
3. **Memory vs compute.** VRAM follows total parameters at release precision; per-token compute follows active parameters; KV follows the real per-layer layout; a batch of an MoE reads the union of its experts.
4. **Thinking is a mode, not a flag.** A hybrid answers interactive traffic instantly on its instant vector and thinks elsewhere; an always-thinker cannot answer without thinking.

Derived checkpoints the player mints in the Studio inherit all of this through one pure computation (REALISM §3).

---

## 1. How a model is judged (ground truth)

- **Correctness gate.** On a request's primary axis, each rack that generated tokens scores them with `margin = quality(model, answer mode)[axis] − PTQ tax − alignment tax − long-context penalty − difficulty`; the answer's margin is the token-weighted mean, and `< 0` is `bad` (`combat.ts marginOn` / `scoreQuality`, `effects.ts serverQualityVs`).
- **The answer mode.** `answerMode(model, request)`: `never` → instant; `always` → thinking; `hybrid` → instant on latency class `IN` (chat, code completion, jailbreak probes), thinking on everything else; a prompt-only request (an embedding) is instant. Instant answers are judged on `qualityByInstant`, thinking answers on `qualityBy`.
- **Difficulty is a per-axis line.** Each `RequestTypeDef` carries a difficulty vector and a `primaryAxis` — chat 18, code completion 56 (coding), RAG 50 / summarization 44 / batch 40 / jailbreak 38 / embed 10 (general), reasoning 82, agent 82 (agentic) — scaled +2% per campaign tier (×1.22 at tier 12).
- **Models are real and free.** The gate (§5) trims the 135-checkpoint pool to the active `MODEL_DEFS`; every active one is owned; deploying costs nothing. Derived models live in `s.derivedModels`, resolved via `resolveModel(s, id)`.
- **Display mode never touches it.** Normal and Expert run the same sim; `src/sim/**` never imports `mode.ts`; `m.real` (developer, licence, provenance) is display-only.

---

## 2. The data pipeline

Every generated file is reproducible byte for byte from committed data. The refresh order (`AGENTS.md` §3 holds the contributor SOP):

```
1. node scripts/thinking-sync.mjs fetch [repo…] && … verify   chat templates → data/model-thinking.json evidence checked
2. node scripts/arch-sync.mjs fetch [repo…] && … extract && … build
                                                              config.json → data/model-arch.json → roster.arch.generated.ts
3. node scripts/aa-sync.mjs snapshot                          latest AA pull → data/aa-snapshot.json (needs AA_API_KEY)
4. node scripts/aa-sync.mjs bridges                           equating + bridges + instant pair fit → data/aa-bridges.json
5. node scripts/gen-roster.mjs                                generated pool → roster.generated.ts (+ new g_ pins)
6. node scripts/aa-sync.mjs build                             resolved cells, provenance, telemetry → roster.bench.generated.ts
7. node scripts/roster-report.mjs pareto && … catalog         docs/PARETO.md and MODEL-CATALOG.md serving lines from the loaded roster
   node scripts/aa-sync.mjs catalog                           MODEL-CATALOG.md benchmark lines (bridged values labelled ≈)
```

- **`scripts/aa-cells.mjs`** is the shared core: snapshot loading, same-UUID equating, bridge fitting, per-cell resolution, the pin guard and the instant pair fit.
- **`scripts/gen-roster.mjs`** admits a checkpoint to the pool only on **explicit open-weight evidence** — a Hugging Face repo in `data/model-arch.json` — that no hand-authored entry claims. Its AA pin is the strongest variant among its rows (a thinking variant breaks ties), it needs the bridge predictors measured (HLE and LCR, plus SciCode or GPQA), and existing `g_` ids stay stable.
- **`scripts/roster-report.mjs`** loads the real `content.ts` through Vite's SSR loader, so PARETO.md and the catalog's `Serving —` lines are computed from the TypeScript that runs, never a re-implementation.
- **`scripts/resolve-arch.mjs`** is the fallback resolver for a gated or missing config: it drafts an architecture entry from the AA name and the catalog prose (`guess`) and validates the resolver against `data/model-arch.json` (`validate`); it also supplies the family key for the default alignment profile.
- **Adding a hand-authored model** means: an architecture record keyed by its HF repo (with its AA `{slug: uuid}` rows), a thinking-support entry with its quote, a `{slug, aaId}` pin (plus an optional `instant` pin on AA's non-reasoning row of the same checkpoint) in `data/roster-aa-map.json`, then a `ROSTER` entry carrying only what the data cannot give: `hf`, name, lane label, alignment, lineage, description, and a `bench` overlay for model-card cells AA lacks (AA cells are merged over it).

---

## 3. Capability: benchmark % → game quality

### 3.1 The blend (`calibrate.ts` BLEND)

Each axis is a weighted composite of six Artificial Analysis cells, all 0–100% metrics on the reference scale: one primary at 0.6, two secondaries at 0.2.

| Game axis | Primary (0.6) | Secondaries (0.2 each) | Why |
|---|---|---|---|
| `chat` | IFBench | GPQA-Diamond, AA-LCR | conversational quality is instruction following first |
| `general` | GPQA-Diamond | IFBench, AA-LCR | broad expert knowledge |
| `coding` | SciCode | Terminal-Bench Hard, IFBench | scientific code generation with an agentic coding signal |
| `reasoning` | Humanity's Last Exam | GPQA-Diamond, AA-LCR | HLE keeps the top unsaturated |
| `agentic` | Terminal-Bench Hard | IFBench, AA-LCR | terminal-agent skill, the axis that resisted compression longest |

The blends differentiate the axes (a strong-IFBench model leads chat while a strong-GPQA one leads general), and the composite index is never used: it re-baselines between versions.

### 3.2 The curves (`CURVES`, `pwl`)

Composite % → quality anchors, fitted by quantile-matching the composite distribution onto the prior quality distribution so the difficulty lines keep their meaning:

```
general   : (17.3→19) (39.2→69) (47.3→80) (66.4→89) (77.8→97) (87.1→104)
chat      : (16.0→19) (31.9→69) (41.2→80) (59.9→89) (71.1→97) (83.1→104)
coding    : ( 5.6→ 8) (19.8→53) (29.1→80) (36.8→86) (45.3→92) (55.1→110)
reasoning : ( 8.1→28) (14.6→72) (18.5→84) (34.0→94) (43.5→106) (56.2→122)
agentic   : ( 5.6→ 8) ( 9.8→18) (21.4→47) (30.1→65) (47.1→93) (59.4→124)
```

`pwl` is linear to the origin below the first anchor, linear between anchors, and above the last anchor a **saturating tail** `qn + (130 − qn)(1 − e^(−1.5·(b − bn)/(130 − qn)))` — continuous with slope 1.5 at the anchor, approaching 130 asymptotically — clamped to `[8, 130]`. The anchors are the June-2026 frontier, so only checkpoints beyond it reach the tail; they spread across the low-120s instead of piling up on the clamp, which keeps the late-2026 frontier separable and leaves a little Studio headroom.

### 3.3 One frozen reference scale (the reference-scale scheme)

A raw per-benchmark % is not stable across snapshots: Artificial Analysis re-runs evals under new harnesses and retires others (REFERENCE-DOSSIER §6.8). The 2026-10 refresh read AA-LCR higher on 342 of 414 overlapping models (+4.5 points on average), re-ran HLE (+0.5) and SciCode for recent models, deleted SciCode for most older ones, and stopped publishing IFBench and Terminal-Bench Hard for new releases. Re-pulling naively would have moved almost every existing model. So every cell is expressed on **one frozen scale** — the 2026-06-21 snapshot the curves were fitted on (`data/aa-reference-2026-06-21.json`) — and resolved per cell, in order (`aa-cells.mjs`):

1. **ref** — the reference snapshot's value for that model's AA UUID (exact for every pre-refresh model);
2. **latest** — the latest value of a cell AA froze (GPQA, IFBench, TB-Hard: byte-identical on every overlap);
3. **eq** — the latest value of a re-scored cell, mapped back by mean-sigma equating fitted on same-UUID pairs (trusted only at n ≥ 50 and r ≥ 0.97);
4. **bridge** — an OLS fit from **measured** cells only (the first predictor set whose inputs are all measured, with n ≥ 60), clamped to the target's observed range; the one chain allowed is an era-imputed Terminal-Bench 2.1 feeding the TB-Hard bridge for a model that has neither.

The committed fits (`data/aa-bridges.json`):

| Cell | Resolution for new models | Fit | n | Residual sd |
|---|---|---|---|---|
| AA-LCR | equated | `ref = −0.6347 + 0.906 × latest` | 414 | 4.04 |
| HLE | equated | `ref = 0.3348 + 0.9275 × latest` | 503 | 0.54 |
| SciCode | equated | `ref = −1.2607 + 1.0085 × latest` | 77 | 1.8 |
| GPQA-Diamond | latest where published, else bridged from HLE + LCR + SciCode | R 0.924 | 535 | 7.5 |
| IFBench | bridged from LCR + HLE + GPQA | R 0.838 | 448 | 9.4 |
| Terminal-Bench Hard | bridged from TB 2.1 + HLE + SciCode | R 0.967 | 144 | 4.97 |

In the active roster, 29 of the 58 checkpoints sit entirely on the reference snapshot; the other 29 (the June–October 2026 releases) carry equated LCR / HLE / SciCode, bridged TB-Hard and (all but one) bridged IFBench, and five carry a bridged GPQA. Each non-reference cell keeps its provenance and sd (`AA_BENCH_SOURCE`), shown in Expert mode as `≈` (bridged) — the uncertainty is a documented property of the data, and the game reads only the resolved number, so it stays deterministic. A permanent test proves the scale is stable: every pinned model measured on the reference snapshot keeps its reference cells exactly.

### 3.4 Pinned by UUID

Roster models are joined to AA by model **UUID** (`{slug, aaId}` in `data/roster-aa-map.json`), never by slug alone: AA recycles slugs onto newer checkpoints (the bare `deepseek-v4-flash` and `deepseek-v4-pro` slugs moved from the April 2026 checkpoints to the July and August re-releases; `hy3` moved from Hy3-preview to Hy3). `pinProblem` refuses a recycled or renamed slug. The roster pins the open DeepSeek-V4-Pro-0813 and V4-Flash-0731 checkpoints deliberately.

### 3.5 Long-context skill

`longCtx = clamp(lcr / 80, 0, 1)` (`calibrate.longCtxOf`; 80 is the reading of full long-context skill at the 2026 frontier; per-tier fallbacks when a cell is missing). It scales the window-fill penalty (REALISM §1.5); a 32K-window model that cannot take AA-LCR's ~100K-token documents reads 0.

---

## 4. Architecture from `config.json`

Artificial Analysis gives benchmarks, not architecture; the serving physics needs real numbers, so `data/model-arch.json` records, per Hugging Face repo, what `scripts/arch-sync.mjs` reads off `config.json` and the safetensors metadata (per-family readers — more than two dozen, with plain GQA as the default — cover gpt-oss, Gemma 3/3n/4, Qwen3-Next / 3.5 / 3.8, NemotronH, Jamba, LFM2, Granite-H, EXAONE, MLA / DSA, DeepSeek-V4 CSA/HCA, the Kimi-Delta-Attention hybrids, the Ling hybrids, MiMo, Step 5, Motif, Inkling, Solar Open 2, LongCat, MiniMax and DeciLM):

- **Size** — the developer-stated `paramsTotalB` / `paramsActiveB` / `isMoE` (memory vs compute basis).
- **The KV layout as layer groups**, counted per token in BF16 elements:

| Group | What it stores | Per-token KV | Per request |
|---|---|---|---|
| `full` | full attention | `layers × kvHeads × (headDim + vHeadDim)` | grows with context |
| `mla` | latent attention | `layers × (latent + rope)` — one tensor, no K/V doubling | grows |
| `compressed` | CSA / HCA | `layers × dim / ratio` | grows |
| `indexer` | sparse-attention index keys | `layers × dim / ratio` | grows |
| `swa` | sliding window | — | constant: `layers × kvHeads × (headDim + vHeadDim) × window` |
| `linear` | recurrent state (DeltaNet / KDA / Mamba) | — | constant: `layers × (state + conv)` |
| `shared` / `none` | cross-layer reuse / attention removed | nothing | nothing |

  The derived serving fields are `kvBytesPerToken` (the growing part, BF16), `kvStateMbPerReq` (the constant part) and `kvLayers` (display). The 2026 hybrids make the spread enormous:

| Checkpoint | Design | KV per token | + per request |
|---|---|---|---|
| Hy3 (295B) | plain GQA on all 80 layers | 320 KB | — |
| Muse Spark Open (816B) | full attention on all 62 layers | 248 KB | — |
| GLM-5.2 / 5.3 (753B) | MLA (576-element latent+rope) + sparse-attention indexer | 93 KB | — |
| Qwen3.8-27B / Qwen3.6-27B | 16 attention + 48 Gated DeltaNet layers | 64 KB | ~154 MB |
| Kimi K3 (2.78T) | gated MLA on 24 of 93 layers + Kimi Delta Attention | 27 KB | ~449 MB |
| GLM-5.3-Flash (321B) | 11 MLA/DSA + 34 KDA layers | 22 KB | ~148 MB |
| MiMo-V2.6-Flash (309B) | 9 global + 39 sliding-window (128-token) layers | 22.5 KB | ~26 MB |
| DeepSeek-V4-Pro-0813 (1.6T) | CSA (ratio 4) + HCA (ratio 128) on one 512-d head + a 128-token window | 9.6 KB | ~8 MB |

- **Release precision** — `nativeWeightBytes` from the safetensors dtype mix (packed 4-bit formats include their block scales): BF16 2; FP8 releases ≈1.0–1.07 (FP8 with a few BF16 tensors); MXFP4 / FP4-expert / INT4-QAT releases ≈0.54–0.66 (gpt-oss 0.56–0.66, DeepSeek-V4 0.54–0.55, Kimi K3 0.56). In the active roster 44 checkpoints release at 16 bits, 6 at 8 bits and 8 at 4 bits. A model is resident at the rack format's bytes only when that format is a lower precision class than the release (otherwise at the release's own bytes), and the PTQ tax applies only below the release precision (REALISM §1.3) — so gpt-oss-120b (≈65 GB) fits one 80 GB H100, DeepSeek-V4-Pro one 8-GPU box, and Kimi K3 (1.56 TB as released) nothing smaller than the NVL72 in any format: re-quantizing a 4-bit release to INT4 stays in the same precision class and saves nothing, and the DGX B200 holds 1.44 TB (8 × 180 GB, as REFERENCE-DOSSIER lists).
- **Window, licence, lineage edge** (`base`: the repo it was post-trained from), sources and confidence. A gated config may name a mirror (`config`); fields listed in an entry's `manual` are never overwritten by `extract` (e.g. Muse Spark Open's layout, taken from its blog and card and marked confidence medium). `arch-sync verify` re-extracts every entry from the fetched configs and fails on any drift, and on any entry it could not check unless `--allow-uncached` is passed (Muse Spark Open's gated config needs `HF_TOKEN`); `thinking-sync verify` holds its quotes to the same rule. Neither download is needed for the tests: `tests/models.test.ts` rebuilds the three generated roster files from the committed data and fails on any difference.

---

## 5. The roster and the gate

The **candidate pool** is every checkpoint with an architecture record: **135** (52 hand-authored + 83 generated). The **frontier-tolerance gate** (`withinFrontierTolerance`, `ROSTER_FRONTIER_TOLERANCE = 0.06`) keeps a checkpoint only if, on at least one axis, its quality is within 6% of the best quality available at its size or smaller — the monotone size↔quality Pareto frontier over the pool — dropping models that trail it on every axis (strictly beaten by something no bigger) while keeping each scale's near-best and every single-axis specialist. The **active roster** is **58 checkpoints from 0.6B to 2.78T** ([PARETO.md](PARETO.md) shows the five frontiers). It spans every scale: sub-1B and edge models (Qwen3 0.6B, Qwen3.5 0.8B, Gemma 3 1B, LFM2.5-1.2B-Thinking), small dense workhorses (MiniCPM5-2B, Qwen3.5 4B/9B, Granite 4.2 8B, K2-Horizon), the 27–37B class (Qwen3.6/3.8-27B, Gemma 4 31B, the 3B-active MoEs), 100–300B sparse models (gpt-oss-120b, Nemotron 3 Super, Qwen3.5-122B, Ling-3.0-flash, Qwen3.8-Flash-Next, DeepSeek-V4-Flash-0731, MiMo-V2.6-Flash, Hy3, Motif 3, GLM-5.3-Flash), and the frontier (Qwen3.5-397B, MiniMax-M3, Nemotron 3 Ultra, Ling-3.1-flash, Step 5, GLM-5.2/5.3, DeepSeek-V4.1-Flash, Muse Spark Open, MiMo-V2.6-Pro, DeepSeek-V4-Pro-0813, Qwen3.8 2.4T, Kimi K3).

**The starter is chosen by rule.** `DEFAULT_MODEL_ID` is the smallest dense checkpoint that can serve the opening waves on its own (`servesOpeningWaves`): it never forces thinking on chat, and after its alignment tax it clears chat and code completion in instant mode and RAG's general line. That is MiniCPM5-2B; the fallback is the smallest dense non-thinking checkpoint.

**Alignment is hand-filled per family** (there is no public safety benchmark to calibrate it from): Meta 62, Qwen 58, Gemma 70, NVIDIA 64, frontier MoEs 60, general instruct 55 — all hard-refusal at 0.10–0.15 over-refusal — against gpt-oss's safe-completion 84 / 0.03, and Muse Spark Open's stronger 72 for standalone use per its card.

---

## 6. Thinking support and instant vectors

Whether a checkpoint thinks is a fact of its **released chat template**, recorded per HF repo in `data/model-thinking.json` with the file it was read from and a verbatim quote (`node scripts/thinking-sync.mjs fetch && … verify` re-checks every quote against the fetched file, that a `never` template has no thinking markers, and that no hybrid or always-thinker is pinned on a non-reasoning row):

- **hybrid** — the serving stack can switch thinking off per request: `enable_thinking=False` (Qwen3.5 / 3.6 / 3.8, GLM-5.2, Gemma 4, Nemotron 3, MiMo, MiniCPM5), `thinking_mode="chat"` (DeepSeek-V4's `encoding_dsv4.py`), `thinking_mode="disabled"` (MiniMax-M3), `reasoning_effort="no_think"` (Hy3).
- **always** — every answer reasons first; a knob only sets the effort: gpt-oss (harmony `reasoning_effort`), Kimi K3 (its card: "always has thinking enabled"), MiniMax-M2.x, GLM-5.3, Step 5, Qwen3.8-2.4T, Muse Spark Open, and the dedicated Thinking / Thinker checkpoints.
- **never** — an instruct deployment. A hybrid template whose roster pin is AA's non-reasoning row is served thinking-off and counts here (the template's own support is kept as `template`).

Active roster: **37 hybrid, 19 always, 2 never** (pool: 64 / 30 / 41).

**The instant vector.** A hybrid's `qualityByInstant` goes through the same blends and curves as `qualityBy`, from either AA's non-reasoning row of the **same** checkpoint — an `instant` pin by UUID whose name (without its mode tag) and release date must match, so Hy3 is not paired with its April preview — or, for a hybrid AA timed only in thinking mode, a per-cell **pair fit** `instant = a + b × thinking` over the 32 pinned pairs (measured cells only), clamped to `[0, thinking]` (`data/aa-bridges.json` `instant`):

| Cell | a | b | n | R | sd |
|---|---|---|---|---|---|
| GPQA-Diamond | −3.92 | 0.930 | 30 | 0.884 | 8.6 |
| IFBench | 16.44 | 0.407 | 28 | 0.871 | 4.5 |
| AA-LCR | −0.75 | 0.727 | 32 | 0.938 | 7.5 |
| SciCode | 3.04 | 0.734 | 31 | 0.793 | 7.6 |
| Terminal-Bench Hard | 0.24 | 0.799 | 27 | 0.930 | 4.4 |
| HLE | 3.83 | 0.274 | 32 | 0.735 | 2.8 |

Switching thinking off costs most on HLE and IFBench and least on GPQA and SciCode, so a hybrid keeps its knowledge on chat but loses the hard-reasoning and instruction-following edge thinking bought. In the active roster 18 hybrids are pinned on a measured non-reasoning row and 19 use the fit. The fit never lets an instant cell exceed its thinking cell. A measured non-reasoning row is not clamped: on a few cells it beats the thinking row — for example, small Qwen3 and Qwen3.5 checkpoints score higher with thinking off on SciCode and HLE (Qwen3.5 2B: SciCode 7.2 off vs 2.8 on) — so a hybrid can show an instant bar above its thinking bar (in the active roster, coding on Qwen3.5 2B and Qwen3 0.6B). That is the measurement, kept as it is; a Studio run moves both vectors by the same amount, and a merge whose instant path comes from one parent keeps what the average cost that parent, so it never answers instantly better than the parent that supplies the path.

**The thinking budget.** `thinkingOf(telemetry, support)`: the template decides *whether* a model thinks; AA's serving telemetry on the pinned thinking variant decides *how much* — `thinkTokens = clamp((ttfat − ttft) × output tok/s, 300, 4000)` when the time-to-first-answer gap exceeds 1 s, else the 1500-token fallback; 0 for `never`. Two thousand tokens is the common figure at the frontier; Qwen3.6-27B / 35B-A3B hit the 4000 clamp. The engine spends `thinkTokens × the archetype's thinkMul` hidden tokens per thinking-mode answer (REALISM §1.11).

---

## 7. MoE handling

`paramsTotalB` (memory basis) and `paramsActiveB` (per-token compute basis) carry MoE physics; `isMoE` flags it. The touch points:

1. **Residency** — a copy's weights are `paramsTotalB × resident bytes`: every expert is resident; this decides which GPU group holds it.
2. **Per-token compute** — prefill and the decode compute term are keyed on `paramsActiveB`.
3. **Per-step weight reads** — an MoE step reads its always-on part (`MOE_SHARED_FRAC 0.35` of the active parameters) plus the **union** of the routed experts its batch touches, `routedTotal × (1 − (1 − routedActive/routedTotal)^b)`: a lone stream reads ~active, a big batch climbs toward total. Wide Expert Parallelism (an MoE served as several copies) reads only its share of the union of the rack's pooled batch, at an all-to-all cost.
4. **No `tech_moe` buff.** Real models are born MoE (the discount is already in their low active count); a global buff would double-count.

**Net invariant:** `memory / fit ← paramsTotalB at release precision`; `compute ← paramsActiveB`; `bandwidth ← active at b = 1, the expert union under batch`. Kimi K3 (2.78T / 104B) needs the NVL72 to *fit* as released and serves at roughly a 104B-active speed; Qwen3.8-Flash-Next (180B / 6B) is VRAM-hungry and compute-cheap.

---

## 8. Capability compression and the agentic axis

With real 2025–26 benchmarks, small and sparse thinking models clear most knowledge and reasoning lines that once needed a frontier giant — capability tracks post-training more than parameter count. That is correct realism, and it flattens a pure "scale up" progression. What keeps the late game demanding:

1. **The agentic axis compressed last.** `agentic` is Terminal-Bench-Hard-led; the agent line is 82 at tier 1 and ≈100 at tier 12. Small bodies sit below it for most of the campaign; in the late-2026 data a dense 27B (Qwen3.8-27B, agentic 125 in thinking mode) crosses it, and the frontier sits in the high 120s. The bar is cleared by capability; it is held by serving.
2. **Serving is the other half of the bar.** A tier-12 agent step reads ~48K tokens of accumulated context, thinks its full budget and must finish within a minute; a chat answer from a thinker blows its 4 s time-to-first-answer; long-context traffic needs KV per user the full-attention models cannot spare. Everyone has a smart model; the question is serving it at scale within SLO.
3. **Quality lines keep rising** +2% per tier, and the Studio's capacity ceiling bounds how far a body can be trained (twice-its-size peers + 6).

---

## 9. Expert-mode surfacing

Real metadata lives as **inert display fields** (`ModelDef.real`: developer, licence, release, window, precision, HF source, confidence, the raw benchmark cells and their provenance, the instant-mode cells and how they were obtained, the thinking toggle) that `sim/**` never reads. Calibration is a build-time transform plus a load-time curve; the sim only sees `qualityBy` / `qualityByInstant` / `thinking` / `thinkTokens` / `paramsTotalB` / `paramsActiveB` / `isMoE` / the KV fields / `nativeWeightBytes` / `contextWindowK` / `longCtx` / `alignment`. The Model Overview (S7) and Lineage Graph (S8) show active/total params, KV per token and per request, release precision, licence, release date, thinking support with its off switch, both quality vectors (the other mode marked on each bar), and the benchmark breakdown with `≈` on bridged cells — so a player sees *why* a model clears a line. Normal mode states the same facts in plain words.

---

## 10. Calibration caveats

1. **Bridged cells are estimates.** IFBench (sd ≈9.4) and TB-Hard (sd ≈5.0) are bridged for every post-June-2026 model; GPQA (sd ≈7.5) for a few. They are labelled in Expert mode and in MODEL-CATALOG.md; re-pin a cell if the host publishes it again.
2. **Benchmark contamination / harness drift.** GPQA and coding sets leak into training; re-runs under new harnesses shift scores (LCR's refresh). Mitigations: one frozen scale with same-UUID equating; a 5-axis blend so no single benchmark decides a crossing; a curve that compresses the top.
3. **Composite-index churn.** The AA Intelligence Index is display-only; calibration uses per-benchmark cells.
4. **Instant-mode outliers are kept as measured.** Qwen3.6-35B-A3B's non-reasoning SciCode of 1.3% (3.7 sd below the pair fit, likely a failed run) gives it instant coding 32; one `longCtx` serves both modes.
5. **Licence nuance.** Several "open" models carry use limits (MaaS revenue thresholds, regional terms, gated downloads). The licence is stored verbatim and shown in Expert mode; gameplay never gates on it.
6. **Advertised vs effective context.** The hard window is `contextWindowK`; the AA-LCR-calibrated fill penalty is the softer, more honest pressure.
7. **Staleness.** The open frontier moves monthly: refresh through §2's pipeline, pin new releases by UUID, and route newer capability to player-built Studio chains and endless mode rather than re-tuning the campaign each season. Mistral Large 4 is listed in MODEL-CATALOG.md as pending (open weights announced for 2026-10-27); it joins the pool once its weights and config ship.
