// Model-architecture sync — the SOP for GPTD's per-checkpoint serving facts.
//
// Artificial Analysis gives benchmarks; it does NOT give architecture. The serving physics
// (KV-cache capacity, weight residency, the roofline) needs real numbers per checkpoint, so they
// live in data/model-arch.json, keyed by the Hugging Face repo of the open weights:
//
//   paramsTotalB / paramsActiveB / isMoE      the developer-stated size (VRAM vs compute basis)
//   layers + kv[]                             the KV-cache layout as LAYER GROUPS, read off config.json
//   nativeWeightBytes / precision             the release precision (bytes/param of the checkpoint)
//   contextK / license                        served window, license
//   base                                      the Hugging Face repo it was post-trained from (a lineage edge)
//   aa { slug: uuid }                         the Artificial Analysis rows that measure this checkpoint
//                                             (the open-weight evidence gen-roster joins on)
//
// Thinking support (always / hybrid / never, with the chat-template evidence) lives in the sibling
// data/model-thinking.json (scripts/thinking-sync.mjs); `build` merges its mode into the output.
//
// KV layer groups (elements are counted per token, BF16 = 2 bytes each):
//   full        full attention:      layers × kvHeads × (headDim + vHeadDim)          grows with context
//   mla         latent attention:    layers × (latent + rope)  (one tensor, no ×2)    grows with context
//   compressed  CSA/HCA:             layers × dim / ratio                             grows with context
//   indexer     sparse-attn keys:    layers × dim / ratio                             grows with context
//   measured    a developer-published per-token figure (elems) when the config cannot express it;
//               `scheme` names the attention family it stands for (e.g. 'csa')
//   swa         sliding window:      layers × kvHeads × (headDim + vHeadDim) × window constant per request
//   linear      recurrent state:     layers × (state × stateBytes + conv × 2)         constant per request
//   shared      cross-layer KV reuse (stores nothing)
//   none        attention removed by architecture search (stores nothing)
//
// Usage:
//   node scripts/arch-sync.mjs fetch [repo…]    download config.json + safetensors metadata into .cache/hf/
//                                               (HF_TOKEN honoured for gated repos; `config` names a mirror)
//   node scripts/arch-sync.mjs extract [repo…]  (re)derive the config fields of data/model-arch.json from the cache;
//                                               fields listed in an entry's `manual` are never overwritten
//   node scripts/arch-sync.mjs verify           re-extract every cached entry and report drift (read-only)
//   node scripts/arch-sync.mjs build            compute the derived serving fields (+ the thinking mode) → src/sim/roster.arch.generated.ts

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ARCH = join(ROOT, 'data', 'model-arch.json')
const THINKING = join(ROOT, 'data', 'model-thinking.json')
const CACHE = join(ROOT, '.cache', 'hf')
const GENERATED = join(ROOT, 'src', 'sim', 'roster.arch.generated.ts')

/** Bytes per stored parameter by safetensors dtype (packed 4-bit formats include their block scales). */
const DTYPE_BYTES = {
  F64: 8, F32: 4, BF16: 2, F16: 2, F8_E4M3: 1, F8_E5M2: 1, I64: 8, BOOL: 1,
  U8: 0.53125, // MXFP4: 4-bit values + one 8-bit scale per 32
  I8: 0.53125, // DeepSeek FP4 (E2M1) experts + E8M0 scale per 32
  I32: 0.5625, // compressed-tensors INT4 pack-quantized, group 32 with BF16 scales
}
const PRECISION_OF = { BF16: 'BF16', F16: 'FP16', F32: 'FP32', F8_E4M3: 'FP8', F8_E5M2: 'FP8', U8: 'MXFP4', I8: 'FP4', I32: 'INT4' }

const loadArch = () => JSON.parse(readFileSync(ARCH, 'utf8'))
const KEY_ORDER = ['aa', 'config', 'base', 'paramsTotalB', 'paramsActiveB', 'isMoE', 'layers', 'heads', 'kv', 'nativeWeightBytes', 'precision', 'hfParamsB', 'contextK', 'license', 'manual', 'sources', 'notes', 'confidence']
const ordered = (e) => Object.fromEntries([...KEY_ORDER.filter((k) => k in e).map((k) => [k, e[k]]), ...Object.entries(e).filter(([k]) => !KEY_ORDER.includes(k))])
const saveArch = (a) => {
  a.models = Object.fromEntries(Object.entries(a.models).sort(([x], [y]) => x.localeCompare(y)).map(([k, e]) => [k, ordered(e)]))
  writeFileSync(ARCH, JSON.stringify(a, null, 2) + '\n')
}
const dirOf = (repo) => join(CACHE, repo.replace('/', '__'))

async function get(url) {
  const headers = process.env.HF_TOKEN ? { authorization: `Bearer ${process.env.HF_TOKEN}` } : {}
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers, redirect: 'follow' })
      if ([401, 403, 404].includes(res.status)) return { status: res.status, text: '' }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { status: res.status, text: await res.text() }
    } catch (e) {
      if (i === 2) return { status: 0, text: '', error: String(e) }
    }
  }
}

async function fetchAll(repos) {
  const arch = loadArch()
  const list = repos.length ? repos : Object.keys(arch.models)
  let i = 0
  const worker = async () => {
    while (i < list.length) {
      const repo = list[i++]
      const cfgRepo = arch.models[repo]?.config ?? repo
      const d = dirOf(repo)
      mkdirSync(d, { recursive: true })
      const api = await get(`https://huggingface.co/api/models/${repo}`)
      const cfg = await get(`https://huggingface.co/${cfgRepo}/resolve/main/config.json`)
      if (api.text) writeFileSync(join(d, 'api.json'), api.text)
      if (cfg.text) writeFileSync(join(d, 'config.json'), cfg.text)
      console.log(`${repo.padEnd(56)} api ${api.status} config ${cfg.status}${cfgRepo !== repo ? ` (via ${cfgRepo})` : ''}`)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
}

const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null)

/* ------------------------------------------------------------------ *
 *  config.json → layer groups, one reader per architecture family.     *
 * ------------------------------------------------------------------ */

const count = (xs, pred) => xs.filter(pred).length
const lm = (cfg) => cfg.text_config ?? cfg.llm_config ?? cfg

/** Gated DeltaNet recurrent state per layer (Qwen3-Next / Qwen3.5 / Qwen3.8): v-heads × dk × dv, plus the short conv. */
function deltaNet(c, layers) {
  const nk = c.linear_num_key_heads
  const nv = c.linear_num_value_heads
  const dk = c.linear_key_head_dim
  const dv = c.linear_value_head_dim
  const conv = (c.linear_conv_kernel_dim - 1) * (2 * nk * dk + nv * dv)
  return { kind: 'linear', mixer: 'gated-deltanet', layers, state: nv * dk * dv, stateBytes: c.mamba_ssm_dtype === 'float32' ? 4 : 2, conv }
}

/** Mamba-2 SSM state per layer: heads × headDim × dState, plus the conv over x/B/C. */
function mamba2(layers, heads, headDim, dState, groups, kernel, fp32) {
  return { kind: 'linear', mixer: 'mamba2', layers, state: heads * headDim * dState, stateBytes: fp32 ? 4 : 2, conv: (kernel - 1) * (heads * headDim + 2 * groups * dState) }
}

/** Kimi Delta Attention (KDA) state per layer: heads × dk × dv, plus short convs on q/k/v. */
function kda(layers, heads, headDim, kernel) {
  return { kind: 'linear', mixer: 'kda', layers, state: heads * headDim * headDim, stateBytes: 4, conv: (kernel - 1) * 3 * heads * headDim }
}

const full = (layers, kvHeads, headDim, vHeadDim) => ({ kind: 'full', layers, kvHeads, headDim, ...(vHeadDim != null && vHeadDim !== headDim ? { vHeadDim } : {}) })
const swa = (layers, kvHeads, headDim, window, vHeadDim) => ({ kind: 'swa', layers, kvHeads, headDim, window, ...(vHeadDim != null && vHeadDim !== headDim ? { vHeadDim } : {}) })
const mla = (layers, latent, rope) => ({ kind: 'mla', layers, latent, rope })

/** Generic dense-attention reader (Llama / Qwen / Mistral / Phi / Granite / ERNIE / Hy3 / K2 …). */
function gqa(cfg) {
  const c = lm(cfg)
  const L = c.num_hidden_layers
  const H = c.num_attention_heads
  const kv = c.num_key_value_heads ?? H
  const hd = c.head_dim || c.hidden_size / H
  return { layers: L, heads: H, kv: [full(L, kv, hd)] }
}

/** Split by a layer_types list (sliding / full / linear / conv / mamba). */
function byTypes(types, L) {
  const t = types.slice(0, L)
  return {
    full: count(t, (x) => x === 'full_attention' || x === 'attention' || x === 'deepseek_sparse_attention'),
    swa: count(t, (x) => x === 'sliding_attention'),
    linear: count(t, (x) => x === 'linear_attention' || x === 'mamba' || x === 'conv'),
  }
}

const READERS = {
  gpt_oss(cfg) {
    const c = lm(cfg)
    const n = byTypes(c.layer_types, c.num_hidden_layers)
    return { layers: c.num_hidden_layers, heads: c.num_attention_heads, kv: [full(n.full, c.num_key_value_heads, c.head_dim), swa(n.swa, c.num_key_value_heads, c.head_dim, c.sliding_window)] }
  },
  gemma3(cfg) {
    const c = lm(cfg)
    const L = c.num_hidden_layers
    const P = c.sliding_window_pattern
    const global = Math.floor(L / P)
    return { layers: L, heads: c.num_attention_heads, kv: [full(global, c.num_key_value_heads, c.head_dim), swa(L - global, c.num_key_value_heads, c.head_dim, c.sliding_window)] }
  },
  gemma3n(cfg) {
    const c = lm(cfg)
    const L = c.num_hidden_layers
    const stored = c.layer_types.slice(0, L - (c.num_kv_shared_layers ?? 0))
    const n = byTypes(stored, stored.length)
    return {
      layers: L, heads: c.num_attention_heads,
      kv: [full(n.full, c.num_key_value_heads, c.head_dim), swa(n.swa, c.num_key_value_heads, c.head_dim, c.sliding_window), { kind: 'shared', layers: L - stored.length }],
    }
  },
  gemma4(cfg) {
    const c = lm(cfg)
    const L = c.num_hidden_layers
    const stored = c.layer_types.slice(0, L - (c.num_kv_shared_layers ?? 0))
    const n = byTypes(stored, stored.length)
    const gkv = c.num_global_key_value_heads ?? c.num_key_value_heads
    const groups = [full(n.full, gkv, c.global_head_dim ?? c.head_dim), swa(n.swa, c.num_key_value_heads, c.head_dim, c.sliding_window)]
    if (L > stored.length) groups.push({ kind: 'shared', layers: L - stored.length })
    return { layers: L, heads: c.num_attention_heads, kv: groups }
  },
  qwen3_5(cfg) {
    const c = lm(cfg)
    const L = c.num_hidden_layers
    const fullN = c.layer_types ? byTypes(c.layer_types, L).full : Math.floor(L / c.full_attention_interval)
    const groups = [full(fullN, c.num_key_value_heads, c.head_dim), deltaNet(c, L - fullN)]
    if (c.indexer_head_dim) groups.push({ kind: 'indexer', layers: fullN, dim: c.indexer_kv_heads * c.indexer_head_dim, ratio: c.indexer_compress_ratio })
    return { layers: L, heads: c.num_attention_heads, kv: groups }
  },
  nemotron_h(cfg) {
    const c = lm(cfg)
    const pattern = c.layers_block_type ? c.layers_block_type.map((t) => (t === 'attention' ? '*' : t === 'mamba' ? 'M' : 'E')) : [...c.hybrid_override_pattern]
    const att = count(pattern, (x) => x === '*')
    const mam = count(pattern, (x) => x === 'M')
    const heads = c.mamba_num_heads
    return {
      layers: pattern.length, heads: c.num_attention_heads,
      kv: [full(att, c.num_key_value_heads, c.head_dim), mamba2(mam, heads, c.mamba_head_dim, c.ssm_state_size, c.mamba_num_groups ?? c.n_groups ?? 8, c.conv_kernel, c.mamba_ssm_cache_dtype === 'float32')],
    }
  },
  jamba(cfg) {
    const c = lm(cfg)
    const L = c.num_hidden_layers
    let att = 0
    for (let i = 0; i < L; i++) if (i % c.attn_layer_period === c.attn_layer_offset) att++
    const inner = c.mamba_expand * c.hidden_size
    return {
      layers: L, heads: c.num_attention_heads,
      kv: [full(att, c.num_key_value_heads, c.hidden_size / c.num_attention_heads), { kind: 'linear', mixer: 'mamba', layers: L - att, state: inner * c.mamba_d_state, stateBytes: 2, conv: (c.mamba_d_conv - 1) * inner }],
    }
  },
  lfm2(cfg) {
    const c = lm(cfg)
    const L = c.num_hidden_layers
    const att = c.layer_types ? byTypes(c.layer_types, L).full : c.full_attn_idxs.length
    return {
      layers: L, heads: c.num_attention_heads,
      kv: [full(att, c.num_key_value_heads, c.hidden_size / c.num_attention_heads), { kind: 'linear', mixer: 'short-conv', layers: L - att, state: 0, stateBytes: 2, conv: (c.conv_L_cache - 1) * (c.conv_dim ?? c.hidden_size) }],
    }
  },
  granitemoehybrid(cfg) {
    const c = lm(cfg)
    const L = c.num_hidden_layers
    const n = byTypes(c.layer_types, L)
    const hd = c.hidden_size / c.num_attention_heads
    const groups = [full(n.full, c.num_key_value_heads, hd)]
    if (n.linear) groups.push(mamba2(n.linear, c.mamba_n_heads, c.mamba_d_head, c.mamba_d_state, c.mamba_n_groups, c.mamba_d_conv, false))
    return { layers: L, heads: c.num_attention_heads, kv: groups }
  },
  exaone4(cfg) {
    const c = lm(cfg)
    const L = c.num_hidden_layers
    const hd = c.head_dim ?? c.hidden_size / c.num_attention_heads
    const n = c.layer_types ? byTypes(c.layer_types, L) : { full: L, swa: 0 }
    const groups = [full(n.full, c.num_key_value_heads, hd)]
    if (n.swa) groups.push(swa(n.swa, c.num_key_value_heads, hd, c.sliding_window))
    return { layers: L, heads: c.num_attention_heads, kv: groups }
  },
  exaone_moe(cfg) {
    const c = lm(cfg)
    const L = c.num_hidden_layers
    const groups = [full(count(c.sliding_windows, (w) => w === 0), c.num_key_value_heads, c.head_dim)]
    const windows = [...new Set(c.sliding_windows.filter((w) => w > 0))]
    for (const w of windows) groups.push(swa(count(c.sliding_windows, (x) => x === w), c.num_key_value_heads, c.head_dim, w))
    return { layers: L, heads: c.num_attention_heads, kv: groups }
  },
  muse_glimmer(cfg) {
    const c = lm(cfg)
    const n = byTypes(c.layer_types, c.num_hidden_layers)
    return { layers: c.num_hidden_layers, heads: c.num_attention_heads, kv: [full(n.full, c.num_key_value_heads, c.head_dim), swa(n.swa, c.num_key_value_heads, c.head_dim, c.sliding_window)] }
  },
  deepseek_v3(cfg) {
    const c = lm(cfg)
    const groups = [mla(c.num_hidden_layers, c.kv_lora_rank, c.qk_rope_head_dim)]
    if (c.index_head_dim) groups.push({ kind: 'indexer', layers: c.num_hidden_layers, dim: c.index_head_dim })
    return { layers: c.num_hidden_layers, heads: c.num_attention_heads, kv: groups }
  },
  glm_moe_dsa(cfg) {
    const c = lm(cfg)
    return {
      layers: c.num_hidden_layers, heads: c.num_attention_heads,
      kv: [mla(c.num_hidden_layers, c.kv_lora_rank, c.qk_rope_head_dim), { kind: 'indexer', layers: count(c.indexer_types, (t) => t === 'full'), dim: c.index_head_dim }],
    }
  },
  longcat(cfg) {
    const L = cfg.num_layers * 2 // two MLA sublayers per shortcut-connected block
    return { layers: L, heads: cfg.num_attention_heads, kv: [mla(L, cfg.kv_lora_rank, cfg.qk_rope_head_dim), { kind: 'indexer', layers: cfg.num_layers, dim: cfg.index_head_dim }] }
  },
  deepseek_v4(cfg) {
    const c = lm(cfg)
    const L = c.num_hidden_layers
    const ratios = c.compress_ratios.slice(0, L)
    const groups = []
    for (const r of [...new Set(ratios.filter((x) => x > 0))].sort((a, b) => a - b)) groups.push({ kind: 'compressed', layers: count(ratios, (x) => x === r), dim: c.head_dim, ratio: r })
    const csa = count(ratios, (x) => x === 4)
    if (csa) groups.push({ kind: 'indexer', layers: csa, dim: c.index_head_dim, ratio: 4 })
    groups.push(swa(L, 1, c.head_dim, c.sliding_window, 0))
    return { layers: L, heads: c.num_attention_heads, kv: groups }
  },
  kimi_k3(cfg) {
    const c = lm(cfg)
    const la = c.linear_attn_config
    return {
      layers: c.num_hidden_layers, heads: c.num_attention_heads,
      kv: [mla(la.full_attn_layers.length, c.kv_lora_rank, c.qk_rope_head_dim), kda(la.kda_layers.length, la.num_heads, la.head_dim, la.short_conv_kernel_size)],
    }
  },
  glm5_next(cfg) {
    const c = lm(cfg)
    const la = c.linear_attn_config
    return {
      layers: c.num_hidden_layers, heads: c.num_attention_heads,
      kv: [
        mla(la.full_attn_layers.length, c.kv_lora_rank, c.qk_rope_head_dim),
        { kind: 'indexer', layers: count(c.indexer_types, (t) => t === 'full'), dim: c.index_head_dim },
        kda(la.kda_layers.length, la.num_heads, la.head_dim, la.short_conv_kernel_size),
      ],
    }
  },
  bailing_hybrid(cfg) {
    const c = lm(cfg)
    const L = c.num_hidden_layers
    const mlaN = Math.floor(L / c.layer_group_size)
    return { layers: L, heads: c.num_attention_heads, kv: [mla(mlaN, c.kv_lora_rank, c.qk_rope_head_dim), kda(L - mlaN, c.num_attention_heads, c.head_dim, c.short_conv_kernel_size)] }
  },
  solar_open2(cfg) {
    const c = lm(cfg)
    const L = c.num_hidden_layers
    const g = c.gqa_layers.length
    const la = c.linear_attn_config
    return { layers: L, heads: c.num_attention_heads, kv: [full(g, c.num_key_value_heads, c.head_dim), kda(L - g, la.num_heads, la.head_dim, la.short_conv_kernel_size)] }
  },
  mimo_v2(cfg) {
    const c = lm(cfg)
    const p = c.hybrid_layer_pattern
    return {
      layers: c.num_hidden_layers, heads: c.num_attention_heads,
      kv: [full(count(p, (x) => x === 0), c.num_key_value_heads, c.head_dim, c.v_head_dim), swa(count(p, (x) => x === 1), c.swa_num_key_value_heads, c.swa_head_dim, c.sliding_window, c.swa_v_head_dim)],
    }
  },
  step5(cfg) {
    const c = lm(cfg)
    const n = byTypes(c.layer_types, c.num_hidden_layers)
    return {
      layers: c.num_hidden_layers, heads: c.num_attention_heads,
      kv: [full(n.full, c.num_attention_groups_full_attention, c.head_dim_full_attention), swa(n.swa, c.num_attention_groups_sliding_attention, c.head_dim_sliding_attention, c.sliding_window)],
    }
  },
  motif(cfg) {
    const c = lm(cfg)
    const L = c.num_hidden_layers
    let global = 0
    for (let i = 0; i < L; i++) if (i % c.sliding_window_period === 0) global++
    return { layers: L, heads: c.num_attention_heads, kv: [mla(global, c.kv_lora_rank, c.qk_rope_head_dim), { ...swa(L - global, 1, c.kv_lora_rank + c.qk_rope_head_dim, c.sliding_window, 0) }] }
  },
  inkling(cfg) {
    const c = lm(cfg)
    const L = c.num_hidden_layers
    const local = c.local_layer_ids.length
    return {
      layers: L, heads: c.num_attention_heads,
      kv: [full(L - local, c.num_key_value_heads, c.head_dim), swa(local, c.swa_num_key_value_heads, c.swa_head_dim, c.sliding_window_size), { kind: 'linear', mixer: 'block-conv', layers: L, state: 0, stateBytes: 2, conv: (c.sconv_kernel_size - 1) * c.hidden_size }],
    }
  },
  minimax(cfg) {
    const c = lm(cfg)
    const L = c.num_hidden_layers
    const softmax = c.attn_type_list ? count(c.attn_type_list, (x) => x === 1) : L
    const groups = [full(softmax, c.num_key_value_heads, c.head_dim)]
    if (softmax < L) groups.push({ kind: 'linear', mixer: 'lightning', layers: L - softmax, state: c.num_attention_heads * c.head_dim * c.head_dim, stateBytes: 4, conv: 0 })
    return { layers: L, heads: c.num_attention_heads, kv: groups }
  },
  deci(cfg) {
    const att = cfg.block_configs.filter((b) => !b.attention.no_op && !b.attention.replace_with_linear)
    const groups = cfg.block_configs.map((b) => b.attention.n_heads_in_group).filter(Boolean)
    const kv = cfg.num_attention_heads / groups[0]
    if (groups.some((g) => g !== groups[0])) throw new Error('DeciLM with mixed GQA groups')
    return { layers: cfg.num_hidden_layers, heads: cfg.num_attention_heads, kv: [full(att.length, kv, cfg.hidden_size / cfg.num_attention_heads), { kind: 'none', layers: cfg.num_hidden_layers - att.length }] }
  },
}

const FAMILY = {
  gpt_oss: 'gpt_oss', gemma3: 'gemma3', gemma3_text: 'gemma3', gemma3n: 'gemma3n', gemma4: 'gemma4', gemma4_unified: 'gemma4',
  qwen3_5: 'qwen3_5', qwen3_5_moe: 'qwen3_5', qwen3_5_moe_text: 'qwen3_5', qwen3_next: 'qwen3_5', qwen4_exp: 'qwen3_5',
  nemotron_h: 'nemotron_h', nemotron_h_omni: 'nemotron_h', jamba: 'jamba', lfm2: 'lfm2', lfm2_moe: 'lfm2', granitemoehybrid: 'granitemoehybrid',
  exaone4: 'exaone4', exaone4_5: 'exaone4', exaone_moe: 'exaone_moe', muse_glimmer: 'muse_glimmer',
  deepseek_v3: 'deepseek_v3', deepseek_v32: 'deepseek_v3', kimi_k2: 'deepseek_v3', axk2: 'deepseek_v3', glm_moe_dsa: 'glm_moe_dsa',
  deepseek_v4: 'deepseek_v4', kimi_k3: 'kimi_k3', glm5_next: 'glm5_next', bailing_hybrid: 'bailing_hybrid', solar_open2: 'solar_open2',
  mimo_v2: 'mimo_v2', step5_vl: 'step5', Motif: 'motif', inkling_mm_model: 'inkling', minimax_m1: 'minimax', minimax_m2: 'minimax', minimax_m3_vl: 'minimax',
  'nemotron-nas': 'deci',
}

function readerFor(cfg) {
  if (cfg.architectures?.[0] === 'LongcatCausalLM') return READERS.longcat
  const fam = FAMILY[cfg.model_type]
  return fam ? READERS[fam] : gqa
}

/** Native release precision from the safetensors dtype breakdown (HF API `safetensors.parameters`). */
function precisionOf(api) {
  const p = api?.safetensors?.parameters
  if (!p) return null
  let bytes = 0
  let n = 0
  let dominant = null
  for (const [dt, cnt] of Object.entries(p)) {
    if (DTYPE_BYTES[dt] == null) throw new Error(`unknown dtype ${dt}`)
    bytes += cnt * DTYPE_BYTES[dt]
    n += cnt
    if (!dominant || cnt > p[dominant]) dominant = dt
  }
  return { nativeWeightBytes: Math.round((bytes / n) * 100) / 100, precision: PRECISION_OF[dominant] ?? dominant, hfParamsB: Math.round(n / 1e7) / 100 }
}

const LICENSES = {
  'apache-2.0': 'Apache-2.0', mit: 'MIT', gemma: 'Gemma', llama3: 'Llama 3 Community', 'llama3.1': 'Llama 3.1 Community',
  'llama3.2': 'Llama 3.2 Community', 'llama3.3': 'Llama 3.3 Community',
}
/** `license: other` → the repo's `license_name`, spelled the way the licence itself is titled. */
const LICENSE_NAMES = {
  'lfm1.0': 'LFM Open License v1.0', 'nvidia-open-model-license': 'NVIDIA Open Model License',
  'nvidia-nemotron-open-model-license': 'NVIDIA Nemotron Open Model License', exaone: 'EXAONE AI Model License', 'openmdw-1.1': 'OpenMDW-1.1',
  'modified-mit': 'Modified MIT', 'upstage-solar-license': 'Upstage Solar License', 'minimax-community': 'MiniMax Community License', qwen: 'Qwen License',
}
function licenseOf(api) {
  const cd = api?.cardData ?? {}
  if (!cd.license) return null
  if (cd.license !== 'other') return LICENSES[cd.license] ?? cd.license
  return cd.license_name && cd.license_name !== 'other' ? (LICENSE_NAMES[cd.license_name] ?? cd.license_name) : null
}

/** Everything config.json + the HF API can tell us about a checkpoint. */
function extract(repo) {
  const d = dirOf(repo)
  const cfg = readJson(join(d, 'config.json'))
  const api = readJson(join(d, 'api.json'))
  if (!cfg) throw new Error(`${repo}: no cached config.json — run fetch (gated repos need HF_TOKEN or a \`config\` mirror)`)
  const shape = readerFor(cfg)(cfg)
  const c = lm(cfg)
  const experts = c.num_experts ?? c.n_routed_experts ?? c.num_local_experts ?? c.moe_num_experts ?? 0
  const mpe = c.max_position_embeddings
  return {
    layers: shape.layers,
    heads: shape.heads,
    kv: shape.kv.filter((g) => g.layers > 0),
    isMoE: experts > 1,
    ...(precisionOf(api) ?? {}),
    ...(mpe ? { contextK: Math.round(mpe / 1000) } : {}),
    ...(licenseOf(api) ? { license: licenseOf(api) } : {}),
  }
}

const DERIVED_KEYS = ['layers', 'heads', 'kv', 'isMoE', 'nativeWeightBytes', 'precision', 'hfParamsB', 'contextK', 'license']

function extractInto(repos) {
  const arch = loadArch()
  const list = repos.length ? repos : Object.keys(arch.models)
  for (const repo of list) {
    const e = arch.models[repo] ?? (arch.models[repo] = { aa: {} })
    if (!existsSync(join(dirOf(repo), 'config.json'))) {
      // a gated config with no mirror: the committed (manual, card-sourced) facts stand
      if (repos.length) throw new Error(`${repo}: no cached config.json — run fetch (gated repos need HF_TOKEN or a \`config\` mirror)`)
      console.warn(`  ~ ${repo}: no cached config — keeping the committed facts`)
      continue
    }
    const x = extract(repo)
    const manual = new Set(e.manual ?? [])
    for (const k of DERIVED_KEYS) if (!manual.has(k) && x[k] !== undefined) e[k] = x[k]
    console.log(`${repo.padEnd(56)} ${summary(derive(e))}`)
  }
  saveArch(arch)
}

function verify() {
  const arch = loadArch()
  let drift = 0
  let skipped = 0
  for (const [repo, e] of Object.entries(arch.models)) {
    if (!existsSync(join(dirOf(repo), 'config.json'))) { skipped++; continue }
    const x = extract(repo)
    const manual = new Set(e.manual ?? [])
    for (const k of DERIVED_KEYS) {
      if (manual.has(k) || x[k] === undefined) continue
      if (JSON.stringify(x[k]) !== JSON.stringify(e[k])) { drift++; console.log(`  ! ${repo} ${k}: committed ${JSON.stringify(e[k])} ≠ config ${JSON.stringify(x[k])}`) }
    }
  }
  console.log(`verify: ${Object.keys(arch.models).length - skipped} checked, ${skipped} without a cached config (run fetch), ${drift} drifted fields`)
}

/* ------------------------------------------------------------------ *
 *  Derived serving fields (what the sim reads).                        *
 * ------------------------------------------------------------------ */

/** Per-token elements a group adds to the growing KV cache. */
function perToken(g) {
  switch (g.kind) {
    case 'full': return g.layers * g.kvHeads * (g.headDim + (g.vHeadDim ?? g.headDim))
    case 'mla': return g.layers * (g.latent + g.rope)
    case 'compressed':
    case 'indexer': return (g.layers * g.dim) / (g.ratio ?? 1)
    case 'measured': return g.elems
    default: return 0
  }
}

/** Constant bytes a group pins per request (sliding windows + recurrent state). */
function perRequestBytes(g) {
  if (g.kind === 'swa') return g.layers * g.kvHeads * (g.headDim + (g.vHeadDim ?? g.headDim)) * g.window * 2
  if (g.kind === 'linear') return g.layers * (g.state * g.stateBytes + g.conv * 2)
  return 0
}

function attnOf(e) {
  const kinds = new Set(e.kv.map((g) => g.kind))
  if (kinds.has('compressed') || e.kv.some((g) => g.scheme === 'csa')) return 'csa'
  // a block-local conv (Inkling) rides inside every attention block; it is not a separate mixer.
  if (e.kv.some((g) => g.kind === 'linear' && g.mixer !== 'block-conv')) return 'hybrid-linear'
  if (kinds.has('swa') || kinds.has('linear')) return 'hybrid-swa'
  if (kinds.has('mla')) return 'MLA'
  const f = e.kv.find((g) => g.kind === 'full')
  if (f.kvHeads === 1) return 'MQA'
  return f.kvHeads === e.heads ? 'MHA' : 'GQA'
}

/** The roster-facing derived record of one checkpoint. */
function derive(e) {
  const growing = e.kv.filter((g) => ['full', 'mla', 'compressed', 'measured'].includes(g.kind))
  const primary = e.kv.find((g) => g.kind === 'full') ?? e.kv.find((g) => g.kind === 'mla') ?? e.kv.find((g) => g.kind === 'compressed') ?? e.kv.find((g) => g.kind === 'measured')
  const display =
    primary.kind === 'full' ? { kvHeads: primary.kvHeads, headDim: primary.headDim }
      : primary.kind === 'mla' ? { kvHeads: 1, headDim: primary.latent + primary.rope }
        : { kvHeads: 1, headDim: primary.dim }
  return {
    paramsTotalB: e.paramsTotalB,
    paramsActiveB: e.paramsActiveB,
    isMoE: e.isMoE,
    layers: e.layers,
    kvLayers: growing.reduce((s, g) => s + g.layers, 0),
    ...display,
    attn: attnOf(e),
    kvBytesPerToken: Math.round(e.kv.reduce((s, g) => s + perToken(g), 0) * 2),
    kvStateMbPerReq: Math.round(e.kv.reduce((s, g) => s + perRequestBytes(g), 0) / 1e5) / 10,
    nativeWeightBytes: e.nativeWeightBytes,
    precision: e.precision,
    contextWindowK: e.contextK,
    license: e.license,
    confidence: e.confidence ?? 'high',
  }
}

const tsStr = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

const summary = (d) =>
  `${String(d.paramsTotalB).padStart(6)}B/${String(d.paramsActiveB).padEnd(5)} ${d.attn.padEnd(13)} KV ${(d.kvBytesPerToken / 1024).toFixed(1).padStart(6)} KB/tok + ${String(d.kvStateMbPerReq).padStart(6)} MB/req · ${d.precision} ${d.nativeWeightBytes} B/param · ${d.contextWindowK}K`

function build() {
  const arch = loadArch()
  const thinking = JSON.parse(readFileSync(THINKING, 'utf8')).models
  const lines = []
  for (const [repo, e] of Object.entries(arch.models)) {
    for (const k of ['paramsTotalB', 'paramsActiveB', 'layers', 'kv', 'nativeWeightBytes', 'contextK', 'license']) if (e[k] == null) throw new Error(`${repo}: missing ${k}`)
    const mode = thinking[repo]?.mode
    if (!['always', 'hybrid', 'never'].includes(mode)) throw new Error(`${repo}: no thinking mode in data/model-thinking.json`)
    const { confidence, ...rest } = derive(e)
    const toggle = mode === 'never' ? null : thinking[repo].toggle
    const d = { ...rest, thinking: mode, ...(toggle ? { thinkingToggle: toggle } : {}), confidence }
    lines.push(`  '${repo}': { ${Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'string' ? tsStr(v) : v}`).join(', ')} },`)
    console.log(`${repo.padEnd(56)} ${summary(d)}`)
  }
  const out =
    `// AUTO-GENERATED by \`node scripts/arch-sync.mjs build\` — do NOT edit by hand.\n` +
    `// Source: data/model-arch.json (Hugging Face config.json + safetensors metadata per checkpoint) and\n` +
    `// data/model-thinking.json (the chat template's thinking support: always / hybrid / never).\n` +
    `// The derived serving facts per open-weight checkpoint, keyed by its Hugging Face repo; content.ts\n` +
    `// joins every roster entry to its checkpoint here. KV bytes are BF16 (the KV-quant research scales them).\n` +
    `import type { ModelArch } from './content'\n\n` +
    `export const MODEL_ARCH: Record<string, ModelArch> = {\n${lines.join('\n')}\n}\n`
  writeFileSync(GENERATED, out)
  console.log(`✓ wrote ${GENERATED} — ${lines.length} checkpoints`)
}

export { loadArch, derive }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, ...args] = process.argv.slice(2)
  try {
    if (cmd === 'fetch') await fetchAll(args)
    else if (cmd === 'extract') extractInto(args)
    else if (cmd === 'verify') verify()
    else if (cmd === 'build') build()
    else { console.error('usage: node scripts/arch-sync.mjs <fetch|extract|verify|build> [repo…]'); process.exit(1) }
  } catch (e) {
    console.error('✗', e.message)
    process.exit(1)
  }
}
