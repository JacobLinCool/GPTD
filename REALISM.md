# GPTD Realism Ledger

> **Single source of truth.** The realism redesign (P0–P5) has fully shipped: GPTD is a realistic data-center LLM-inference simulator delivered as tower defense — *"the board is the metaphor, the numbers are real."* The authoritative as-built design is [REDESIGN-BLUEPRINT.md](./REDESIGN-BLUEPRINT.md) (§0–§10), grounded by [REFERENCE-DOSSIER.md](./REFERENCE-DOSSIER.md) (the real-world citations). **This ledger is reconciled to the as-built code** — it is the "how the game stays true to reality" view of the blueprint, not a competing design. Where this file and the blueprint/code disagree, the code wins; report the drift.

**Purpose.** GPTD's simulation is meant to be *defensible in front of domain professionals* — LLM inference engineers, SREs, datacenter operators, ML researchers. This document is the ledger of every realism-relevant decision: what the real-world mechanic is (with numbers), what the literature says (cited to REFERENCE-DOSSIER.md §refs), what GPTD ships today (with code pointers), and where we knowingly deviate. When you change a mechanic, update its entry here and in the blueprint.

**Code anchors.** Serving physics + economy: `src/sim/effects.ts`; benchmark→quality: `src/sim/calibrate.ts`; roster: `src/sim/content.ts`; two-layer safety: `src/sim/safety.ts` + `src/sim/combat.ts`; player post-training: `src/sim/models.ts`; research tracks: `src/sim/research.ts`; constants: `src/config.ts`; types: `src/core/types.ts`.

**Status markers.** ✅ shipped · 🔶 shipped but knowingly simplified · ⚪ open / honest design note.

---

## 0. Governing principle: directional fidelity（方向忠實性）

**Numbers may be tuned for gameplay; the sign structure of a tradeoff may not.** A technique that gives 10× in reality may give +35% in-game — that is balancing. But if a technique has real costs (more VRAM, more power, more compute, lower accuracy, higher latency), those costs **must exist in the game with the correct sign**; they may be softened, never deleted. Conversely, a benefit may not be invented that the real technique lacks.

The as-built design pushes this further than the old "tuned coefficient" approach: most serving mechanics are now computed from a **real roofline on real hardware specs** rather than carrying a hand-tuned multiplier. The benefit and the cost both *emerge* from the physics (e.g. a small-active MoE serves fast **and** still pins all its experts in VRAM, because VRAM ∝ `paramsTotalB` while speed ∝ `paramsActiveB`). The remaining authored coefficients (recipe gains, two calibration constants) are honestly flagged as such (§7).

---

## 1. Serving core — the real roofline

> Reality anchors: REFERENCE-DOSSIER §1.1 (prefill compute-bound / decode bandwidth-bound), §5.6–5.8 (memory + roofline + $/Mtoken), §0#10 (MoE memory-compute decoupling).

### 1.1 ✅ Two-phase requests on a real roofline

**Reality.** A kernel's attainable throughput is `min(compute roof, bandwidth roof)`. Prefill processes the whole prompt in parallel (GEMM, compute-bound, ~90–95% H100 utilization); decode emits one token per request per step (GEMV, bandwidth-bound, ~20–40% utilization). Prefill cost ∝ input tokens and is super-linear in prompt length (O(n²) attention); decode cost ∝ output tokens × KV re-read (REFERENCE-DOSSIER §1.1).

**GPTD.** Every request carries real `inputTokens` / `outputTokens`. The rack computes (`src/sim/effects.ts`):
- `prefillTokS(n) = aggTflops / (2 × paramsActiveB × superlinear(n))`, `superlinear(n) = 1 + n/16000` (the O(n²) penalty);
- `decodeTokS_b1 = HBM_BW / (2 × paramsActiveB × bytesPerParam)` (the bandwidth roof);
- `computeRoofTokS = aggTflops / (2 × paramsActiveB)` (the compute roof decode hits at large batch);
- `aggDecodeTokS = min(decodeTokS_b1 × batch, computeRoofTokS)` — decode is **linear in batch until it saturates the compute roof**; per-user rate = aggregate / batch.

There is no abstract `flopsPerWork`/`bandwidthPerWork`/`work`-vs-`memory` coefficient any more — `FLOPs/token ≈ 2 × paramsActiveB` and the HBM bandwidth term are computed directly from the deployed model and the real GPU. TTFT emerges from prefill time (+ queue + input guardrail); TPOT emerges from the per-user decode rate.

### 1.2 ✅ Real hardware ladder (GPU specs, watts, capex)

**Reality.** Real accelerators have specific fp8/bf16 TFLOPS, HBM capacity + bandwidth, TDP watts, and capex; ≳1000–1200 W single-GPU TDP mandates direct liquid cooling; an NVL72 rack is ~120 kW vs ~10–15 kW for air-cooled racks (REFERENCE-DOSSIER §5.2–5.5, §0#12).

**GPTD.** `HW_SPECS` (`src/sim/content.ts`) is the real ladder, each with PER-GPU `bf16TflopsPerGpu`/`fp8TflopsPerGpu`/`hbmGbPerGpu`/`hbmTbsPerGpu`/`tdpWattsPerGpu`/`gpuHrUsdPerGpu`/`capexUsd` and a `gpus` count; aggregates are `perGpu × gpus`:
`hw_edge` (1× L4-class, 24 GB) → `hw_standard` (L40S, 48) → `hw_perf` (H100, 80) → `hw_frontier` (H200, 141) → `hw_pod` (DGX H200, 8×H200, 1.1 TB) → `hw_superpod` (DGX B200, 8×B200, 1.5 TB) → `hw_giga` (GB200 NVL72, 72×B200, ~13.8 TB).
Build cost = `capexUsd / CREDIT_USD`. Cooling is `air` vs `liquid`; a liquid-cooled rack is a **hard gate** — it needs at least one Liquid Cooling Loop facility (`hasLiquidLoop`, `hwNeedsLiquid`), so pod/superpod/giga cannot run without it.

### 1.3 ✅ VRAM gating: weights resident, KV competes for the rest

**Reality.** Weights must be resident or the model cannot serve from that accelerator; KV cache then competes for the remainder. FP16/FP8/INT4 = 2/1/0.5 bytes per param. For MoE, **all experts stay resident (VRAM ∝ total params)** while compute/bandwidth track **active params** (REFERENCE-DOSSIER §5.6, §0#10, §0#11).

**GPTD.** `modelMemory = paramsTotalB × bytesPerParam` (`bytesPerParam = min(model.weightBytes, s.infra.weightQuantBytes)`); `serverFitsMemory` hard-gates deployment (`modelMemory + FRAMEWORK_GB ≤ hbmGb`). MoE inflation is **not** a flat tax: it falls out of the total-vs-active split — Kimi K2 (1000B total / 32B active) needs a GigaCluster to *fit* but serves at 32B-active speed once resident. This is the single most important cost-structure fact in the sim and it is structural, not a coefficient.

### 1.4 ✅ KV cache from real architecture; continuous-batching budget

**Reality.** Per-token KV = `2 × layers × kv_heads × head_dim × bytes`, growing linearly with sequence length; GQA/MQA cut it via low `kv_heads`; MLA stores a compact latent (DeepSeek-V2: −93.3%). Pre-PagedAttention allocators wasted 60–80% of KV memory (20.4–38.2% useful); paged block allocation reaches ~96% (REFERENCE-DOSSIER §4.2, §4.6, §1.2#4).

**GPTD.** `kvPerReqGb = 2 × layers × kvHeads × headDim × contextLen × kvQuantBytes / 1e9`, using the model's **real** `layers`/`kvHeads`/`headDim` (from model cards, `src/sim/content.ts` ROSTER). GQA/MQA emerge from low `kvHeads`; **MLA models apply ×0.067** (the −93.3% latent approximation, flagged in-tooltip as an equivalent scaling, not the true latent geometry). There is **no global `r_tech_gqa` ×0.4** any more — grouped/latent attention is a model attribute (blueprint R4). KV budget per rack = `(hbmGb − weights − FRAMEWORK_GB) × kvUtilization`; `kvUtilization` is **0.55** until PagedAttention research lifts it to **0.96**. Before Continuous Batching is researched, `serverTargets = 1` (the pre-Orca request-level era); after, batch is `hw.targets + multiStep`, capped at runtime by the real KV budget.

### 1.5 ✅ Hard context window — beyond it, the request is unservable

**Reality.** A prompt past the model's context window is rejected, not merely degraded (REFERENCE-DOSSIER §1.2#4).

**GPTD.** `serverCtxWindowTokens = contextWindowK × 1000 × (1 + flashCtxBonus)` in **real tokens**; a request whose `contextLen` exceeds it resolves `unservable` (`src/sim/combat.ts`). With real 128K+ windows this rarely triggers — long context now bites mainly through the **KV budget** (§1.4), which is the more honest failure mode.

### 1.6 ✅ Prefill/decode interference, chunked prefill, disaggregation — infra research

**Reality.** Admitting a prefill into a decode batch slows both (generation stalls); chunked prefill (Sarathi) keeps decode flowing while ingesting; P/D disaggregation runs the phases on separate pools (DistServe 2.0–4.48× goodput, Splitwise on Azure traces). Chunked-prefill and disaggregation are architecturally opposed strategies (REFERENCE-DOSSIER §1.1, §4.3).

**GPTD.** Both live on the infra tree (`s.infra`, not `s.upgrades`): `inf_chunked` (decode-priority share 0.35 while ingesting) and `inf_disagg` (role-pinned prefill ×1.5 / decode ×1.25 racks). They are a **hard `conflicts` pair** (`INFRA_NODES`, `src/sim/content.ts`) — you commit to one scheduling philosophy. Misconfigured pools strand traffic, the real failure mode.

### 1.7 ✅ Dual clock: SLO judged in real ms, not raw b=1 latency

**Reality.** A bare b=1 decode of a long output takes many real seconds; that is not the latency a user under continuous batching sees. The serving objective is **Goodput** — the rate of requests meeting per-phase SLOs (TTFT/TPOT), e.g. MLPerf Interactive 450 ms / 40 ms, Conversational 2000 ms / 200 ms (REFERENCE-DOSSIER §1.3, §0#4).

**GPTD.** `SIM_TIME_SCALE = 10` compresses real datacenter seconds into visible board seconds for animation only. **SLO is always judged on the real-second axis** via `effLatencyMs` — the concurrency-amortized effective latency (per-user decode rate ÷ batch, plus prefill, queue, and guardrail latency). `LAT_CLASS_SLO` (`src/config.ts`): IN 400/40 ms, NR 2000/200 ms, TO none. This is the fix that keeps Goodput from being identically zero: high-concurrency low-OSL chat lands inside SLO; long-OSL reasoning naturally strains it.

---

## 2. Models & calibration — capability is a benchmark-derived vector

> Reality anchors: REFERENCE-DOSSIER §6 (open-weight roster), §6.3–6.4 (benchmark saturation + the agentic/SWE wall), §2.9 (lineage).

### 2.1 ✅ 30 real open-weight base checkpoints (from a 130-model catalog), free to deploy

**Reality.** Open weights are a free download; what gates use is whether the checkpoint fits the accelerator's VRAM (REFERENCE-DOSSIER §6, §0#11).

**GPTD.** The roster is **30 real checkpoints** (`src/sim/content.ts` ROSTER), drawn from a fact-checked **130-model catalog** (`MODEL-CATALOG.md`, sourced from Artificial Analysis + official model cards). It spans ~1B → 1.6T across Meta, Alibaba, OpenAI, Google, Microsoft, Mistral, Z.ai, DeepSeek, NVIDIA, MiniMax, and Moonshot — from Llama-3.2-1B / Qwen3-4B / Nemotron Nano 9B up through Qwen3.5-397B, GLM-5.2, DeepSeek-V4-Pro, Nemotron 3 Ultra, and Kimi K2 (the 2026 frontier). **All are owned free from turn one** (`STARTER_MODELS = OPEN_MODEL_IDS`); deploying one costs nothing. Gating is VRAM-fit only (plus, in practice, the rack tiers a 100B+ checkpoint needs). Each carries real metadata (`real`: developer/license/openWeights/released/contextWindowK/source/lineage) surfaced as inert display fields the sim never reads.

### 2.2 ✅ `qualityBy` is a 5-axis vector calibrated from public benchmarks — never hand-edited

**Reality.** Capability is a vector over task types, not a scalar; a coder is not a better chatbot; instruction tuning pays an alignment tax on some benchmarks (REFERENCE-DOSSIER §2.4, §6.3).

**GPTD.** Every checkpoint's `qualityBy = {chat, coding, reasoning, general, agentic}` is computed by `qualityFromBenchmarks` (`src/sim/calibrate.ts`) from real public benchmarks — **`qualityBy` is never hand-edited** (the rule). Axis → benchmark: chat/general ← MMLU-Pro; coding ← LiveCodeBench (fallbacks SWE-bench Verified, HumanEval); reasoning ← GPQA-Diamond (fallback AIME); agentic ← SWE-bench Verified (fallback discounted LiveCodeBench). Each axis has a piecewise-linear `%→quality` curve (`pwl`, `CURVES`) anchored so the request difficulty lines keep meaning. Quality is **deliberately NOT** derived from the Artificial Analysis composite Intelligence Index (it re-baselines between versions, e.g. MiniMax-M2 read 61 then 28); per-benchmark %s are scale-stable, and AA index is display-only.

### 2.3 ✅ The agentic / SWE wall — why big models still matter

**Reality.** 2025–26 capability has compressed: a small thinking model clears reasoning lines that once needed a 671B frontier model — **except on the agentic / SWE-bench axis, where scale and post-training still open a real gap** (REFERENCE-DOSSIER §6.4, §0#14).

**GPTD.** `agentic` is the anti-saturation axis: its curve is anchored on **SWE-bench Verified**, the unsaturated benchmark. Models without a real SWE score fall to a deliberately low per-tier `agentic` floor (`QUALITY_FLOOR`, e.g. small 20). The `agent` request type (`difficulty.agentic = 82`) is the late-game wall only a true frontier checkpoint — or one the player trains themselves — clears. This is the discriminative "bigger still matters" gate, grounded in the one benchmark family that has not converged. It is also how the formerly-OP small MoE (Qwen3 30B-A3B) is balanced: it serves fast and answers reasoning, but its calibrated agentic score genuinely lags (a calibration fact, not a hand-edit).

### 2.4 ✅ `paramsTotalB` vs `paramsActiveB`; real lineage edges

**GPTD.** Each model splits `paramsTotalB` (VRAM basis) from `paramsActiveB` (compute/decode basis); for dense models they are equal. Real lineage is recorded where it exists — e.g. Nemotron-3-Super carries a `baseModelId: 'llama33_70b'` / `relation: 'finetune'` edge (NVIDIA's Llama-based line) shown on the S8 LineageGraph. The old dense 253B Nemotron-Ultra (a trap: vast, costly, not best on any axis) was replaced with the real hybrid-MoE Nemotron-3-Super-120B-A12B, which has a genuine active-param advantage.

---

## 3. Post-Training Studio — the real per-model taxonomy

> Reality anchors: REFERENCE-DOSSIER §2 (post-training stack), §2.8 (the five tradeoffs), §2.10 (per-model vs serving-layer).

### 3.1 ✅ Almost all post-training is per-model; it mints a new checkpoint

**Reality.** Each post-training step (CPT/SFT/DPO/RLHF/GRPO/CAI/distill/merge/QAT…) produces a **new weight artifact**; only multi-LoRA serving and PTQ deployment live at the serving layer (REFERENCE-DOSSIER §2.10).

**GPTD.** The closed `ft_agent`/`pt_giga` cards are **gone**. Post-training is the **Post-Training Studio** (the centerpiece, `src/sim/models.ts` + `METHOD_RECIPES` in `content.ts`): pick a base (a roster model **or a previously-derived model** — unlimited iterative finetune-of-a-finetune) × **method** (`cpt`/`sft`/`lora`/`qlora`/`dora`/`dpo`/`rlhf`/`cai`/`grpo`/`distill`/`merge`/`qat`) × **target** (chat/coding/reasoning/general/agentic/safety/longctx/domain) × **effort** (5 notches 0.25–2.0). It spends Data + requisitioned compute (the posttrain research track) and mints a **new named derived `ModelDef`** (`drv_{seq}`, `{base}-{Target}-{Method}`) with a snapshot `qualityBy` plus a `Lineage` record. The player-built GRPO-agentic run on a frontier base is now the agentic specialist; a deep iterative chain is the endless-mode quality ceiling.

### 3.2 ✅ `deriveQuality` models the five real tradeoffs

**Reality.** The recurring constraints: alignment tax (alignment ↑ ⇒ general capability ↓, monotone), catastrophic forgetting (CPT/alignment forget old skills), capability-vs-safety tension, data quality > quantity, narrow-FT overfitting (REFERENCE-DOSSIER §2.8).

**GPTD.** `deriveQuality` (`src/sim/models.ts`) applies: `depthDamp = 1/(1 + 0.15 × lineage.depth)` (deep chains converge, no free score-farming); a `headroom = (130 − base)/130` cap (the closer to the ceiling, the harder to push); per-recipe `gainCap`; an alignment tax on the general axis for safety/RLHF/CAI; catastrophic forgetting on non-target axes via `forgetScale`. `distill` swaps to a smaller student base (`reshapesDeployment`, cap = min(teacher, student-capacity)); `qat` drops `weightBytes` and pays −2 quality; `merge` averages two upstream bases (no gain, no tax, no forgetting). The teaching contrast is real: **RLHF** buys high safety but the steepest capability tax and rising over-refusal, while **CAI** buys a Pareto improvement (raises safety *and* lowers over-refusal).

### 3.3 🔶 Recipe gain/cost table is an honestly-flagged game curve

**Reality vs game.** Base `qualityBy` is physics (benchmark → quality, §2.2). Derived **gains** are not first-principles — they are a calibrated game curve. The 48 recipe constants (`gainScale`/`gainCap`/`taxScale`/`forgetScale`) are explicitly marked `autoplay-calibratable`; `calibrateRecipes` is a validating pass-through that asserts the band-displacement ordering (merge 0 < adapters < heavy methods; GRPO leads the reasoning/agentic methods) so a future hand-edit cannot silently break balance (`src/sim/calibrate.ts`, `recipeGainOrderingOk`). Training cost is grounded by relative magnitude: `computeCost = recipe.costCompute × (active/8)^0.7 × effort × 1000` FLOPS·s — CPT lands ~60× a LoRA, matching REFERENCE-DOSSIER §2.1.

---

## 4. Safety — two distinct layers

> Reality anchors: REFERENCE-DOSSIER §3 (two-layer model), §2.4 (alignment as post-training), §3.1 (safe-completion), §3.3 (guardrail systems).

### 4.1 ✅ Layer 1 — model-intrinsic alignment (per-model, 0 latency, not a serving knob)

**Reality.** RLHF / CAI / safety-SFT / safe-completion are baked into the weights at post-training; at inference there is no per-request safety dial — you change the model. Alignment trades capability for safety (alignment tax); safe-completion (GPT-5) pays a lower tax than hard-refusal (REFERENCE-DOSSIER §2.4, §3.1).

**GPTD.** Each `ModelDef` carries an `AlignmentProfile {safety, refusalStyle, overRefusal}` (`src/sim/safety.ts`). The **alignment tax** = `TAX_K[refusalStyle] × max(0, safety−40)/100`, with `TAX_K = {none: 0, 'hard-refusal': 9, 'safe-completion': 4}`, subtracted from `qualityBy` in `serverQualityVs` (on top, never baked in). At serve time the model **self-handles** a hazard at **0 latency** with probability `clamp01(safety/100 − severity × HAZARD_HARDNESS[h])`, where `HAZARD_HARDNESS = {jailbreak: 0.35, injection: 0.55, harmful: 0.2, pii: 0.3}` (injection is the hardest to self-handle). A benign request is wrongly refused with probability `alignment.overRefusal` → the `over_refused` outcome. The gpt-oss family is the deliberate Pareto teaching point (high safety, safe-completion, low over-refusal, low tax) against everyone else's hard-refusal. Alignment is acquired only via the Studio (RLHF/CAI/safety-SFT/safe-completion methods).

### 4.2 ✅ Layer 2 — external guardrail buildings (per-request, on the path, with cost)

**Reality.** Guardrails are separate models/classifiers on the request path; you can toggle them and tune their threshold per deployment, paying stacked latency and compute. A lightweight encoder (Prompt Guard 86M ≈ 92 ms, input-only) is two orders of magnitude cheaper than a generative guard (Llama Guard 12B = a full LLM inference); OpenAI's omni moderation is a hosted call (REFERENCE-DOSSIER §3.3).

**GPTD.** Three guardrail buildings (`TOWER_DEFS` guardrails, latency/power via `guardLatencyMs`/`guardPower`):
- `guard_encoder` — Prompt Guard 86M, **fixed 92 ms**, ~0 compute (does not touch rack KV/watt), input-only, catches jailbreak + injection.
- `guard_llm` — Llama Guard 12B, runs the **real §6 roofline on its own rack tile** (~337 ms from prefill ~300 tok + decode ~24 tok), **draws real power/heat**, catches all hazards. Its latency is computed, not a magic constant — the encoder-vs-generative two-orders-of-magnitude gap is real in the numbers.
- `guard_mod` — OpenAI omni moderation, fixed ~120 ms, hosted (no rack cost), catches harmful + pii.

Input-side latency loads TTFT; output-side loads E2EL (`src/sim/combat.ts`). Threshold sets a **no-free-lunch** tradeoff: `effRecall = clamp01(baseRecall × (0.6 + 0.8 × threshold))` rises with threshold, but `overRefuse = OVERREF_K[archetype] × threshold²` (convex; `OVERREF_K = {encoder: 0.06, generative: 0.1, moderation: 0.05}`) punishes catching more. The default threshold 0.5 causes some over-refusal by design.

### 4.3 ✅ Red-team is a dev-time eval, not a serving knob

**Reality.** Red-teaming calibrates the system (judge by intent, XSTest) rather than weakening attackers (REFERENCE-DOSSIER §3.5–3.6).

**GPTD.** The old `spawnRiskMult` "make enemies weaker" model is gone. Red-team is a one-time eval on the **eval research track** (`eval_redteam` v1/v2). Its main effect is the real calibration: it **lowers over-refusal convexity** (`OVERREF_K ×0.7`) and **unlocks the harder detection categories** (`injection` at v1, `pii` at v2 — until then a guardrail cannot catch them). A small `+0.02` recall bump is explicitly framed as "calibrating the threshold, not improving the model" (`src/sim/safety.ts`).

### 4.4 ✅ Requests carry hazards; six-way verdict

**GPTD.** Requests carry a `SafetyProfile` of hazard severities (e.g. `jailbreak` carries `jailbreak: 0.9`; `agent` carries `injection: 0.3` — agents are real prompt-injection targets). A hazard is handled iff layer 1 self-handles it **or** an in-path guardrail clears it; an unhandled hazard reaching the core is an `unsafe` breach (−−Trust). A benign request wrongly refused by either layer is `over_refused` (revenue 0, light Trust hit, so the player is taught to prefer low over-refusal).

---

## 5. Economy — real $/Mtoken and $/GPU-hr

> Reality anchors: REFERENCE-DOSSIER §5.8 (`$/Mtoken` identity; low utilization is fatal), §1.4 (per-workload prices).

### 5.1 ✅ Token-priced income, wall-clock operating cost, idle racks bleed

**Reality.** `$/Mtoken = ($/GPU-hr × 3600) / (aggregate tok/s × 1e6)`; a 10%-loaded rack can cost 10× per token. Output tokens on reasoning/agentic traffic sell for far more ($15–25/Mtok) than embeddings/chat (REFERENCE-DOSSIER §5.8, §1.4).

**GPTD.** 1 credit = $1000 (`CREDIT_USD`). Build cost = `capexUsd / CREDIT_USD`. Income = real `$/Mtoken` on the request's actual input+output tokens (`serveRevenue` = `(tokensIn × pricePerMtokIn + tokensOut × pricePerMtokOut)/1e6 × TRAFFIC_SCALE × marketPriceMul / CREDIT_USD`). Operating cost is **fixed by wall-clock**: `rackOperatingCostPerSec = gpuHrUsd × realHoursPerBoardSec × TRAFFIC_SCALE × OP_COST_SCALE / CREDIT_USD` — it bills whether or not the rack serves anything, so an idle / over-provisioned rack bleeds and the **utilization penalty emerges** rather than being hand-coded. `TRAFFIC_SCALE` carries on **both** sides, keeping the real `$/Mtoken` identity exact.

### 5.2 ✅ Six outcomes; Goodput drives SLA

**GPTD.** `resolveServe` (`src/sim/combat.ts`) settles each request into one of six outcomes: `served` / `slo_miss` / `bad` / `unservable` / `unsafe` / `over_refused`. Priority among a fully-served request is `unsafe > bad > slo_miss > served`. A **bad answer is still billed** (REFERENCE-DOSSIER §2.2) but bleeds Trust; an `slo_miss` (correct, safe, but late on `effLatencyMs`) earns **zero cash** and an SLA penalty and is excluded from Goodput. **Goodput** = within-SLO served rate; it drives the SLA meter. Lose on `cash < 0` / `trust ≤ 0` / `sla ≤ 0` (`src/sim/sim.ts`); win = clearing the full 100-wave campaign (an escalating elimination gauntlet of real 2023→2026 history, `campaign-data.ts`); endless mode continues beyond wave 100.

### 5.3 ✅ Real power & cooling; phase-asymmetric throttle

**Reality.** ≈all electrical power becomes heat; decode is so memory-bound that capping GPU power barely moves it while prefill takes the hit (Splitwise/ISCA'24, POLCA) (REFERENCE-DOSSIER §5.1-style, §5.5).

**GPTD.** `serverPower = (tdpWatts/1000) × RACK_UTILIZATION × reduce × mul` in **real kW**: an H100 rack reads ~0.56 kW, a DGX-H200 pod ~4.5 kW, an NVL72 ~57.6 kW. FP8/INT4 weight-quant cut draw (−15% / −5%); throughput pushes utilization up; speculative decoding keeps a draft hot on the frontier tier (+8%/level). Heat ≈ power. Thermal throttle is phase-asymmetric: `decodeThrottle(t) = 1 − (1 − t) × 0.25` — prefill takes the full hit, decode a quarter.

---

## 6. Infra tech tree — serving/infra only

> Reality anchors: REFERENCE-DOSSIER §4 (serving systems), §2.10 (only multi-LoRA + PTQ are serving-layer).

### 6.1 ✅ 22 infra nodes on typed `s.infra`, three research tracks

**GPTD.** All serving switches live on a typed `s.infra` (`InfraState`), separate from cash-bought `s.upgrades` (blueprint R6). The 22 `InfraNodeDef` (`src/sim/content.ts`) span nine categories — scheduling (continuous batching root, multi-step, chunked ⟂ disagg), kv-memory (PagedAttention root, prefix cache, FlashAttention, FP8/INT4 KV-quant, offload), decoding (speculative), weight-quant (FP8/INT4/NVFP4, the last needing Blackwell), parallelism (TP/PP/DP/EP), routing (KV-aware), multi-LoRA (2000 slots, S-LoRA), engine (vLLM/SGLang/TRT-LLM tiers). Research runs on **three concurrent tracks** — infra / posttrain / eval — that **share one requisitioned FLOPS pool** capped at `RESEARCH_MAX_SHARE = 0.45` of fleet FLOPS, requisitioning the strongest online racks first (`src/sim/research.ts`).

### 6.2 ✅ What is NOT a tech node (the removals)

The following were relocated to where they belong, per blueprint P3c / R4:
- **MoE** is no longer the `tech_moe` flops/bandwidth/VRAM buff. It is a **model property** — VRAM ∝ total / speed ∝ active (§1.3) — plus the `inf_par_ep` (Expert Parallelism) node for sharding. There is no longer a global −flops MoE discount to research.
- **GQA/MLA** are model attributes (real `kvHeads` / `attn:'MLA'` ×0.067), not the old `r_tech_gqa` global ×0.4 (§1.4).
- **Reasoning** is a model property (`isReasoning`, cold-started by a GRPO Studio run), not a fleet `tech_reasoning` quality buff.
- The `scale_pretrain` +quality buff is gone; model polish is the Post-Training Studio.
- The `saf_rlhf` / `saf_redteam` serving buffs are gone; layer-1 alignment is per-model (the Studio) and red-team is a dev-time eval (§4.3).

### 6.3 ✅ Quantization — regime-split, both layers

**Reality.** FP8 W8A8 is effectively lossless; INT4 W4A16 wins small-batch decode but collapses on long context (REFERENCE-DOSSIER §2.7, §4.5).

**GPTD.** Serving-layer PTQ (`inf_wq_fp8`/`inf_wq_int4`/`inf_wq_nvfp4`) sets `s.infra.weightQuantBytes` (2→1→0.5), which feeds `bytesPerParam` and so cuts VRAM and the decode bandwidth term. INT4 pays a flat −2 quality and a **steep −6 long-context penalty above 8K real tokens** (`int4ContextPenalty`). Per-model QAT (the Studio `qat` method) is distinct from serving-layer PTQ (REFERENCE-DOSSIER §2.7).

### 6.4 ✅ Speculative decoding — batch-dependent, costs power

**Reality.** Draft-and-verify gives ~2× decode at b=1 but fades as batch grows and is off at batch ≥32; the draft stays hot, so power rises (REFERENCE-DOSSIER §4.4).

**GPTD.** `specMul`: b≤1 → 2.0, ≤4 → 1.7, ≤16 → 1.66, 16<b<32 → lerp to 1.0, ≥32 → 1.0 (`src/sim/effects.ts`). It applies only to decode and adds +8%/level power on the frontier tier — a low-batch outpost rack's neat trick, useless on a saturated core rack (the real "turn it off at high batch" lesson).

---

## 7. Honest calibration notes (real, not bugs)

These are documented design constants, fine to mention as notes:
- `OP_COST_SCALE = 0.036` + `TRAFFIC_SCALE = 100000` scale the real operating bill to a playable level while preserving the wall-clock / idle-bleed property (`src/config.ts`).
- The 48 post-training recipe gain constants are an autoplay-calibratable game curve (validated, not fitted; §3.3).
- The NVL72 is modeled at 57.6 kW from per-GPU TDP × utilization only (no NVLink-switch / CPU overhead), so it reads a bit under the ~120 kW full-rack figure.
- Guardrail default threshold 0.5 causes some over-refusal by design (the no-free-lunch lesson).
- MLA is an equivalent ×0.067 KV scaling, not the true latent geometry (flagged in-tooltip).

## 8. Open questions (⚪ evidence still wanted)

Speculative-decoding acceptance rates; MoE expert-parallel serving overheads (routing imbalance, all-to-all); real prefix/semantic-cache hit-rate distributions; training-fleet GPU failure/straggler rates and training-vs-serving sharing practice; PUE / cooling / demand-response numbers. (All cross-referenced to the unverified-specifics callouts in REFERENCE-DOSSIER.)

---

## References

All real-world numbers and the literature backing each mechanic above are consolidated in [REFERENCE-DOSSIER.md](./REFERENCE-DOSSIER.md) — the single citations source for the redesign (request workloads §1, post-training §2, safety/guardrails §3, serving systems §4, hardware/economy §5, the open-weight roster §6). Cite §refs there rather than duplicating the bibliography here.
