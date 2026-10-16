/**
 * Layout, palette, and simulation constants.
 * The game renders to a fixed DESIGN resolution that is uniformly scaled to fit the window,
 * so all gameplay code can work in stable "design pixels".
 */

export const DESIGN_W = 1280
export const DESIGN_H = 720

export const TILE = 48
export const GRID_COLS = 24
export const GRID_ROWS = 11
export const GRID_X = Math.round((DESIGN_W - GRID_COLS * TILE) / 2) // 64
export const GRID_Y = 96

export const HUD_H = 96
export const BUILDBAR_H = 96

/** Fixed simulation timestep (seconds). The sim is deterministic at this step. */
export const SIM_DT = 1 / 60
/** Max sim steps processed per rendered frame (prevents spiral-of-death). */
export const MAX_STEPS = 5

/** Pixel-art neon "data center at night" palette. */
export const COLORS = {
  bg: 0x0a0e14,
  bgGrid: 0x121a26,
  panel: 0x0e1622,
  panelEdge: 0x21304a,
  tile: 0x111c2b,
  tileBuild: 0x16263b,
  tileHover: 0x244064,
  tileBad: 0x4a2030,
  laneFloor: 0x0c1830,
  laneEdge: 0x1d3a66,
  laneGlow: 0x2b6cff,
  core: 0x5fd7ff,
  coreDark: 0x123a52,

  trust: 0x57e39b,
  sla: 0x5fd7ff,
  cash: 0xffd166,
  power: 0xff9f43,
  cooling: 0x59c2ff,
  data: 0xc792ea,

  text: 0xd7e3f4,
  textDim: 0x7a8aa3,
  textBright: 0xffffff,
  danger: 0xff5d5d,
  warn: 0xffb454,
  good: 0x57e39b,

  white: 0xffffff,
  black: 0x000000,
  shadow: 0x05080d,
} as const

/** Per-meter visual maxima for the HUD bars. */
export const METER_MAX = { trust: 100, sla: 100 }

/**
 * §6.6 real credit economy: 1 credit = $CREDIT_USD. All capex / $/GPU-hr / token
 * revenue use this single scale, so the bankruptcy threshold (cash<0) is in real
 * money. Build cost = capexUsd / CREDIT_USD; operating cost and income share it.
 */
export const CREDIT_USD = 1000

/**
 * §4.5 research data investment. Every authored research `dataCost` (the 22 infra
 * nodes + post-training method unlocks + red-team evals) is scaled by this so
 * unlocking a technique is a meaningful Data sink — real R&D, not pocket change.
 * Tuned against the autoplay depth gate (raising it slows the tech tree). Raised from 1.5×
 * so the tree is a real early-mid investment, not solved by ~wave 20
 * (the autoplay used to earn ~18k Data and spend <500 — Data was a dead resource).
 */
export const RESEARCH_DATA_SCALE = 4

/**
 * §4.5 research COMPUTE investment. Scales every research node's compute target so
 * unlocking the tree requisitions real FLOPs over real waves (a chunk of the fleet
 * goes offline to train, §C7) — research is paced by your compute, not free. Pairs
 * with RESEARCH_DATA_SCALE: data is the gate, compute is the wall-clock. Tuned so a
 * node takes roughly a third to one wave of the fleet it unlocks at (measured on the
 * autoplay: ≈5–30 board seconds of a ≈50 s wave), so the lent racks are a felt cost.
 */
export const RESEARCH_COMPUTE_SCALE = 12

/**
 * §1.4 post-training compute investment. Scales every Studio run's FLOP bill so a
 * training run requisitions a meaningful slice of the fleet for several waves —
 * making a checkpoint (and especially a STACKED one) a real compute commitment that
 * competes with serving, not a free action.
 */
export const POSTTRAIN_COMPUTE_SCALE = 2.0

/**
 * §6.6 traffic multiplier. Each request SPRITE stands for this many real user
 * requests, so the token revenue one sprite earns is meaningful against real GPU
 * capex and operating cost.
 */
export const TRAFFIC_SCALE = 100000

/**
 * §5.7 the COHORT: a sprite occupying a rack places this many concurrent real streams
 * on every real rack the board tile stands for. One sprite alone is therefore already a
 * production-sized decode batch, two or three of them push the batch to 56–84 streams,
 * and per-user speed falls while aggregate throughput rises toward the compute roof —
 * the batching tradeoff in real numbers. KV is reserved per stream, so long contexts
 * shrink the cohort a rack can hold (a KV-limited cohort is served a few streams at a
 * time and its sprite takes longer).
 */
export const COHORT_STREAMS = 28

/**
 * §6.6 the cohort identity: a board rack stands for this many identical real racks,
 * because TRAFFIC_SCALE requests per sprite = RACKS_PER_TILE racks × COHORT_STREAMS
 * streams each. The wall-clock bill is RACKS_PER_TILE racks' real $/hour, and the tokens
 * they produce are TRAFFIC_SCALE × the sprite's progress — so the $/Mtoken a rack card
 * shows is the rate its cash flow obeys (up to the tick a finished sprite's slot waits),
 * and an idle rack still pays its bill.
 */
export const RACKS_PER_TILE = TRAFFIC_SCALE / COHORT_STREAMS

/**
 * §4.1 the engine's batch cap per model copy once Continuous Batching runs (a latency-tuned
 * `max_num_seqs`): this many concurrent streams, i.e. ⌊ENGINE_MAX_STREAMS / COHORT_STREAMS⌋
 * request sprites per decode lane. KV then admits a sprite only while its copy has room, so
 * long contexts hold fewer streams. Before Continuous Batching a lane runs one static batch.
 */
export const ENGINE_MAX_STREAMS = 256

/* ------------------------------------------------------------------ *
 *  SERVING PHYSICS (§5.7 roofline efficiencies, parallelism, latency    *
 *  floors). Every constant is a real-world ballpark; see REALISM.       *
 * ------------------------------------------------------------------ */

/** Decode memory-bandwidth utilization (MBU) a tuned engine reaches on HBM reads (60–80% measured). */
export const MBU_DECODE = 0.7
/**
 * §4.8 the always-on share of an MoE's ACTIVE params — attention, embeddings, shared experts —
 * read by every token; the rest are routed experts a batch touches as a union. (DeepSeek-V3
 * ≈45%, Qwen3-235B ≈35%, gpt-oss-120b ≈30%.)
 */
export const MOE_SHARED_FRAC = 0.35
/** Prefill model-FLOPs utilization (MFU) of the compute-bound prompt GEMMs (40–60% measured). */
export const MFU_PREFILL = 0.55
/** Decode-time MFU once a large batch makes the step compute-bound (attention overhead keeps it lower). */
export const MFU_DECODE = 0.5
/** Per-iteration CPU scheduling + sampling overhead of the engine, in ms (multi-step amortizes it). */
export const STEP_OVERHEAD_MS = 1.0
/**
 * §4.8 an MoE layer's fixed per-step cost, in µs: the router GEMM, top-k, the token permute /
 * unpermute and the grouped expert GEMMs are several small kernels per layer that a small batch
 * cannot fill (launch- and latency-bound). Calibrated so gpt-oss-120b alone on one H100 decodes
 * ≈250 tok/s (Artificial Analysis production median ≈212 tok/s); it amortizes over the batch.
 */
export const MOE_LAYER_OVERHEAD_US = 50
/** Multi-step scheduling: decode steps run per scheduler call (vLLM v0.6 used 8). */
export const MULTISTEP_STEPS = 8
/** The widest tensor-parallel group one stream is split across (latency gains flatten beyond 8). */
export const MAX_TP = 8
/** Tensor-parallel scaling efficiency on per-stream bandwidth and compute (no free perfect TP). */
export const TP_EFFICIENCY: Readonly<Record<number, number>> = { 1: 1, 2: 0.9, 4: 0.8, 8: 0.65 }
/** One decode-sized NVLink all-reduce, in µs; a TP layer needs two (attention + MLP) per token. */
export const ALLREDUCE_US = 8
/** Expert-parallel all-to-all (dispatch + combine) per MoE layer per step, in µs. */
export const ALLTOALL_US = 12
/** Pipeline parallelism: activation hand-off per extra stage per decode step (µs) and per prefill (ms). */
export const PP_HOP_US = 30
export const PP_BUBBLE_MS = 20
/**
 * §3.3 a guard check's service overhead, in ms: the hop to the guard service and back plus
 * tokenizing the turn (an AI-gateway hop is ≈3–4 ms, REFERENCE-DOSSIER §3.6). Every guard pays it
 * — the encoder's fixed check latency already includes it; the generative judge pays it on top
 * of its roofline inference.
 */
export const GUARD_SERVICE_MS = 5
/** P/D disaggregation: KV transfer bandwidth between racks (GB/s, ~400 Gb/s RDMA). */
export const KV_TRANSFER_GBPS = 50
/** P/D disaggregation: a phase-dedicated pool's parallelism tuning gain (DistServe, ≤ 10%). */
export const DISAGG_POOL_GAIN = 1.1
/** KV offload (LMCache): PCIe bandwidth a prefix reload from CPU/SSD runs at (GB/s). */
export const PCIE_RELOAD_GBPS = 25

/**
 * §4.3 chunked prefill (Sarathi-Serve, OSDI'24; vLLM / SGLang `max_num_batched_tokens`): every
 * engine step carries the running decodes plus up to a TOKEN BUDGET of prompt chunks. The budget
 * is profiled per deployment from the time-between-tokens target, the way Sarathi-Serve sizes it
 * from the TBT SLO: the prompt tokens whose compute fills a busy decode step up to
 * CHUNK_STEP_TARGET_MS (3/4 of the interactive 40 ms TPOT bound), or stretches it by at least
 * CHUNK_MIN_STRETCH where a big model's decode step is already longer; prompt tokens that fit
 * under the step's memory-bound weight + KV reads ride along for free (the roofline knee). The
 * budget is clamped to CHUNK_MIN_TOKENS..CHUNK_MAX_TOKENS (8192 is the large-GPU default of
 * vLLM's V1 scheduler and SGLang's chunked_prefill_size).
 */
export const CHUNK_STEP_TARGET_MS = 30
export const CHUNK_MIN_STRETCH = 0.25
export const CHUNK_MIN_TOKENS = 256
export const CHUNK_MAX_TOKENS = 8192
/**
 * Prefill efficiency kept by chunking: every chunk re-reads the KV of the prompt's earlier chunks
 * and runs smaller GEMMs than one monolithic prefill (Sarathi-Serve measures the overhead as
 * small at chunk sizes of a few hundred tokens and up) — the throughput price of stall-free
 * scheduling.
 */
export const CHUNKED_PREFILL_EFF = 0.9

/** §4.4 speculative decoding: draft tokens verified per step (EAGLE runs 3–5). */
export const SPEC_DRAFT_TOKENS = 4
/**
 * §4.4 speculative decoding fades with the batch: verification turns compute-bound and the
 * engine shrinks each stream's draft budget, so the accepted-token gain is whole up to
 * SPEC_FADE_START_STREAMS streams per lane and gone by SPEC_FADE_END_STREAMS (log-linear in
 * between; EAGLE-3 / vLLM measure the speed-up collapsing at batch 32–128).
 */
export const SPEC_FADE_START_STREAMS = 32
export const SPEC_FADE_END_STREAMS = 128
/** Draft-head VRAM as a share of the target's weights (≈ one extra decoder layer), with a floor in GB. */
export const SPEC_DRAFT_VRAM_FRAC = 0.03
export const SPEC_DRAFT_VRAM_MIN_GB = 0.5

/** §6.6 electricity: the all-in industrial price per kWh and facility PUE (air vs direct liquid). */
export const POWER_USD_PER_KWH = 0.1
export const PUE_AIR = 1.4
export const PUE_LIQUID = 1.15
/** Share of nameplate draw an idle rack still burns (the energy bill only; the power meter stays nameplate). */
export const IDLE_POWER_FRAC = 0.3

/** §4.9 TensorRT-LLM's compiled kernels: MBU/MFU closer to the roof (never past it). */
export const TRTLLM_KERNEL_GAIN = 1.12
/** §4.9 SGLang's RadixAttention: a higher prefix-reuse rate and ceiling than block-level caching. */
export const RADIX_HIT_BONUS = 0.1
export const RADIX_HIT_CAP = 0.8
/** §4.2 KV offload (LMCache): a CPU/SSD tier that keeps more prefixes resident (extra hit chance, overall ceiling). */
export const OFFLOAD_HIT_BONUS = 0.12
export const OFFLOAD_HIT_CAP = 0.9
/** §4.10 S-LoRA: unmerged adapters run extra low-rank GEMMs — this share of decode speed is kept. */
export const LORA_UNMERGED_SPEED = 0.93
/** FlashAttention: the O(n²) prefill term grows this much slower, and Flash-Decoding reads KV this much faster. */
export const FLASH_PREFILL_GAIN = 0.5
export const FLASH_KV_READ_GAIN = 1.2

/**
 * §1.2 long context: answer quality decays as a prompt fills the model's window.
 * No loss below LONGCTX_FILL_FREE of the window; at a full window a model with no
 * long-context skill loses LONGCTX_MAX_PENALTY quality points, and the best long-context
 * models keep only (1 − LONGCTX_SKILL_RELIEF) of that loss.
 */
export const LONGCTX_FILL_FREE = 0.25
export const LONGCTX_MAX_PENALTY = 24
export const LONGCTX_SKILL_RELIEF = 0.75

/**
 * §6.6 clear-bonus rescale: converts a wave's authored SLA-contract value
 * (campaign.ts tierBonus) into credits. The paid bonus is that × the wave's Goodput
 * (campaign.ts contractPayout). Tuned against the autoplay economy: the opening contract
 * (≈24 credits) funds a clean starter fleet's growth while its token revenue is still a few
 * credits a wave; by the 2024 tiers token income overtakes it.
 */
export const CLEAR_BONUS_SCALE = 0.12

/**
 * §6.5 REAL power/cooling. The power system runs in real kW now: a rack draws its
 * aggregate `tdpWatts` (kW) and emits ≈that much heat (≈all electrical power → heat).
 * Base grid + chiller capacity (kW) is the substation/CRAC every datacenter has
 * before you build any Power Plant / Cooling Tower; calibrated so a starter Edge/
 * Standard fleet (L4 0.072 kW, L40S 0.35 kW, H100/H200 0.7 kW) lights up, and a
 * Power Plant / Cooling Tower each add a sizeable real block — an H100 node is ~10 kW
 * and an NVL72 ~72 kW (its 72×1000 W aggregate tdpWatts), so the meters read in kW.
 */
export const START = {
  cash: 300,
  trust: 100,
  sla: 100,
  data: 0,
  /** base electrical capacity in kW (the substation feed before any Power Plant). */
  basePower: 6,
  /** base heat-rejection capacity in kW (the house chillers before any Cooling Tower). */
  baseCooling: 6,
}

/**
 * §6.5 utilization factor on a rack's nameplate TDP: a serving rack rarely sits at
 * 100% of its TDP wall (decode is bandwidth-bound, idle slots draw less). Real PUE-
 * adjacent utilization is ~0.7–0.85; we use 0.8 so the meters track real datacenter
 * draw (an 8× H200 pod ~4.5 kW served, an NVL72 ~58 kW). serverPower() applies this
 * on top of the FP8/INT4/throughput/spec modifiers.
 */
export const RACK_UTILIZATION = 0.8

/**
 * Throttle floor: even fully overheated GPUs keep this fraction of speed. Set low
 * (0.2) so running racks hot WITHOUT enough cooling collapses serving to ~20% — a
 * real, painful penalty that forces buying Cooling rather than coasting on a soft dip.
 */
export const THROTTLE_FLOOR = 0.2
/**
 * Global multiplier converting a request's per-type tile speed into lane speed.
 * The four-ingress central-core map has shorter individual lanes than the old
 * single serpentine, so this keeps board travel time in the same playable band.
 */
export const LANE_SPEED = 0.75

/**
 * §0.4 dual-clock: one board second compresses this many REAL datacenter seconds.
 * Visual pacing only — SLO is always judged on the real-second axis (effLatency).
 */
export const SIM_TIME_SCALE = 10
/** §6.2 per-GPU runtime VRAM overhead (framework, activations, CUDA graphs) before KV, in GB. */
export const FRAMEWORK_GB = 1.5
/** FlashAttention never materializes the attention score matrix: this much activation memory back per GPU (GB). */
export const FLASH_ACTIVATION_CREDIT_GB = 0.5
/**
 * §1.3 per-latency-class SLO in REAL milliseconds (MLPerf / IETF classes).
 *   IN — interactive (chat/completion): tight TTFT, tight per-token.
 *   NR — near-real-time (RAG/reasoning/enterprise): relaxed.
 *   TO — throughput/offline (bots/batch): no hard latency SLO.
 */
export const LAT_CLASS_SLO = {
  IN: { ttftMs: 400, tpotMs: 40 },
  NR: { ttftMs: 2000, tpotMs: 200 },
  TO: { ttftMs: Infinity, tpotMs: Infinity },
} as const
