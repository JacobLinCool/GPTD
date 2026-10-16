# GPTD Realism Ledger

> **Single source of truth.** GPTD is a tower-defense game built on real-world simulation — a tower defense grounded in real data-center LLM-inference engineering — *"the board is the metaphor, the numbers are real."* The authoritative design spec is [BLUEPRINT.md](./BLUEPRINT.md) (§0–§7), grounded by [REFERENCE-DOSSIER.md](./REFERENCE-DOSSIER.md) (the real-world citations). **This ledger is reconciled to the shipped code** — it is the "how the game stays true to reality" view of the blueprint. Where this file and the blueprint/code disagree, the code wins.

> New here? GPTD is a tower-defense game simulating an LLM-inference data center — start with the README.

**Purpose.** GPTD's simulation is meant to be *defensible in front of domain professionals* — LLM inference engineers, SREs, datacenter operators, ML researchers. This document is the ledger of every realism-relevant decision: what the real-world mechanic is (with numbers), what the literature says (cited to REFERENCE-DOSSIER.md §refs), what GPTD ships (with code pointers), and where we knowingly deviate. When you change a mechanic, update its entry here and in the blueprint.

**Code anchors.** Serving physics + economy: `src/sim/effects.ts`; the combat tick (admission, prefill, decode, routing, cache, layer 1): `src/sim/combat.ts`; guardrail screening: `src/sim/guards.ts`; outcomes and pay: `src/sim/resolve.ts`; two-layer safety constants: `src/sim/safety.ts`; benchmark→quality: `src/sim/calibrate.ts`; roster: `src/sim/content.ts` + `data/*.json`; player post-training: `src/sim/models.ts`; research tracks: `src/sim/research.ts`; power/cooling: `src/sim/power.ts`; campaign curve: `src/sim/campaign.ts`; the shared load forecast: `src/sim/loadForecast.ts`; constants: `src/config.ts`; types: `src/core/types.ts`. Model grounding has its own document: [REALISM-MODELS.md](./REALISM-MODELS.md).

**Status markers.** ✅ shipped · 🔶 shipped but knowingly simplified · ⚪ open / honest design note.

---

## 0. Governing principle: directional fidelity（方向忠實性）

**Numbers may be tuned for gameplay; the sign structure of a tradeoff may not.** A technique that gives 10× in reality may give +35% in-game — that is balancing. But if a technique has real costs (more VRAM, more power, more compute, lower accuracy, higher latency), those costs **must exist in the game with the correct sign**; they may be softened, never deleted. Conversely, a benefit may not be invented that the real technique lacks.

Most serving mechanics are computed from a **real roofline on real hardware specs** rather than a hand-tuned multiplier, so the benefit and the cost both *emerge* from the physics: a small-active MoE serves fast **and** pins all its experts in memory, and a big batch of it reads the union of their experts; a hybrid-attention model holds many more long-context users **because** most of its layers keep no growing KV. The remaining authored coefficients (recipe gains, a few efficiencies, the economy scale) are honestly flagged as such (§7).

---

## 1. Serving core — the real roofline

> Reality anchors: REFERENCE-DOSSIER §1.1 (prefill compute-bound / decode bandwidth-bound), §4.3 (chunked prefill / disaggregation), §4.6–4.8 (attention variants, parallelism, MoE), §5.6–5.8 (memory, roofline, $/Mtoken), §0#10 (MoE memory-compute decoupling).

### 1.1 ✅ Two-phase requests on a real roofline

**Reality.** A kernel's attainable throughput is `min(compute roof, bandwidth roof)`. Prefill processes the whole prompt in parallel (GEMM, compute-bound); decode emits one token per stream per step and re-reads the weights plus every stream's KV (GEMV, bandwidth-bound). Tuned engines reach roughly 60–80% of HBM bandwidth on decode and 40–60% of peak FLOPS on prefill (REFERENCE-DOSSIER §1.1, §5.7).

**GPTD.** Every request carries real token counts; the rack computes (`effects.ts`):
- `prefillTokS(n) = tensorRate(fmt) × tpDeg × tpEff × MFU_PREFILL / (2 × activeB × (1 + n / (16000 × (1 + 0.5·flash))))` with `MFU_PREFILL = 0.55` — the O(n²) attention term softened by FlashAttention;
- one decode step of a lane `= max(t_mem, t_comp) + background prefill + fixed`, where `t_mem = (weights read + every stream's KV) / (HBM_BW × tpDeg × tpEff × MBU_DECODE)` with `MBU_DECODE = 0.7`, `t_comp = streams × 2 × activeB / (tensorRate × tpDeg × tpEff × MFU_DECODE)` with `MFU_DECODE = 0.5`, and `fixed` = scheduler overhead (1 ms, amortized by multi-step) + TP all-reduces + wide-EP all-to-alls + pipeline hops;
- per-user tok/s `= 1 / step`, aggregate `= streams / step`: per-user speed falls with the batch and its contexts while aggregate rises toward the compute roof.

The weight format sets the tensor rate the GEMMs run at (its *activation* precision): FP8 W8A8 runs at the FP8 rate, INT4 W4A16 dequantizes to the BF16 rate, NVFP4 uses Blackwell's FP4 rate.

### 1.2 ✅ Real hardware ladder (GPU specs, watts, capex, cooling class)

**Reality.** Real accelerators have specific dense tensor rates, HBM capacity and bandwidth, TDP and capex; a single-GPU TDP of ≳1000–1200 W mandates direct liquid cooling. DGX H200 and the air-cooled DGX B200 (~14.3 kW) are air systems; the GB200 NVL72 (~120 kW) is liquid-only (REFERENCE-DOSSIER §5.2–5.5, §0#12).

**GPTD.** `HW_SPECS` (`content.ts`) is the real ladder with per-GPU specs and a GPU count: `hw_edge` (L4-class, 24 GB) → `hw_standard` (L40S, 48) → `hw_perf` (H100, 80) → `hw_frontier` (H200, 141) → `hw_pod` (DGX H200, 8× 141 GB, air) → `hw_superpod` (DGX B200, 8× 192 GB, FP4 tensor cores, air) → `hw_giga` (GB200 NVL72, 72× 192 GB, liquid). Build cost = `capexUsd / CREDIT_USD` (single-GPU tiers at deployed-node capex). Only the NVL72 is liquid-cooled; it is a **hard gate** — it cannot be placed, upgraded into or run without a Liquid Cooling Loop (`hwNeedsLiquid`, `hasLiquidLoop`). A rack's coverage range follows its current tier (`towerRangeTiles`).

### 1.3 ✅ Weights resident at their release precision; formats chosen per rack

**Reality.** Weights must be resident to serve; KV competes for the rest. Checkpoints ship at different precisions (BF16, FP8, MXFP4 / INT4-QAT / FP4 experts), and a model is benchmarked as released. Post-training quantization below the release precision costs some quality (FP8 essentially lossless; 4-bit costs more, especially on long context and hard math). For MoE, **every expert stays resident** while compute tracks the active parameters (REFERENCE-DOSSIER §4.5, §5.6, §0#10–11).

**GPTD.** Resident bytes per parameter = `min(nativeWeightBytes, format bytes)` (`residentBytes`), with the release precision read off the safetensors dtype mix (`data/model-arch.json`): BF16 2, FP8 ≈1, MXFP4 / FP4 / INT4-QAT ≈0.53–0.66. Each rack picks its format between waves among the researched ones — BF16, FP8 (1 B), INT4 (0.53 B incl. group scales), NVFP4 (0.5625 B, Blackwell only) — and *auto* takes the fastest one that costs this model no quality and fits. The PTQ tax (INT4 −2 / −6 past 8K tokens; NVFP4 −1 / −2) applies **only below the release precision** (`ptqBelowNative`): gpt-oss's MXFP4 or DeepSeek-V4's FP4 experts pay nothing in a 4-bit format, and a natively 4-bit checkpoint runs at the FP4 rate on Blackwell without research. Lower-precision GEMMs draw less power (FP8 −15%, 4-bit a further −5%).

### 1.4 ✅ KV from the real architecture; cohorts and KV-limited concurrency

**Reality.** Per-token KV is `2 × layers × kv_heads × head_dim × bytes` for full attention; GQA/MQA cut it via fewer KV heads; MLA stores one compressed latent plus a decoupled RoPE key per layer (DeepSeek-V2/V3: 512 + 64 elements, no K/V doubling); DeepSeek-V4's CSA/HCA store one compressed entry per 4 / 128 tokens; the 2026 hybrids keep growing KV on only a fraction of their layers — linear-attention (Gated DeltaNet, Kimi Delta Attention) and sliding-window layers hold a constant per-request state instead. Pre-PagedAttention allocators wasted 60–80% of KV memory; paged allocation recovers ~96% (REFERENCE-DOSSIER §4.2, §4.6, §6.7).

**GPTD.** `kvPerReqGb = kvBytesPerToken × ctx × (kvQuantBytes / 2) + kvStateMbPerReq` (`effects.ts`), where `kvBytesPerToken` is BF16 over the **KV-bearing layers only**, computed from each checkpoint's `config.json` layer groups (full / MLA latent+rope / compressed / indexer / SWA / linear / shared), and `kvStateMbPerReq` holds the bounded windows and recurrent states. The architecture is data, so the spread is real: Hy3 (plain GQA) keeps 320 KB/token, Muse Spark Open 248 KB, GLM-5.2 (MLA + indexer) 93 KB, Qwen3.6-27B (16 of 64 layers) 64 KB, DeepSeek-V4-Pro (CSA/HCA) 9.6 KB. The KV budget of a model copy is `(group HBM − weights − draft − framework) × kvUtilization` (0.55 → 0.96 with PagedAttention). Each sprite is a **cohort of 28 real streams** (`COHORT_STREAMS`); a cohort is admitted only as far as KV holds (shared prefix blocks stored once), so long contexts or KV-heavy models shrink the batch a rack can carry. The engine caps a lane at 256 streams with Continuous Batching (`ENGINE_MAX_STREAMS`; one static batch before it), so KV, not an arbitrary slot count, is the real limit. Admission checks the **full sequence** (prompt + answer + the hidden tokens that rack's model would think): a request that could never fit one copy is rejected there, and a busy budget makes it wait (the wait counts toward TTFT) — no request is stranded mid-decode.

### 1.5 ✅ Hard context window, and quality that decays as the window fills

**Reality.** A sequence past the trained window is rejected; well before that, quality degrades as a prompt fills the window, and models differ sharply in long-context skill (AA-LCR, ~100K-token documents) (REFERENCE-DOSSIER §1.2#4, §6.3).

**GPTD.** `serverCtxWindowTokens = contextWindowK × 1000` is a hard gate on the full sequence (→ `unservable` if no in-range rack can ever hold it). Below that, `longContextPenaltyFor` subtracts quality: nothing below 25% fill, rising to `24 × (1 − 0.75 × longCtx)` points at a full window (×ramp^1.5), where `longCtx = lcr / 80` is calibrated from the AA-LCR cell (`calibrate.longCtxOf`). A 1M-window model with strong long-context skill barely notices a 100K prompt that a 128K model struggles with. A 4-bit PTQ format adds its long-context tax past 8K tokens and an INT4 KV cache −2 past 32K. FlashAttention grants no quality or window bonus.

### 1.6 ✅ Prefill/decode interference, chunked prefill as a token budget, disaggregation

**Reality.** An unchunked prefill stalls every decode in its batch for its busy time. Sarathi-Serve's stall-free scheduling carries the running decodes plus a **token budget** of prompt chunks per iteration, profiled once from the time-between-tokens target (a long prompt is split; a short one rides one step); vLLM V1 enables chunked prefill by default with an 8192-token default budget on H100-class GPUs, as does SGLang's `chunked_prefill_size`. P/D disaggregation runs the phases on separate pools and ships the KV over the network. The two are opposed strategies (REFERENCE-DOSSIER §1.1, §4.3).

**GPTD.** Without Chunked Prefill a lane prefills one prompt at a time **exclusively** and its decodes stall for the busy time (`combat.ts exclusivePrefill`; a full-tick stall is charged to the stalled decodes' E2E). With it, each step carries the decodes plus up to `chunkBudgetTokens` of prompt (`effects.ts`): the prompt compute that fits between the step's decode compute and `max(CHUNK_STEP_TARGET_MS 30 ms, busy decode step × 1.25)` — including the tokens that hide under the memory-bound reads (the roofline knee) — converted at the short-prompt prefill rate × `CHUNKED_PREFILL_EFF 0.9`, clamped to 256–8192 tokens. A prompt within the budget prefills in one step; a longer one fills `tokens ÷ budget` steps; decodes emit a token every step and pay the longer chunk-carrying steps (`promptOccupancy`, `chunkedPrefill`). Typical budgets: a few hundred tokens for a dense 27B or a 70B, ~1.1–1.4K for an 8–9B FP8 model on an H100, the 8192 cap for a 3B-active MoE on a DGX B200. `inf_disagg` role-pins racks: a pool gain of `DISAGG_POOL_GAIN 1.1`, KV transfer at `KV_TRANSFER_GBPS 50` added to the first decode step, a decode pool takes only KV its own model produced, and the cohort's other prompts are owed to the prefill pool that produced the KV (`prefillDebtSec`) — splitting the phases removes the interference without making the prompt work disappear. Chunked ⟂ disaggregation is a hard research conflict enforced in `researchUnlocked`.

### 1.7 ✅ Dual clock: every SLO judged on the request's real history

**Reality.** The serving objective is **Goodput** — requests meeting per-phase SLOs: MLPerf Interactive 450 ms TTFT / 40 ms TPOT, Conversational 2000 / 200 ms, the long-context 405B scenario 6 s / 175 ms; code completion wants TTFT ≲ 200 ms; for a reasoning model the user-facing latency is the **time to first answer token**, after the hidden thinking (Artificial Analysis measures it separately) (REFERENCE-DOSSIER §1.3, §0#4).

**GPTD.** `SIM_TIME_SCALE = 10` compresses real seconds into board seconds for animation only; lane transit is never latency. **TTFT** = queue wait at racks that could prefill the request (decode-pinned racks, and racks whose window or whole KV can never hold it, do not count) + the prefill's wall time in its completing tick + input-guard checks + the rack's admission delay (pipeline bubble, multi-step wait). **Time to first answer** adds the hidden reasoning's decode time. **TPOT** is judged once at delivery as `decodeSec / (tokens − 1)` (MLPerf's per-request definition; hidden tokens included), and E2E adds the output-guard tail. Bounds (`LAT_CLASS_SLO` + per-type overrides): IN 400 / 40 ms, NR 2000 / 200 ms, TO none; code completion TTFT 200 ms; summarization TTFT 6 s (MLPerf's long-context bound); an agent step 60 s end-to-end; time to first answer ≤ 4 s for chat and jailbreak probes and ≤ 400 ms for code completion. Goodput = clean serves ÷ every terminal outcome (`telemetry.goodputPctOf`); `sloAttainPct` reports answered requests within every bound as a secondary view.

### 1.8 ✅ Era token growth — prompts grew far more than answers, and every request stays servable

**Reality.** Per-request prompts grew roughly 4× and completions roughly 3× on OpenRouter between early 2024 and 2026, driven by programming and context-rich workloads; the IETF workload-profile draft gives the real bands per profile — CHAT 64–16K in / 50–1K out, COMP 256–8K / 5–200, LDQA 4K–128K, SUMM 1K–32K, REAS up to 33K out, AGNT 512–16K accumulated in / 20–500 per step (REFERENCE-DOSSIER §1.4).

**GPTD.** Base lengths (`REQUEST_TYPES`) are 2023 magnitudes; `ERA_TOKEN_GROWTH` (`campaign.ts`) gives each archetype its late-2026 prompt and answer growth, applied on a convex ramp `((tier − 1)/11)^1.5` (2023 stays near base; 2025–26 carries most of the growth) by `groupMuls`, which buildWave and endless share. End-of-campaign sizes (tier 12, prompt / answer): embed 6K / 0 · chat 2.6K / 512 · comp 7.5K / 200 · RAG 48K / 819 · summarization 96K / 1K · reasoning 2K / 12K · agent 48K / 1K per step · batch 3K / 8K · jailbreak 3K / 500 (many-shot jailbreaks are long prompts). Each lands inside its IETF band (summarization's whole documents sit above SUMM's 32K, inside LDQA's range). Hidden reasoning comes on top for a thinking model. Per-request work stays physically servable at real per-user speeds; late difficulty comes from volume, mix, the quality line (+2% per tier), hazards and incidents. The Codex shows the `base → era` range.

### 1.9 ✅ Model-parallel groups: copies add concurrency, not per-user speed

**Reality.** A model too big for one GPU is split by tensor parallelism inside an NVLink domain at sub-linear efficiency (two all-reduces per layer on the critical path; NVLink systems measure roughly 70–85% at TP=4 and 56–75% at TP=8), or across stages by pipeline parallelism (memory, not latency). Extra GPUs beyond what a copy needs run more copies (data parallelism) — more concurrency, never a faster stream. Expert parallelism shards an MoE's experts across GPUs with an all-to-all per MoE layer (REFERENCE-DOSSIER §4.7–4.8).

**GPTD.** `rackPlan` puts one copy on the smallest power-of-two GPU group whose HBM holds weights + draft + framework; `replicas = ⌊gpus / g⌋`. A stream runs at `tpDeg = min(g, 8)` × `TP_EFFICIENCY {1, 0.9, 0.8, 0.65}` plus `2 × layers × ALLREDUCE_US (8 µs)` per step; GPUs beyond 8 are pipeline stages (`PP_HOP_US 30` per step, `PP_BUBBLE_MS 20` per extra stage on TTFT). Research gates the span: before Tensor Parallelism a copy must fit one GPU (a multi-GPU rack runs replicas), TP allows ≤8, Pipeline Parallelism beyond (the deploy picker and denial reasons say "needs Tensor/Pipeline Parallelism"). Data Parallelism makes the whole rack one scheduling group (requests load-balanced over every copy and the pooled KV; without it a cohort stays on the copy it landed on). Wide EP (an MoE served as several copies) reads only `1/replicas` of the expert union of the rack's pooled batch, plus `2 × layers × ALLTOALL_US (12 µs)`.

### 1.10 ✅ Realistic batching — and the calibration against public numbers

**Reality.** Under production batches, per-user decode speed sits in a 20–300 tok/s band while aggregate throughput reaches thousands; an MoE batch touches the union of its tokens' experts, so its weight reads grow with the batch (REFERENCE-DOSSIER §4.8, §5.7).

**GPTD.** An MoE step reads its always-on part (`MOE_SHARED_FRAC 0.35` of the active parameters) plus `routedTotal × (1 − (1 − routedActive/routedTotal)^b)` of the routed experts for `b` streams (`weightsReadGb`). Measured on the shipped code (racks with Continuous Batching, PagedAttention, FP8 where marked, TP/PP; b1 = one stream alone; one cohort = 28 streams; busy = two cohorts per lane, a 1.5K/256 mix at 1.6K context; prefill of a 1.5K-token prompt; the Llama rows use a dense body with the real Llama-3.1-8B / 3.3-70B layer layout, since neither is in the active roster):

| Rack + model | Split | b1 tok/s | one cohort | busy per-user / aggregate | 1.5K prefill | Public basis |
|---|---|---|---|---|---|---|
| Llama-3.1-8B BF16 / L40S | 1 GPU | 36 | 25 | 13 / 736 | 132 ms | 0.864 TB/s ÷ 16 GB ≈ 54 tok/s roof at b1 |
| Llama-3.1-8B BF16 / H100 | 1 GPU | 128 | 91 | 43 / 2.4K | 48 ms | 3.35 TB/s ÷ 16 GB ≈ 209 roof; ~60% MBU at b1 (Databricks) |
| Llama-3.1-8B FP8 / H100 | 1 GPU | 227 | 131 | 68 / 3.8K | 24 ms | — |
| same + Chunked Prefill | 1 GPU | 227 | 131 | 105 / 5.9K | 24 ms | vLLM V1 default scheduler |
| Llama-3.3-70B FP8 / H200 | 1 GPU | 46 | 36 | 13 / 728 | 211 ms | 4.8 TB/s ÷ 70 GB ≈ 69 roof; 2·70B·1.5K ÷ (1979 TF × 0.55) ≈ 190 ms |
| gpt-oss-120b (MXFP4) / H100 | 1 GPU | 451 | 56 | 35 / 2.0K | 15 ms | AA measured API median ≈ 212 tok/s |
| Qwen3.5-397B FP8 / DGX H200 | 4 GPU × 2 copies | 282 | 43 | 28 / 3.1K | 16 ms | AA measured API median ≈ 55 |
| GLM-5.2 FP8 / DGX B200 | 4 GPU × 2 copies | 223 | 34 | 24 / 2.6K | 17 ms | AA measured API median ≈ 72 |
| DeepSeek-V4-Pro (FP4 experts) / DGX B200 | 8 GPU × 1 copy | 347 | 66 | 42 / 2.4K | 6 ms | AA measured API median ≈ 93 |
| Kimi K3 (MXFP4) / NVL72 | 16 GPU (2 stages of TP8) × 4 copies | 221 | 53 | 21 / 9.6K | 13 ms | AA measured API median ≈ 45 |

The measured API speeds (Artificial Analysis' median output speed, carried in `AA_META`) sit between the game's single-stream ceiling and its busy-rack figure — where real providers trade per-user speed against concurrency. The test suite also checks that a rack card's shown $/Mtok matches the cash flow it produces within ±15% (`tests/metrics.test.ts`).

### 1.11 ✅ Thinking tokens, and the hybrid's instant mode

**Reality.** A reasoning model emits hidden thinking before its answer: it costs decode time and KV like any token, and the user waits for the first *answer* token. Most 2026 open checkpoints are hybrids whose serving stack switches thinking off per request (`enable_thinking=False`, `thinking_mode="chat"`, `reasoning_effort="no_think"`); some always think and expose only an effort knob (REFERENCE-DOSSIER §1.4, §6.7).

**GPTD.** A checkpoint's thinking support (`always` / `hybrid` / `never`) is read off its chat template (`data/model-thinking.json`). The engine policy `answerMode`: a hybrid answers latency class `IN` (chat, code completion, jailbreak probes) **instantly**, judged on `qualityByInstant`, and thinks on `NR` / `TO` traffic; an always-thinker always thinks; embeddings never do. Hidden tokens = `thinkTokens × thinkMul` (chat / RAG / summarization / batch / jailbreak 0.5, comp 0.05, agent 1, reason 0 because its output already is the reasoning), added at the first token by the model that produced it: they decode first, grow KV, add E2E, count toward TPOT and are **never billed** (`processedRevenue` caps billed output at the answer). The router's ETA and admission's full-sequence check include them. The mode is latched on the request and carried on its outcome event.

---

## 2. Models & calibration — capability is a benchmark-derived vector

> Reality anchors: REFERENCE-DOSSIER §6 (open-weight landscape), §6.3–6.4 (benchmark saturation, the agentic gap), §6.7–6.8 (the 2026 landscape and the benchmark host's eval changes), §2.9 (lineage). Pipeline details: [REALISM-MODELS.md](./REALISM-MODELS.md).

### 2.1 ✅ 58 active real open-weight checkpoints, gated from a 135-checkpoint pool, free to deploy

**Reality.** Open weights are a free download; what gates use is whether the checkpoint fits the accelerators (REFERENCE-DOSSIER §6, §0#11).

**GPTD.** The candidate pool is every checkpoint with a Hugging Face architecture record: 52 hand-authored (`ROSTER`, drawn from the fact-checked [MODEL-CATALOG.md](MODEL-CATALOG.md)) + 83 generated (`roster.generated.ts`, explicit open-weight evidence: an HF repo in `data/model-arch.json`). The **6% frontier-tolerance gate** (`withinFrontierTolerance`) keeps a checkpoint only if it is within 6% of the best quality at its size or smaller on some axis ([PARETO.md](PARETO.md)), leaving **58 active checkpoints from 0.6B to 2.78T**. All are owned free from turn one (`STARTER_MODELS = OPEN_MODEL_IDS`); deploying costs nothing; fit (weights at release precision + framework per GPU, within an allowed parallel group) is the gate. Real metadata (`m.real`: developer, licence, release, source, precision, benchmark provenance, thinking toggle) is display-only — the sim never reads it.

### 2.2 ✅ `qualityBy` calibrated from six benchmark cells on one frozen reference scale — never hand-edited

**Reality.** Capability is a vector over task types, not a scalar. Benchmark hosts re-run, re-score and retire evals: Artificial Analysis removed IFBench from its index (v4.1, June 2026), replaced Terminal-Bench 2.1 with the much harder Terminal-Bench 4.0 (v4.3, September 2026), moved GPQA and τ-bench to legacy, and re-ran AA-LCR, HLE and SciCode under new harnesses; it also recycles model slugs onto newer checkpoints (REFERENCE-DOSSIER §6.8). Composite indexes re-baseline between versions.

**GPTD.** Each axis is a weighted blend (primary 0.6, two secondaries 0.2) of six AA cells — chat = IFBench-led, general = GPQA-led, coding = SciCode-led, reasoning = HLE-led, agentic = Terminal-Bench-Hard-led — mapped through a per-axis piecewise-linear curve with a saturating tail toward 130 (`calibrate.ts`). Every cell lives on **one frozen reference scale**, the 2026-06-21 snapshot the curves were quantile-fitted on (`data/aa-reference-2026-06-21.json`). At build time (`scripts/aa-cells.mjs`) each cell resolves reference → latest (a frozen eval as-is; a re-scored one through same-UUID mean-sigma equating, e.g. `LCR_ref = −0.63 + 0.906 × LCR_latest`) → an OLS **bridge** from measured cells, clamped to the observed range. Models are pinned by AA UUID, and a guard refuses a recycled or renamed slug. The proof the scale is stable: every pinned model measured on the reference snapshot keeps its reference cells exactly (`tests/models.test.ts`). The composite index is never fed to calibration.

### 2.3 ✅ The agentic axis — the last to compress

**Reality.** Through 2025 small thinking models closed the knowledge and reasoning gaps while agentic / terminal benchmarks kept a real separation; by late 2026 strong open models clear terminal suites that once separated the frontier (REFERENCE-DOSSIER §6.4, §6.7).

**GPTD.** `agentic` is Terminal-Bench-Hard-led; the `agent` line is 82 at tier 1 and ≈100 at tier 12 (+2% per tier). Early small bodies sit below it; in the late-2026 data a dense 27B (Qwen3.8-27B, agentic 125) crosses it. The late agentic challenge is therefore a serving one — a 48K-token accumulated prompt, a full think and the answer inside one minute — rather than a capability wall (DESIGN §15).

### 2.4 ✅ `paramsTotalB` vs `paramsActiveB`, the expert union, real lineage

**GPTD.** Each model splits `paramsTotalB` (memory) from `paramsActiveB` (per-token compute); a batch's weight reads climb from active toward total (§1.10). Lineage edges come from the HF `base_model` metadata where it exists (e.g. GLM-5.3 → GLM-5.2's base; Nex-N2-Pro → Qwen3.5-397B) and show on the Lineage Graph.

### 2.5 ✅ Thinking support from the chat template; the thinking budget from serving telemetry

**Reality.** Whether a checkpoint can answer without thinking is a property of its released chat template / encoding script; how long it thinks shows in a provider's time-to-first-answer-token measurements (REFERENCE-DOSSIER §1.3, §6.7).

**GPTD.** `data/model-thinking.json` records each checkpoint's support with a verbatim quote from its template, card or encoding script, verified by `scripts/thinking-sync.mjs verify`. In the active roster: 37 hybrid, 19 always, 2 never. A hybrid's `qualityByInstant` is calibrated from AA's non-reasoning row of the **same** checkpoint (pinned by UUID; same name and release date) or, when AA timed it only in thinking mode, from a per-cell pair fit `instant = a + b × thinking` over the measured pairs, clamped to the thinking cell (`data/aa-bridges.json` `instant`). `thinkTokens = clamp((ttfat − ttft) × output tok/s, 300, 4000)` from AA's serving telemetry on the pinned thinking variant, 1500 when untimed (`calibrate.thinkingOf`).

---

## 3. Post-Training Studio — the real per-model taxonomy

> Reality anchors: REFERENCE-DOSSIER §2 (post-training stack), §2.6 (merging needs a shared source), §2.8 (the five tradeoffs), §2.10 (per-model vs serving-layer).

### 3.1 ✅ Almost all post-training is per-model; it mints a new checkpoint

**Reality.** Each post-training step (CPT / SFT / DPO / RLHF / GRPO / CAI / distill / merge / QAT…) produces a **new weight artifact**; only multi-LoRA serving and PTQ deployment live at the serving layer (REFERENCE-DOSSIER §2.10).

**GPTD.** The **Post-Training Studio** (`models.ts`, `METHOD_RECIPES` in `content.ts`): base (a roster model or a derived one) × method × target × effort, paid in Data up front and requisitioned compute during waves, mints a named derived `ModelDef` with a `Lineage` record. Serving-layer techniques stay in the infra tree (PTQ formats per rack; Multi-LoRA adapter swaps).

### 3.2 ✅ `deriveQuality` models the real tradeoffs — and the body's capacity

**Reality.** Alignment tax (alignment ↑ ⇒ general capability ↓), catastrophic forgetting (worst for CPT without replay), capability-vs-safety tension, data quality > quantity, narrow-FT overfitting; RL and distillation gains on small models are bounded by the base's capacity (DeepSeek-R1's distill results) (REFERENCE-DOSSIER §2.1, §2.5–2.8).

**GPTD.** `deriveQuality`: `depthDamp = 1/(1 + 0.15·depth)`, `headroom = (130 − base)/130`, the recipe's `gainCap`, and a **capacity ceiling** set by the deploy body — the best `qualityBy[axis]` among roster *base* models with at most 2× its total parameters, +6, ≤130 (`capacityCeiling`; it depends only on the body, so stacking runs cannot ratchet it; distillation uses its own student cap). Forgetting on every non-target axis scales `forgetScale × √effort × (1 + 0.5·(depth − 1))`; CPT forgets ≈3 points per axis at effort 1. The alignment tax lands on `general` for safety targets, RLHF and CAI. Distill moves the capability into a smaller student (`min(teacher, student + 18)`); QAT sets a 4-bit release precision (no PTQ tax afterwards) at −2. **RLHF** buys high safety with the steepest tax and rising over-refusal; **CAI** buys a Pareto improvement (safety ↑, over-refusal ↓, safe-completion). The run moves a hybrid's instant vector by the same per-axis amount; a reasoning run teaches an instruct model to think (`never → always`).

### 3.3 ✅ Merging needs one shared source

**Reality.** Weight averaging (model soups, Model Stock, TIES) works across fine-tunes of the **same** pre-trained base and architecture; it interpolates behaviour, alignment included (REFERENCE-DOSSIER §2.4, §2.6).

**GPTD.** A merge needs two distinct checkpoints with the same root base and an identical body (`mergeCompatible`: reasons `self` / `root` / `body`); it costs Data for the evaluation pass; the result's safety, over-refusal and instruction-following are the parents' mean, a refusal style survives only if both share it, and its thinking support is shared or becomes hybrid. No gain, no forgetting.

### 3.4 🔶 The recipe gain/cost table is an honestly-flagged game curve

**Reality vs game.** Base `qualityBy` is physics (benchmark → quality). Derived **gains** are not first-principles — they are a calibrated game curve. The recipe constants (`gainScale` / `gainCap` / `taxScale` / `forgetScale`) are marked `autoplay-calibratable`; `calibrateRecipes` is a validating pass-through asserting the band-displacement ordering (merge 0 < adapters < heavy methods; GRPO leads the reasoning/agentic methods). Training cost is grounded by relative magnitude: compute ∝ `costCompute × (active/8)^0.7 × effort` × `POSTTRAIN_COMPUTE_SCALE` × a lineage-depth surcharge × a mild MoE sparsity factor; Data ∝ effort × depth surcharge × total parameters^0.45.

---

## 4. Safety — two distinct layers

> Reality anchors: REFERENCE-DOSSIER §3 (two-layer model), §2.4 (alignment as post-training), §3.1 (safe-completion), §3.3 (guardrail systems), §3.6 (the cost of safety: latency, over-refusal, evasion).

### 4.1 ✅ Layer 1 — model-intrinsic alignment, rolled once at the first output token

**Reality.** RLHF / CAI / safety-SFT / safe-completion are baked into the weights; at inference there is no per-request safety dial. Alignment acts mostly through the first output tokens; safe-completion (GPT-5) pays a lower tax than hard refusal. Over-refusal is measured on borderline-but-benign prompts (XSTest, OR-Bench), so how often a workload trips it depends on how much of it is borderline (REFERENCE-DOSSIER §2.4, §3.1, §3.6).

**GPTD.** `AlignmentProfile {safety, refusalStyle, overRefusal}` per model (family defaults; no public safety benchmark to calibrate against — Muse Spark Open carries its card's stronger standalone safety, 72). Rolled **once, at the first output token, by the rack that produced it** (`combat.applyLayer1`); a rack that never admitted the request cannot refuse or sanitize it, and an embedding (no generated text) never rolls. Over-refusal of a benign request = `overRefusal × refusalExposure` (chat 1.0, reasoning 0.5, RAG 0.4, summarization 0.3, batch 0.2, comp 0.1, embed 0; an agent step always carries an injection hazard, so it is never treated as benign). Self-handle = `clamp01(safety/100 − severity × HAZARD_HARDNESS[h])` with hardness jailbreak 0.35, injection 0.55, harmful 0.2, PII 0.3; a handled attack is answered with a 30-token refusal or a 200-token safe completion. Alignment tax = `TAX_K[style] × max(0, safety − 40)/100` with `TAX_K = {none 0, hard-refusal 9, safe-completion 4}`, subtracted in `serverQualityVs`.

### 4.2 ✅ Layer 2 — guardrails as pipeline stages covering lanes

**Reality.** Guardrails are separate models/classifiers on the request path (input → guard → LLM → guard → user), not per-rack devices; one classifier gives one verdict for one input, so copies add capacity, not recall; distinct systems stack. A BERT-class encoder (Prompt Guard 2 86M: 92.4 ms per 512-token classification on an A100 per its card; longer prompts split and scanned in parallel) is input-only; a generative judge (Llama Guard 4 12B) reads the turn and emits `safe`, or `unsafe` plus category codes — a prefill plus a few tokens — on both sides (REFERENCE-DOSSIER §3.2–3.3).

**GPTD.** `guards.ts`: a guard screens every request on the lanes its range circle touches, wherever it sits; each request is screened once, at its first contact with a rack that could prefill it. Per family on the lane: input latency once (→ TTFT), output latency once (→ E2E), one false positive × refusal exposure, the family's **best** recall among covering copies; distinct families stack. An input catch blocks the attack before any compute; output checks run before delivery.

- `guard_encoder` — fixed 92 ms (the card figure), input-only, jailbreak (+ injection after Red-Team Eval), 0.1 kW.
- `guard_llm` — a real 12B inference on its own H100 rack via the roofline (`guardCheckMs`): the prefill of the turn it reads (the user prompt on input; prompt + answer on output; each part capped at `GUARD_TURN_TOKENS 2048`) plus `GUARD_VERDICT_TOKENS 3` (the first from the prefill, two decoded). Measured: 27 / 48 / 134 / 269 ms at 100 / 512 / 2048 / 4096 tokens in BF16, 15 / 26 / 73 / 145 ms in FP8; readouts quote the 512-token figure. It draws its rack's kW (0.56 BF16 / 0.48 FP8) and pays its GPU-hours and energy; in a brownout it is shed with support, after every server.
- `guard_mod` — hosted moderation, fixed 120 ms, both sides, harmful (+ PII after Red-Team Eval II); kept out of the build bar.

🔶 **Known inversion.** The encoder's fixed 92 ms is Meta's published per-classification figure, while the generative judge is priced from first principles on an H100; on short prompts the game's Llama Guard (26–48 ms) is therefore *faster* than its encoder, inverting the real ordering, where an optimized 86M encoder is a few milliseconds of GPU time (third-party encoder guardrails decide in 2.4–9.5 ms) and a generative judge is roughly an order of magnitude slower for a typical prompt. What the game keeps right is the cost structure: the judge scales with the turn, checks both sides, and costs a GPU and power of its own (REFERENCE-DOSSIER §3.3 note, §3.6).

### 4.3 ✅ A fixed operating point; red-team is a dev-time eval

**Reality.** A deployment picks a guardrail threshold and lives with its recall/over-refusal tradeoff; red-teaming calibrates the system (judge by intent, XSTest) rather than weakening attackers (REFERENCE-DOSSIER §3.5–3.6).

**GPTD.** The threshold is a fixed 0.5 (`s.guardrailThreshold`; no in-game control), so `effRecall = baseRecall × (0.6 + 0.8·0.5) + 0.02 × redteam level` and the benign false-positive rate is `OVERREF_K × 0.25 × overrefMul` (encoder 0.06, generative 0.1, moderation 0.05 at K). Red-Team Eval (eval track) multiplies over-refusal by 0.7 and unlocks injection detection (v1) and PII detection (v2); the +0.02 recall is "calibrating the threshold, not improving the model".

### 4.4 ✅ Attacks escalate with the era; novel attacks evade classifiers

**Reality.** Attack sophistication rose from manual DAN role-play (2023) through transferable adversarial suffixes, many-shot jailbreaks and indirect / agentic injection (2025–26); fine-tuned input classifiers are brittle under distribution shift and evasion attacks, while a generative judge reasoning about intent degrades less (REFERENCE-DOSSIER §3.4, §3.6; arXiv 2504.11168).

**GPTD.** Every hazard severity is multiplied by `hazardMulOf(tier) = min(1.45, 1 + 0.039·(tier − 1))` and clamped to 1 (the jailbreak's 2023 base 0.7 reaches 1.0 by tier 12; an agent's tool-borne injection 0.3 → 0.43). A share of attacks are **novel**, `novelShareOf(tier) = clamp(0.05·(tier − 2), 0, 0.5)`, assigned by spawn order (no RNG draw); against them a family keeps `NOVEL_RECALL_MUL` of its recall — encoder 0.45, moderation 0.7, generative 1. Layer 1 is judged on severity, not novelty. Authored overrides arm specific events (W48 reasoning carries harmful content; W66 RAG carries injection).

### 4.5 ✅ The verdict: a breach is an unsafe answer delivered

**GPTD.** A hazard is handled iff the model self-handles it or a covering guard catches it. An `unsafe` breach is an unsafe answer actually **delivered** (resolved at delivery; Trust × `safetyDamage`, no SLA); a hazardous request never answered is a plain `leaked` (SLA only; an attacker who got no answer costs no Trust). A handled attack resolves `served` and is paid only for the tokens processed. A benign request wrongly refused by either layer is `overRefused` (Trust −0.25 × penalty, SLA −0.2 × penalty), light enough that one refusal does not outweigh several clean serves, heavy enough that a 12%-refusal model is visibly worse than a 3% one.

---

## 5. Economy — real $/Mtoken, real $/GPU-hr, real kW

> Reality anchors: REFERENCE-DOSSIER §5.8 (`$/Mtoken` identity; low utilization is fatal; PUE and industrial power price), §1.4 (per-workload prices).

### 5.1 ✅ The cohort identity: the $/Mtok a rack shows is the rate its cash obeys

**Reality.** `$/Mtoken = ($/GPU-hr × 3600) / (aggregate tok/s × 1e6)`; a 10%-loaded rack can cost 10× per token (REFERENCE-DOSSIER §5.8).

**GPTD.** A sprite is `TRAFFIC_SCALE = 100,000` requests; a board rack is `RACKS_PER_TILE = TRAFFIC_SCALE / COHORT_STREAMS ≈ 3,571` real racks; both income and the bill carry the scale, so the rack card's $/Mtok (`dollarsPerMtokenAt`) is the rate the cash flow follows (within tick granularity; checked ±15% in tests). Income = real $/Mtoken on the tokens actually **processed** — the prompt ingested (a cached prefix included) plus the answer tokens — × the market multiplier (`processedRevenue`).

### 5.2 ✅ A wall-clock bill in two lines; idle racks bleed

**Reality.** A rack's all-in hourly cost is mostly amortization, maintenance and colocation; electricity is a few percent of it at industrial prices (US industrial average ≈8.6¢/kWh in 2025) and facility PUE (global average ≈1.54; hyperscale and direct-liquid sites far lower) (REFERENCE-DOSSIER §5.8).

**GPTD.** `towerOpexPerSec` (the one rule the economy tick, the next-wave bill preview and the burn readout share): the **GPU-hour line** = the per-GPU-hour rate minus the electricity it embeds, paid by every online rack busy or idle; the **energy line** = kW drawn × (30% idle → 100% by load) × throttle × PUE (air 1.4 / liquid 1.15) × $0.10/kWh × the incident's power price. Energy is ~2–4% of a rack's all-in hour at full load; power-price incidents therefore scale only that line (the grid-capacity incidents that cut kW are the real power lever). A requisitioned training rack bills fully loaded; a dark rack bills nothing; the generative guard's rack pays both lines. The utilization penalty emerges.

### 5.3 ✅ Seven outcomes; Goodput pays the SLA contract

**GPTD.** `resolve.ts` settles each request into one of seven outcomes (DESIGN §11): served 100% pay, sloMiss 50% (the SLA credit), every other outcome 0 (wrong answers are refunded). Goodput = served ÷ all terminal outcomes. Each cleared wave pays its **SLA contract** `(160 + 40 × tier + 320 on a boss) × 0.12 × Goodput` (`campaign.contractPayout`): committed customers paying for capacity served cleanly — most of the early income, overtaken by token income by the 2024 tiers. Lose on `cash < 0` / `trust ≤ 0` / `sla ≤ 0`.

### 5.4 🔶 Routing and admission — capability dispatch, first-free prompt claiming, co-decoding

**Reality.** A model gateway routes each request to a model that can answer it (RouteLLM-style cost/quality routing); a cluster router balances load across replicas and, KV-aware, sends a request where its prefix is cached; one replica prefills a prompt and decodes it (REFERENCE-DOSSIER §1.5, §4.10).

**GPTD.** A Router reserves every request in its range for an in-range rack with a free slot: among racks that answer it correctly (margin ≥ 0 in that model's answer mode) the soonest finish (remaining answer + hidden tokens at the rack's one-cohort per-user speed), ties → larger margin; otherwise the best margin; never stranding traffic. KV-aware routing recovers 50% of routed cacheable misses up to the 0.85 prefix ceiling. Without a router each rack admits the requests nearest the core first. Two deliberate abstractions:
- **First-free prompt claiming.** A prompt is claimed each tick by the first rack in build order that has a free slot and room, with no load balancing across racks, so prompts pile onto the earliest racks; a request waiting at a full entry rack keeps accruing TTFT as it walks. Real fleets balance prompts across replicas.
- **Co-decoding.** An unreserved decoding request is admitted as a decode job by every in-range rack with a free slot, so its sprite can sit in several batches and its tokens are credited per rack. Its *latency* is still accounted at each rack's physical per-token rate (several racks never make its tokens faster), and its quality is the token-weighted margin of the racks that wrote it; the board simply finishes it in fewer ticks. A real request is decoded by one replica.

### 5.5 ✅ Real power & cooling: two pools, a phase-asymmetric throttle

**Reality.** ≈all electrical power becomes heat; a coolant loop plumbed to cold plates cannot cool an air-cooled chassis; decode is more memory-bound than prefill, so it keeps an edge under a thermal cap (REFERENCE-DOSSIER §5.5).

**GPTD.** `serverPower = TDP × gpus × RACK_UTILIZATION (0.8) × format reduction × (1.08 with speculative decoding)` in real kW (an H100 rack ~0.56 kW, a DGX H200 ~4.5 kW, a DGX B200 ~6.4 kW, an NVL72 ~57.6 kW). Power: a 6 kW substation + 8 kW per Power Plant, × the curtailment modifier; over budget, the hungriest servers go dark first, then support. Cooling has **two pools** (`power.ts`): air (6 kW house chillers + Cooling Towers) for every air rack, liquid (Liquid Cooling Loops) for liquid racks only; each pool throttles only its own racks, `throttle = max(0.2, capacity / heat)`. Prefill and compute-bound steps take the full throttle; memory-bound decode uses `decodeThrottle(t) = 1 − (1 − t) × 0.85`. Meters refresh after every build-phase action and after a telegraphed incident; `brownout` events fire on transitions only.

---

## 6. Infra tech tree — serving/infra only, every node with its real effect and cost

> Reality anchors: REFERENCE-DOSSIER §4 (serving systems), §2.10 (only multi-LoRA + PTQ are serving-layer).

### 6.1 ✅ 22 infra nodes on typed `s.infra`, three research tracks on one pool

**GPTD.** All serving switches live on `s.infra` (`InfraState`). The 22 `InfraNodeDef` span eight categories (scheduling, kv-memory, decoding, weight-quant, parallelism, routing, multi-lora, engine). Research runs on three tracks — infra / posttrain / eval — that **share one requisitioned pool**: whole racks, strongest first, that fit under `RESEARCH_MAX_SHARE = 0.45` of fleet bf16 FLOPS (rounding down; the weakest rack only if nothing fits; never the last online rack), the lent rate split equally across active tracks (`requisitionPick`, `updateResearch`). Projects start between waves and advance during them; `requisitionPreview` shows the lent racks, the serving share lost and the waves a project needs.

### 6.2 ✅ What each node really does

| Node | Real effect in GPTD | Real cost kept |
|---|---|---|
| Continuous Batching | engine cap 256 streams per lane (one static batch before) | per-user speed falls as the batch grows |
| Multi-Step Scheduling | step overhead amortized over 8 steps | new requests join only every few steps (+4 steps of admission wait) |
| Chunked Prefill | token-budget scheduler (§1.6) | decodes pay the longer chunk steps; prompt work at 90% |
| P/D Disaggregation | role-pinned pools, ×1.1 pool gain | KV transfer at 50 GB/s; decode pools take only their model's KV; prompts owed to the prefill pool |
| PagedAttention | KV utilization 0.55 → 0.96 | — |
| Prefix Caching | cache hit 0.35 → the 0.7 cap; skips the shared prefix only | the suffix still prefills; cached input billed at full price |
| FlashAttention | O(n²) prefill term 1.5× slower to grow; KV reads ×1.2; 0.5 GB/GPU activation memory back | no quality, window or KV-size bonus |
| FP8 / INT4 KV Cache | growing KV ×0.5 / ×0.25 | INT4 KV −2 quality past 32K tokens |
| KV Offloading (LMCache) | +0.12 prefix hit chance (cap 0.9) from a CPU/SSD tier | PCIe reload at 25 GB/s on TTFT; never active-attention KV |
| Speculative Decoding (EAGLE) | 4 drafts verified per step; accepted tokens by axis (coding 2.4 … reasoning 1.7) | draft VRAM (3% of weights, ≥0.5 GB); +8% power on every tier; verify compute; off once it stops paying |
| FP8 / INT4 / NVFP4 weights | per-rack formats (§1.3) | INT4 at the BF16 rate and taxed; NVFP4 Blackwell-only (research needs a Blackwell rack) |
| Tensor / Pipeline / Data / Expert Parallelism | groups, replicas, load balancing, wide EP (§1.9) | TP efficiency < 1 + all-reduces; PP hops + bubble; EP all-to-all |
| KV-Aware Routing | routed cacheable traffic finds its prefix more often | needs a router; never speeds decode |
| Multi-LoRA Serving | a base and its adapters hot-swap mid-wave | unmerged adapters run at 0.93 speed until the next wave |
| SGLang ⟂ TensorRT-LLM | RadixAttention +0.1 hit (cap 0.8) ⟂ compiled kernels ×1.12 MBU/MFU | a one-way choice |

### 6.3 ✅ What is modeled where (not as a tech node)

- **MoE**, **GQA / MLA / CSA / hybrid attention**, **thinking** are **model properties** (memory vs compute, KV layout, chat-template support), not fleet buffs.
- Model polish is the Post-Training Studio; layer-1 alignment is per-model; red-team is a dev-time eval.

---

## 7. Honest calibration notes and known deviations

Documented design constants and simplifications, fine to state openly:

- 🔶 **MoE single-stream speed is optimistic (≈1.5–2×).** The roofline has no per-layer routing / gating or kernel-launch overhead, so a lone stream on a sparse MoE reads only its active experts at full MBU: gpt-oss-120b on one H100 decodes ~450 tok/s alone, against ≈210 tok/s measured by Artificial Analysis on live APIs. Production-batch speeds land in range (§1.10).
- 🔶 **Speculative decoding fades much later than measured.** In the roofline the KV re-read keeps a step memory-bound, so verifying four drafts stays cheap: a dense 9B on an H100 keeps ~1.9× up to ~100 streams per lane (fading past 128), and a sparse MoE keeps ~2× through the engine's 256-stream cap. The dossier's EAGLE-3 measurements peak near batch 56 and approach zero by 64+, and practice switches it off from batch 32 (REFERENCE-DOSSIER §4.4). Its power, VRAM and verify-compute costs are kept.
- 🔶 **The encoder guard reads slower than the generative judge on short prompts** (§4.2): a fixed card figure against a first-principles roofline price.
- 🔶 **Co-decoding and first-free prompt claiming** (§5.4): no cross-rack prompt load balancing; an unreserved decode may sit in several racks' batches.
- 🔶 **An unservable verdict latches on any rack.** A request one in-range rack finds infeasible (window or whole-copy KV) is marked, so if no capable rack reaches it before the core it ends `unservable` rather than `leaked`.
- 🔶 **Chunked long prompts.** A long prompt's later chunks cost more (their attention reads the earlier chunks), so a step can run past the 30 ms target while long documents are read.
- 🔶 **Bridged benchmark cells carry real uncertainty**: GPQA bridged from HLE + LCR + SciCode (residual sd ≈7.5), IFBench from LCR + HLE + GPQA (sd ≈9.4), TB-Hard from Terminal-Bench 2.1 + HLE + SciCode (sd ≈5.0). The calibration reads the resolved values; Expert mode marks them ≈ (bridged).
- 🔶 **Instant-mode vectors.** One `longCtx` serves both modes; hybrids AA timed only in thinking mode get pair-fit instant cells; Qwen3.6-35B-A3B's AA non-reasoning SciCode of 1.3% is kept as measured (its instant coding reads 32); Hy3 is deliberately not paired (AA's non-reasoning row is the earlier Hy3-preview checkpoint).
- ⚪ **Hidden thinking per archetype is a design choice**: summarization and batch think on hybrids (`thinkMul 0.5`), although real stacks often switch thinking off for summarization; reasoning's `thinkMul` is 0 because its long output already is the chain of thought.
- 🔶 **The Studio's capacity ceiling uses total parameters**, so a sparse MoE body is bounded by dense peers of its total size, not its effective size.
- 🔶 **Cached prompt tokens bill at full price.** Real providers discount cached input (Anthropic: cache reads at 1/10); the cache's in-game value is TTFT and prefill capacity.
- 🔶 **Constitutional AI about halves a hard-refusal model's over-refusal** (−0.04 × √effort: ≈0.12 → ≈0.063 at the top effort notch), still about twice gpt-oss's 0.03; a stronger cut would be a design call.
- 🔶 **The load forecast is an estimate.** It runs combat's math at the wave's arrival moments but approximates rack-to-rack contention; RAG first-token time behind long embeddings is under-predicted for some dense models.
- ⚪ **Every agent step carries an injection attempt.** The `agent` archetype always holds a tool-borne injection hazard (0.3, escalating with the era), so until a red-teamed guard covers its lane only the model's alignment stands between it and an unsafe delivery. Real agent traffic carries injected instructions in some fraction of its tool outputs, not every step; the uniform hazard is a pessimistic stand-in that makes injection defence a standing requirement on agent lanes.
- ⚪ The guardrail threshold is a fixed 0.5 operating point (§4.3).
- ⚪ `TRAFFIC_SCALE = 100,000` and `RACKS_PER_TILE` are the economy's scale; the SLA contract (`CLEAR_BONUS_SCALE 0.12`) stands in for subscriptions and reserved capacity a token meter alone does not capture.
- ⚪ Electricity is a flat $0.10/kWh before incidents; the NVL72 reads 57.6 kW from per-GPU TDP × utilization only (no NVLink-switch / CPU overhead), under the ~120 kW full-rack figure.
- ⚪ TensorRT-LLM's per-model compile delay on redeploy is not modeled; the engines differ only in their benefit and lock each other out.
- ⚪ The 48 post-training recipe constants are an autoplay-calibratable game curve (§3.4).

## 8. Open questions (⚪ evidence still wanted)

Speculative-decoding acceptance and its fade with batch on MoE targets; MoE expert-parallel serving overheads (routing imbalance, all-to-all at scale); real prefix-cache hit-rate distributions by workload; how real fleets balance prompt admission across replicas; production thinking budgets per workload (do serving stacks switch thinking off for summarization?); training-fleet sharing practice; PUE and demand-response numbers for liquid-cooled AI halls. (All cross-referenced to the unverified-specifics callouts in REFERENCE-DOSSIER.)

---

## References

All real-world numbers and the literature backing each mechanic above are consolidated in [REFERENCE-DOSSIER.md](./REFERENCE-DOSSIER.md) — the single citations source for the design (request workloads and SLOs §1, post-training §2, safety/guardrails §3, serving systems §4, hardware/economy §5, the open-weight landscape and benchmark host §6, the 2026 events behind the campaign's final waves §7). Cite §refs there rather than duplicating the bibliography here.
