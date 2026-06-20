import type { RNG } from './rng'

export interface Vec2 {
  x: number
  y: number
}

export type Phase = 'menu' | 'build' | 'wave' | 'won' | 'lost'

export type ServerSpec = 'general' | 'chat' | 'coding' | 'reasoning' | 'agentic'
/** §6.4/H7/M1: the authoritative name for the capability-match axis (values = ServerSpec). */
export type CapabilityAxis = ServerSpec
/** §4.6 attention family; reflected in the real KV formula via kvHeads (MLA gets a latent factor). */
export type AttnVariant = 'MHA' | 'MQA' | 'GQA' | 'MLA'
/** §1.3 latency class → real-ms SLO bucket. IN=interactive, NR=near-real-time, TO=throughput/offline. */
export type LatencyClass = 'IN' | 'NR' | 'TO'

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
 * Static hardware profile for a server rack — now REAL accelerator specs.
 * A board tile represents `gpus` GPUs; aggregate fields (bf16Tflops, hbmGb, …)
 * are `perGpu × gpus`, filled at load (§6.3). powerDraw / heat stay ABSTRACT
 * for the existing power system this phase (real watts is a later phase).
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
  hbmGb: number
  /** aggregate HBM bandwidth in TB/s. */
  hbmTbs: number
  /** aggregate nameplate TDP in watts (tdpWattsPerGpu × gpus) — the REAL kW power basis (§6.5). */
  tdpWatts: number
  /** aggregate operating rate in USD per hour (gpuHrUsdPerGpu × gpus, §5.8/§6.6). */
  gpuHrUsd: number
  // --- engineering / display fields ---
  /** Baseline concurrent decode slots before serving upgrades. */
  targets: number
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
  /** the public benchmark %s the qualityBy vector was calibrated from. */
  benchmarks: {
    mmluPro?: number
    gpqaDiamond?: number
    liveCodeBench?: number
    sweBench?: number
    aime?: number
    humanEval?: number
    longContext?: number
  }
  confidence: 'high' | 'medium' | 'low'
  /** primary source — arXiv id or model-card URL. */
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
 * so deploying one costs nothing. What gates them is (a) rack VRAM — a model
 * must fit `paramsTotalB` of memory — and (b) METHOD unlocks: a sparse-expert
 * (`isMoE`) checkpoint needs the MoE research, a thinking (`isReasoning`)
 * checkpoint needs the Reasoning research, before it can be deployed.
 * Custom checkpoints you finetune/pretrain in the Model Lab are added the same
 * way. Models decide answer quality and serving demand.
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
  /** sparse mixture-of-experts: all experts resident (VRAM), only active params serve. Deploy-gated by the MoE method. */
  isMoE: boolean
  /** test-time "thinking" model: its `qualityBy` already reflects the gain, and it emits far more output tokens. Deploy-gated by the Reasoning method. */
  isReasoning: boolean
  /** Peak correctness score (the model's best axis) — display & sorting. */
  quality: number
  /**
   * Correctness per traffic axis, checked against Request complexity by
   * affinity. For real checkpoints this is calibrated from public benchmarks
   * (MMLU-Pro→chat/general, LiveCodeBench→coding, GPQA-Diamond→reasoning);
   * see `sim/calibrate.ts`.
   */
  qualityBy: Record<CapabilityAxis, number>
  // --- real architecture (feeds the §5.6 KV / §6.2 roofline formulas) ---
  /** transformer layers. */
  layers: number
  /** KV (grouped/MQA/MLA) heads — low values reflect GQA/MQA naturally. */
  kvHeads: number
  /** per-head dimension. */
  headDim: number
  /** attention family (§4.6). MLA gets a latent KV factor. */
  attn: AttnVariant
  /** bytes per weight param at deploy default: 2=FP16, 1=FP8, 0.5=INT4 (§5.6). */
  weightBytes: 2 | 1 | 0.5
  /** real context window in thousands of tokens (the hard window gate, §1.2). */
  contextWindowK: number
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
 * 'tech' → 'infra' (no def maps to 'eval' yet — that track is reserved).
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
  /** scheduling.batch=continuous batching unlocked; multiStep/throughput lift tok/s; chunked=Sarathi. */
  scheduling: { batch: boolean; multiStep: number; chunked: boolean }
  /** KV memory: paged utilization, prefix-cache hit ceiling, KV element bytes, CPU/SSD offload, FlashAttention level. */
  kv: { utilization: number; prefixHitCeil: number; quantBytes: number; offloadGb: number; flash: number }
  /** P/D disaggregation (DistServe); hard-conflicts chunked prefill (§4.3). */
  disagg: boolean
  /** Speculative decoding (EAGLE): batch-dependent decode speedup (§4.4). */
  spec: { enabled: boolean; level: number }
  /** PTQ weight quant; feeds §6.2 bytesPerParam (2=FP16, 1=FP8, 0.5=INT4). */
  weightQuantBytes: 2 | 1 | 0.5
  /** TP=+prefill roof (NVLink), PP=memory, DP=throughput, EP=MoE serving-efficiency (§4.7). */
  par: { tp: boolean; pp: boolean; dp: boolean; ep: boolean }
  /** KV-aware request routing (Dynamo, ~2×, §4.10). */
  routing: { kvAware: boolean }
  /** S-LoRA adapter slots served from one base copy (§4.10). */
  loraSlots: number
  /** inference engine tier 0=vLLM / 1=SGLang / 2=TRT-LLM → engine throughput mul (§4.9). */
  engineTier: 0 | 1 | 2
  /** aggregate throughput lift (multi-step scheduling + bigger-rack utilization, §4.1). */
  throughput: number
}

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
  /** flat effect bag (e.g. {schedBatch:1}, {kvUtilization:0.96}, {weightQuantBytes:1}). */
  effects: Partial<Record<string, number>>
  level: number
  /** prerequisite infra-node ids. */
  requires: string[]
  /** mutually-exclusive infra-node ids (§4.3 chunked ⟂ disagg). */
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
  /** §6.5 Liquid Cooling Loop: enables liquid-cooled racks (pod/superpod/giga) and adds large kW. */
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
  /** §1.3 per-type SLO overrides (ms). `agent` rides E2EL only (latClass TO + e2elSloMs). */
  ttftSloMs?: number
  e2elSloMs?: number
  /** path-tiles per second */
  speed: number
  /**
   * §6.4/R8 per-axis quality threshold a model must clear to answer correctly.
   * The capability-match axis (`primaryAxis`) is the one combat judges; the
   * vector also carries secondary axes for documentation/balance. Replaces the
   * old scalar `complexity` ([fix M2]) — runtime scalar = difficulty[primaryAxis].
   */
  difficulty: Partial<Record<CapabilityAxis, number>>
  /** §1.2#10 fraction of the prompt that is a reusable prefix (prefix-cache friendliness). */
  prefixShare: number
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
  /** real seconds spent in range but un-admitted (drives ttftReal queue wait, §0.4). */
  queueSec: number
  /** real seconds to first token (queue + prefill), latched at prefill done (§0.4). */
  ttftReal: number
  /** real seconds for the full answer (ttft + decode), accumulated as decode runs (§0.4). */
  e2elReal: number
  /** latched true once this request's TTFT or per-token rate misses its class SLO. */
  sloViolated: boolean
  /**
   * latched true when an in-range online server REJECTED this request on the hard
   * context-window gate (contextLen > window). If it then leaks without ever being
   * served, the outcome is `unservable` (a distinct bucket), not a plain leak (§2.5).
   */
  windowBlocked: boolean
  speed: number
  /** resolved scalar difficulty = def.difficulty[primaryAxis] × complexityMul (the quality gate, §6.4). */
  difficulty: number
  context: number
  /** §3.4 per-request hazard severities (hazard → 0..1); the two-layer verdict reads this. */
  hazards: SafetyProfile
  /** §3.4 the hazards NOT yet cleared by layer 1 (self-handle) or layer 2 (a guardrail in path). */
  hazardsOpen: SafetyProfile
  /** derived quick danger flag = max open-hazard severity (renderer/movement). */
  safetyRisk: number
  reward: number
  /** real input/output token prices ($/Mtok) carried from the def (§6.6). */
  pricePerMtokIn: number
  pricePerMtokOut: number
  trustPenalty: number
  slaPenalty: number
  data: number
  /** best (model quality - complexity) margin seen from any server that hit it */
  bestQuality: number
  /** sim time when this request entered the lane (drives latency telemetry) */
  bornAt: number
  /** §3.4 true once every hazard has been cleared (layer 1 self-handle OR a guardrail). */
  safetyCleared: boolean
  /**
   * §3.6/§2.5 latched when a BENIGN request was wrongly refused — by layer 1
   * (model over-refusal) or layer 2 (a guardrail's threshold over-refuse). Resolves
   * to the `over_refused` outcome (revenue 0, light Trust hit), excluded from served.
   */
  overRefused: boolean
  /** §3.4 layer-1 self-handle (0-latency) is rolled once, the first time a server hits it. */
  selfHandled: boolean
  /** §3.3 guardrail tower ids that have already processed this request (each checks once). */
  guardsSeen: Set<number>
  routed: boolean
  /** seconds until another cache lookup may be attempted (0 = may roll now) */
  cacheCd: number
  x: number
  y: number
  hitFlash: number
  cacheFlash: number
  alive: boolean
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
  cooldown: number
  muzzle: number
  targetId: number | null
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
}

export interface WaveDef {
  name: string
  brief: string
  teaches: string
  /** bonus cash paid for clearing the wave */
  clearBonus: number
  groups: SpawnGroup[]
}

export type ModifierTarget = 'powerPrice' | 'coolingCap' | 'buildCost' | 'safetyDamage' | 'volume' | 'reward'

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

export type GameEvent =
  | { type: 'fire'; fx: { x: number; y: number }; tx: number; ty: number; color: number }
  | { type: 'serve'; x: number; y: number; kind: 'good' | 'bad' | 'unsafe' | 'over_refused'; amount: number }
  | { type: 'cache'; x: number; y: number }
  | { type: 'leak'; x: number; y: number; unsafe: boolean }
  | { type: 'place'; x: number; y: number }
  | { type: 'sell'; x: number; y: number }
  | { type: 'brownout' }
  | { type: 'wave-start'; index: number }
  | { type: 'wave-clear'; index: number }
  | { type: 'train' }
  | { type: 'research-done'; id: string }
  | { type: 'win' }
  | { type: 'lose' }

export interface GameStats {
  served: number
  /** completed-but-late: missed its class SLO → zero cash, excluded from Goodput (§2.5). */
  sloMiss: number
  bad: number
  /** rejected by the hard context-window gate and never served (§2.5). */
  unservable: number
  unsafe: number
  /** benign request wrongly refused by over-aligned model or guardrail (§3.6/§2.5). */
  overRefused: number
  leaked: number
  cashEarned: number
  peakConcurrent: number
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
  /** context-window-rejected requests (§2.5). */
  unservable: number
  unsafe: number
  /** benign request wrongly refused (§3.6/§2.5). */
  overRefused: number
  leaked: number
  cacheHits: number
  /** token-priced request revenue earned during the wave (excludes the clear bonus) */
  cashIn: number
  /** real operating cost (Σ online racks' $/GPU-hr × wall-clock) paid during the wave */
  powerCost: number
  /** first-hardware-contact→answer latencies (seconds) of every answered request */
  latencies: number[]
  /** first-hardware-contact→first-token latencies (TTFT, seconds) of every prefilled request */
  ttfts: number[]
  /** answered (served+bad) request count — the Goodput denominator. */
  answered: number
  /** answered requests that met their class SLO (effLatency within TTFT∧TPOT) — the Goodput numerator. */
  goodput: number
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
  /** context-window-rejected requests (§2.5). */
  unservable: number
  unsafe: number
  /** benign request wrongly refused (§3.6/§2.5). */
  overRefused: number
  leaked: number
  cacheHits: number
  cashIn: number
  clearBonus: number
  powerCost: number
  avgLatency: number
  p95Latency: number
  /** time-to-first-token stats, measured from first hardware contact */
  avgTtft: number
  p95Ttft: number
  /** % of answered requests that met their class SLO (Goodput, §1.3/§6.4). */
  goodputPct: number
  duration: number
  byType: Record<string, WaveTypeStat>
}

export interface ActiveModifiers {
  powerPrice: number
  coolingCap: number
  buildCost: number
  safetyDamage: number
  volume: number
  reward: number
}

export interface GameState {
  phase: Phase
  time: number
  meters: Meters
  data: number
  power: Capacity
  cooling: Capacity
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
   * Derived (player-created) checkpoints, resolved via `resolveModel(s,id)`
   * ahead of the static `MODEL_DEFS`. Empty `{}` in P0.5 (creation is P3b);
   * the resolution layer is stood up now so derived models resolve in-sim.
   */
  derivedModels: Record<string, ModelDef>
  /** monotonically increasing id counter for derived checkpoints (`drv_{seq}`). */
  derivedSeq: number
  /** DORMANT infra typed bag (R6); effects still read `s.upgrades` this phase. */
  infra: InfraState
  /** the three concurrent research tracks (§4.5 / C7), each busy or idle. */
  research: ResearchTracks
  /**
   * §3.6 global guardrail decision threshold (0..1, default 0.5). Higher → guardrails
   * catch more hazards (recall↑) but wrongly block more benign traffic (over-refuse↑) —
   * the no-free-lunch tradeoff. Per-building tuning is a later nicety; one knob for P3d.
   */
  guardrailThreshold: number
  /** global market price multiplier on token revenue (§6.6; init 1, drift deferred). */
  marketPriceMul: number
  /** rolling fleet utilization = servedTokS / theoreticalMaxTokS (§6.6), 0..1. */
  utilization: number
  /** total real capex (USD) of the deployed rack fleet — telemetry (§6.6). */
  fleetCapexUsd: number
  /** past wave 20: procedural waves with climbing difficulty, no wave cap */
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
