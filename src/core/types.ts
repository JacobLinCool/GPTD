import type { RNG } from './rng'

export interface Vec2 {
  x: number
  y: number
}

export type Phase = 'menu' | 'build' | 'wave' | 'won' | 'lost'

export type ServerSpec = 'general' | 'chat' | 'coding' | 'reasoning' | 'agentic'
/** §6.4/H7/M1: the authoritative name for the capability-match axis (values = ServerSpec). */
export type CapabilityAxis = ServerSpec
/**
 * §4.6 attention family (display). The KV accounting itself is per model —
 * `ModelDef.kvBytesPerToken` / `kvStateMbPerReq`, derived from config.json — so the
 * label only names the design: dense MHA/MQA/GQA, latent MLA, the 2026 hybrids that
 * keep a growing KV on only a few layers (`hybrid-linear`: linear/SSM/conv mixers with
 * a constant state; `hybrid-swa`: sliding-window layers bounded by their window), and
 * DeepSeek-V4's compressed sparse attention (`csa`).
 */
export type AttnVariant = 'MHA' | 'MQA' | 'GQA' | 'MLA' | 'hybrid-linear' | 'hybrid-swa' | 'csa'
/** §1.3 latency class → real-ms SLO bucket. IN=interactive, NR=near-real-time, TO=throughput/offline. */
export type LatencyClass = 'IN' | 'NR' | 'TO'
/**
 * §1.4 whether a checkpoint thinks, read off its released chat template (data/model-thinking.json):
 * 'always' — every answer reasons first (a toggle only sets the effort); 'hybrid' — the serving
 * stack can switch thinking off per request (enable_thinking=False, thinking_mode="chat", …);
 * 'never' — an instruct deployment that answers at once.
 */
export type ThinkingSupport = 'always' | 'hybrid' | 'never'
/**
 * §1.4 the mode one answer runs in — the engine's per-request policy (effects.ts `answerMode`):
 * a hybrid answers interactive traffic (latency class IN) in 'instant' mode, everything else
 * 'thinking'; an 'always' model always thinks, a 'never' model never does.
 */
export type AnswerMode = 'instant' | 'thinking'

/**
 * §3.4 the four serving-layer threat categories (OWASP Top 10 for LLM Apps).
 * jailbreak/injection are prompt-side attacks; harmful/pii are content/leakage.
 */
export type SafetyHazard = 'jailbreak' | 'injection' | 'harmful' | 'pii'
/** §3.4 a request's hazard profile: hazard → severity (0..1). Most archetypes carry none. */
export type SafetyProfile = Partial<Record<SafetyHazard, number>>

/* ------------------------------------------------------------------ *
 *  POST-TRAINING (§1) — the Post-Training Studio data model.          *
 *  Every post-training run produces a NEW derived `ModelDef` (I1);    *
 *  it is never a global buff. Recipe constants are autoplay-           *
 *  calibratable game curves (I2/[fix C4]), not first principles.      *
 * ------------------------------------------------------------------ */

/** §1.3 the 12 real per-model post-training methods. */
export type PostTrainMethod =
  | 'cpt'
  | 'sft'
  | 'lora'
  | 'qlora'
  | 'dora'
  | 'dpo'
  | 'rlhf'
  | 'cai'
  | 'grpo'
  | 'distill'
  | 'merge'
  | 'qat'

/** §1.3 the 8 post-training targets: the 5 CapabilityAxis values + safety/longctx/domain. */
export type PostTrainTarget = CapabilityAxis | 'safety' | 'longctx' | 'domain'

/** §2.9/§6.5 the lineage edge a method creates. */
export type LineageRelation = 'finetune' | 'quantized' | 'adapter' | 'merge'

/**
 * §1.3 a data-driven post-training recipe. `gainScale/gainCap/taxScale/forgetScale`
 * are autoplay-calibratable game curves ([fix C4]) — `calibrateRecipes()` (P5) will
 * regress them; they are NOT first-principles physics.
 */
export interface MethodRecipe {
  id: PostTrainMethod
  name: string
  relation: LineageRelation
  /** which targets this method may train. */
  allowedTargets: PostTrainTarget[]
  // --- cost table (§1.3, autoplay-calibratable) ---
  costData: number
  costCompute: number
  // --- gain / tax / forgetting profile (§1.4, autoplay-calibratable [fix C4]) ---
  gainScale: number
  gainCap: number
  taxScale: number
  forgetScale: number
  /** distill/merge/qat reshape the deploy fields (params/arch/bytes); others inherit the base. */
  reshapesDeployment: boolean
  /** the method-unlock research flag required to run it (sft is the starter — none). */
  requiresTech?: string
  desc: string
}

/**
 * §7 the machine-readable provenance of a derived checkpoint. Values are
 * snapshotted at creation ([fix C4]); replay needs only seed + derivedSeq + the
 * Lineage of each link in the chain.
 */
export interface Lineage {
  /** base model id(s): 1 for finetune/adapter/quantized, 2 for merge. */
  baseModelIds: string[]
  relation: LineageRelation
  method: PostTrainMethod
  target: PostTrainTarget
  effort: number
  spent: { data: number; compute: number; waves: number }
  /** chain depth (base = 0); feeds the deriveQuality depth-damp ([fix C4]). */
  depth: number
  createdAtWave: number
}

/**
 * §3.1/R3 the model's intrinsic (first-layer) alignment. Post-training methods
 * MODIFY this (rlhf/cai/safety-sft raise `safety`; cai lowers over-refusal,
 * crude rlhf raises it). The combat-time CONSUMPTION of this profile is P3d.
 */
export interface AlignmentProfile {
  /** intrinsic safety, 0..100 (was intrinsicSafety). */
  safety: number
  refusalStyle: 'none' | 'hard-refusal' | 'safe-completion'
  /** over-refusal rate, 0..1 — the single source of truth ([fix L1]). */
  overRefusal: number
}

/**
 * Static hardware profile for a server rack — REAL accelerator specs.
 * A board tile represents `gpus` GPUs; aggregate fields (bf16Tflops, hbmGb, …)
 * are `perGpu × gpus`, filled at load (§6.3). The power system draws the real
 * aggregate `tdpWatts` (power.ts / effects `serverPower`); the abstract `powerDraw` /
 * `heat` fields are not read by the power system.
 */
export interface ServerHardwareDef {
  id: string
  name: string
  /** Marketing/display GPU class, e.g. "H100-class". */
  gpuModel: string
  /** number of GPUs this one board tile stands for (§6.3 tile→GPU mapping). */
  gpus: number
  // --- per-GPU real specs (§5.2–5.5) ---
  bf16TflopsPerGpu: number
  fp8TflopsPerGpu: number
  /** dense FP4 tensor rate per GPU (Blackwell 5th-gen Tensor Cores only; 0 = no FP4 hardware). */
  fp4TflopsPerGpu: number
  hbmGbPerGpu: number
  /** HBM bandwidth per GPU in TB/s. */
  hbmTbsPerGpu: number
  tdpWattsPerGpu: number
  cooling: 'air' | 'liquid'
  capexUsd: number
  /** real cloud operating rate in USD per GPU-hour (§5.8); aggregate = ×gpus. */
  gpuHrUsdPerGpu: number
  // --- aggregate (perGpu × gpus), filled at load ---
  bf16Tflops: number
  fp8Tflops: number
  fp4Tflops: number
  hbmGb: number
  /** aggregate HBM bandwidth in TB/s. */
  hbmTbs: number
  /** aggregate nameplate TDP in watts (tdpWattsPerGpu × gpus) — the REAL kW power basis (§6.5). */
  tdpWatts: number
  /** aggregate operating rate in USD per hour (gpuHrUsdPerGpu × gpus, §5.8/§6.6). */
  gpuHrUsd: number
  // --- engineering / display fields ---
  /**
   * LEGACY abstract power/heat numbers. As of P2 (§6.5) the power SYSTEM ignores
   * these for servers and uses real `tdpWatts` via serverPower()/serverHeat(); they
   * survive only as authored data and are not read by gameplay.
   */
  powerDraw: number
  heat: number
  cost: number
  range: number
  color: number
  accent: number
  desc: string
}

export type ModelVariant = 'base' | 'instruct' | 'coding'

/** A public-benchmark cell (Artificial Analysis / model-card) a checkpoint can carry. */
export type BenchmarkCell =
  | 'gpqaDiamond'
  | 'ifBench'
  | 'lcr'
  | 'sciCode'
  | 'terminalBenchHard'
  | 'hle'
  | 'terminalBenchV21'
  | 'terminalBenchV40'
  | 'tauBanking'
  | 'mmluPro'
  | 'mmlu'
  | 'aime'
  | 'liveCodeBench'
  | 'sweBench'
  | 'humanEval'

/**
 * Real-world provenance for a checkpoint. Display-only — the simulation never
 * reads this; it lives here so Professional (Expert) Mode can show where the
 * model came from and which public benchmarks its `qualityBy` was derived from.
 * Keeping it inert preserves the `sim/** must not import mode.ts` invariant.
 */
export interface RealModelMeta {
  developer: string
  /** SPDX-ish license string, verbatim (e.g. "Apache-2.0", "MIT", "Llama Community"). */
  license: string
  /** open-weight (downloadable) vs merely open-access. */
  openWeights: boolean
  /** approximate release period, e.g. "2025-Q3". */
  released: string
  /** advertised context window in thousands of tokens. */
  contextWindowK: number
  /** the public benchmark %s the qualityBy vector was calibrated from (reference scale). */
  benchmarks: Partial<Record<BenchmarkCell, number>>
  /**
   * provenance of each benchmark cell that is NOT a reference-snapshot measurement:
   * 'latest' (a frozen eval read from the latest snapshot), 'eq' (re-scored, equated
   * back to the reference scale) or 'bridge:<predictors> sd=<x>' (estimated from the
   * measured cells — show it as ≈). Absent = measured on the reference snapshot.
   */
  benchmarkSource?: Partial<Record<BenchmarkCell, string>>
  /** how a serving stack switches this checkpoint's thinking off (hybrid) or sets its effort (always), from its chat template. */
  thinkingToggle?: string
  /**
   * a hybrid's INSTANT-mode cells (thinking off) its `qualityByInstant` was calibrated from, their
   * provenance (as `benchmarkSource`, plus 'pairfit sd=<x>' for a cell estimated from the
   * thinking/instant pair fit) and the AA row they were measured on ('' = the pair fit).
   */
  benchmarksInstant?: Partial<Record<BenchmarkCell, number>>
  benchmarkSourceInstant?: Partial<Record<BenchmarkCell, string>>
  instantVia?: string
  /** native release precision of the open weights ('BF16', 'FP8', 'MXFP4', 'INT4', 'FP4'). */
  precision?: string
  confidence: 'high' | 'medium' | 'low'
  /** primary source — the Hugging Face model-card URL of the open weights. */
  source: string
  /**
   * §6.5/[fix H6] the roster base this checkpoint genuinely DERIVES from (the
   * S8 LineageGraph edge). Display-only — the sim never reads `real`. Most roster
   * entries are roots (undefined); a model that is a real derivative (e.g. an
   * NVIDIA Llama-based finetune) names its base + relation here.
   */
  baseModelId?: string
  relation?: LineageRelation
}

/**
 * Static model profile.
 *
 * Open-weight checkpoints are GLOBAL, FREE assets: the weights are a download,
 * so deploying one costs nothing. What gates them is rack VRAM — the weights
 * (`paramsTotalB` × the resident bytes/param) must fit. Checkpoints you post-train
 * in the Studio are added the same way. Models decide answer quality and serving
 * demand.
 */
export interface ModelDef {
  id: string
  name: string
  tier: 'small' | 'general' | 'coding' | 'frontier'
  variant: ModelVariant
  spec: CapabilityAxis
  /** §1.1 'base' = a curated open-weight roster checkpoint; 'derived' = player-trained in the Studio. */
  origin: 'base' | 'derived'
  /**
   * TOTAL parameter count in billions — the VRAM residency basis (all weights,
   * incl. every MoE expert, must fit). VRAM ∝ paramsTotalB (§5.6).
   */
  paramsTotalB: number
  /**
   * ACTIVE parameters per token in billions — the serving-cost basis (compute &
   * bandwidth scale with active params, §4.8). Equals `paramsTotalB` for dense
   * models; far smaller for MoE (e.g. DeepSeek-V3.1: 671 total / 37 active).
   */
  paramsActiveB: number
  /** sparse mixture-of-experts: all experts resident (VRAM), only active params serve. */
  isMoE: boolean
  /**
   * §1.4 thinking support from the checkpoint's chat template (data/model-thinking.json):
   * 'always' / 'hybrid' / 'never'. The engine picks the mode of every answer from it
   * (effects.ts `answerMode`): a hybrid answers interactive traffic instantly.
   */
  thinking: ThinkingSupport
  /**
   * the checkpoint can think (`thinking` ≠ 'never'), so its `qualityBy` is its THINKING-mode
   * capability (the roster pins the thinking variant on Artificial Analysis).
   */
  isReasoning: boolean
  /**
   * hidden reasoning tokens a thinking model emits per answer before the first answer
   * token: clamp((ttfat − ttft) × tok/s, 300, 4000) from AA's telemetry, 1500 when a
   * thinking model has none measured, 0 for a 'never' model (calibrate.ts).
   */
  thinkTokens: number
  /** Peak correctness score (the model's best axis) — display & sorting. */
  quality: number
  /**
   * Correctness per traffic axis, checked against a request's difficulty on its
   * primary axis. For real checkpoints this is calibrated from six public benchmark
   * cells (IFBench→chat, GPQA-Diamond→general, SciCode→coding, HLE→reasoning,
   * Terminal-Bench Hard→agentic, each blended with two secondaries); see `sim/calibrate.ts`.
   */
  qualityBy: Record<CapabilityAxis, number>
  /**
   * a HYBRID's capability with thinking switched off — the vector its instant-mode answers are
   * judged with. Calibrated through the same curves as `qualityBy`, from AA's Non-reasoning row of
   * the same checkpoint or, without one, the per-cell thinking→instant pair fit. Absent for
   * 'always' / 'never' models (they have one mode, so `qualityBy` is all there is).
   */
  qualityByInstant?: Record<CapabilityAxis, number>
  // --- real architecture (from config.json, data/model-arch.json; feeds §5.6 KV / §6.2 roofline) ---
  /** transformer layers (all of them, whatever their mixer). */
  layers: number
  /** layers that keep a GROWING per-token KV cache (hybrids keep it on only a few). Display. */
  kvLayers: number
  /** KV heads of the full-attention layers (1 for MLA/CSA, whose cache is one latent). Display. */
  kvHeads: number
  /** per-head dimension of that cache (latent + rope for MLA). Display. */
  headDim: number
  /** attention family (§4.6, display) — the KV accounting is the two fields below. */
  attn: AttnVariant
  /**
   * BF16 KV-cache bytes per token over the KV-bearing layers only: full attention
   * 2·kvHeads·headDim per layer, MLA latent+rope (one tensor), CSA/HCA compressed,
   * sparse-attention indexer keys; sliding-window and linear/SSM layers excluded (§5.6).
   */
  kvBytesPerToken: number
  /** constant per-request cache (MB, BF16 windows / native state dtype) that does not grow with context: sliding windows + linear/SSM recurrent state. */
  kvStateMbPerReq: number
  /**
   * native release precision in bytes/param — the precision its benchmarks were
   * measured at: BF16 2, FP8 ≈1, MXFP4 / INT4-QAT / FP4 ≈0.55 (block scales included).
   * Serving-layer PTQ can lower the resident bytes further; only quantizing BELOW this
   * precision costs quality (effects.ts).
   */
  nativeWeightBytes: number
  /** real context window in thousands of tokens (the hard window gate, §1.2). */
  contextWindowK: number
  /**
   * §1.2 long-context skill, 0..1: how much answer quality survives as a prompt fills the
   * window. Calibrated at load from the AA long-context-reasoning cell (calibrate.ts
   * `longCtxOf`); combat turns window fill into a quality penalty scaled by (1 − skill).
   */
  longCtx: number
  // --- intrinsic state (§3, R3): post-training methods MODIFY these; P3d consumes them ---
  /** first-layer alignment profile (safety / refusal style / over-refusal). */
  alignment: AlignmentProfile
  /** instruction-following aptitude, 0..100 (base variants ≈25, instruct ≈85, §OQ-G12). */
  instructFollow: number
  desc: string
  /** machine-readable provenance — required when `origin === 'derived'` (§1.6/§7). */
  lineage?: Lineage
  /** real-world provenance + benchmark breakdown (Professional Mode display only). */
  real?: RealModelMeta
}

/**
 * A research project: training a model checkpoint or an auxiliary technique.
 * Costs Data up front, then requisitions the STRONGEST racks during waves
 * (they train instead of serving) until `compute` FLOPS·s have accumulated.
 * `kind` maps to a research track (§4.5 / C7): 'model' → 'posttrain',
 * 'tech' → 'infra', 'eval' → 'eval' (the red-team evals).
 */
export interface ResearchDef {
  id: string
  /** 'model' → posttrain track, 'tech' → infra track, 'eval' → eval track (§3.6 red-team). */
  kind: 'model' | 'tech' | 'eval'
  name: string
  /** kind 'model': the checkpoint unlocked on completion */
  modelId?: string
  /** kind 'tech': the upgrade-counter id incremented on completion (tech_moe / tech_reasoning) */
  techId?: string
  dataCost: number
  /** total training compute (FLOPS·seconds) accumulated by requisitioned racks */
  compute: number
  /** prerequisite research ids */
  requires?: string[]
  desc: string
}

/**
 * One in-flight research slot (§4.5 / C7). The board can run THREE tracks
 * concurrently — an infra upgrade, a per-model post-training run, and an eval —
 * each owning its own slot. The tracks share one requisition compute pool.
 */
export type ResearchTrack = 'infra' | 'posttrain' | 'eval'

/**
 * The payload of a Post-Training Studio run (§1) carried on the posttrain slot.
 * On completion `deriveModel(s, meta)` snapshots a new derived `ModelDef`.
 */
export interface PostTrainMeta {
  /** base model id(s): 1 for finetune/adapter/quantized, 2 for merge. */
  baseIds: string[]
  method: PostTrainMethod
  target: PostTrainTarget
  effort: number
  /** Data already paid up front (recorded into the lineage `spent`). */
  dataSpent: number
  /** wave the run was started on (for `createdAtWave`). */
  startWave: number
}

export interface ResearchSlot {
  id: string
  /** which track this slot belongs to (also `def.kind` → track mapping). */
  kind: ResearchTrack
  progress: number
  compute: number
  /** §1 the post-training payload (posttrain track only); a static research def has none. */
  meta?: PostTrainMeta
}

/** The three independent research tracks (§4.5 / C7); each may be busy or idle. */
export interface ResearchTracks {
  infra: ResearchSlot | null
  posttrain: ResearchSlot | null
  eval: ResearchSlot | null
}

/**
 * Infra serving-stack switches (R6, §4). The SINGLE source of truth for the
 * serving physics getters in effects.ts (migrated off `s.upgrades` in P3c). Each
 * field is a typed switch/level set by an `InfraNodeDef` via `applyInfraEffects`.
 */
export interface InfraState {
  /**
   * scheduling.batch = continuous batching (iteration-level scheduling); multiStep = steps run
   * per scheduler call (amortizes the per-step overhead, delays admission); chunked = Sarathi.
   */
  scheduling: { batch: boolean; multiStep: number; chunked: boolean }
  /** KV memory: paged utilization, prefix-cache hit ceiling, KV element bytes, CPU/SSD offload tier (GB), FlashAttention. */
  kv: { utilization: number; prefixHitCeil: number; quantBytes: number; offloadGb: number; flash: number }
  /** P/D disaggregation (DistServe); hard-conflicts chunked prefill (§4.3). */
  disagg: boolean
  /** Speculative decoding (EAGLE): a draft head proposes tokens the target verifies (§4.4). */
  spec: { enabled: boolean; level: number }
  /**
   * §4.5 the weight formats researched for serving (BF16 always). Each rack picks its own
   * precision among these (Tower.precision; auto = the best one that costs no quality).
   */
  quant: { fp8: boolean; int4: boolean; nvfp4: boolean }
  /**
   * §4.7 parallelism: tp = a model may span up to 8 GPUs of one rack (tensor parallel);
   * pp = beyond 8 (pipeline stages); dp = a rack's replicas are load-balanced per request;
   * ep = MoE experts are sharded across a rack's replicas (wide expert parallelism).
   */
  par: { tp: boolean; pp: boolean; dp: boolean; ep: boolean }
  /** KV-aware request routing (Dynamo): routed cacheable traffic finds its prefix (§4.10). */
  routing: { kvAware: boolean }
  /** S-LoRA: adapter checkpoints stay unmerged beside their base, so they hot-swap mid-wave (§4.10). */
  loraSlots: number
  /** inference engine 0 = vLLM / 1 = SGLang (RadixAttention prefix reuse) / 2 = TensorRT-LLM (faster kernels) (§4.9). */
  engineTier: 0 | 1 | 2
}

/** §4.5 a serving weight format: resident bytes, the tensor rate it runs at, and its PTQ quality cost. */
export type WeightFormat = 'bf16' | 'fp8' | 'int4' | 'nvfp4'

/** §4 InfraCategory — the nine serving-stack categories the tech tree groups by. */
export type InfraCategory =
  | 'scheduling'
  | 'kv-memory'
  | 'decoding'
  | 'weight-quant'
  | 'parallelism'
  | 'routing'
  | 'multi-lora'
  | 'engine'

/**
 * §4.2/§4.4 a single infra-tree node. `effects` is a flat key→number bag
 * `applyInfraEffects` interprets to mutate `s.infra`; `requires`/`conflicts`
 * are other node ids; UI shows `coupling`/`optimizes`/`sourceRef`.
 */
export interface InfraNodeDef {
  id: string
  category: InfraCategory
  name: string
  i18nKey: string
  /** flat effect bag (e.g. {schedBatch:1}, {kvUtilization:0.96}, {quantFp8:1}). */
  effects: Partial<Record<string, number>>
  level: number
  /** prerequisite infra-node ids. */
  requires: string[]
  /** mutually-exclusive infra-node ids (§4.3 chunked ⟂ disagg, §4.9 one engine), enforced by researchUnlocked. */
  conflicts?: string[]
  dataCost: number
  compute: number
  /** what this optimizes (UI badge). */
  optimizes: ('latency' | 'throughput' | 'memory' | 'cost')[]
  /** pure-infra vs model-interacting (UI badge). */
  coupling: 'pure-infra' | 'infra-model'
  /** §ref for the tooltip. */
  sourceRef: string
  /** Blackwell-rack requirement (NVFP4); display/gating hint. */
  requiresBlackwell?: boolean
}

export type TowerKind =
  | 'server'
  | 'router'
  | 'cache'
  /** §3.3 external guardrail building (replaces the single Safety Gate): encoder / generative / moderation. */
  | 'guardrail'
  | 'power'
  | 'cooling'
  /** §6.5 Liquid Cooling Loop: enables liquid-cooled racks (hardware `cooling: 'liquid'` — the NVL72) and adds large kW. */
  | 'cooling_liquid'
  | 'lab'

/** §3.3 the three guardrail families — the key teaching contrast (encoder ms vs generative full inference). */
export type GuardrailArchetype = 'encoder' | 'generative' | 'moderation'

/**
 * §3.3/§7 a guardrail building's spec. `checkLatencyMs` is a FIXED real-ms cost for
 * the encoder/moderation families; the generative family (`runsOnRoofline`) instead
 * runs a real (shorter) LLM inference on its OWN rack via the §6 roofline, so its
 * latency is the real computed inference time and it draws real power/heat ([fix M8]).
 */
export interface GuardrailSpec {
  archetype: GuardrailArchetype
  /** input → adds to TTFT; output → adds to E2EL; both → adds at both ends (§0.4). */
  side: 'input' | 'output' | 'both'
  /** which hazards this guardrail can catch (subject to red-team category unlocks, §3.6). */
  catches: SafetyHazard[]
  /** FIXED check latency (ms) for encoder/moderation; undefined for the roofline generative family. */
  checkLatencyMs?: number
  /** §3.3 [fix M8] true → guard_llm: runs the real §6 roofline on its own rack, drawing KV/watt. */
  runsOnRoofline: boolean
  /** generative family's inference-cost basis (active params, e.g. 12B); the roofline reads this. */
  guardParamsActiveB?: number
  /** the generative guardrail's own rack hardware id (§6 roofline runs on this), e.g. an H100. */
  guardHardwareId?: string
  /** §3.6 catch rate before the threshold curve (effRecall = baseRecall × (0.6 + 0.8×threshold)). */
  baseRecall: number
}

/** Static definition of a kind of incoming request (the "enemy"). */
export interface RequestTypeDef {
  id: string
  name: string
  glyph: string
  color: number
  /** legacy abstract work points — retained only for endless scaling math. */
  work: number
  /** real prompt length (ISL): the prefill / TTFT cost basis (§1.4). */
  inputTokens: number
  /** real generated length (OSL): the decode / TPOT cost basis (§1.4). */
  outputTokens: number
  /** §1.3 latency class → which real-ms SLO bucket this request is judged against. */
  latClass: LatencyClass
  /** §1.3 per-type SLO overrides (ms): a tighter TTFT (comp's 200 ms), or an end-to-end bound on top of the class bounds (agent: NR + 60 s E2EL). */
  ttftSloMs?: number
  e2elSloMs?: number
  /**
   * §1.3 time to first ANSWER token (ms) for interactive traffic: a thinking model's hidden
   * reasoning runs before the answer starts, so TTFT stays the engine's first token while
   * this bound catches the thinking wait (SloCause 'ttfat'). Unset = no such bound.
   */
  ttfatSloMs?: number
  /**
   * §1.4 how much of a thinking model's hidden-reasoning budget (ModelDef.thinkTokens) this
   * archetype triggers: 1 = a full think before answering, 0 = none (an embedding emits no
   * text; a long-CoT request's output already IS its reasoning). Hidden tokens cost decode
   * time, KV and E2EL like any token, but are not billed.
   */
  thinkMul: number
  /** path-tiles per second */
  speed: number
  /**
   * §6.4/R8 per-axis quality threshold a model must clear to answer correctly.
   * The capability-match axis (`primaryAxis`) is the one combat judges; the
   * vector also carries secondary axes for documentation/balance. Replaces the
   * old scalar `complexity` ([fix M2]) — runtime scalar = difficulty[primaryAxis].
   */
  difficulty: Partial<Record<CapabilityAxis, number>>
  /**
   * §1.2#10 fraction of the prompt that is a reusable prefix (prefix-cache friendliness).
   * A prefix-cache hit skips exactly this share of the prefill; the unique suffix still prefills.
   */
  prefixShare: number
  /**
   * §3.6 the share of this archetype's BENIGN traffic that is borderline enough for an
   * aligned model or a guardrail to wrongly refuse. Over-refusal benchmarks (XSTest,
   * OR-Bench) measure refusal on deliberately borderline prompts, not on everyday
   * traffic, so this multiplies both the model's `alignment.overRefusal` (layer 1) and
   * a guardrail's false-positive rate (layer 2). 0 = never refused (an embedding
   * generates no text to refuse). It applies only to benign requests: an archetype that
   * always carries a hazard (the agent's prompt-injection exposure) is never over-refused
   * unless a wave strips its hazard.
   */
  refusalExposure: number
  /**
   * §3.4 adversarial INTENT: the whole request is an attack (a jailbreak), so the correct
   * answer is to block or refuse it. A handled attack resolves `served` without a quality
   * judgement, and an attack that is never answered costs availability (SLA) only. A hazard
   * carrier without this flag (an agent whose tool output carries an injection) is a real
   * user task: once its hazard is cleared it is served and judged like any other request.
   */
  adversarial?: boolean
  /** §1.4 AGNT: an agentic loop that drives tools across multiple steps. */
  toolUse?: boolean
  /** abstract 0..100 context demand; long-context work penalizes weak memory/model stacks */
  context: number
  /**
   * §3.4 the request's hazard profile (hazard → severity 0..1). The TWO-LAYER safety
   * verdict (§3.4) checks every hazard against model self-handle (layer 1) OR a
   * guardrail in path (layer 2). Most archetypes carry none.
   */
  hazards?: SafetyProfile
  /**
   * Derived quick "is this request risky?" scalar = max severity over `hazards`.
   * Renderer/movement use it as a cheap danger flag; the real verdict is per-hazard.
   */
  safetyRisk: number
  /**
   * Legacy flat reward points — RETAINED only for endless-scaling math
   * (rewardMul) and as a fallback display. Real income is now token-priced
   * via pricePerMtokIn/Out (§6.6); a clean serve pays the real $/Mtoken revenue,
   * not this. Kept to preserve the endless reward-curve ordering.
   */
  reward: number
  /** real input-token price in USD per million tokens (§5.8 [fix H4]). */
  pricePerMtokIn: number
  /** real output-token price in USD per million tokens (§5.8 [fix H4]). */
  pricePerMtokOut: number
  trustPenalty: number
  slaPenalty: number
  data: number
  cacheable: boolean
  /** §6.4/[fix M1] the capability axis this request is judged against (was `affinity`). */
  primaryAxis: CapabilityAxis
  desc: string
}

/** Static definition of a buildable tower / building. */
export interface TowerDef {
  id: string
  name: string
  kind: TowerKind
  cost: number
  /** tiles; 0 = non-targeting support building */
  range: number
  color: number
  accent: number
  desc: string
  tagline: string
  // --- server fields: the rack tier this building starts as, plus the model
  //     included in the box. Both live on the Tower instance afterwards. ---
  hardwareId?: string
  defaultModelId?: string
  // --- support / infrastructure fields (REAL kW, §6.5) ---
  /** support-building electrical draw in kW (servers draw real tdpWatts via serverPower). */
  powerDraw?: number
  /** support-building heat output in kW. */
  heat?: number

  /** Power Plant: electrical capacity added in kW. */
  power?: number
  /** Cooling Tower / Liquid Cooling Loop: heat-rejection capacity added in kW. */
  cooling?: number
  cacheChance?: number
  routeBonus?: number
  /** §3.3 guardrail building spec (kind 'guardrail'): the two-layer safety second layer. */
  guardrail?: GuardrailSpec
}

/** Runtime request instance. */
export interface Request {
  id: number
  def: RequestTypeDef
  /** which global ingress lane this request is following */
  laneId: number
  /** distance travelled along the lane, in design pixels */
  dist: number
  /** decode tokens remaining (output generation; bandwidth-bound, batch-friendly) */
  work: number
  /** prefill tokens remaining (prompt ingestion; compute-bound, serializes a rack) */
  prefill: number
  /** total decode tokens this request will emit (the OSL it was spawned with). */
  maxWork: number
  /** total input tokens (ISL) ingested during prefill. */
  tokensIn: number
  /** total output tokens (OSL) generated during decode. */
  tokensOut: number
  /** current KV sequence length = inputTokens + generated outputTokens (grows during decode, §5.6/H1). */
  contextLen: number
  /** sim time when prefill finished — the request's TTFT moment (undefined until then) */
  prefillDoneAt?: number
  /**
   * real seconds spent waiting in range of a rack that could prefill it (§0.4 queue wait:
   * slot / KV contention at an eligible replica). Lane transit, decode-pinned racks and
   * racks whose window or KV can never hold it do not count.
   */
  queueSec: number
  /** real seconds of input-side guardrail checks, added to TTFT at the first-token latch (§0.4). */
  guardInSec: number
  /** real seconds of output-side guardrail checks, added to E2EL when the answer is delivered (§0.4). */
  guardOutSec: number
  /**
   * real seconds to first token = queue wait + the prefill (including the fractional
   * completing tick) + input guards, latched when the first token exists (§0.4).
   */
  ttftReal: number
  /** real seconds for the full answer (ttft + decode + output guards), accumulated as decode runs (§0.4). */
  e2elReal: number
  /**
   * real decode seconds after the first token, at the per-token time of the streams in
   * flight (throttle, P/D role, prefill time-share and stalls). TPOT is judged once, at
   * delivery: decodeSec / (tokens generated − 1), hidden reasoning tokens included.
   */
  decodeSec: number
  /**
   * §1.4 hidden reasoning tokens this answer carries, latched at the first token from the
   * model that produced it (thinkTokens × the archetype's thinkMul). They decode BEFORE the
   * answer, so they are the first `hiddenTokens` of `maxWork`, and they are never billed.
   */
  hiddenTokens: number
  /** real seconds to the first ANSWER token (TTFT + the hidden reasoning), latched when the answer starts. */
  ttfatReal: number
  /**
   * the model that holds this request's KV — its partly ingested prompt, or its whole context
   * once it has a first token. Only racks running that model may continue it; another model
   * takes over only by re-prefilling (combat `handOff`).
   */
  kvModelId?: string
  /** the rack that produced the first token; a P/D decode-pool rack elsewhere pays the KV transfer from it. */
  kvTowerId?: number
  /** real seconds of KV transfer still owed when a decode pool picks the request up (P/D disaggregation). */
  kvTransferSec: number
  /**
   * the rack whose engine runs this answer's decode (set at its first token; taken over by the
   * least busy rack of its model in reach once it walks out of its home's reach). Its home admits
   * it before any new prompt; other racks of its model only help decode it with spare capacity.
   */
  homeTowerId?: number
  /**
   * a streaming answer whose KV model went out of reach is being re-prefilled by a rack of
   * another model (recompute preemption): `prefill` holds its whole sequence again, its first
   * token stands, and the re-ingest time is a stall inside its decode (E2EL, TPOT).
   */
  recompute: boolean
  /** latched true once this request misses a latency bound of its class SLO (cause in `sloCause`). */
  sloViolated: boolean
  /**
   * latched true when an in-range online server REJECTED this request on a hard capacity
   * gate: its full sequence exceeds the model window, or one stream's KV exceeds a whole
   * model copy's KV budget.
   */
  windowBlocked: boolean
  /**
   * latched true when an in-range online server could hold this request at its full sequence
   * (window and KV). A request that reaches the core unanswered is `unservable` only when a
   * rack rejected it on a hard gate and NO rack that saw it could ever have held it; otherwise
   * it waited on capacity and is a plain `leaked` (§2.5).
   */
  fitSeen: boolean
  speed: number
  /** resolved scalar difficulty = def.difficulty[primaryAxis] × complexityMul (the quality gate, §6.4). */
  difficulty: number
  context: number
  /** §3.4 per-request hazard severities (hazard → 0..1); the two-layer verdict reads this. */
  hazards: SafetyProfile
  /** §3.4 the hazards NOT yet cleared by layer 1 (self-handle) or layer 2 (a guardrail in path). */
  hazardsOpen: SafetyProfile
  /**
   * A NOVEL attack (adaptive variant of the era): classifier guards lose recall on it
   * (guards.ts NOVEL_RECALL_MUL); a generative judge and the model's own alignment do not.
   */
  novel: boolean
  /** derived quick danger flag = max open-hazard severity (renderer/movement). */
  safetyRisk: number
  reward: number
  /** real input/output token prices ($/Mtok) carried from the def (§6.6). */
  pricePerMtokIn: number
  pricePerMtokOut: number
  trustPenalty: number
  slaPenalty: number
  data: number
  /**
   * the answer's quality margin (effQ − difficulty on the judged axis): the TOKEN-WEIGHTED
   * mean over the racks that generated its tokens, so a strong rack that produced a
   * sliver of the answer cannot bless tokens a weak rack wrote. −999 until scored;
   * ≥ 0 = a correct answer, < 0 = a wrong one.
   */
  bestQuality: number
  /** token-weighted quality accumulator: Σ generated × margin, and Σ generated (bestQuality = sum / weight). */
  qualTokSum: number
  qualTokW: number
  /** sim time when this request entered the lane (drives latency telemetry) */
  bornAt: number
  /** §3.4 true once every hazard has been cleared (layer 1 self-handle OR a guardrail). */
  safetyCleared: boolean
  /**
   * §3.6/§2.5 latched when a BENIGN request was wrongly refused — by layer 1
   * (model over-refusal) or layer 2 (a guardrail false positive); `refusedBy` says which.
   * Resolves to the `overRefused` outcome (revenue 0, light Trust/SLA hit).
   */
  overRefused: boolean
  /**
   * §3.4 layer 1 has been rolled. It is rolled ONCE, at the first output token, with the
   * alignment of the model on the rack that produced that token (prefill completion or a
   * full prefix-cache hit) — never by a rack that only had the request in range.
   */
  selfHandled: boolean
  /**
   * §3.3 true once the guardrails covering this request's lane have screened it. A guard
   * screens by LANE COVERAGE: each request is screened exactly once, at its first contact
   * with a rack that could prefill it, wherever on the lane the guard sits.
   */
  screened: boolean
  /** §3.3 the guardrail tower ids that screened this request (one per archetype on its lane). */
  guardsSeen: Set<number>
  /** §3.4 an ADVERSARIAL request correctly handled: blocked by a guard, or refused / safely completed by the model. */
  attackHandled: boolean
  /** inside an online Router's range this tick (capability-aware dispatch applies, §4.10). */
  routed: boolean
  /** the rack a Router dispatched this request's prompt to this tick (null = not routed this tick). */
  routedTo: number | null
  /** the request's single prefix-cache lookup has been rolled (hit or miss, it is never re-rolled). */
  cacheLooked: boolean
  /** prompt tokens served from a prefix-cache hit (0 = no hit). */
  cachedTokens: number
  /** output tokens generated per rack id — `answeredBy` is the largest contributor. */
  tokBy: Record<number, number>
  x: number
  y: number
  alive: boolean
  // ---- display-only (read by render/UI/agent; the sim never branches on these) ----
  /** sloMiss cause, latched at the first violated bound. */
  sloCause?: SloCause
  /** overRefused: who refused it. */
  refusedBy?: RefusedBy
  /** hidden reasoning tokens this answer carries (0/undefined = it was answered without thinking). */
  thinkTokens?: number
  /** the mode the rack that produced the first token answered in (latched then; undefined before it). */
  thinkingMode?: AnswerMode
  /** the tower that generated most of the answer so far. */
  answeredBy?: number
  /** the model deployed on `answeredBy` when it generated those tokens (survives a later sell/swap). */
  answeredModelId?: string
}

/** Runtime tower instance. */
export interface Tower {
  id: number
  def: TowerDef
  col: number
  row: number
  x: number
  y: number
  level: number
  online: boolean
  /** 1 = full speed, < 1 = thermally throttled */
  throttle: number
  /** fraction of batch slots busy last combat tick (0..1) — expert telemetry */
  load: number
  /** current rack hardware tier (servers only; upgradable in place) */
  hwId?: string
  /** currently deployed model checkpoint (servers only; swappable) */
  modelId?: string
  /** requisitioned for the active research project (trains instead of serving) */
  training?: boolean
  /** P/D disaggregation role (requires the research; undefined = auto) */
  role?: 'prefill' | 'decode'
  /** §4.5 the weight format this rack serves its model in (researched formats only; undefined = auto). */
  precision?: WeightFormat
  /**
   * §4.10 multi-LoRA: the rack hot-swapped between adapter siblings mid-wave, so it serves
   * them unmerged (the S-LoRA kernel overhead applies) until the next build phase re-merges.
   */
  loraHot?: boolean
  /**
   * §4.3 P/D disaggregation: real lane-seconds of prompt prefill this rack owes the decode
   * pools that took its KV (their cohorts' other prompts). A prefill pool pays it out of its
   * lane time before it starts new prompts; 0 for every other rack. Reset at wave start.
   */
  prefillDebtSec: number
  // ---- display-only, refreshed each combat tick (render/UI read; the sim never branches on these) ----
  /** request ids this rack decoded last tick. */
  decodeIds?: number[]
  /** request id whose prefill this rack ran last tick (null = none). */
  prefillId?: number | null
  /** fraction of this rack's KV budget in use last tick (0..1). */
  kvFrac?: number
  /** request sprites decoding on this rack last tick. */
  batch?: number
  /** real concurrent streams last tick (Σ of the admitted sprites' cohorts, §5.7). */
  streams?: number
  /** per-user decode tok/s of a stream on this rack last tick (0 = not decoding). */
  tokS?: number
}

export interface Meters {
  trust: number
  sla: number
  cash: number
}

/** A capacity meter. §6.5: power & cooling are REAL kW (used kW vs cap kW). */
export interface Capacity {
  used: number
  cap: number
}

/** One scheduled burst of spawns inside a wave. */
export interface SpawnGroup {
  typeId: string
  count: number
  /** seconds between spawns in this group */
  interval: number
  /** seconds before this group begins (from wave start) */
  delay: number
  workMul?: number
  speedMul?: number
  /** endless scaling: benchmarks get harder — complexity climbs with the wave index */
  complexityMul?: number
  rewardMul?: number
  /** endless scaling: context windows of the era keep growing too */
  contextMul?: number
  /**
   * Pin this burst to a single ingress lane — a "single-entry surge" (undersea
   * cable cut / regional outage funnels traffic through one region instead of
   * spreading across the four ingress lanes). Undefined → spread round-robin
   * across the active lane window.
   */
  lane?: number
  /**
   * Era hazard pressure (campaign.ts hazardMulOf): multiplies every hazard severity the
   * archetype carries (clamped to 1). Attacks get stronger as the campaign advances.
   */
  hazardMul?: number
  /**
   * Share (0..1) of this burst's hazardous requests that are NOVEL attacks — adaptive
   * variants the classifier guards never trained on (they lose recall on them, per
   * archetype). Assigned deterministically by spawn order, no RNG.
   */
  novelShare?: number
  /** Per-burst hazard override (an authored wave can arm an archetype that is benign by default). */
  hazards?: SafetyProfile
}

export interface WaveDef {
  name: string
  brief: string
  teaches: string
  /**
   * The SLA-contract payment for clearing the wave at 100% Goodput (credits before
   * CLEAR_BONUS_SCALE); the paid bonus scales with the wave's Goodput (sim.ts clearWave).
   */
  clearBonus: number
  groups: SpawnGroup[]
}

export type ModifierTarget =
  | 'powerPrice'
  | 'coolingCap'
  | 'buildCost'
  | 'safetyDamage'
  | 'volume'
  | 'reward'
  /** usable grid capacity (a curtailment order sheds part of the feed). */
  | 'powerCap'
  /** 0 = no NEW Power Plant can be energized (an interconnection freeze); 1 = normal. */
  | 'powerBuild'
  /** SLA cost of every non-served outcome (an enterprise pilot: strict penalties). */
  | 'slaDamage'

export interface IncidentDef {
  id: string
  name: string
  icon: string
  desc: string
  /** active multipliers applied during the next wave */
  mods: Partial<Record<ModifierTarget, number>>
  /** one-shot effect applied immediately when the incident is telegraphed */
  instant?: (s: GameState) => void
  /**
   * Funnel the upcoming wave's un-pinned traffic into this many randomly-chosen
   * ingress lanes (a network reroute / undersea-cable cut). 1 = a single-entry
   * surge — all spread traffic crashes into one ingress, stressing local capacity.
   */
  concentrate?: number
  good?: boolean
}

export interface UpgradeDef {
  id: string
  path: 'scale' | 'efficiency' | 'safety' | 'product'
  name: string
  cashCost: number
  dataCost: number
  desc: string
  /** prerequisite upgrade ids */
  requires?: string[]
  /** max times it can be bought */
  maxLevel: number
}

export interface RuntimeSpawn extends SpawnGroup {
  spawned: number
  timer: number
  started: boolean
}

/**
 * The seven terminal outcomes of a request (§2.5) — ONE vocabulary shared by the
 * sim telemetry, the board FX, audio, the wave report, the end screen and the
 * agent bridge. (`src/outcomes.ts` maps each to its color / glyph / label / cue.)
 */
export type Outcome = 'served' | 'sloMiss' | 'bad' | 'unsafe' | 'overRefused' | 'unservable' | 'leaked'
export const OUTCOMES: readonly Outcome[] = ['served', 'sloMiss', 'bad', 'unsafe', 'overRefused', 'unservable', 'leaked']
/** Which latency bound a late answer missed first: time-to-first-token, per-token, end-to-end, or time-to-first-ANSWER-token (thinking models). */
export type SloCause = 'ttft' | 'tpot' | 'e2el' | 'ttfat'
/** Who wrongly refused a benign request: the model's own alignment (layer 1) or a guardrail (layer 2). */
export type RefusedBy = 'model' | 'guard'
/** Which meter ended the run. */
export type LoseMeter = 'cash' | 'trust' | 'sla'

/**
 * Sim → presentation event stream (drained by game.ts each frame).
 *
 * Rule: events fire per request LIFECYCLE / player action / state TRANSITION — never
 * per tick (tests do not drain `s.events`). Continuous display state lives on
 * Tower/Request display fields instead.
 *
 * Every terminal request resolves into exactly one `outcome`; the safety layers
 * announce themselves with `guard` / `selfHandle`; player actions with `build`,
 * `upgrade`, `deploy`, `sell`; research with `research-start`, `research-done` and
 * `posttrain-done`. The board FX, audio, notifications and achievements all read
 * this one vocabulary.
 */
export type GameEvent =
  | {
      type: 'outcome'
      requestId: number
      typeId: string
      laneId: number
      x: number
      y: number
      outcome: Outcome
      /** credits earned by this request (0 for every non-paying outcome). */
      cash: number
      /** meter deltas this outcome applied (negative = loss). */
      dTrust: number
      dSla: number
      /** sloMiss only: the first latency bound violated. */
      cause?: SloCause
      /** the judged capability axis and the quality margin (effQ − difficulty; < 0 = wrong). */
      axis?: ServerSpec
      margin?: number
      /** overRefused only: model (layer 1) vs guardrail (layer 2). */
      refusedBy?: RefusedBy
      /** the rack that generated (most of) the answer, and its model, when one did. */
      towerId?: number
      modelId?: string
      /** true when a prefix-cache hit skipped (part of) the prefill. */
      cached?: boolean
      /** the mode the answer ran in (instant / thinking) and the hidden reasoning tokens it carried. */
      thinkingMode?: AnswerMode
      hiddenTokens?: number
    }
  | {
      type: 'guard'
      towerId: number
      requestId: number
      x: number
      y: number
      /** caught = a hazard was cleared by this guard; overRefused = it wrongly blocked a benign request. */
      result: 'caught' | 'overRefused'
      archetype: GuardrailArchetype
      hazard?: SafetyHazard
    }
  /** layer 1: the serving model's own alignment cleared a hazard (safe refusal / safe completion). */
  | { type: 'selfHandle'; towerId: number; requestId: number; x: number; y: number; hazard: SafetyHazard }
  | { type: 'cache'; x: number; y: number; towerId?: number; requestId?: number }
  | { type: 'build'; towerId: number; defId: string; x: number; y: number }
  | { type: 'upgrade'; towerId: number; hwId: string; x: number; y: number }
  | { type: 'deploy'; towerId: number; modelId: string; x: number; y: number }
  | { type: 'sell'; x: number; y: number; towerId?: number; defId?: string; refund?: number }
  /** emitted on power-state TRANSITIONS only (on = brownout began, false = recovered). */
  | { type: 'brownout'; on?: boolean }
  | { type: 'wave-start'; index: number; boss?: boolean; surgeLane?: number }
  | { type: 'wave-clear'; index: number; goodputPct?: number }
  | { type: 'incident'; id: string }
  | { type: 'research-start'; id: string; track?: string }
  | { type: 'research-done'; id: string }
  | { type: 'posttrain-done'; modelId: string }
  | { type: 'win' }
  | { type: 'lose'; meter?: LoseMeter }

export interface GameStats {
  served: number
  /** completed-but-late: missed its class SLO → half pay (an SLA credit), excluded from Goodput (§2.5). */
  sloMiss: number
  bad: number
  /** rejected by a hard capacity gate (the context window or a whole KV budget) and never served (§2.5). */
  unservable: number
  unsafe: number
  /** benign request wrongly refused by over-aligned model or guardrail (§3.6/§2.5). */
  overRefused: number
  leaked: number
  cashEarned: number
  peakConcurrent: number
  /** cumulative Trust / SLA lost per outcome over the run (display: end screen "biggest drains"). */
  trustLostBy?: Partial<Record<Outcome, number>>
  slaLostBy?: Partial<Record<Outcome, number>>
}

/** Per-request-type outcome row inside the wave telemetry (the six outcomes, §2.5). */
export interface WaveTypeStat {
  served: number
  sloMiss: number
  bad: number
  unservable: number
  unsafe: number
  /** benign request wrongly refused (§3.6/§2.5). */
  overRefused: number
  leaked: number
  cash: number
}

/**
 * Telemetry accumulated by the sim while a wave runs. Always collected
 * (it is cheap and deterministic); Expert Mode merely displays it.
 */
export interface WaveStats {
  waveIndex: number
  served: number
  /** completed-but-late requests (§2.5). */
  sloMiss: number
  bad: number
  /** capacity-rejected requests: too long for the window or the KV budget (§2.5). */
  unservable: number
  unsafe: number
  /** benign request wrongly refused (§3.6/§2.5). */
  overRefused: number
  leaked: number
  cacheHits: number
  /** token-priced request revenue earned during the wave (excludes the clear bonus) */
  cashIn: number
  /** the whole operating bill paid during the wave (= gpuCost + energyCost) */
  powerCost: number
  /** §6.6 the GPU-hour line: hardware amortization, maintenance, colo — every online rack, busy or idle */
  gpuCost: number
  /** §6.6 the energy line: kW drawn × PUE × $/kWh (power-price incidents scale only this) */
  energyCost: number
  /** first-hardware-contact→answer latencies (seconds) of every answered request */
  latencies: number[]
  /** first-hardware-contact→first-token latencies (TTFT, seconds) of every prefilled request */
  ttfts: number[]
  /** every terminal outcome this wave — the honest Goodput denominator (§5.5). */
  total: number
  /** requests that received a computed answer (served with a first token, sloMiss, bad, unsafe). */
  answered: number
  /** answered requests that met every latency bound of their class SLO (the SLO-attainment numerator). */
  answeredInSlo: number
  /** clean `served` outcomes (correct, safe, within SLO) — the Goodput numerator. */
  goodput: number
  /** Trust / SLA lost this wave per outcome (positive magnitudes). */
  trustLostBy: Partial<Record<Outcome, number>>
  slaLostBy: Partial<Record<Outcome, number>>
  /** sloMiss count by the first latency bound violated. */
  sloCauses: Partial<Record<SloCause, number>>
  /** overRefused count by who refused (model vs guardrail). */
  overRefusedBy: Partial<Record<RefusedBy, number>>
  /** hazards cleared by a guardrail (layer 2) this wave. */
  guardCaught: number
  /** hazards self-handled by the serving model's alignment (layer 1) this wave. */
  selfHandled: number
  /** sim times of recent answers, pruned to a short window (drives req/s) */
  recentServes: number[]
  byType: Record<string, WaveTypeStat>
}

/** Finalized end-of-wave report (the Expert Mode settlement screen). */
export interface WaveReport {
  waveIndex: number
  served: number
  /** completed-but-late requests (§2.5). */
  sloMiss: number
  bad: number
  /** capacity-rejected requests: too long for the window or the KV budget (§2.5). */
  unservable: number
  unsafe: number
  /** benign request wrongly refused (§3.6/§2.5). */
  overRefused: number
  leaked: number
  cacheHits: number
  cashIn: number
  clearBonus: number
  /** the whole operating bill (= gpuCost + energyCost). */
  powerCost: number
  /** §6.6 the GPU-hour line and the energy line of the bill. */
  gpuCost?: number
  energyCost?: number
  avgLatency: number
  p95Latency: number
  /** time-to-first-token stats, measured from first hardware contact */
  avgTtft: number
  p95Ttft: number
  /**
   * Goodput (§5.5): % of ALL this wave's requests served correctly, safely and within
   * their SLO — timeouts, refusals, breaches and context rejects count as misses.
   */
  goodputPct: number
  duration: number
  byType: Record<string, WaveTypeStat>
  /** secondary latency view: % of ANSWERED requests that met every latency bound of their SLO. */
  sloAttainPct?: number
  /** hazards cleared by a guardrail (layer 2) / self-handled by the model (layer 1) this wave. */
  guardCaught?: number
  selfHandled?: number
  /** every terminal outcome this wave (the honest Goodput denominator). */
  total?: number
  /** Trust / SLA lost this wave per outcome (the "why did my meter drop" ledger). */
  trustLostBy?: Partial<Record<Outcome, number>>
  slaLostBy?: Partial<Record<Outcome, number>>
  /** sloMiss count by the bound that was missed. */
  sloCauses?: Partial<Record<SloCause, number>>
  /** overRefused split by who refused. */
  overRefusedBy?: Partial<Record<RefusedBy, number>>
}

export interface ActiveModifiers {
  powerPrice: number
  coolingCap: number
  buildCost: number
  safetyDamage: number
  volume: number
  reward: number
  powerCap: number
  powerBuild: number
  slaDamage: number
}

export interface GameState {
  phase: Phase
  time: number
  meters: Meters
  data: number
  power: Capacity
  /** every heat load against every heat-rejection asset (air + liquid), for the HUD meter. */
  cooling: Capacity
  /**
   * The Liquid Cooling Loops' own pool: only liquid-cooled racks reject heat into it, and
   * its capacity cools nothing else (air racks and support lean on the house chillers +
   * Cooling Towers). Included in `cooling`; each pool throttles its own racks.
   */
  coolingLiquid: Capacity
  routingPower: number
  towers: Tower[]
  requests: Request[]
  rng: RNG
  seed: number
  waveIndex: number
  waveActive: boolean
  waveTime: number
  spawns: RuntimeSpawn[]
  upgrades: Record<string, number>
  modifiers: ActiveModifiers
  pendingIncident: IncidentDef | null
  stats: GameStats
  /** live telemetry for the wave in progress (null between waves) */
  waveStats: WaveStats | null
  /** settled report of the most recently cleared wave */
  lastReport: WaveReport | null
  /** globally researched model checkpoints (deployable for free) */
  models: Record<string, true>
  /**
   * Derived (player-created) checkpoints the Post-Training Studio minted, resolved via
   * `resolveModel(s, id)` ahead of the static `MODEL_DEFS`.
   */
  derivedModels: Record<string, ModelDef>
  /** monotonically increasing id counter for derived checkpoints (`drv_{seq}`). */
  derivedSeq: number
  /** the researched serving stack, typed (R6): `applyInfraEffects` folds every infra node's effects into it, and every effects getter reads it. */
  infra: InfraState
  /** the three concurrent research tracks (§4.5 / C7), each busy or idle. */
  research: ResearchTracks
  /**
   * §3.6 the guardrails' decision threshold (0..1). The game runs every guard at the fixed
   * calibrated operating point 0.5 — where `effRecall` returns the guard's measured recall and
   * `overRefuse` its measured false-positive rate; no control changes it. The curve on either
   * side (more recall for more false refusals) is the no-free-lunch tradeoff the safety math
   * models and the tests exercise.
   */
  guardrailThreshold: number
  /** global market price multiplier on token revenue (§6.6; init 1, drift deferred). */
  marketPriceMul: number
  /** rolling fleet utilization = servedTokS / theoreticalMaxTokS (§6.6), 0..1. */
  utilization: number
  /** total real capex (USD) of the deployed rack fleet — telemetry (§6.6). */
  fleetCapexUsd: number
  /** past wave 100: procedural surges resuming at the wave-100 load and climbing, no wave cap */
  endless: boolean
  /** the wave currently being played (authored or procedurally generated) */
  currentWave: WaveDef | null
  events: GameEvent[]
  nextId: number
  /** round-robin counter indexing into the active lane window for scheduled traffic */
  nextLaneId: number
  /**
   * Ingress lanes in play for the current wave. Empty = all four lanes (the
   * default spread). A concentration incident narrows this to one (or a few)
   * lane(s) — a single-entry surge that funnels un-pinned traffic through one
   * region (§ network reroute / cable cut).
   */
  laneWindow: number[]
  message: string
}
