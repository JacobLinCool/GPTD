# GPTD Model Catalog — real open-weight LLMs

> New here? GPTD is a tower-defense game simulating an LLM-inference data center — start with the README; this file is the model-roster reference.

The fact-checked source-of-truth list behind the in-game roster. Every model is a REAL
open-weight release; the in-game `ROSTER` (`src/sim/content.ts`) draws its picks from here
and `qualityBy` is calibrated from these benchmarks (`calibrate.ts`) — never hand-written.

<!-- Contributor reference (not player-facing):

Benchmark columns: GPQA-D · IFBench · LCR · SciCode · Terminal-Bench Hard · HLE — the six
benchmarks `qualityBy` is calibrated from. Each capability axis is a WEIGHTED BLEND of these
(primary 0.6 + two secondary 0.2; see `src/sim/calibrate.ts` BLEND and `docs/MATH.md`):
chat = IFBench-led, general = GPQA-led, coding = SciCode-led, reasoning = HLE-led, agentic =
Terminal-Bench-Hard-led. Every roster value is on ONE frozen reference scale — the 2026-06-21
Artificial Analysis snapshot the calibration curves were fitted on (`data/aa-reference-2026-06-21.json`):
a cell measured there is carried forward by AA model UUID; a newer model's re-scored LCR / HLE /
SciCode is equated back to that scale; an eval AA no longer publishes (IFBench, TB-Hard, and for
some models GPQA / SciCode) is BRIDGED from the measured cells and shown as `≈74.8 (bridged)`.
The resolution, fits and uncertainties live in `scripts/aa-cells.mjs` and `data/aa-bridges.json`;
refresh with `node scripts/aa-sync.mjs snapshot && node scripts/aa-sync.mjs bridges && node
scripts/aa-sync.mjs build && node scripts/aa-sync.mjs catalog` (the UUID pins and catalog name
aliases live in `data/roster-aa-map.json`). Non-roster catalog models are best-effort exact-name
matches against the latest snapshot (raw, not equated; some show `—`).

The `Serving —` line of every roster model is generated from its Hugging Face config.json
(`data/model-arch.json`, `node scripts/arch-sync.mjs build`): the attention design, the KV cache
per token over the KV-bearing layers (+ the constant per-request window / recurrent state), the
release precision, and the thinking support read off the released chat template
(`data/model-thinking.json`, verified by `node scripts/thinking-sync.mjs verify`): a HYBRID's off
switch and its thinking-off capability (calibrated from Artificial Analysis' Non-reasoning row of the
same checkpoint, or the per-cell thinking→instant pair fit in `data/aa-bridges.json`), an
always-thinker's hidden budget. ★ marks the active in-game roster (the
frontier-tolerance gate, see PARETO.md); `node scripts/roster-report.mjs catalog` refreshes ★, the
serving lines and the generated block at the end.

How to maintain: when a notable open model ships, add it here first (developer · release ·
license · params · context · official link · lineage · the Artificial Analysis Intelligence Index ·
a 2–4 sentence description · a confidence flag), THEN give it an architecture record
(`data/model-arch.json`) and its thinking-support evidence (`data/model-thinking.json`) so it
joins the candidate pool (AGENTS.md §3 has the full pipeline). Put `—` for any benchmark you cannot
verify; mark `confidence: low` rather than guessing. Re-run the `gptd-model-catalog` +
`gptd-newest-models` research workflows to refresh from Artificial Analysis + Hugging Face model
cards.

Inventory:
- 218 models catalogued (153 hand-written + 65 generated pool entries) · 58 in the active roster (★).
- Confidence: 177 high · 37 med · 4 low.
- Includes the late-2026 open frontier (Kimi K3, GLM-5.3, DeepSeek-V4.1-Flash and the V4 0731/0813 re-releases, Qwen3.8, MiMo-V2.6, Step 5, Muse Spark Open, the Ling-3 hybrids, K2-Horizon) and Mistral Large 4, pending its open weights (2026-10-27).
-->


## Edge (≤4B total) — 21 models

### SmolLM2-135M-Instruct
**HuggingFace** · 2024-11 · Apache 2.0 · 0.135B dense · 8K ctx · spec: chat · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Smallest fully-open SmolLM2 model from HuggingFace, a 135M dense decoder trained from scratch on ~2T curated tokens for ultra-lightweight on-device rewriting and summarization. Too small to register on hard reasoning benchmarks; valued as a transparent edge baseline.

### SmolLM2-360M-Instruct
**HuggingFace** · 2024-11 · Apache 2.0 · 0.36B dense · 8K ctx · spec: chat · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

A 360M fully-open HuggingFace model trained from scratch on ~4T tokens, offering noticeably better instruction following than the 135M while still running on CPUs and phones. Non-reasoning chat model with documented data and training code.

### Qwen3-0.6B ★
**Alibaba/Qwen** · 2025-04 · Apache 2.0 · 0.6B dense · reasoning · 32K ctx · spec: general · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/Qwen/Qwen3-0.6B)
Benchmarks — GPQA-D 23.9 · IFBench 23.3 · LCR 0 · SciCode 2.8 · TB-Hard 0 · HLE 5.7  
Serving — GQA · KV 112.0 KB/token on 28 of 28 layers · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 25 / 21 / 12 / 27 / 8 (from AA Qwen3 0.6B (Non-reasoning)); thinks ~1500 hidden tokens elsewhere  

Smallest dense model in Alibaba's Qwen3 family, notable for still carrying the hybrid thinking/non-thinking switch at 0.6B. Targets extreme edge deployment, draft/speculative decoding and browser inference; 32K context. Per-model post-training benchmarks were not cleanly published.

### Gemma 3 1B
**Google** · 2025-03 · Gemma · 1B dense · 32K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/google/gemma-3-1b-it)
Benchmarks — GPQA-D 23.7 · IFBench 19.9 · LCR 0 · SciCode — · TB-Hard 0 · HLE 5.3  

Smallest, text-only member of Google's Gemma 3 family, a 1B dense decoder trained from scratch with a Gemini-derived recipe and 32K context. Tuned for efficient on-device chat with improved math over Llama-3.2-1B. Non-reasoning edge model.

### Llama 3.2 1B Instruct
**Meta** · 2024-09 · Llama 3.2 Community License · 1.23B dense · 128K ctx · spec: chat · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/meta-llama/Llama-3.2-1B-Instruct)
Benchmarks — GPQA-D 19.6 · IFBench 22.8 · LCR 5 · SciCode 1.7 · TB-Hard 0 · HLE 5.3  
Serving — GQA · KV 32.0 KB/token on 16 of 16 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Meta's smallest text-only Llama 3.2 model, a 1.23B dense decoder produced via pruning and distillation from Llama 3.1 with a 128K context. Targets on-device summarization, rewriting and tool use; non-reasoning with modest benchmarks (MMLU 49.3, GPQA 27.2).

### Qwen3-1.7B
**Alibaba/Qwen** · 2025-04 · Apache 2.0 · 1.7B dense · reasoning · 32K ctx · spec: reasoning · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/Qwen/Qwen3-1.7B)
Benchmarks — GPQA-D 35.6 · IFBench 26.9 · LCR 0 · SciCode 4.3 · TB-Hard 0 · HLE 4.8  
Serving — GQA · KV 112.0 KB/token on 28 of 28 layers · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 26 / 28 / 17 / 33 / 8 (from AA Qwen3 1.7B (Non-reasoning)); thinks ~1500 hidden tokens elsewhere  

A 1.7B dense Qwen3 model (GQA, 28 layers) with the hybrid reasoning switch, roughly matching the older Qwen2.5-3B base. In thinking mode it is benchmarked against DeepSeek-R1-Distill-Qwen-1.5B; 32K context, tool-calling, 100+ languages. Per-size scores not published.

### SmolLM2-1.7B-Instruct
**HuggingFace** · 2024-11 · Apache 2.0 · 1.7B dense · 8K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Flagship of HuggingFace's SmolLM2 family, a 1.7B dense decoder trained from scratch on ~11T tokens with SFT+DPO. Beat Qwen2.5-1.5B and Llama-3.2-1B on several tasks at its era; non-reasoning chat with a short 8K context. Fully open with reproducible data.

### Granite 3.3 2B Instruct
**IBM** · 2025-04 · Apache 2.0 · 2B dense · reasoning · 128K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/ibm-granite/granite-3.3-2b-instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

IBM's 2B dense enterprise model with optional structured reasoning via think/response tags and a 128K context. Tuned for reliable instruction following, RAG, coding and tool use rather than competition math (MMLU 55.9, HumanEval 80.5). Apache 2.0 with enterprise governance.

### MiniCPM5-2B ★
**OpenBMB** · 2026-09 · Apache 2.0 · 2.52B dense · reasoning · 131K ctx · spec: reasoning · lineage: from-scratch (MiniCPM5-2B-Base) · confidence: high · AAII 12.5
[model card](https://huggingface.co/openbmb/MiniCPM5-2B)
Benchmarks — GPQA-D 70.2 · IFBench ≈51.2 (bridged) · LCR 53.1 · SciCode 25.3 · TB-Hard ≈8.9 (bridged) · HLE 8.6  
Serving — GQA · KV 42.0 KB/token on 42 of 42 layers · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 80 / 82 / 59 / 87 / 42 (from the thinking→instant pair fit); thinks ~1500 hidden tokens elsewhere  

OpenBMB's 2.5B dense hybrid-thinking model (thinking is switched by `enable_thinking`), released September 2026. Only 2 KV heads over 42 layers keep its cache to ~42 KB per token, and it leads the ≤2.5B class on GPQA (70) and long-context reasoning (AA's re-scored LCR 59, 53 on the reference scale above) — the strongest model that fits the smallest edge rack. Artificial Analysis publishes no IFBench or Terminal-Bench Hard for it, so those cells are bridged.

### Gemma 2 2B
**Google** · 2024-07 · Gemma · 2.6B dense · 8K ctx · spec: general · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/google/gemma-2-2b-it)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Smallest Gemma 2 model, a 2.6B dense decoder trained from scratch via distillation from a larger teacher, using interleaved local/global attention and logit soft-capping with 8K context. Punches above its weight for on-device chat. Non-reasoning.

### Granite 4.0 Micro
**IBM** · 2025-10 · Apache 2.0 · 3B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/ibm-granite/granite-4.0-micro)
Benchmarks — GPQA-D 33.6 · IFBench 24.8 · LCR 4 · SciCode 11.9 · TB-Hard 1.5 · HLE 5.1  
Serving — GQA · KV 80.0 KB/token on 40 of 40 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Smallest dense model in IBM's Granite 4.0 family, a ~3B all-transformer model for edge and high-throughput enterprise deployment with 128K context. The non-hybrid counterpart to Micro-H, positioned for fast, low-memory agentic and tool-calling tasks. Apache 2.0.

### SmolLM3-3B
**HuggingFace** · 2025-07 · Apache 2.0 · 3B dense · reasoning · 128K ctx · spec: reasoning · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/HuggingFaceTB/SmolLM3-3B)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

HuggingFace's 3B dense decoder (GQA + NoPE) trained from scratch on 11.2T tokens, the most genuinely open model at 3B with full data and pipeline. Dual-mode reasoner (/think, /no_think), multilingual, 64K context extensible to 128K. With thinking: GPQA 41.7, AIME-2025 36.7, LiveCodeBench 30.

### Llama 3.2 3B Instruct
**Meta** · 2024-09 · Llama 3.2 Community License · 3.21B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Meta's 3.21B text-only Llama 3.2 model, distilled and pruned from Llama 3.1, with a 128K context and strong on-device instruction following (MMLU 63.4, GPQA 32.8). Widely used small baseline for summarization and rewriting; non-reasoning.

### Phi-3.5-mini-instruct
**Microsoft** · 2024-08 · MIT · 3.8B dense · 128K ctx · spec: general · lineage: derived from Phi-3-mini · confidence: high
[model card](https://huggingface.co/microsoft/Phi-3.5-mini-instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Microsoft's refresh of Phi-3-mini, a 3.8B dense decoder with 128K context and enhanced multilingual and long-context training. Improves multilingual understanding and reasoning over its predecessor while keeping the compact size. Non-reasoning general instruct model.

### Phi-3-mini-128k-instruct
**Microsoft** · 2024-06 · MIT · 3.8B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/microsoft/Phi-3-mini-128k-instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Microsoft's smallest Phi-3 model, a 3.8B dense decoder trained from scratch on ~4.9T tokens of filtered web and synthetic textbook-quality data, with 4K and 128K context variants. Delivered MMLU/reasoning scores rivaling larger models via the Phi data-quality philosophy.

### Phi-4-mini-instruct
**Microsoft** · 2025-02 · MIT · 3.8B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/microsoft/Phi-4-mini-instruct)
Benchmarks — GPQA-D 33.1 · IFBench 21.1 · LCR 13.7 · SciCode 10.8 · TB-Hard 0 · HLE 4.2  
Serving — GQA · KV 128.0 KB/token on 32 of 32 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Microsoft's 3.8B dense model trained from scratch on heavily curated and synthetic data, the successor to Phi-3.5-mini, with 128K context, GQA and shared embeddings. Matches some 8B models on reasoning and math (MMLU 73, MMLU-Pro 52.8, GPQA 33.1). Non-reasoning, MIT-licensed.

### Phi-4-mini-reasoning
**Microsoft** · 2025-04 · MIT · 3.8B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Phi-4-mini-instruct · confidence: high
[model card](https://huggingface.co/microsoft/Phi-4-mini-reasoning)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Microsoft's math-focused 3.8B reasoning model, fine-tuned from Phi-4-mini on ~150B tokens of synthetic chain-of-thought distilled from DeepSeek-R1. Scores exceptionally for its size (AIME-2024 57.5, MATH-500 94.6, GPQA 52). Always reasons step-by-step; 128K context, MIT.

### NVIDIA Nemotron 3 Nano 4B ★
**NVIDIA** · 2026-03 · NVIDIA Nemotron Open Model License · 3.97B dense · reasoning · 262K ctx · spec: reasoning · lineage: derived from NVIDIA-Nemotron-Nano-9B-v2 (compressed via Nemotron Elastic framework) · confidence: med
[model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16)
Benchmarks — GPQA-D 51.3 · IFBench 58.2 · LCR 16.7 · SciCode 16.4 · TB-Hard 6.8 · HLE 4.8  
Serving — hybrid-linear · KV 16.0 KB/token on 4 of 42 layers + 43 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 73 / 63 / 48 / 67 / 28 (from the thinking→instant pair fit); thinks ~1500 hidden tokens elsewhere  

Nemotron 3 Nano 4B is the edge-class member of the family, a ~3.97B-parameter dense Mamba2-Transformer hybrid (primarily Mamba-2 and MLP layers with just four Attention layers, so not MoE) released March 2026 under the NVIDIA Nemotron Open Model License. Unlike the from-scratch Ultra/Super/30B tiers, this 4B is derived: it is compressed from NVIDIA-Nemotron-Nano-9B-v2 using NVIDIA's Nemotron Elastic framework. It is a unified reasoning/non-reasoning model with controllable reasoning via system prompts and a 262K-token context window. Reported model-card scores include AIME25 78.5 and GPQA 53.2; MMLU-Pro, LiveCodeBench, and SWE-bench Verified are not published on the card, so they carry no published score.

### Qwen3-4B
**Alibaba/Qwen** · 2025-04 · Apache 2.0 · 4B dense · reasoning · 32K ctx · spec: reasoning · lineage: from-scratch · confidence: low
[model card](https://huggingface.co/Qwen/Qwen3-4B)
Benchmarks — GPQA-D 52.2 · IFBench 32.5 · LCR 0 · SciCode — · TB-Hard — · HLE 4.4  

Compact dense model from the original Qwen3 launch with hybrid thinking/non-thinking inference; the 4B base rivaled the larger Qwen2.5-7B base on over half of benchmarks. Native 32K context. Superseded by the 256K-context Qwen3-4B-2507 refreshes.

### Qwen3-4B-Instruct-2507
**Alibaba/Qwen** · 2025-07 · Apache 2.0 · 4B dense · 262K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507)
Benchmarks — GPQA-D 51.7 · IFBench 33.5 · LCR 7.3 · SciCode 18.1 · TB-Hard 4.5 · HLE 4.7  
Serving — GQA · KV 144.0 KB/token on 36 of 36 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Updated non-thinking 4B dense Qwen3 with a native 256K context. Posts remarkably strong non-reasoning scores for its size (MMLU-Pro 69.6, GPQA 62, AIME-2025 47.4, LiveCodeBench 35.1), rivaling larger prior-gen models. The canonical general-purpose edge model with tool-calling.

### Qwen3-4B-Thinking-2507
**Alibaba/Qwen** · 2025-07 · Apache 2.0 · 4B dense · reasoning · 262K ctx · spec: reasoning · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3-4B-Thinking-2507)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Dedicated-reasoning 4B Qwen3 refresh with extended chain-of-thought and a native 256K context, one of the strongest small reasoners available (MMLU-Pro 74, GPQA 65.8, AIME-2025 81.3, LiveCodeBench 55.2). Targets math/code/agentic use on edge-class hardware.


## Small (4–15B) — 33 models

### Gemma 3 4B
**Google** · 2025-03 · Gemma · 4.3B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/google/gemma-3-4b-it)
Benchmarks — GPQA-D 29.1 · IFBench 28.3 · LCR 6.7 · SciCode — · TB-Hard 0.8 · HLE 5.3  

Google's 4B multimodal (image+text) Gemma 3 model pairing a SigLIP encoder with a 128K-context decoder, competitive with the older Gemma 2 27B. Supports 140+ languages and function calling. Non-reasoning, targeting efficient multimodal edge assistants.

### Gemma 3n E2B
**Google** · 2025-06 · Gemma · 5B dense · 32K ctx · spec: general · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/google/gemma-3n-E2B-it)
Benchmarks — GPQA-D 22.9 · IFBench 22 · LCR 0 · SciCode — · TB-Hard 0.8 · HLE 4.2  

Smaller of Google's mobile-first multimodal Gemma 3n models, built on the MatFormer architecture with Per-Layer Embeddings to cut memory; ~5B raw params with a ~2B effective footprint via selective activation. Accepts text, image, audio and video. Targets real-time on-device multimodal AI.

### K2-Horizon-3.7B ★
**Institute of Foundation Models (MBZUAI)** · 2026-09 · Apache 2.0 · 5.06B dense · reasoning · 524K ctx · spec: reasoning · lineage: from-scratch · confidence: high · AAII 15.6
[model card](https://huggingface.co/IFM/K2-Horizon-3.7B)
Benchmarks — GPQA-D 69.2 · IFBench ≈53.5 (bridged) · LCR 55.8 · SciCode 20.9 · TB-Hard ≈18.3 (bridged) · HLE 13.2  
Serving — GQA · KV 144.0 KB/token on 36 of 36 layers · BF16 weights (2 B/param) · always thinks (reasoning_effort (high / medium / low)): ~1500 hidden tokens per answer  

The small end of IFM's fully open K2-Horizon fleet (weights, data, code and recipes all public), released September 2026. "3.7B" is the transformer core; the untied 250K-vocabulary embedding brings it to 5.06B. Plain full-attention GQA (144 KB of KV per token) on a 512K window, so long prompts fill an edge rack's cache fast.

### Phi-3-small-128k-instruct
**Microsoft** · 2024-05 · MIT · 7B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/microsoft/Phi-3-small-128k-instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

The 7B member of Microsoft's Phi-3 family, a dense decoder using alternating dense and blocksparse attention, trained from scratch on ~4.8T tokens with a 100K vocab and 128K context option. Scored ~75.5 MMLU. Non-reasoning general instruct model.

### Llama 2 7B Chat
**Meta** · 2023-07 · Llama 2 Community License · 7B dense · 4K ctx · spec: chat · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/meta-llama/Llama-2-7b-chat-hf)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Meta's smallest Llama 2 chat model, pretrained on ~2T tokens with a 4K context and RLHF. A landmark permissively-licensed open model in 2023 that seeded a huge fine-tune ecosystem, but weak by modern standards (MMLU ~45-48). Historically important rather than competitive.

### OLMo 2 7B Instruct
**Allen AI** · 2024-11 · Apache 2.0 · 7B dense · 4K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/allenai/OLMo-2-1124-7B-Instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Fully-open dense model from Allen AI, pretrained from scratch and post-trained with the Tulu 3 recipe (SFT, DPO, RLVR), 4K context. Notable for releasing weights, data, code, recipes and thousands of checkpoints (MMLU ~63). A reference for open science. Non-reasoning.

### Granite 4.0 H Tiny
**IBM** · 2025-10 · Apache 2.0 · 7B total / 1B active (MoE) · 128K ctx · spec: agentic · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/ibm-granite/granite-4.0-h-tiny)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Small hybrid MoE in IBM's Granite 4.0 family, ~7B total / ~1B active across fine-grained experts plus shared experts, using a 9:1 Mamba-2-to-transformer hybrid with no positional encodings. Very low memory and fast long-context inference for edge agentic and tool-calling workloads. Apache 2.0.

### DeepSeek-R1-Distill-Qwen-7B
**DeepSeek** · 2025-01 · MIT (weights) / Apache 2.0 base · 7B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Qwen2.5-Math-7B · confidence: high
[model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Dense 7B reasoning model distilled from DeepSeek-R1 onto Qwen2.5-Math-7B, delivering strong math and coding reasoning far above its base (AIME-2024 55.5, GPQA 49.1). Inherits R1's long chain-of-thought style; 128K context.

### Mistral-7B-Instruct-v0.3
**Mistral AI** · 2024-05 · Apache 2.0 · 7.2B dense · 32K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Final instruct refresh of the 7B dense transformer that launched Mistral AI, adding a 32K vocab, v3 tokenizer and function calling. Popularized sliding-window/grouped-query attention and became a widely fine-tuned open base; 32K context. Non-reasoning.

### Qwen2.5-7B-Instruct
**Alibaba/Qwen** · 2024-09 · Apache 2.0 · 7.6B dense · 131K ctx · spec: general · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

The popular small-but-capable dense model of the Qwen2.5 generation, 7.6B params with a 131K context, widely adopted as a fine-tune base and for edge deployment. Non-reasoning general instruct model with strong multilingual and instruction-following ability.

### Ling-3.0-tiny ★
**InclusionAI (Ant Group)** · 2026-08 · MIT · 7.9B total / 1.3B active (MoE) · reasoning · 131K ctx · spec: reasoning · lineage: from-scratch · confidence: high · AAII 11.1
[model card](https://huggingface.co/inclusionAI/Ling-3.0-tiny)
Benchmarks — GPQA-D 73.4 · IFBench ≈52.4 (bridged) · LCR 54 · SciCode 23.1 · TB-Hard ≈17 (bridged) · HLE 9  
Serving — hybrid-linear · KV 6.8 KB/token on 6 of 24 layers + 20 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False (thinking_option "off")): instant on interactive traffic, judged 81 / 83 / 60 / 88 / 51 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

A 7.9B MoE with 1.3B active and Kimi Delta Attention on 3 of every 4 layers (18 KDA + 6 MLA): about 7 KB of KV per token plus a small constant recurrent state. The fastest decode of any capable model on an edge rack; validated on DGX Spark and Apple Silicon.

### Ministral-8B-Instruct-2410
**Mistral AI** · 2024-10 · Mistral Research License · 8B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/mistralai/Ministral-8B-Instruct-2410)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Edge/on-device dense model from 'Les Ministraux' with interleaved sliding-window attention and a 128K context, strong reasoning, function calling and multilingual ability for its size (MMLU 65, HumanEval 76.8). Mistral Research License.

### Llama 3 8B Instruct
**Meta** · 2024-04 · Llama 3 Community License · 8B dense · 8K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Meta's third-generation small dense model, pretrained on 15T+ tokens with an 8K context and a 128K-token tokenizer. Dramatically improved on Llama 2 7B/13B (MMLU ~68, GPQA ~34). One of the most widely deployed open small models of 2024.

### DeepSeek-R1-Distill-Llama-8B
**DeepSeek** · 2025-01 · MIT (weights) / Llama 3.1 Community (base) · 8B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Llama-3.1-8B · confidence: high
[model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Llama-8B)
Benchmarks — GPQA-D 30.2 · IFBench 17.6 · LCR 0 · SciCode — · TB-Hard — · HLE —  

Dense 8B reasoning model distilling DeepSeek-R1's long chain-of-thought onto Meta's Llama-3.1-8B base (AIME-2024 50.4, GPQA 49). Brings R1-style reasoning to the popular Llama 8B footprint; 128K context.

### Llama 3.1 8B Instruct
**Meta** · 2024-07 · Llama 3.1 Community License · 8B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct)
Benchmarks — GPQA-D 25.9 · IFBench 28.6 · LCR 15.7 · SciCode 13.2 · TB-Hard 0.8 · HLE 5.1  
Serving — GQA · KV 128.0 KB/token on 32 of 32 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Refreshed small dense model in Meta's 3.1 generation, extending context to 128K with improved multilingual and tool-use ability (MMLU-Pro 48.3, GPQA 30.4). A strong efficient general-purpose model for its size and one of the most-downloaded open small models.

### Gemma 3n E4B
**Google** · 2025-06 · Gemma · 8B dense · 32K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/google/gemma-3n-E4B-it)
Benchmarks — GPQA-D 29.6 · IFBench 27.9 · LCR 0 · SciCode — · TB-Hard 2.3 · HLE 4.5  

Larger mobile-first multimodal Gemma 3n model using the MatFormer ('Matryoshka') architecture so a smaller E2B nests within it; ~8B raw params with a ~4B activation footprint, accepting text, image, audio and video. First sub-10B model to surpass 1300 on LMArena.

### Granite 3.3 8B Instruct
**IBM** · 2025-04 · Apache 2.0 · 8.17B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/ibm-granite/granite-3.3-8b-instruct)
Benchmarks — GPQA-D 33.8 · IFBench 22.4 · LCR — · SciCode — · TB-Hard 0 · HLE 4.2  

IBM's enterprise-focused 8B dense Granite model with a 128K context and optional fill-in-the-middle and thinking modes. Targets RAG, summarization, classification and tool/function calling with strong instruction following. Emphasizes governance and Apache 2.0 over leaderboards.

### Qwen3-8B
**Alibaba/Qwen** · 2025-04 · Apache 2.0 · 8.2B dense · reasoning · 131K ctx · spec: reasoning · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/Qwen/Qwen3-8B)
Benchmarks — GPQA-D 45.2 · IFBench 28.6 · LCR 0 · SciCode 16.8 · TB-Hard 2.3 · HLE 2.8  
Serving — GQA · KV 144.0 KB/token on 36 of 36 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Popular small dense Qwen3 model with the hybrid thinking/non-thinking switch, a common choice for on-device and cost-sensitive deployment that can outperform the older Qwen2.5-14B base on many tasks. Native 32K context extendable to 128K.

### NVIDIA-Nemotron-Nano-9B-v2
**NVIDIA** · 2025-08 · NVIDIA Open Model License · 9B dense · reasoning · 128K ctx · spec: reasoning · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-Nano-9B-v2)
Benchmarks — GPQA-D 57 · IFBench 27.6 · LCR 21 · SciCode 22 · TB-Hard 1.5 · HLE 4.6  
Serving — hybrid-linear · KV 16.0 KB/token on 4 of 56 layers + 73 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False (or /no_think)): instant on interactive traffic, judged 69 / 75 / 48 / 83 / 20 (from AA NVIDIA Nemotron Nano 9B V2 (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

From-scratch hybrid Mamba-2/Transformer reasoning model (mostly Mamba-2 + MLP, four attention layers), Minitron-distilled from a 12B base pretrained on 20T tokens. Up to 6x higher throughput than similar Transformers, 128K context on a single A10G. Reasoning ON: GPQA 64, AIME-2025 72.1, LiveCodeBench 71.1.

### GLM-4-9B-Chat
**Zhipu AI** · 2024-06 · GLM-4 Model License · 9B dense · 128K ctx · spec: chat · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/THUDM/glm-4-9b-chat)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Open 9B chat model from the GLM-4 generation by Zhipu AI, supporting 128K context, 26 languages and agent features (web browsing, code execution, function calling). Outperformed Llama-3-8B across math, reasoning and code at release. Dense, non-reasoning.

### K2-Horizon-7B ★
**Institute of Foundation Models (MBZUAI)** · 2026-09 · Apache 2.0 · 9B dense · reasoning · 524K ctx · spec: reasoning · lineage: from-scratch · confidence: high · AAII 20.6
[model card](https://huggingface.co/IFM/K2-Horizon-7B)
Benchmarks — GPQA-D 75.3 · IFBench ≈58.4 (bridged) · LCR 62.5 · SciCode 26.5 · TB-Hard ≈27.7 (bridged) · HLE 17.2  
Serving — GQA · KV 144.0 KB/token on 36 of 36 layers · BF16 weights (2 B/param) · always thinks (reasoning_effort (high / medium / low)): ~1500 hidden tokens per answer  

The 7B core (9B with its large vocabulary) of IFM's fully open fleet, and the strongest model of its size on the autumn 2026 snapshot: AAII 20.6 against Qwen3.5-9B's 11.2, Terminal-Bench 2.1 44%. Reasoning effort is set per request; plain GQA on a 512K window.

### Gemma 2 9B
**Google** · 2024-06 · Gemma · 9.2B dense · 8K ctx · spec: general · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/google/gemma-2-9b-it)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Mid-size dense Gemma 2 model trained from scratch on ~8T tokens with distillation, interleaved local/global attention, GQA and logit soft-capping. Among the strongest sub-10B open models at its July 2024 launch; 8K context. Non-reasoning.

### NVIDIA-Nemotron-Nano-12B-v2
**NVIDIA** · 2025-08 · NVIDIA Open Model License · 12B dense · reasoning · 128K ctx · spec: reasoning · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-Nano-12B-v2)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

The 12B sibling and pre-compression base of the Nemotron Nano 2 family, a from-scratch hybrid Mamba-2/Transformer reasoning model pretrained on 20T tokens, parent of the Minitron-distilled 9B. Reasoning ON: GPQA 65, AIME-2025 75.9, LiveCodeBench 70. Toggleable thinking budget.

### Mistral-Nemo-Instruct-2407
**Mistral AI** · 2024-07 · Apache 2.0 · 12B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/mistralai/Mistral-Nemo-Instruct-2407)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Dense 12B model trained jointly by Mistral AI and NVIDIA, a more capable multilingual successor to Mistral 7B with a 128K context and the Tekken tokenizer (MMLU ~68). Quantization-friendly via FP8-aware training. Non-reasoning general chat model.

### Gemma 3 12B
**Google** · 2025-03 · Gemma · 12B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/google/gemma-3-12b-it)
Benchmarks — GPQA-D 34.9 · IFBench 36.7 · LCR 6.7 · SciCode 17.4 · TB-Hard 0.8 · HLE 4.8  
Serving — hybrid-swa · KV 64.0 KB/token on 8 of 48 layers + 336 MB/request · BF16 weights (2 B/param) · answers without hidden reasoning  

Mid-large multimodal model in Google's Gemma 3 family with a 128K context and integrated SigLIP vision encoder, supporting text and image across 140+ languages (MMLU-Pro 60.6, GPQA 40.9). A balanced general-purpose multimodal chat model. Non-reasoning.

### Llama 2 13B Chat
**Meta** · 2023-07 · Llama 2 Community License · 13B dense · 4K ctx · spec: chat · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/meta-llama/Llama-2-13b-chat-hf)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Mid-size Llama 2 chat model trained from scratch on ~2T tokens with a 4K context and RLHF (MMLU ~54). A popular base for community instruction tuning in 2023-2024; predates the modern benchmark suite. Historically important.

### OLMo 2 13B Instruct
**Allen AI** · 2024-11 · Apache 2.0 · 13B dense · 4K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/allenai/OLMo-2-1124-13B-Instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Mid-size fully-open dense model from Allen AI, pretrained from scratch on ~5T tokens and post-trained via Tulu 3 (SFT, DPO, RLVR), with full reproducibility of weights, data and artifacts (MMLU ~67). 4K context. Non-reasoning, open-science reference.

### Phi-3-medium-128k-instruct
**Microsoft** · 2024-05 · MIT · 14B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/microsoft/Phi-3-medium-128k-instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

The 14B flagship of Microsoft's Phi-3 family, a dense decoder trained from scratch on ~4.8T tokens of filtered and synthetic data with 4K and 128K context variants (~76.6 MMLU). Embodies the Phi small-but-capable philosophy. Non-reasoning instruct model.

### DeepSeek-R1-Distill-Qwen-14B
**DeepSeek** · 2025-01 · MIT (weights) / Apache 2.0 base · 14B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Qwen2.5-14B · confidence: high
[model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-14B)
Benchmarks — GPQA-D 48.4 · IFBench 22.1 · LCR 10.3 · SciCode — · TB-Hard — · HLE 4.1  

Dense 14B reasoning model distilled from DeepSeek-R1 onto Qwen2.5-14B, reaching AIME-2024 69.7 and LiveCodeBench 53.1, beating many far larger non-reasoning models on math and code. Long chain-of-thought; 128K context.

### Phi-4
**Microsoft** · 2024-12 · MIT · 14B dense · 16K ctx · spec: reasoning · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/microsoft/phi-4)
Benchmarks — GPQA-D 57.5 · IFBench 23.5 · LCR 0 · SciCode 26 · TB-Hard 3.8 · HLE 4.1  
Serving — GQA · KV 200.0 KB/token on 40 of 40 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Microsoft's 14B dense decoder trained from scratch on ~9.8T tokens with a heavy emphasis on synthetic reasoning-dense data. Despite a modest 16K context it posts strong STEM/math/reasoning results (MMLU-Pro 70.4, GPQA 56.1) rivaling larger models. Not long-CoT but reasoning-strong.

### Phi-4-reasoning
**Microsoft** · 2025-04 · MIT · 14B dense · reasoning · 32K ctx · spec: reasoning · lineage: derived from Phi-4 · confidence: high
[model card](https://huggingface.co/microsoft/Phi-4-reasoning)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Microsoft's 14B open-weight reasoning model, fine-tuned from Phi-4 via SFT on ~8.3B tokens of chain-of-thought traces from o3-mini. Rivals much larger models on math, science and code (AIME-2024 75.3, GPQA 65.8, LiveCodeBench 53.8). Produces explicit long-form reasoning; 32K context.

### Phi-4-reasoning-plus
**Microsoft** · 2025-04 · MIT · 14B dense · reasoning · 32K ctx · spec: reasoning · lineage: derived from Phi-4 · confidence: high
[model card](https://huggingface.co/microsoft/Phi-4-reasoning-plus)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

RL-enhanced variant of Phi-4-reasoning (CoT SFT plus a GRPO RL phase), generating ~50% more reasoning tokens for higher accuracy (AIME-2024 81.3, AIME-2025 78, GPQA 68.9), approaching DeepSeek-R1 on math. Trades latency for top-tier reasoning at 14B.

### Qwen3-14B
**Alibaba/Qwen** · 2025-04 · Apache 2.0 · 14.8B dense · reasoning · 131K ctx · spec: reasoning · lineage: from-scratch · confidence: low
[model card](https://huggingface.co/Qwen/Qwen3-14B)
Benchmarks — GPQA-D 60.4 · IFBench 40.5 · LCR 0 · SciCode 31.6 · TB-Hard 3.8 · HLE 4.3  
Serving — GQA · KV 160.0 KB/token on 40 of 40 layers · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 43 / 55 / 59 / 54 / 14 (from AA Qwen3 14B (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

Mid-size dense Qwen3 model with the hybrid thinking/non-thinking switch; Qwen noted Qwen3 dense models often match the prior-gen larger Qwen2.5 models. Native 32K context extendable to 128K. Clean per-model thinking-mode benchmarks were not published.


## Mid (15–40B) — 25 models

### gpt-oss-20b ★
**OpenAI** · 2025-08 · Apache 2.0 · 20.9B total / 3.6B active (MoE) · reasoning · 131K ctx · spec: reasoning · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/openai/gpt-oss-20b)
Benchmarks — GPQA-D 68.8 · IFBench 65.1 · LCR 30.7 · SciCode 34.4 · TB-Hard 10.6 · HLE 9.8  
Serving — hybrid-swa · KV 24.0 KB/token on 12 of 24 layers + 3 MB/request · MXFP4 weights (0.66 B/param) · always thinks (reasoning_effort (low / medium / high)): ~2000 hidden tokens per answer  

The smaller of OpenAI's two open-weight gpt-oss MoE reasoning models, 20.9B total / 3.6B active with MXFP4 expert quantization that runs on ~16GB consumer/edge hardware. 131K context, configurable reasoning effort, tool use (GPQA 71.5, AIME-2025 91.7, SWE-bench 60.7). A capable lightweight reasoner. Apache 2.0.

### Mistral-Small-Instruct-2409
**Mistral AI** · 2024-09 · Mistral Research License · 22B dense · 32K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/mistralai/Mistral-Small-Instruct-2409)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

The 22B dense first-generation 'Small' model, between Mistral NeMo 12B and Mistral Large 2, with a 32K context and native function calling (MMLU-Pro ~48). Non-commercial Mistral Research License; superseded by the 24B Apache-licensed Small 3 line.

### Codestral-22B-v0.1
**Mistral AI** · 2024-05 · Mistral Non-Production License (MNPL) · 22B dense · 32K ctx · spec: coding · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/mistralai/Codestral-22B-v0.1)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Mistral AI's first dedicated code model, a dense 22B trained from scratch on 80+ programming languages with instruction-following and fill-in-the-middle support; 32K context. Source-available MNPL. Preceded the agentic Devstral line; coding-specialist.

### Mistral Small 3 (24B, 2501)
**Mistral AI** · 2025-01 · Apache 2.0 · 24B dense · 32K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/mistralai/Mistral-Small-24B-Instruct-2501)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Dense 24B model re-licensed under Apache 2.0 for low-latency local deployment, competitive with Llama 3.3 70B and Qwen 2.5 32B (MMLU-Pro 66, GPQA 45). Native function calling, JSON output, Tekken tokenizer, 32K context. Base for the Devstral and Magistral derivatives.

### Magistral-Small-2506 (1.0)
**Mistral AI** · 2025-06 · Apache 2.0 · 24B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Mistral-Small-3.1-24B-Base-2503 · confidence: high
[model card](https://huggingface.co/mistralai/Magistral-Small-2506)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Mistral AI's first open reasoning model, derived from Mistral Small 3.1 via SFT on Magistral Medium traces plus RL, using explicit [THINK] tokens (AIME-2024 70.7, GPQA 68.2, LiveCodeBench 55.8). Apache 2.0, 128K context. Reasoning specialist.

### Devstral Small 2 (24B, 2512)
**Mistral AI** · 2025-12 · Apache 2.0 · 24B dense · 393K ctx · spec: agentic · lineage: derived from Mistral-Small-3.1-24B-Base-2503 · confidence: high
[model card](https://huggingface.co/mistralai/Devstral-Small-2-24B-Instruct-2512)
Benchmarks — GPQA-D 53.2 · IFBench 31.2 · LCR 24 · SciCode 28.8 · TB-Hard 16.7 · HLE 3.4  
Serving — GQA · KV 160.0 KB/token on 40 of 40 layers · FP8 weights (1.07 B/param) · answers without hidden reasoning  

Mistral's second-generation small coding agent (December 2025), a dense 24B released in FP8 with a 393K window: strong on coding and agentic tool loops, ordinary elsewhere. It supersedes Devstral Small 1.1 (2507).

### Magistral-Small-2509 (1.2)
**Mistral AI** · 2025-09 · Apache 2.0 · 24B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Mistral-Small-3.2-24B-Instruct-2506 · confidence: high
[model card](https://huggingface.co/mistralai/Magistral-Small-2509)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Updated open reasoning model built on Mistral Small 3.2 with an added vision encoder for multimodal reasoning, markedly improving over 1.0 (AIME-2024 86.1, GPQA 70.1, LiveCodeBench 70.9). Apache 2.0, 128K context, [THINK] tokens, fits a single RTX 4090 when quantized.

### Mistral Small 3.2 (24B, 2506)
**Mistral AI** · 2025-06 · Apache 2.0 · 24B dense · 128K ctx · spec: general · lineage: derived from Mistral-Small-3.1-24B-Base-2503 · confidence: high
[model card](https://huggingface.co/mistralai/Mistral-Small-3.2-24B-Instruct-2506)
Benchmarks — GPQA-D 50.5 · IFBench 33.5 · LCR 17.3 · SciCode 26.4 · TB-Hard 6.8 · HLE 4.3  
Serving — GQA · KV 160.0 KB/token on 40 of 40 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Refinement of Mistral Small 3.1, fine-tuned from its base to improve instruction following, reduce repetition and strengthen tool/function calling. Dense 24B multimodal (text+vision) with a 128K context (MMLU-Pro 69.1, GPQA 46.1, HumanEval+ ~93). General-purpose, Apache 2.0.

### Gemma 3 27B
**Google** · 2025-03 · Gemma · 27B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/google/gemma-3-27b-it)
Benchmarks — GPQA-D 42.8 · IFBench 31.8 · LCR 5.7 · SciCode 21.2 · TB-Hard 3.8 · HLE 4.7  
Serving — hybrid-swa · KV 80.0 KB/token on 10 of 62 layers + 436 MB/request · BF16 weights (2 B/param) · answers without hidden reasoning  

Flagship of Google's Gemma 3 family, a dense multimodal (text+image) model trained from scratch with a 128K context and 140+ language support, marketed as a top single-accelerator open model (MMLU-Pro 67.5, GPQA 42.4). Integrates a SigLIP vision encoder. Non-reasoning.

### Qwen3.6-27B ★
**Alibaba Qwen Team** · 2026-04 · Apache-2.0 · 27B dense · reasoning · 262K ctx · spec: coding · lineage: from-scratch · confidence: high · AAII 37
[model card](https://huggingface.co/Qwen/Qwen3.6-27B)
Benchmarks — GPQA-D 84.2 · IFBench 67.6 · LCR 68.7 · SciCode 39.8 · TB-Hard 34.8 · HLE 21.6  
Serving — hybrid-linear · KV 64.0 KB/token on 16 of 64 layers + 154 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 87 / 91 / 85 / 96 / 70 (from AA Qwen3.6 27B (Non-reasoning)); thinks ~4000 hidden tokens elsewhere  

Qwen3.6-27B is Alibaba's first open-weight model in the Qwen3.6 generation, released April 2026 under Apache 2.0 as a dense 27B multimodal model with a hybrid Gated DeltaNet + Gated Attention architecture (64 layers) and Multi-Token Prediction for speculative decoding. It is a reasoning model (thinking mode on by default) with native 262K context extensible to ~1.01M tokens via YaRN. Notably, this dense 27B model matches or beats the much larger Qwen3.5-397B-A17B MoE on agentic coding benchmarks (SWE-bench Verified 77.2, Terminal-Bench 2.0 59.3). It scores 37 on the Artificial Analysis Intelligence Index, making it the open-weights leader under ~150B parameters at release.

### Gemma 2 27B
**Google** · 2024-06 · Gemma · 27.2B dense · 8K ctx · spec: general · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/google/gemma-2-27b-it)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Flagship of Google's Gemma 2 family, a dense text-only decoder pretrained from scratch and competitive with larger models at a practical size (~75 MMLU), ranking highly on early Chatbot Arena. Interleaved local/global attention, 8K context. Non-reasoning.

### Qwen3.8-27B ★
**Alibaba/Qwen** · 2026-08 · Apache 2.0 · 27.8B dense · reasoning · 262K ctx · spec: agentic · lineage: from-scratch (the Qwen3.6-27B layout) · confidence: high · AAII 33.7
[model card](https://huggingface.co/Qwen/Qwen3.8-27B)
Benchmarks — GPQA-D 90.5 · IFBench ≈71.5 (bridged) · LCR 73.7 · SciCode 45.7 · TB-Hard ≈52 (bridged) · HLE 31.8  
Serving — hybrid-linear · KV 64.0 KB/token on 16 of 64 layers + 154 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 92 / 94 / 87 / 96 / 84 (from AA Qwen3.8 27B (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

The dense 27B leader of late 2026: 48 Gated DeltaNet + 16 gated-attention layers (only those 16 keep KV, ~64 KB per token), Apache 2.0, released August 2026. Its Terminal-Bench 2.1 (79.8) rivals 750B MoEs, so the agentic lane — long the wall that did not compress — is cleared by a model that fits one H100 at FP8. Pinned on the Xhigh effort row; Low/Medium/Non-reasoning are effort settings of the same weights.

### NVIDIA Nemotron 3 Nano 30B A3B
**NVIDIA** · 2025-12 · NVIDIA Nemotron Open Model License · 30B total / 3.5B active (MoE) · reasoning · 1000K ctx · spec: reasoning · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16)
Benchmarks — GPQA-D 75.7 · IFBench 71.1 · LCR 33.7 · SciCode 29.6 · TB-Hard 13.6 · HLE 10.2  
Serving — hybrid-linear · KV 6.0 KB/token on 6 of 52 layers + 49 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 69 / 54 / 64 / 55 / 34 (from AA NVIDIA Nemotron 3 Nano 30B A3B (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

Nemotron 3 Nano 30B is the efficient agentic member of the Nemotron 3 family, a 30B-total / ~3.5B-active hybrid Mamba-2 + MoE model (23 Mamba-2/MoE layers plus 6 Attention layers; 128+1 experts, 5 active per token) trained from scratch on roughly 25T tokens. Released December 2025 under the NVIDIA Nemotron Open Model License as part of the open Nemotron 3 debut (open weights, data, and recipes), it supports up to 1M-token context (256k default) and a controllable reasoning mode. Model-card benchmarks include MMLU-Pro 78.3, GPQA 73.0 (no tools), AIME25 89.1 (no tools), LiveCodeBench v6 68.3, and SWE-bench Verified 38.8 (OpenHands). It is designed for fast, cost-efficient on-device and agentic deployment relative to the larger Super and Ultra tiers.

### Qwen3-30B-A3B
**Alibaba/Qwen** · 2025-04 · Apache 2.0 · 30.5B total / 3.3B active (MoE) · reasoning · 131K ctx · spec: reasoning · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/Qwen/Qwen3-30B-A3B)
Benchmarks — GPQA-D 70.7 · IFBench 50.7 · LCR 59 · SciCode 33.3 · TB-Hard 5.3 · HLE 9.8  
Serving — GQA · KV 96.0 KB/token on 48 of 48 layers · BF16 weights (2 B/param) · always thinks (no off switch): ~2000 hidden tokens per answer  

Small MoE of the original Qwen3 launch, 30.5B total / 3.3B active (128 experts, 8 active), delivering reasoning near the 32B dense model at a fraction of the compute. Hybrid thinking/non-thinking; native 32K extendable to 128K. A popular efficient choice. Later refreshed as Instruct/Thinking-2507.

### Qwen3-30B-A3B-Instruct-2507
**Alibaba/Qwen** · 2025-07 · Apache 2.0 · 30.5B total / 3.3B active (MoE) · 262K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3-30B-A3B-Instruct-2507)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

July 2025 non-thinking refresh of Qwen3's small MoE (30.5B total / 3.3B active), delivering strong general capability (MMLU-Pro 78.4, GPQA 70.4) at very low inference cost with a 262K context. A fast, deployment-friendly general/chat model.

### Qwen3-30B-A3B-Thinking-2507
**Alibaba/Qwen** · 2025-07 · Apache 2.0 · 30.5B total / 3.3B active (MoE) · reasoning · 262K ctx · spec: reasoning · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3-30B-A3B-Thinking-2507)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

July 2025 dedicated-reasoning refresh of Qwen3's small MoE (30.5B total / 3.3B active, 128 experts), packing flagship-level reasoning into a tiny active footprint (AIME-2025 85, MMLU-Pro 80.9, GPQA 73.4, LiveCodeBench 66). Native 262K context. Extremely efficient open reasoner.

### Qwen3-Coder-30B-A3B-Instruct
**Alibaba/Qwen** · 2025-07 · Apache 2.0 · 30.5B total / 3.3B active (MoE) · 262K ctx · spec: agentic · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct)
Benchmarks — GPQA-D 51.6 · IFBench 32.7 · LCR 29 · SciCode 27.8 · TB-Hard 15.2 · HLE 4  
Serving — GQA · KV 96.0 KB/token on 48 of 48 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Small, efficient member of the Qwen3-Coder agentic-coding family, a 30.5B total / 3.3B active MoE bringing agentic coding and tool-use to commodity hardware with only ~3B active (SWE-bench Verified ~51.6). Native 262K context; non-thinking, well-suited to local coding agents.

### DeepSeek-R1-Distill-Qwen-32B
**DeepSeek** · 2025-01 · MIT (weights) / Apache 2.0 base · 32B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Qwen2.5-32B · confidence: high
[model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B)
Benchmarks — GPQA-D 61.5 · IFBench 22.9 · LCR 8.7 · SciCode — · TB-Hard — · HLE 4.6  

Largest dense R1 distill, distilled from DeepSeek-R1 onto Qwen2.5-32B; the strongest open dense reasoning model at launch (AIME-2024 72.6, GPQA 62.1, LiveCodeBench 57.2), rivaling o1-mini. R1-style long chain-of-thought; 128K context.

### OLMo 2 32B Instruct
**Allen AI** · 2025-03 · Apache 2.0 · 32B dense · 4K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/allenai/OLMo-2-0325-32B-Instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Largest fully-open dense model from Allen AI, pretrained from scratch on up to ~6T tokens and post-trained with Tulu 3, billed as the first fully-open model to match GPT-3.5 Turbo / GPT-4o mini (MMLU 77.3, GSM8K 87.6). 4K context. Standout for complete transparency.

### Granite 4.0 H Small
**IBM** · 2025-10 · Apache 2.0 · 32B total / 9B active (MoE) · 128K ctx · spec: agentic · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/ibm-granite/granite-4.0-h-small)
Benchmarks — GPQA-D 41.6 · IFBench 31.5 · LCR 9 · SciCode 20.9 · TB-Hard 2.3 · HLE 3.7  
Serving — hybrid-linear · KV 16.0 KB/token on 4 of 40 layers + 77 MB/request · BF16 weights (2 B/param) · answers without hidden reasoning  

Flagship of IBM's Granite 4.0 family, a hybrid Mamba-2/transformer MoE with 32B total / 9B active (72 experts, 10 active + shared) and a 128K context, pretrained on IBM's ~22T-token enterprise corpus (MMLU-Pro 55.5, GPQA 40.6, HumanEval ~88, BFCL ~64.7). Cost-efficient enterprise agentic workflows. Apache 2.0.

### QwQ-32B
**Alibaba/Qwen** · 2025-03 · Apache 2.0 · 32.5B dense · reasoning · 131K ctx · spec: reasoning · lineage: derived from Qwen2.5-32B · confidence: high
[model card](https://huggingface.co/Qwen/QwQ-32B)
Benchmarks — GPQA-D 59.3 · IFBench 38.8 · LCR 26.7 · SciCode — · TB-Hard — · HLE 7.3  

Alibaba Qwen's dedicated reasoning model built on Qwen2.5-32B with large-scale RL for long chain-of-thought. At only 32.5B dense params it rivaled the much larger DeepSeek-R1 on math and coding (AIME-2024 79.5, GPQA 65.9, LiveCodeBench 63.4). A landmark for RL-driven mid-size reasoners.

### Qwen2.5-32B-Instruct
**Alibaba/Qwen** · 2024-09 · Apache 2.0 · 32.8B dense · 131K ctx · spec: general · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/Qwen/Qwen2.5-32B-Instruct)
Benchmarks — GPQA-D 46.6 · IFBench — · LCR — · SciCode — · TB-Hard — · HLE 4  

Mid-large dense model in the Qwen2.5 series, 32.8B params with a 131K context, balancing capability and deployability and serving as the base for QwQ-32B (MMLU-Pro 69, GPQA 49.5, LiveCodeBench 51.2). Non-reasoning general-purpose instruct model.

### Qwen2.5-Coder-32B-Instruct
**Alibaba/Qwen** · 2024-11 · Apache 2.0 · 32.8B dense · 131K ctx · spec: coding · lineage: derived from Qwen2.5-32B · confidence: med
[model card](https://huggingface.co/Qwen/Qwen2.5-Coder-32B-Instruct)
Benchmarks — GPQA-D 41.7 · IFBench — · LCR — · SciCode — · TB-Hard — · HLE 3.5  

Flagship code model of the Qwen2.5-Coder series, continued-pretrained from Qwen2.5-32B on ~5.5T code-heavy tokens; the first open model to match GPT-4o-class coding (HumanEval 92.7, Aider 73.7). 131K context, specializes in code generation, repair and reasoning across many languages.

### Qwen3-32B
**Alibaba/Qwen** · 2025-04 · Apache 2.0 · 32.8B dense · reasoning · 131K ctx · spec: reasoning · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/Qwen/Qwen3-32B)
Benchmarks — GPQA-D 66.8 · IFBench 36.3 · LCR 0 · SciCode 35.4 · TB-Hard 3 · HLE 8.3  
Serving — GQA · KV 256.0 KB/token on 64 of 64 layers · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 62 / 67 / 65 / 63 / 16 (from AA Qwen3 32B (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

Largest dense model of the original Qwen3 launch, a hybrid that toggles between thinking and fast non-thinking modes. In thinking mode it scores MMLU-Pro ~82, GPQA 73.1 and AIME-2025 83.7, outperforming QwQ-32B. Native 32K context extendable to 128K. A strong single-GPU-class reasoner.


### K2-Horizon-MoVA-36B-A4B ★
**Institute of Foundation Models (MBZUAI)** · 2026-09 · Apache 2.0 · 37.4B total / 4B active (MoE) · reasoning · 524K ctx · spec: reasoning · lineage: from-scratch · confidence: high · AAII 25.3
[model card](https://huggingface.co/IFM/K2-Horizon-MoVA-36B-A4B)
Benchmarks — GPQA-D 82.2 · IFBench ≈62.9 (bridged) · LCR 64.3 · SciCode 39.1 · TB-Hard ≈37.1 (bridged) · HLE 22  
Serving — GQA · KV 192.0 KB/token on 48 of 48 layers · BF16 weights (2 B/param) · always thinks (reasoning_effort (high / medium / low)): ~1500 hidden tokens per answer  

A fully open 36B MoE with 4B active and Mixture-of-Values attention: routed value experts add capacity without adding cache — the KV still stores standard 8×128 K/V (192 KB per token). Cheap to serve on a mid rack; Terminal-Bench 2.1 57%.

## Large (40–130B) — 25 models

### Phi-3.5-MoE-instruct
**Microsoft** · 2024-08 · MIT · 42B total / 6.6B active (MoE) · 128K ctx · spec: general · lineage: derived from Phi-3.5 · confidence: high
[model card](https://huggingface.co/microsoft/Phi-3.5-MoE-instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Microsoft's MoE model in the Phi-3.5 family, 16 experts totaling ~42B with ~6.6B active (top-2), built on the Phi-3 data recipe with 128K context (MMLU-Pro 54.3, GPQA 36.8). Outperforms the dense Phi-3.5-mini and rivals larger dense models. The only MoE in the Phi line through 3.5.

### Mixtral-8x7B-Instruct-v0.1
**Mistral AI** · 2023-12 · Apache 2.0 · 46.7B total / 12.9B active (MoE) · 32K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/mistralai/Mixtral-8x7B-Instruct-v0.1)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Mistral AI's first sparse MoE, 8 experts with 2 active per token (46.7B total / ~12.9B active). Matched or beat Llama 2 70B and GPT-3.5 at far lower cost, making MoE mainstream in open weights. General-purpose multilingual chat, 32K context (MMLU-Pro ~43).

### Llama-3.3-Nemotron-Super-49B-v1.5
**NVIDIA** · 2025-07 · NVIDIA Open Model License + Llama 3.3 Community License · 49B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Llama-3.3-70B-Instruct · confidence: high
[model card](https://huggingface.co/nvidia/Llama-3_3-Nemotron-Super-49B-v1_5)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Upgraded reasoning model NAS-compressed from Llama-3.3-70B-Instruct to a 49B dense footprint, the strongest of NVIDIA's single-GPU-class Nemotron reasoners (MMLU-Pro 79.5, GPQA 72, AIME-2025 82.7, LiveCodeBench 73.6). Toggleable reasoning; fits a single H200; strong price-to-performance.

### Llama-3.3-Nemotron-Super-49B-v1
**NVIDIA** · 2025-03 · NVIDIA Open Model License + Llama 3.3 Community License · 49B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Llama-3.3-70B-Instruct · confidence: high
[model card](https://huggingface.co/nvidia/Llama-3_3-Nemotron-Super-49B-v1)
Benchmarks — GPQA-D 64.3 · IFBench 38.1 · LCR 17 · SciCode 28.2 · TB-Hard 0 · HLE 6.5  
Serving — GQA · KV 196.0 KB/token on 49 of 80 layers · BF16 weights (2 B/param) · hybrid thinking (system prompt "detailed thinking off"): instant on interactive traffic, judged 74 / 72 / 58 / 72 / 19 (from AA Llama 3.3 Nemotron Super 49B v1 (Non-reasoning)); thinks ~1500 hidden tokens elsewhere  

Reasoning-capable model NAS-compressed from Llama-3.3-70B-Instruct to 49B so it fits a single H200, with toggleable reasoning and post-training for math, coding, RAG and tool calling (GPQA 66.7, AIME-2025 58.4, MATH500 96.6). Superseded by the stronger v1.5.

### Llama 3 70B Instruct
**Meta** · 2024-04 · Llama 3 Community License · 70B dense · 8K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/meta-llama/Meta-Llama-3-70B-Instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Meta's third-generation flagship dense model, pretrained on 15T+ tokens with GQA and an 8K context, a leading open-weight model at release (MMLU ~82, HumanEval ~81, GPQA 39.5). Quickly extended into the 128K-context Llama 3.1 generation. Non-reasoning.

### Llama 3.1 70B Instruct
**Meta** · 2024-07 · Llama 3.1 Community License · 70B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/meta-llama/Llama-3.1-70B-Instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Meta's 3.1-generation mid-flagship dense model with a 128K context, improved long-context handling and stronger tool use (MMLU-Pro 66.4, GPQA 41.7). Among the better open dense models of late 2024, later largely superseded by Llama 3.3 70B. Non-reasoning.

### Llama 3.3 70B Instruct
**Meta** · 2024-12 · Llama 3.3 Community License · 70B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct)
Benchmarks — GPQA-D 49.8 · IFBench 47.1 · LCR 15 · SciCode 26 · TB-Hard 3 · HLE 4  
Serving — GQA · KV 320.0 KB/token on 80 of 80 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Meta's late-2024 post-training refresh of the 70B dense model, delivering quality close to Llama 3.1 405B at a fraction of the cost, with a 128K context (MMLU-Pro 68.9, GPQA 50.5) and strong instruction following and tool use. Meta's go-to open dense model until Llama 4. Non-reasoning.

### Llama-3.1-Nemotron-70B-Instruct
**NVIDIA** · 2024-10 · NVIDIA Open Model License + Llama 3.1 Community License · 70B dense · 128K ctx · spec: chat · lineage: derived from Llama-3.1-70B-Instruct · confidence: high
[model card](https://huggingface.co/nvidia/Llama-3.1-Nemotron-70B-Instruct-HF)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

RLHF-aligned chat model from NVIDIA built on Llama-3.1-70B-Instruct, trained with REINFORCE and the HelpSteer2 reward model. At launch it topped Arena Hard (85.0) and AlpacaEval 2 LC (57.6), beating GPT-4o and Claude 3.5 Sonnet on those alignment benchmarks. Dense, non-reasoning.

### DeepSeek-R1-Distill-Llama-70B
**DeepSeek** · 2025-01 · MIT (weights) / Llama 3.3 Community (base) · 70B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Llama-3.3-70B-Instruct · confidence: high
[model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Llama-70B)
Benchmarks — GPQA-D 40.2 · IFBench 27.6 · LCR 11 · SciCode 31.3 · TB-Hard 1.5 · HLE 6.1  
Serving — GQA · KV 320.0 KB/token on 80 of 80 layers · BF16 weights (2 B/param) · always thinks (no off switch): ~2000 hidden tokens per answer  

Dense 70B reasoning model distilling DeepSeek-R1 onto Llama-3.3-70B-Instruct, pairing R1-style reasoning with Llama's strong knowledge base (AIME-2024 70, GPQA 65.2, LiveCodeBench 57.5). 128K context, R1-style long chain-of-thought.

### Qwen2.5-72B-Instruct
**Alibaba/Qwen** · 2024-09 · Qwen · 72.7B dense · 131K ctx · spec: general · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/Qwen/Qwen2.5-72B-Instruct)
Benchmarks — GPQA-D 49.1 · IFBench 36.9 · LCR — · SciCode — · TB-Hard 4.5 · HLE 3.6  

Dense flagship of the Qwen2.5 generation, trained on ~18T tokens, a 72B transformer with a 131K context that at launch was among the strongest open general-purpose models, competitive with Llama-3.1-405B (MMLU-Pro 71.1, GPQA 49, LiveCodeBench 55.5). Non-reasoning instruct model.

### Qwen3-Next-80B-A3B-Instruct
**Alibaba/Qwen** · 2025-09 · Apache 2.0 · 80B total / 3B active (MoE) · 262K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3-Next-80B-A3B-Instruct)
Benchmarks — GPQA-D 73.8 · IFBench 39.7 · LCR 52.7 · SciCode — · TB-Hard 7.6 · HLE 7.6  

Alibaba Qwen's next-gen ultra-sparse MoE, 80B total but only ~3B active across 512 experts (10 active + 1 shared), mixing Gated DeltaNet (linear attention) and Gated Attention for efficient long-context inference (262K, extendable to ~1M). Rivals Qwen3-32B at a fraction of active compute (MMLU-Pro 80.6, GPQA 72.9). Non-thinking.

### Qwen3-Next-80B-A3B-Thinking
**Alibaba/Qwen** · 2025-09 · Apache 2.0 · 80B total / 3B active (MoE) · reasoning · 262K ctx · spec: reasoning · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3-Next-80B-A3B-Thinking)
Benchmarks — GPQA-D 75.9 · IFBench 60.7 · LCR 60.3 · SciCode 38.8 · TB-Hard 9.8 · HLE 11.7  
Serving — hybrid-linear · KV 24.0 KB/token on 12 of 48 layers + 40 MB/request · BF16 weights (2 B/param) · always thinks (no off switch): ~2000 hidden tokens per answer  

Reasoning variant of Alibaba Qwen's next-gen ultra-sparse MoE, 80B total / ~3B active (512 experts), built on the hybrid Gated DeltaNet + Gated Attention architecture for cheap long-context reasoning (AIME-2025 87.8, MMLU-Pro 82.7, GPQA 77.2, LiveCodeBench 68.7). Native 262K context. Flagship-class reasoning at tiny active cost.

### Command R+ (08-2024)
**Cohere** · 2024-08 · CC-BY-NC 4.0 (non-commercial) · 104B dense · 128K ctx · spec: agentic · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/CohereForAI/c4ai-command-r-plus-08-2024)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Cohere's 104B dense flagship of the R series, trained from scratch for advanced multi-step tool use, RAG with verifiable citations and 23-language enterprise tasks, with a 128K context (GPQA ~34). Cohere's most capable model before Command A. Non-commercial license.

### GLM-4.5-Air
**Zhipu AI (Z.ai)** · 2025-08 · MIT · 106B total / 12B active (MoE) · reasoning · 128K ctx · spec: agentic · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/zai-org/GLM-4.5-Air)
Benchmarks — GPQA-D 73.3 · IFBench 37.6 · LCR 43.7 · SciCode 30.6 · TB-Hard 20.5 · HLE 6.8  
Serving — GQA · KV 184.0 KB/token on 46 of 46 layers · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 76 / 82 / 68 / 87 / 49 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

Lighter from-scratch MoE sibling of GLM-4.5 (106B total / 12B active), designed for efficiency while retaining hybrid thinking/non-thinking reasoning and agentic ability (MMLU-Pro 81.4, AIME-2024 89.4, GPQA 73.3, LiveCodeBench 61.5, SWE-bench 57.6). MIT, 128K context. Cost-efficient agentic and coding model.

### Llama 4 Scout 17B-16E Instruct
**Meta** · 2025-04 · Llama 4 Community License · 109B total / 17B active (MoE) · 10000K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Smaller of Meta's first natively-multimodal MoE models, 17B active across 16 experts (109B total) with an industry-leading 10M-token context that fits on a single H100 with Int4 (MMLU-Pro 74.3, GPQA 57.2, LiveCodeBench 32.8). Non-reasoning multimodal, targeting long-context document and image understanding.

### Command A (03-2025)
**Cohere** · 2025-03 · CC-BY-NC 4.0 (non-commercial) · 111B dense · 256K ctx · spec: agentic · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/CohereLabs/c4ai-command-a-03-2025)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Cohere's 111B dense enterprise flagship trained from scratch, optimized for agentic tool use, RAG and 23-language tasks, notable for running on just two A100/H100 GPUs with a 256K context (GPQA 50.5). Supersedes Command R+ with stronger code and instruction following. Non-commercial license.

### Command A Reasoning (08-2025)
**Cohere** · 2025-08 · CC-BY-NC 4.0 (non-commercial) · 111B dense · reasoning · 256K ctx · spec: reasoning · lineage: derived from c4ai-command-a-03-2025 · confidence: med
[model card](https://huggingface.co/CohereLabs/command-a-reasoning-08-2025)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Reasoning-enabled variant of Command A, a 111B dense model fine-tuned with toggleable reasoning (START/END_THINKING tags) for higher accuracy or lower latency, targeting agentic, tool-use and multilingual enterprise reasoning with a 256K input context (GPQA 66.7). Non-commercial license.

### gpt-oss-120b ★
**OpenAI** · 2025-08 · Apache 2.0 · 116.8B total / 5.1B active (MoE) · reasoning · 131K ctx · spec: reasoning · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/openai/gpt-oss-120b)
Benchmarks — GPQA-D 78.2 · IFBench 69 · LCR 50.7 · SciCode 38.9 · TB-Hard 23.5 · HLE 18.5  
Serving — hybrid-swa · KV 36.0 KB/token on 18 of 36 layers + 5 MB/request · MXFP4 weights (0.56 B/param) · always thinks (reasoning_effort (low / medium / high)): ~2000 hidden tokens per answer  

OpenAI's first major open-weight model since GPT-2, a from-scratch MoE reasoning model (116.8B total / 5.1B active) with MXFP4-quantized experts that fit on a single 80GB GPU. Configurable reasoning effort, 131K context, tool use (MMLU-Pro 80.8, GPQA 80.1, AIME-2025 92.5, SWE-bench 62.4). Strong agentic reasoning and coding. Apache 2.0.

### NVIDIA Nemotron 3 Super 120B A12B ★
**NVIDIA** · 2026-03 · NVIDIA Nemotron Open Model License · 120B total / 12B active (MoE) · reasoning · 1000K ctx · spec: reasoning · lineage: from-scratch · confidence: high · AAII 25
[model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16)
Benchmarks — GPQA-D 80 · IFBench 71.5 · LCR 60 · SciCode 36 · TB-Hard 28.8 · HLE 19.2  
Serving — hybrid-linear · KV 8.0 KB/token on 8 of 88 layers + 170 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 84 / 86 / 82 / 90 / 67 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

Nemotron 3 Super is the mid-tier member of NVIDIA's Nemotron 3 line, a 120B-total / 12B-active Latent Mixture-of-Experts (Mamba-2 + MoE + Attention hybrid with Multi-Token Prediction) released March 2026 under the NVIDIA Nemotron Open Model License. It is post-trained from NVIDIA's own from-scratch base model (the line is not derived from Llama), pre-trained on 25T+ tokens and refined with multi-stage RL for agentic and reasoning use, supporting up to 1M-token context. Its model card reports MMLU-Pro 83.73, GPQA-Diamond 79.23 (no tools), AIME25 90.21, LiveCodeBench v5 81.19, and SWE-bench Verified 60.47 (OpenHands). The Artificial Analysis model page lists an Intelligence Index of 25 at ~$0.28 blended/Mtok and ~150 tok/s (note: an AA launch article cited a higher 36.0 under a different index version).

### Qwen3.5-122B-A10B ★
**Alibaba Qwen Team** · 2026-02 · Apache-2.0 · 122B total / 10B active (MoE) · reasoning · 262K ctx · spec: general · lineage: from-scratch · confidence: high · AAII 32
[model card](https://huggingface.co/Qwen/Qwen3.5-122B-A10B)
Benchmarks — GPQA-D 85.7 · IFBench 75.7 · LCR 66.7 · SciCode 42 · TB-Hard 31.1 · HLE 23.4  
Serving — hybrid-linear · KV 24.0 KB/token on 12 of 48 layers + 154 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 88 / 92 / 86 / 97 / 80 (from AA Qwen3.5 122B A10B (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

Qwen3.5-122B-A10B is Alibaba's mid-tier multimodal foundation model in the Qwen3.5 series, released February 2026 under Apache 2.0 as a sparse MoE with 122B total and 10B active parameters (256 experts, 8 routed + 1 shared per token). It is a reasoning vision-language model with thinking mode enabled by default, built on a hybrid Gated Delta Network + sparse MoE architecture with early-fusion multimodal training. Native context is 262K tokens, extensible to ~1.01M via YaRN. It reports MMLU-Pro 86.7, GPQA-Diamond 86.6, AIME 2026 91.3, LiveCodeBench v6 78.9, and SWE-bench Verified 72.0, scoring 32 on the Artificial Analysis Intelligence Index.

### Mistral Large 2 (123B, 2407)
**Mistral AI** · 2024-07 · Mistral Research License · 123B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/mistralai/Mistral-Large-Instruct-2407)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Mistral AI's flagship dense model, 123B with a 128K context and support for 80+ coding and many natural languages, built for state-of-the-art reasoning, knowledge and coding, competing with GPT-4-class and Llama 3.1 405B at far smaller size (MMLU 84, MMLU-Pro ~66). Non-commercial license.

### Ling-3.0-flash ★
**InclusionAI (Ant Group)** · 2026-08 · MIT · 124B total / 5.1B active (MoE) · reasoning · 262K ctx · spec: reasoning · lineage: from-scratch · confidence: high · AAII 20.1
[model card](https://huggingface.co/inclusionAI/Ling-3.0-flash)
Benchmarks — GPQA-D 85.5 · IFBench ≈64.2 (bridged) · LCR 65.5 · SciCode 41.1 · TB-Hard ≈37.1 (bridged) · HLE 22.3  
Serving — hybrid-linear · KV 7.9 KB/token on 7 of 42 layers + 76 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False (thinking_option "off")): instant on interactive traffic, judged 84 / 88 / 84 / 92 / 74 (from the thinking→instant pair fit); thinks ~1500 hidden tokens elsewhere  

Qwen3.5-122B-class quality (GPQA 85.5, Terminal-Bench 2.1 55%) at half the active parameters and a fraction of the cache: Kimi Delta Attention on 5 of every 6 layers leaves 7 gated-MLA layers with ~8 KB of KV per token.

### MiniMax-M2.7 ★
**MiniMax** · 2026-03 · MiniMax Model License · 230B total / 10B active (MoE) · reasoning · 205K ctx · spec: agentic · lineage: derived from MiniMax-M2.5 · confidence: high · AAII 38
[model card](https://huggingface.co/MiniMaxAI/MiniMax-M2.7)
Benchmarks — GPQA-D 87.4 · IFBench 75.7 · LCR 68.7 · SciCode 47 · TB-Hard 39.4 · HLE 28.1  
Serving — GQA · KV 248.0 KB/token on 62 of 62 layers · FP8 weights (1.01 B/param) · always thinks (no off switch): ~2462 hidden tokens per answer  

MiniMax-M2.7, released March 18, 2026, is an open-weight Sparse Mixture-of-Experts reasoning model with ~230B total parameters and ~10B active parameters, 62 layers, and a ~205K-token (204,800) context window. It is notable as MiniMax's first model to deeply participate in its own evolution, having autonomously optimized a programming scaffold over 100+ rounds for a reported ~30% performance gain. Published benchmarks include GPQA-Diamond 87.4, SWE-bench Pro 56.22, Terminal-Bench 2 57.0, and HLE 28.1; MMLU-Pro, AIME, LiveCodeBench, and SWE-bench Verified were not officially reported. It scored 38 on the Artificial Analysis Intelligence Index.

### MiMo-V2-Flash
**Xiaomi (MiMo / LLM-Core team)** · 2025-12 · MIT · 309B total / 15B active (MoE) · reasoning · 256K ctx · spec: reasoning · lineage: from-scratch · confidence: med · AAII 33
[model card](https://github.com/XiaomiMiMo/MiMo-V2-Flash)
Benchmarks — GPQA-D 65.6 · IFBench 39.9 · LCR 36.3 · SciCode — · TB-Hard 25.8 · HLE 8.6  

MiMo-V2-Flash is Xiaomi's efficient open-weight Mixture-of-Experts reasoning/coding/agentic foundation model with 309B total and 15B active parameters, released mid-December 2025 (Dec 16-17) under the MIT license. Its hybrid attention interleaves sliding-window and global attention at a 5:1 ratio with an aggressive 128-token window plus learnable attention-sink bias, cutting KV-cache ~6x while supporting a 256K context, and adds a lightweight multi-token-prediction module. Per its technical report (arXiv:2601.02780), the post-trained model scores MMLU-Pro 84.9, GPQA-Diamond 84.3, AIME 2025 94.1, LiveCodeBench-v6 85.1, and SWE-bench Verified 73.4. Artificial Analysis lists an Intelligence Index of 33; note the catalog anchor labeled this a Feb 2026 release, but authoritative sources (Xiaomi, Wikipedia, the arXiv report) date it to December 2025.

### MiMo-V2.5
**Xiaomi (MiMo / LLM-Core team)** · 2026-04 · MIT · 310B total / 15B active (MoE) · reasoning · 1024K ctx · spec: general · lineage: derived from MiMo-V2-Flash sparse-MoE language backbone (hybrid SWA+GA) plus dedicated vision (729M) and audio (261M) encoders via lightweight projectors · confidence: med · AAII 40
[model card](https://huggingface.co/XiaomiMiMo/MiMo-V2.5)
Benchmarks — GPQA-D 84.9 · IFBench 67.1 · LCR 73 · SciCode 43.9 · TB-Hard 41.7 · HLE 27.2  

MiMo-V2.5 is a 310B-total / 15B-active sparse Mixture-of-Experts model from Xiaomi, released April 22, 2026 under the MIT license alongside the larger V2.5-Pro. Its language backbone inherits the MiMo-V2-Flash hybrid sliding-window/global-attention architecture and is extended into a unified multimodal (text, image, video, audio) reasoning model with dedicated vision and audio encoders, supporting up to a 1M-token context. Verified agentic benchmark results include SWE-bench Pro 56.1 and Terminal-Bench 2.0 65.8; the standard MMLU-Pro/GPQA-Diamond/AIME/LiveCodeBench/SWE-bench Verified figures were not text-verifiable from the official card and are left as unknown. Artificial Analysis reports an Intelligence Index of 40 at a blended price near $0.06/Mtok.


## Frontier (>130B) — 49 models

### Mixtral-8x22B-Instruct-v0.1
**Mistral AI** · 2024-04 · Apache 2.0 · 141B total / 39B active (MoE) · 64K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/mistralai/Mixtral-8x22B-Instruct-v0.1)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

The larger sparse MoE in the Mixtral line, 141B total / 39B active (8 experts, 2 active), with a 64K context, strong multilingual performance, native function calling and math/coding ability at frontier-class efficiency for early 2024 (MMLU-Pro ~56). General-purpose, Apache 2.0.

### Qwen3.8-Flash-Next ★
**Alibaba/Qwen** · 2026-08 · Qwen Community License 1.0 · 180B total / 6B active (MoE) · reasoning · 262K ctx · spec: agentic · lineage: from-scratch · confidence: high · AAII 39.8
[model card](https://huggingface.co/Qwen/Qwen3.8-Flash-Next)
Benchmarks — GPQA-D 92.3 · IFBench ≈73.2 (bridged) · LCR 71.5 · SciCode 49.8 · TB-Hard ≈56.8 (bridged) · HLE 35.6  
Serving — hybrid-linear · KV 24.8 KB/token on 12 of 48 layers + 116 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 86 / 91 / 90 / 95 / 93 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

The most extreme sparsity on the board: 180B resident (125B of MoE, a 51B n-gram embedding table and an MTP head) but only 6B active, over 36 Gated DeltaNet + 12 sparse full-attention layers. It beats Qwen3.5-397B on every Artificial Analysis cell — VRAM-hungry, compute-cheap. Commercial MaaS use needs a separate Qwen license.

### MiniMax-M2 ★
**MiniMax** · 2025-10 · Modified MIT · 230B total / 10B active (MoE) · reasoning · 205K ctx · spec: agentic · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/MiniMaxAI/MiniMax-M2)
Benchmarks — GPQA-D 77.7 · IFBench 72.3 · LCR 61 · SciCode 36.1 · TB-Hard 25.8 · HLE 12.5  
Serving — GQA · KV 248.0 KB/token on 62 of 62 layers · FP8 weights (1.01 B/param) · always thinks (no off switch): ~2000 hidden tokens per answer  

Compact, fast MoE with 230B total / only 10B active, built for coding and agentic workflows as an 'interleaved thinking' model. The tiny active footprint gives low latency and high throughput while posting frontier-class agentic scores (SWE-bench 69.4, LiveCodeBench 83, GPQA 78). One of the best price/performance open agentic coders.

### Qwen3-235B-A22B
**Alibaba/Qwen** · 2025-04 · Apache 2.0 · 235B total / 22B active (MoE) · reasoning · 131K ctx · spec: reasoning · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/Qwen/Qwen3-235B-A22B)
Benchmarks — GPQA-D 70 · IFBench 38.7 · LCR 0 · SciCode — · TB-Hard 6.1 · HLE 11  

Flagship MoE of the original Qwen3 launch, 235B total / 22B active (128 experts, 8 active), pioneering Qwen3's unified hybrid thinking/non-thinking switch and competitive with DeepSeek-R1, o1 and Gemini 2.5 Pro at launch (AIME-2025 81.5, GPQA 71.1, LiveCodeBench 70.7). Native 32K extendable to 128K. Later split into Instruct/Thinking-2507.

### Qwen3-235B-A22B-Instruct-2507
**Alibaba/Qwen** · 2025-07 · Apache 2.0 · 235B total / 22B active (MoE) · 262K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3-235B-A22B-Instruct-2507)
Benchmarks — GPQA-D 75.3 · IFBench 46.1 · LCR 33.9 · SciCode — · TB-Hard 15.2 · HLE 11.1  

July 2025 non-thinking refresh of Qwen3's flagship MoE (235B total / 22B active), dropping chain-of-thought for fast, high-quality direct answers and extending native context to 262K (~1M with YaRN). Posts large gains over the original (MMLU-Pro 83, GPQA 77.5). A top-tier open general/chat model.

### Qwen3-235B-A22B-Thinking-2507
**Alibaba/Qwen** · 2025-07 · Apache 2.0 · 235B total / 22B active (MoE) · reasoning · 262K ctx · spec: reasoning · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3-235B-A22B-Thinking-2507)
Benchmarks — GPQA-D 79 · IFBench 51.2 · LCR 67 · SciCode 42.4 · TB-Hard 13.6 · HLE 15  
Serving — GQA · KV 188.0 KB/token on 94 of 94 layers · BF16 weights (2 B/param) · always thinks (no off switch): ~2000 hidden tokens per answer  

July 2025 dedicated-reasoning refresh of Qwen3's flagship MoE (235B total / 22B active, 128 experts), at release the strongest open reasoning model with SOTA open scores (AIME-2025 92.3, MMLU-Pro 84.4, GPQA 81.1, LiveCodeBench 74.1). Native 262K context extendable toward 1M. Thinking-only; rivals closed frontier reasoners.

### DeepSeek-V2.5
**DeepSeek** · 2024-09 · DeepSeek Model License · 236B total / 21B active (MoE) · 128K ctx · spec: general · lineage: from-scratch · confidence: low
[model card](https://huggingface.co/deepseek-ai/DeepSeek-V2.5)
Benchmarks — GPQA-D 42.3 · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

A 236B total / 21B active MoE from DeepSeek that merged V2-Chat and DeepSeek-Coder-V2 into one general+code assistant, using Multi-head Latent Attention (MLA) and fine-grained MoE with a 128K context (LiveCodeBench 41.8). Predates the reasoning era; the V2-to-V3 bridge model.

### DeepSeek-Coder-V2-Instruct
**DeepSeek** · 2024-06 · DeepSeek Model License · 236B total / 21B active (MoE) · 128K ctx · spec: coding · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/deepseek-ai/DeepSeek-Coder-V2-Instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Code-specialized MoE from DeepSeek, 236B total / 21B active, continued-pretrained from a DeepSeek-V2 checkpoint on ~6T mostly-code tokens. The first open model to credibly challenge closed models on coding (HumanEval 90.2, LiveCodeBench 43.4), 128K context, 338 languages. Non-reasoning instruct coder.

### Solar Open 2 250B ★
**Upstage** · 2026-07 · Upstage Solar License · 250B total / 15B active (MoE) · reasoning · 1049K ctx · spec: reasoning · lineage: from-scratch (2.3% of weights transferred from Solar Open 100B) · confidence: high · AAII 24.7
[model card](https://huggingface.co/upstage/Solar-Open2-250B)
Benchmarks — GPQA-D 85.7 · IFBench ≈65.9 (bridged) · LCR 64.3 · SciCode 47.1 · TB-Hard ≈34.9 (bridged) · HLE 26.8  
Serving — hybrid-linear · KV 48.0 KB/token on 12 of 48 layers + 156 MB/request · BF16 weights (2 B/param) · hybrid thinking (reasoning_effort="low"): instant on interactive traffic, judged 84 / 88 / 86 / 92 / 73 (from the thinking→instant pair fit); thinks ~1500 hidden tokens elsewhere  

A NoPE hybrid laid out as [GQA, KDA×3]×12: only 12 of its 48 layers keep a KV cache (48 KB per token) and the rest are linear attention. Near the frontier on chat, general and coding at ≤250B; the card's IFBench 80.0 and TB-Hard 28.3 come from Upstage's own harness and are not used for calibration.

### Llama-3.1-Nemotron-Ultra-253B-v1
**NVIDIA** · 2025-04 · NVIDIA Open Model License + Llama 3.1 Community License · 253B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Llama-3.1-405B-Instruct · confidence: high
[model card](https://huggingface.co/nvidia/Llama-3_1-Nemotron-Ultra-253B-v1)
Benchmarks — GPQA-D 72.8 · IFBench 38.2 · LCR 7.3 · SciCode 34.7 · TB-Hard 2.3 · HLE 8.1  
Serving — GQA · KV 256.0 KB/token on 64 of 162 layers · BF16 weights (2 B/param) · hybrid thinking (system prompt "detailed thinking off"): instant on interactive traffic, judged 70 / 78 / 65 / 80 / 15 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

NVIDIA's flagship open reasoning model, NAS-compressed from Llama-3.1-405B-Instruct to 253B dense so it fits a single 8xH100 node, with toggleable reasoning (MMLU-Pro 82.5, GPQA 76, AIME-2025 72.5, LiveCodeBench 66.3). At launch the first open model to beat DeepSeek R1 on GPQA Diamond and LiveCodeBench at roughly half R1's size.

### Inkling-Small ★
**Thinking Machines Lab** · 2026-07 · Apache 2.0 · 276B total / 12B active (MoE) · reasoning · 1049K ctx · spec: reasoning · lineage: from-scratch · confidence: high · AAII 25.7
[model card](https://huggingface.co/thinkingmachines/Inkling-Small)
Benchmarks — GPQA-D 89.5 · IFBench ≈69.7 (bridged) · LCR 67.9 · SciCode 48.9 · TB-Hard ≈41.5 (bridged) · HLE 31.2  
Serving — hybrid-swa · KV 28.0 KB/token on 7 of 42 layers + 74 MB/request · BF16 weights (2 B/param) · hybrid thinking (reasoning_effort="none" (effort 0)): instant on interactive traffic, judged 85 / 89 / 88 / 93 / 79 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

Five sliding-window (512-token) layers per global one give a 1M window on ~28 KB of growing KV per token, plus a ~74 MB constant window state. It beats its own 975B sibling Inkling on every axis; natively multimodal input with controllable thinking effort.

### DeepSeek-V4-Flash-0731 ★
**DeepSeek** · 2026-07 · MIT · 284B total / 13B active (MoE) · reasoning · 1049K ctx · spec: reasoning · lineage: re-post-train of DeepSeek-V4-Flash (2026-04-24) · confidence: high · AAII 34.3
[model card](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731)
Benchmarks — GPQA-D 90.8 · IFBench ≈73 (bridged) · LCR 71.5 · SciCode 49.5 · TB-Hard ≈53.7 (bridged) · HLE 36.1  
Serving — csa · KV 6.7 KB/token on 41 of 43 layers + 6 MB/request · FP4 weights (0.55 B/param) · hybrid thinking (thinking_mode="chat"): instant on interactive traffic, judged 86 / 90 / 89 / 95 / 90 (from the thinking→instant pair fit); thinks ~1500 hidden tokens elsewhere  

DeepSeek-V4-Flash-0731 is the July 31, 2026 re-post-train of the smaller V4 model (first released April 24, 2026): a 284B MoE with 13B active and a 1M-token window, open under MIT. It shares V4's compressed attention — CSA (ratio 4) and HCA (ratio 128) on one shared 512-d KV head plus a 128-token window — so its KV is ~7 KB per token, and FP4 experts with FP8 elsewhere put the weights at ~165 GB. The roster pins the open 0731 Max row (Artificial Analysis reassigned the bare `deepseek-v4-flash` slug from the April checkpoint to it). Max/High/Non-think are effort settings of the same weights.

### Hy3-preview (Hunyuan 3)
**Tencent (Hunyuan / Hy Team)** · 2026-04 · Tencent Hy Community License Agreement · 295B total / 21B active (MoE) · reasoning · 256K ctx · spec: reasoning · lineage: from-scratch · confidence: med · AAII 34
[model card](https://huggingface.co/tencent/Hy3-preview)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Hy3-preview is Tencent Hunyuan's 295B-total / 21B-active Mixture-of-Experts model (192 experts, top-8 activated, 80 layers, plus a 3.8B MTP layer), released April 23, 2026 as the first model from Tencent's rebuilt training infrastructure. It supports a 256K context and a configurable reasoning_effort parameter (no_think vs high) for chain-of-thought, and is optimized for reasoning and agentic/search tasks at low cost (AAII 34, agentic index ~49.7). Base-model card scores include MMLU-Pro 65.76, LiveCodeBench-v6 34.86, and the instruct model reaches SWE-bench Verified 74.4 and GPQA Diamond ~73.2. AIME was not disclosed on the model card, so it is left unverified.

### Hy3 ★
**Tencent (Hy Team)** · 2026-07 · Apache 2.0 · 295B total / 21B active (MoE) · reasoning · 262K ctx · spec: reasoning · lineage: final release of the Hy3-preview line · confidence: high · AAII 25.3
[model card](https://huggingface.co/tencent/Hy3)
Benchmarks — GPQA-D 89.7 · IFBench ≈70.5 (bridged) · LCR 70.9 · SciCode 47.8 · TB-Hard ≈45.5 (bridged) · HLE 31.4  
Serving — GQA · KV 320.0 KB/token on 80 of 80 layers · BF16 weights (2 B/param) · hybrid thinking (reasoning_effort="no_think"): instant on interactive traffic, judged 86 / 89 / 88 / 94 / 83 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

The final Apache-2.0 release of Tencent's Hy3 (the preview carried a regional license). Plain full-attention GQA over 80 layers: 320 KB of KV per token, 14× MiMo-V2.6-Flash at the same weight footprint — the high-KV foil that shows why the 2026 hybrids exist.

### MiMo-V2.6-Flash ★
**Xiaomi (MiMo / LLM-Core team)** · 2026-09 · MIT · 309B total / 15B active (MoE) · reasoning · 1049K ctx · spec: reasoning · lineage: from-scratch (MiMo-V2 hybrid-attention backbone) · confidence: high · AAII 37.9
[model card](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Flash-MOPD)
Benchmarks — GPQA-D ≈90 (bridged) · IFBench ≈70.8 (bridged) · LCR 66.7 · SciCode 50.5 · TB-Hard ≈48.2 (bridged) · HLE 32.9  
Serving — hybrid-swa · KV 22.5 KB/token on 9 of 48 layers + 26 MB/request · MXFP4 weights (0.56 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 85 / 89 / 89 / 93 / 84 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

The best ~300B open model of autumn 2026: 39 of its 48 layers attend a 128-token sliding window, holding growing KV to ~22 KB per token; FP8 weights with MXFP4-stored experts (~0.56 bytes/param). Omni-modal; Artificial Analysis publishes no GPQA, IFBench or TB-Hard for it, so those cells are bridged.

### Motif 3 ★
**Motif Technologies** · 2026-08 · MIT · 314B total / 13.2B active (MoE) · reasoning · 262K ctx · spec: agentic · lineage: from-scratch · confidence: high · AAII 33.6
[model card](https://huggingface.co/Motif-Technologies/Motif-3)
Benchmarks — GPQA-D 83.4 · IFBench ≈69.6 (bridged) · LCR 68.2 · SciCode 41.3 · TB-Hard ≈50.1 (bridged) · HLE 34.7  
Serving — hybrid-swa · KV 15.8 KB/token on 14 of 53 layers + 6 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 85 / 87 / 86 / 93 / 86 (from the thinking→instant pair fit); thinks ~1500 hidden tokens elsewhere  

Grouped differential attention on an MLA latent, with 128-token sliding windows on 3 of every 4 layers: ~16 KB of KV per token, 20× less than Hy3 at the same size. Terminal-Bench 2.1 75% at 13B active; the card's calibrated-abstention score (OmniScience 71.6) is a real over-refusal-versus-hallucination signal.

### GLM-5.3-Flash ★
**Z AI (Zhipu AI)** · 2026-08 · MIT · 321B total / 18B active (MoE) · reasoning · 1049K ctx · spec: agentic · lineage: from-scratch · confidence: high · AAII 41.8
[model card](https://huggingface.co/zai-org/GLM-5.3-Flash)
Benchmarks — GPQA-D 91.2 · IFBench ≈73.8 (bridged) · LCR 71.8 · SciCode 50.8 · TB-Hard ≈56.8 (bridged) · HLE 37.3  
Serving — hybrid-linear · KV 22.3 KB/token on 11 of 45 layers + 148 MB/request · FP8 weights (1.02 B/param) · always thinks (reasoning_effort (low / high / max)): ~2000 hidden tokens per answer  

Above GLM-5.2 on almost every cell at less than half the size: 34 Kimi Delta Attention + 11 DeepSeek-Sparse-Attention (MLA) layers, FP8 weights, MIT-licensed. Z AI's claim of 4.4× less KV than GLM-5.3 matches its config within 5% (~22 KB per token).

### Nemotron-4-340B-Instruct
**NVIDIA** · 2024-06 · NVIDIA Open Model License · 340B dense · 4K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/nvidia/Nemotron-4-340B-Instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

A 340B dense decoder pretrained from scratch by NVIDIA on 9T tokens; the Instruct variant is aligned via SFT/DPO/RPO with over 98% synthetically-generated alignment data. Purpose-built as a permissively-licensed synthetic-data-generation engine (MMLU 78.7, HumanEval 73.2). Limited by a short 4K context. Non-reasoning.

### GLM-4.5
**Zhipu AI (Z.ai)** · 2025-08 · MIT · 355B total / 32B active (MoE) · reasoning · 128K ctx · spec: agentic · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/zai-org/GLM-4.5)
Benchmarks — GPQA-D 78.2 · IFBench 44.1 · LCR 52.7 · SciCode — · TB-Hard 22 · HLE 13  

Z.ai's flagship from-scratch MoE foundation model (355B total / 32B active) unifying agentic, reasoning and coding (ARC) with switchable thinking/non-thinking modes. Among the top open models at release (MMLU-Pro 84.6, AIME-2024 91, GPQA 79.1, LiveCodeBench 72.9, SWE-bench 64.2). MIT-licensed; base of GLM-4.6.

### GLM-4.6
**Z AI (Zhipu AI)** · 2025-09 · MIT · 355B total / ?B active (MoE) · reasoning · 200K ctx · spec: coding · lineage: derived from GLM-4.5 (355B MoE) · confidence: med · AAII 23
[model card](https://huggingface.co/zai-org/GLM-4.6)
Benchmarks — GPQA-D 63.2 · IFBench 36.7 · LCR 26.3 · SciCode — · TB-Hard 28.8 · HLE 5.5  

GLM-4.6 is Z AI's (Zhipu) ~355B-total Mixture-of-Experts model released September 30, 2025 under MIT, an iterative upgrade over GLM-4.5 that extends the context window to 200K tokens and improves real-world coding, reasoning, tool use, and agentic workflows. Reported benchmarks include MMLU-Pro ~83.1, AIME 2025 ~90.3, LiveCodeBench v6 ~73, and GPQA ~78.8. Its active-parameter count is not separately disclosed on the HF card, and its Artificial Analysis Intelligence Index of ~23 reflects the stricter v4.1 methodology. Active params and a clean SWE-bench Verified figure remain unverified.

### K2-Horizon-375B-A23B ★
**Institute of Foundation Models (MBZUAI)** · 2026-09 · Apache 2.0 · 379.2B total / 23B active (MoE) · reasoning · 524K ctx · spec: agentic · lineage: from-scratch · confidence: high · AAII 30.5
[model card](https://huggingface.co/IFM/K2-Horizon-375B-A23B)
Benchmarks — GPQA-D 87.3 · IFBench ≈69.4 (bridged) · LCR 71.8 · SciCode 42 · TB-Hard ≈47.2 (bridged) · HLE 30  
Serving — GQA · KV 244.0 KB/token on 61 of 61 layers · BF16 weights (2 B/param) · always thinks (reasoning_effort (high / medium / low)): ~2000 hidden tokens per answer  

The largest fully open model (weights, data, code, intermediate and RL-expert checkpoints). Plain full-attention GQA keeps its cache heavy — 244 KB per token against single-digit KB for the compressed-attention frontier — the price of a transparent, standard architecture.

### Qwen3.5-397B-A17B ★
**Alibaba Qwen Team** · 2026-02 · Apache-2.0 · 397B total / 17B active (MoE) · reasoning · 262K ctx · spec: reasoning · lineage: from-scratch · confidence: high · AAII 34
[model card](https://huggingface.co/Qwen/Qwen3.5-397B-A17B)
Benchmarks — GPQA-D 89.3 · IFBench 78.8 · LCR 65.7 · SciCode 42 · TB-Hard 40.9 · HLE 27.3  
Serving — hybrid-linear · KV 30.0 KB/token on 15 of 60 layers + 192 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 89 / 94 / 90 / 102 / 87 (from AA Qwen3.5 397B A17B (Non-reasoning)); thinks ~3186 hidden tokens elsewhere  

Qwen3.5-397B-A17B is the flagship of Alibaba's Qwen3.5 series, released February 2026 under Apache 2.0 as a sparse Mixture-of-Experts model with 397B total and 17B active parameters (512 experts, 11 routed + 1 shared per token). It is a unified vision-language reasoning model (thinking mode by default) using an efficient hybrid architecture combining Gated Delta Networks with sparse MoE and early-fusion multimodal training, supporting 200+ languages. Native context is 262K tokens, extensible to ~1.01M via YaRN; the hosted Qwen3.5-Plus variant defaults to 1M context. It posts strong benchmarks (MMLU-Pro 87.8, GPQA-Diamond 88.4, AIME 2026 91.3, SWE-bench Verified 76.4) and scores 34 on the Artificial Analysis Intelligence Index.

### Llama 4 Maverick 17B-128E Instruct
**Meta** · 2025-04 · Llama 4 Community License · 400B total / 17B active (MoE) · 1000K ctx · spec: general · lineage: from-scratch · confidence: med
[model card](https://huggingface.co/meta-llama/Llama-4-Maverick-17B-128E-Instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Meta's flagship natively-multimodal MoE, 17B active across 128 experts (400B total) with a 1M-token context, designed to fit on a single H100 host (MMLU-Pro 80.5, GPQA 69.8, LiveCodeBench 43.4). Distilled in part from the unreleased Llama 4 Behemoth teacher. Non-reasoning; independent agentic-coding evals place SWE-bench Verified in the mid-20s.

### MiniMax-M3 ★
**MiniMax** · 2026-06 · MiniMax Community License · 428B total / 23B active (MoE) · reasoning · 1000K ctx · spec: agentic · lineage: derived from MiniMax-M2 · confidence: high · AAII 44
[model card](https://huggingface.co/MiniMaxAI/MiniMax-M3)
Benchmarks — GPQA-D 92.9 · IFBench 82.9 · LCR 74 · SciCode 45.4 · TB-Hard 42.4 · HLE 37.1  
Serving — GQA · KV 120.0 KB/token on 60 of 60 layers · BF16 weights (2 B/param) · hybrid thinking (thinking_mode="disabled"): instant on interactive traffic, judged 88 / 92 / 87 / 96 / 83 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

MiniMax-M3, released June 1, 2026, is an open-weight frontier model built on the new MiniMax Sparse Attention (MSA) architecture, a 428B-total / 23B-active Mixture-of-Experts model with native multimodality and a 1M-token context window (512K guaranteed minimum). MSA delivers roughly 9.7x faster prefill and 15.6x faster decode at 1M context versus MiniMax M2. Published numbers include GPQA-Diamond ~92.9 and SWE-bench Pro 59.0 (surpassing GPT-5.5 and Gemini 3.1 Pro on that benchmark), plus Terminal-Bench 2.1 66.0 and BrowseComp 83.5; MMLU-Pro, AIME, LiveCodeBench, and SWE-bench Verified were not officially released. It scored 44 on the Artificial Analysis Intelligence Index, ranking #2 among tracked models.

### MiniMax-M1-80k
**MiniMax** · 2025-06 · Apache 2.0 · 456B total / 45.9B active (MoE) · reasoning · 1000K ctx · spec: reasoning · lineage: derived from MiniMax-Text-01 · confidence: high
[model card](https://huggingface.co/MiniMaxAI/MiniMax-M1-80k)
Benchmarks — GPQA-D 69.7 · IFBench 41.8 · LCR 54.3 · SciCode 37.4 · TB-Hard 3 · HLE 8.2  
Serving — hybrid-linear · KV 40.0 KB/token on 10 of 80 layers + 294 MB/request · BF16 weights (2 B/param) · always thinks (no off switch): ~1500 hidden tokens per answer  

Hybrid-MoE reasoning model from MiniMax, 456B total / 45.9B active, built on MiniMax-Text-01 and RL-trained (CISPO). Its lightning (linear) attention gives a native 1M-token context at ~25% the FLOPs of DeepSeek-R1 at 100K generation (AIME-2025 76.9, GPQA 70, LiveCodeBench 65, SWE-bench 56). Extremely efficient for long reasoning.

### Qwen3-Coder-480B-A35B-Instruct
**Alibaba/Qwen** · 2025-07 · Apache 2.0 · 480B total / 35B active (MoE) · 262K ctx · spec: agentic · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3-Coder-480B-A35B-Instruct)
Benchmarks — GPQA-D 61.8 · IFBench 40.5 · LCR 42.3 · SciCode 35.9 · TB-Hard 18.9 · HLE 4.4  
Serving — GQA · KV 248.0 KB/token on 62 of 62 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Alibaba Qwen's flagship agentic code model, a 480B total / 35B active MoE (160 experts, 8 active) that set SOTA open results on agentic coding/tool-use (SWE-bench Verified 67 without test-time scaling, 69.6 with 500-turn scaling), comparable to Claude Sonnet 4. Native 262K context extendable to ~1M, for long-horizon repo-level agent workflows. Non-thinking.

### NVIDIA Nemotron 3 Ultra 550B A55B ★
**NVIDIA** · 2026-06 · OpenMDW License Agreement v1.1 · 550B total / 55B active (MoE) · reasoning · 1000K ctx · spec: reasoning · lineage: from-scratch · confidence: high · AAII 38
[model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16)
Benchmarks — GPQA-D 86.7 · IFBench 81.4 · LCR 67 · SciCode 39.9 · TB-Hard 36.4 · HLE 26.6  
Serving — hybrid-linear · KV 12.0 KB/token on 12 of 108 layers + 408 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 86 / 89 / 85 / 92 / 76 (from the thinking→instant pair fit); thinks ~2275 hidden tokens elsewhere  

Nemotron 3 Ultra is NVIDIA's frontier-scale open-weight flagship, a 550B-total / 55B-active Latent Mixture-of-Experts model built on a hybrid Mamba-2 + MoE + Attention stack with Multi-Token Prediction, trained from scratch (not derived from Llama). Released June 2026 under the permissive OpenMDW v1.1 license, it targets demanding agentic, long-context (up to 1M tokens; ~262k as served by Artificial Analysis providers), and reasoning workloads. It scores 38 on the Artificial Analysis Intelligence Index at ~$0.58 blended/Mtok and ~153 tok/s, making it the strongest US open-weight model on that index at launch. Its own model card reports MMLU-Pro 86.8, GPQA 87.0, LiveCodeBench v6 89.0, and SWE-bench Verified 70.7, but uses IMOAnswerBench rather than AIME for math (so AIME is unverified).

### Ling-3.1-flash ★
**InclusionAI (Ant Group)** · 2026-10 · MIT · 560B total / 25B active (MoE) · reasoning · 262K ctx · spec: agentic · lineage: from-scratch (the Ling-3.0-flash architecture, scaled) · confidence: high · AAII 41.1
[model card](https://huggingface.co/inclusionAI/Ling-3.1-flash)
Benchmarks — GPQA-D ≈94.4 (bridged) · IFBench ≈75.6 (bridged) · LCR 74.6 · SciCode 53.3 · TB-Hard ≈53.9 (bridged) · HLE 36.9  
Serving — hybrid-linear · KV 10.1 KB/token on 9 of 72 layers + 274 MB/request · FP8 weights (1 B/param) · hybrid thinking (enable_thinking=False (thinking_option "off")): instant on interactive traffic, judged 87 / 92 / 91 / 96 / 91 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

Linear-attention hybrids at frontier scale: Kimi Delta Attention on 7 of every 8 layers leaves 9 gated-MLA layers with ~10 KB of KV per token at 560B, and FP8 weights fit one 8×H200 pod. The README advertises a 1M window; the shipped config serves 262K.

### Step 5 Preview ★
**StepFun** · 2026-09 · StepFun Model License 1.0 · 600B total / 27B active (MoE) · reasoning · 1049K ctx · spec: agentic · lineage: from-scratch · confidence: high · AAII 43.7
[model card](https://huggingface.co/stepfun-ai/Step-5-Preview)
Benchmarks — GPQA-D ≈96.3 (bridged) · IFBench ≈81.2 (bridged) · LCR 79.4 · SciCode 58.1 · TB-Hard ≈61.5 (bridged) · HLE 43.5  
Serving — hybrid-swa · KV 69.0 KB/token on 23 of 92 layers + 109 MB/request · FP8 weights (1.07 B/param) · always thinks (reasoning_effort (a system "Reasoning: …" line)): ~2000 hidden tokens per answer  

A 600B frontier MoE in FP8 (one 8×H200 pod): 69 sliding-window (512) layers and 23 full layers behind a block-compressed sparse indexer. Its license charges MaaS businesses above $20M revenue and device makers — an operator constraint as real as VRAM. GPQA, IFBench and TB-Hard are bridged.

### DeepSeek-V3
**DeepSeek** · 2024-12 · MIT (code) + DeepSeek Model License (weights) · 671B total / 37B active (MoE) · 128K ctx · spec: general · lineage: from-scratch · confidence: high
[model card](https://huggingface.co/deepseek-ai/DeepSeek-V3)
Benchmarks — GPQA-D 55.7 · IFBench 34.8 · LCR 29 · SciCode 35.4 · TB-Hard 6.8 · HLE 3.6  
Serving — MLA · KV 68.6 KB/token on 61 of 61 layers · FP8 weights (1.01 B/param) · answers without hidden reasoning  

DeepSeek's 671B total / 37B active MoE foundation model (256 routed experts), trained from scratch for only ~2.79M H800 GPU-hours using MLA, auxiliary-loss-free load balancing, FP8 training and Multi-Token Prediction. A landmark efficient frontier-class open model and the base for the V3/R1/V3.1 family (MMLU-Pro 75.9, GPQA 59.1, SWE-bench 42). Non-reasoning.

### DeepSeek-R1
**DeepSeek** · 2025-01 · MIT · 671B total / 37B active (MoE) · reasoning · 128K ctx · spec: reasoning · lineage: derived from DeepSeek-V3-Base · confidence: high
[model card](https://huggingface.co/deepseek-ai/DeepSeek-R1)
Benchmarks — GPQA-D 81.3 · IFBench 39.6 · LCR 55.7 · SciCode — · TB-Hard 15.9 · HLE 15.8  

DeepSeek's first large-scale reasoning model, post-trained from DeepSeek-V3-Base via large-scale RL (GRPO) plus cold-start SFT, sharing the 671B/37B MoE. Its January 2025 release stunned the field by matching OpenAI o1-class reasoning at open-weight cost under MIT (MMLU-Pro 84, GPQA 71.5, AIME-2025 79.8, SWE-bench 49.2). Parent of the R1 distill series.

### DeepSeek-R1-0528
**DeepSeek** · 2025-05 · MIT · 671B total / 37B active (MoE) · reasoning · 128K ctx · spec: reasoning · lineage: derived from DeepSeek-V3-Base · confidence: high
[model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-0528)
Benchmarks — GPQA-D 81.3 · IFBench 39.6 · LCR 54.7 · SciCode 40.3 · TB-Hard 15.9 · HLE 14.9  
Serving — MLA · KV 68.6 KB/token on 61 of 61 layers · FP8 weights (1.01 B/param) · always thinks (no off switch): ~1500 hidden tokens per answer  

May 2025 refresh of DeepSeek-R1 with substantially deeper reasoning (average AIME token usage roughly doubled), pushing AIME-2025 to 87.5, GPQA to 81 and LiveCodeBench to 73.3, narrowing the gap to closed frontier reasoners (SWE-bench 57.6). Also reduced hallucination and improved tool/function calling. 671B/37B MoE, MIT.

### DeepSeek-V3.1
**DeepSeek** · 2025-08 · MIT · 671B total / 37B active (MoE) · reasoning · 128K ctx · spec: agentic · lineage: derived from DeepSeek-V3-Base · confidence: high
[model card](https://huggingface.co/deepseek-ai/DeepSeek-V3.1)
Benchmarks — GPQA-D 77.9 · IFBench 41.5 · LCR 53.3 · SciCode 39.1 · TB-Hard 25 · HLE 13  
Serving — MLA · KV 68.6 KB/token on 61 of 61 layers · FP8 weights (1.01 B/param) · hybrid thinking (thinking=False): instant on interactive traffic, judged 82 / 86 / 84 / 90 / 67 (from AA DeepSeek V3.1 (Non-reasoning)); thinks ~1500 hidden tokens elsewhere  

Hybrid model supporting both thinking and non-thinking modes in one checkpoint, post-trained on a long-context-extended V3.1-Base, sharing the 671B/37B MLA MoE and adding much stronger tool calling and agentic behavior (MMLU-Pro 84.8, GPQA 80.1, AIME-2025 88.4, LiveCodeBench 74.8, SWE-bench 66). The campaign's frontier dense-MoE workhorse. MIT.

### DeepSeek-V3.1-Terminus
**DeepSeek** · 2025-09 · MIT · 671B total / 37B active (MoE) · reasoning · 128K ctx · spec: agentic · lineage: derived from DeepSeek-V3.1 · confidence: med
[model card](https://huggingface.co/deepseek-ai/DeepSeek-V3.1-Terminus)
Benchmarks — GPQA-D 75.1 · IFBench 41.2 · LCR 45.3 · SciCode — · TB-Hard 31.8 · HLE 8.7  

September 2025 stability-and-agent refresh of DeepSeek-V3.1, keeping the 671B/37B hybrid-thinking MoE. Improved language consistency and sharpened the Code Agent and Search Agent, nudging SWE-bench Verified to ~68.4 (GPQA 80.7, AIME-2025 88, LiveCodeBench 74.9). Immediate predecessor of V3.2-Exp. MIT.

### DeepSeek-V3.2-Exp
**DeepSeek** · 2025-09 · MIT · 685B total / 37B active (MoE) · reasoning · 128K ctx · spec: agentic · lineage: derived from DeepSeek-V3.1-Terminus · confidence: med
[model card](https://huggingface.co/deepseek-ai/DeepSeek-V3.2-Exp)
Benchmarks — GPQA-D 79.7 · IFBench 54.1 · LCR 69 · SciCode 37.7 · TB-Hard 31.1 · HLE 13.8  
Serving — MLA · KV 83.9 KB/token on 61 of 61 layers · FP8 weights (1.01 B/param) · hybrid thinking (thinking=False): instant on interactive traffic, judged 84 / 87 / 87 / 90 / 68 (from AA DeepSeek V3.2 Exp (Non-reasoning)); thinks ~1500 hidden tokens elsewhere  

Experimental release introducing DeepSeek Sparse Attention (DSA), the lab's first fine-grained sparse-attention mechanism, built on V3.1-Terminus to validate long-context efficiency. Keeps the ~685B/37B MoE shape while sharply cutting long-context cost at near-identical quality (AIME-2025 89.3, SWE-bench 67.8, LiveCodeBench 74.1). A step toward DeepSeek's next-gen architecture. MIT.

### GLM-5.2 (max) ★
**Z AI (Zhipu AI)** · 2026-06 · MIT · 753B total / 40B active (MoE) · reasoning · 1000K ctx · spec: agentic · lineage: derived from GLM-5 / GLM-5.1 (744B MoE base, DeepSeek Sparse Attention) · confidence: med · AAII 51
[model card](https://huggingface.co/blog/zai-org/glm-52-blog)
Benchmarks — GPQA-D 89.5 · IFBench 73.3 · LCR 71.3 · SciCode 50.5 · TB-Hard 50.8 · HLE 40.1  
Serving — MLA · KV 93.0 KB/token on 78 of 78 layers · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 84 / 85 / 85 / 89 / 73 (from AA GLM-5.2 (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

GLM-5.2 is Z AI's (Zhipu) flagship open-weight Mixture-of-Experts model released June 2026, sharing the GLM-5 family's ~753B-total / 40B-active architecture with DeepSeek Sparse Attention but extending the context window to 1M tokens. It became the leading open-weight model on the Artificial Analysis Intelligence Index v4.1 (AAII 51), ranking 4th overall and trailing only top proprietary models. It is tuned for long-horizon agentic coding, scoring 62.1 on SWE-bench Pro and 81.0 on Terminal-Bench 2.1, plus AIME 2026 99.2 and GPQA-Diamond 91.2. Z AI did not publish standard SWE-bench Verified, MMLU-Pro, or LiveCodeBench numbers at launch, so those are left unverified.

### GLM-5.3 ★
**Z AI (Zhipu AI)** · 2026-08 · GLM-5.3 License (MIT-style) · 753B total / 40B active (MoE) · reasoning · 1049K ctx · spec: agentic · lineage: derived from GLM-5.2 (same pre-trained base; every gain is post-training) · confidence: high · AAII 44.8
[model card](https://huggingface.co/zai-org/GLM-5.3)
Benchmarks — GPQA-D 91.7 · IFBench ≈74.8 (bridged) · LCR 71.5 · SciCode 58.2 · TB-Hard ≈58.8 (bridged) · HLE 39.6  
Serving — MLA · KV 93.0 KB/token on 78 of 78 layers · FP8 weights (1 B/param) · always thinks (reasoning_effort (low / high / max)): ~2000 hidden tokens per answer  

GLM-5.2's base, re-post-trained — and released in FP8, so the same 753B MLA + DeepSeek-Sparse-Attention body that needs a SuperPod at BF16 fits one 8×H200 pod. Terminal-Bench 2.1 83.9; IFBench is not published (bridged). The license asks MaaS operators above $10B revenue for a Z AI security review.

### GLM-5.1
**Z AI (Zhipu AI)** · 2026-04 · MIT · 754B total / 40B active (MoE) · reasoning · 200K ctx · spec: agentic · lineage: derived from GLM-5 (744-754B MoE base, DeepSeek Sparse Attention) · confidence: med · AAII 40
[model card](https://huggingface.co/zai-org/GLM-5.1)
Benchmarks — GPQA-D 86.8 · IFBench 76.3 · LCR 73.7 · SciCode 44.8 · TB-Hard 43.2 · HLE 30.1  

GLM-5.1 is a post-training upgrade of Z AI's GLM-5 base, keeping the ~754B-total / 40B-active Mixture-of-Experts architecture with a 200K-token context and up to 128K output tokens, released April 2026 under MIT. It targets long-horizon agentic engineering, able to sustain a single coding task across hundreds of self-evaluation rounds and thousands of tool calls. Reported scores include AIME 2026 95.3, GPQA-Diamond 86.2, and SWE-bench Pro 58.4 (topping the SWE-bench Pro leaderboard at release). It scores 40 on the Artificial Analysis Intelligence Index; standard MMLU-Pro, LiveCodeBench, and SWE-bench Verified figures were not cleanly published.

### DeepSeek-V4.1-Flash ★
**DeepSeek** · 2026-09 · MIT · 763B total / 16B active (MoE) · reasoning · 1049K ctx · spec: reasoning · lineage: from-scratch (a new causal encoder–decoder) · confidence: med · AAII 39.5
[model card](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash)
Benchmarks — GPQA-D ≈92.8 (bridged) · IFBench ≈75.3 (bridged) · LCR 75.5 · SciCode 51.1 · TB-Hard ≈53.2 (bridged) · HLE 36.7  
Serving — csa · KV 3.3 KB/token on 40 of 40 layers + 5 MB/request · FP4 weights (0.66 B/param) · hybrid thinking (enable_thinking=False (thinking_mode "chat")): instant on interactive traffic, judged 87 / 87 / 85 / 92 / 71 (from AA DeepSeek V4.1 Flash (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

DeepSeek's current flagship — its API routes V4-Pro and V4-Flash traffic here: a causal encoder–decoder whose decoder reuses the encoder's compressed KV. The card publishes 890 bytes per token with FP4 KV, the smallest cache at the frontier. The 763B includes a 196B Engram n-gram memory; active parameters are 8B in prefill and 16B in decode. Artificial Analysis publishes no GPQA, IFBench, TB-Hard or TB-2.1, so four cells are bridged from HLE, LCR and SciCode.

### Muse Spark Open ★
**Meta** · 2026-10 · Muse Model License · 816B total / 42B active (MoE) · reasoning · 1049K ctx · spec: reasoning · lineage: shares the Muse Spark 1.3 pre-trained base; extra safety post-training for standalone use · confidence: med · AAII 38.9
[model card](https://huggingface.co/meta-models/Muse-Spark-Open-816B-A42B)
Benchmarks — GPQA-D 89 · IFBench ≈74.4 (bridged) · LCR 70.3 · SciCode 57.6 · TB-Hard ≈55.9 (bridged) · HLE 41.1  
Serving — GQA · KV 248.0 KB/token on 62 of 62 layers · BF16 weights (2 B/param) · always thinks (reasoning_effort (low / medium / high / xhigh)): ~2000 hidden tokens per answer  

The strongest US open-weight model (October 2026) and a deliberate contrast: full attention on all 62 layers — ~248 KB of KV per token, 10–60× the hybrids (the Hugging Face blog's 266 GB for one 1M-token context matches exactly). A gated download with manual approval; the config is gated, so the layout comes from the blog and card. A separate deal is required for MaaS above $20M revenue.

### Kimi-K2-Instruct
**Moonshot AI** · 2025-07 · Modified MIT · 1000B total / 32B active (MoE) · 128K ctx · spec: agentic · lineage: derived from Kimi-K2-Base · confidence: high
[model card](https://huggingface.co/moonshotai/Kimi-K2-Instruct)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Moonshot AI's 1-trillion-total / 32B-active MoE (384 experts, 8 active + 1 shared, MLA), post-trained into a 'reflex-grade' non-thinking instruct model optimized for agentic and tool-use tasks. Strong agentic coding without long CoT (SWE-bench 65.8 single / 71.6 multi-attempt, MMLU-Pro 81.1); AIME-2025 49.5 reflects the no-reasoning design.

### Kimi-K2-Thinking
**Moonshot AI** · 2025-11 · Modified MIT · 1000B total / 32B active (MoE) · reasoning · 256K ctx · spec: agentic · lineage: derived from Kimi-K2-Base · confidence: high
[model card](https://huggingface.co/moonshotai/Kimi-K2-Thinking)
Benchmarks — GPQA-D 83.8 · IFBench 68.1 · LCR 66.3 · SciCode 42.4 · TB-Hard 31.1 · HLE 22.3  
Serving — MLA · KV 68.6 KB/token on 61 of 61 layers · INT4 weights (0.58 B/param) · always thinks (no off switch): ~2000 hidden tokens per answer  

Moonshot AI's reasoning + tool-orchestration flagship, sharing the 1T-total / 32B-active MoE (384 experts) but adding long step-by-step thinking interleaved with function calls, 256K context. One of the strongest open models on hard reasoning and agentic coding (GPQA 84.5, LiveCodeBench 83.1, SWE-bench 71.3, AIME-2025 94.5 no-tools). Trained natively in INT4 (quantization-aware), so its ~580 GB of weights fit one 8×H200 pod and its benchmarks are measured at that precision.

### Kimi K2.6
**Moonshot AI** · 2026-04 · Modified MIT License · 1000B total / 32B active (MoE) · reasoning · 256K ctx · spec: agentic · lineage: derived from Kimi K2.5 · confidence: high · AAII 43
[model card](https://huggingface.co/moonshotai/Kimi-K2.6)
Benchmarks — GPQA-D 91.1 · IFBench 76 · LCR 81 · SciCode 51.5 · TB-Hard 43.9 · HLE 37.5  

Kimi K2.6 is Moonshot AI's flagship open-weight, natively-multimodal agentic model, released April 20, 2026 under a Modified MIT License. It is a 1-trillion-parameter Mixture-of-Experts model (384 experts, 8 active + 1 shared) with 32B activated parameters, MLA attention, a 256K-token context window, and both thinking and instant modes. Official numbers include GPQA-Diamond 90.5, AIME 2026 96.4, LiveCodeBench v6 89.6, and SWE-bench Verified 80.2; MMLU-Pro was not published (only the vision MMMU-Pro at 79.4). It scored 43 on the Artificial Analysis Intelligence Index, making it the leading open-weights model at launch.

### Kimi K2.7 Code
**Moonshot AI** · 2026-06 · Modified MIT License · 1000B total / 32B active (MoE) · reasoning · 256K ctx · spec: coding · lineage: derived from Kimi K2.6 · confidence: high · AAII 42
[model card](https://huggingface.co/moonshotai/Kimi-K2.7-Code)
Benchmarks — GPQA-D 89.6 · IFBench 63.1 · LCR 79.3 · SciCode 47.8 · TB-Hard 44.7 · HLE 35  

Kimi K2.7 Code, released June 12, 2026, is a coding-specialized upgrade built on the Kimi K2.6 foundation, sharing the same 1T-parameter / 32B-active MoE architecture (384 experts), 256K context, native INT4 quantization, and Modified MIT License. It makes thinking mode mandatory (disabling it returns an API error) while cutting reasoning-token consumption roughly 30% versus K2.6. Moonshot only published gains on its own proprietary suites (Kimi Code Bench v2 62.0 / +21.8%, Program Bench 53.6, MLS Bench Lite 35.1) and did not release standard MMLU-Pro, GPQA-Diamond, AIME, LiveCodeBench, or SWE-bench Verified scores, drawing criticism for skipping independent benchmark submission. It scored 42 on the Artificial Analysis Intelligence Index.

### MiMo-V2.6-Pro ★
**Xiaomi (MiMo / LLM-Core team)** · 2026-09 · MIT · 1020B total / 42B active (MoE) · reasoning · 1049K ctx · spec: agentic · lineage: from-scratch (MOPD post-train of MiMo-V2.6-Pro-RL) · confidence: high · AAII 46.3
[model card](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Pro-MOPD)
Benchmarks — GPQA-D ≈96.3 (bridged) · IFBench ≈82.5 (bridged) · LCR 77.6 · SciCode 60.2 · TB-Hard ≈63.7 (bridged) · HLE 46.2  
Serving — hybrid-swa · KV 50.0 KB/token on 10 of 70 layers + 39 MB/request · MXFP4 weights (0.55 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 88 / 93 / 98 / 99 / 105 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

The highest Artificial Analysis index among open weights on the October 2026 snapshot (46.3). Sixty 128-token sliding-window layers per ten global ones hold growing KV to ~50 KB per token at trillion scale, and MXFP4-stored experts put the weights at ~560 GB — one 8×H200 pod. GPQA, IFBench and TB-Hard are bridged.

### MiMo-V2.5-Pro
**Xiaomi (MiMo / LLM-Core team)** · 2026-04 · MIT · 1023B total / 42B active (MoE) · reasoning · 1024K ctx · spec: agentic · lineage: derived from MiMo-V2-Flash architecture (hybrid sliding-window + global attention, 3-layer MTP); MiMo-V2.5-Pro-Base · confidence: med · AAII 42
[model card](https://huggingface.co/XiaomiMiMo/MiMo-V2.5-Pro)
Benchmarks — GPQA-D 86.6 · IFBench 79.9 · LCR 79.7 · SciCode 50.6 · TB-Hard 43.2 · HLE 35.7  

MiMo-V2.5-Pro is Xiaomi's flagship open-weight Mixture-of-Experts LLM with ~1.02T total parameters and 42B active per token, released April 22, 2026 under the MIT license. It uses the MiMo-V2-Flash hybrid-attention architecture (interleaved sliding-window and global attention) with 3 lightweight multi-token-prediction modules and a 1M-token context window, and is a reasoning/agentic model targeting long-horizon software-engineering and tool-use tasks. Verified post-training results include 78.9% SWE-bench Verified and 80.6 LiveCodeBench (plus 48.0 Humanity's Last Exam and 57.2 SWE-bench Pro); the model card's MMLU-Pro 68.5 / GPQA-Diamond 66.7 / AIME 37.3 figures are explicitly base-model scores, so instruct values for those three are left unverified. Artificial Analysis places it at Intelligence Index 42 with a blended price near $0.18/Mtok.

### DeepSeek-V4-Pro-0813 ★
**DeepSeek** · 2026-08 · MIT · 1600B total / 49B active (MoE) · reasoning · 1049K ctx · spec: reasoning · lineage: re-post-train of DeepSeek-V4-Pro (2026-04-24) · confidence: high · AAII 36
[model card](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-0813)
Benchmarks — GPQA-D 92.8 · IFBench ≈74.7 (bridged) · LCR 72.1 · SciCode 50.2 · TB-Hard ≈54.6 (bridged) · HLE 38.4  
Serving — csa · KV 9.6 KB/token on 61 of 61 layers + 8 MB/request · FP4 weights (0.54 B/param) · hybrid thinking (thinking_mode="chat"): instant on interactive traffic, judged 86 / 88 / 87 / 91 / 70 (from AA DeepSeek V4 Pro 0813 (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

DeepSeek-V4-Pro-0813 is the August 13, 2026 re-post-train of DeepSeek's V4 flagship (first released April 24, 2026): a 1.6T-parameter MoE with 49B active and a 1M-token window, open under MIT. Its hybrid attention — Compressed Sparse Attention (ratio 4) on 30 layers and Heavily Compressed Attention (ratio 128) on 31, one shared 512-d KV head — keeps ~10 KB of KV per token, about 10% of DeepSeek-V3.2's, and FP4 experts with FP8 elsewhere put the weights at ~890 GB, inside one 8×H200 pod. The roster pins the open 0813 Max row (Artificial Analysis reassigned the bare `deepseek-v4-pro` slug to it); Max/High/Non-think are effort settings of the same weights.

### Kimi K3 ★
**Moonshot AI** · 2026-07 · Kimi K3 License · 2780B total / 104B active (MoE) · reasoning · 1049K ctx · spec: agentic · lineage: from-scratch · confidence: high · AAII 43.6
[model card](https://huggingface.co/moonshotai/Kimi-K3)
Benchmarks — GPQA-D 93.5 · IFBench ≈79 (bridged) · LCR 79.7 · SciCode 58.7 · TB-Hard ≈60.9 (bridged) · HLE 43.8  
Serving — hybrid-linear · KV 27.0 KB/token on 24 of 93 layers + 449 MB/request · MXFP4 weights (0.56 B/param) · always thinks (reasoning_effort (low / high / max)): ~2000 hidden tokens per answer  

The largest open model: 2.78T total / 104B active (896 experts, top-16), with Kimi Delta Attention on 69 of 93 layers and gated MLA on the rest (~27 KB of KV per token). Its weights are MXFP4 quantization-aware-trained — 1.56 TB, just over an 8×B200's HBM — so only the NVL72 holds it. The license requires a separate agreement for MaaS above $20M revenue.

### Mistral Large 4 (pending open weights)
**Mistral AI** · 2026-10 (API preview 2026-10-06) · license unpublished · size unpublished · ctx unpublished · spec: — · lineage: — · confidence: low
[announcement](https://mistral.ai/news)
Benchmarks — GPQA-D — · IFBench — · LCR — · SciCode — · TB-Hard — · HLE —  

Mistral's next frontier model has been in API preview since October 6, 2026, with the open weights announced for **October 27, 2026**. Its layer layout, expert count, attention type and license are unpublished, so it has no architecture record and no roster slot yet; it joins the candidate pool once the weights and config ship. The preview's Artificial Analysis cells so far: LCR 81.3, SciCode 54.2, HLE 35.0.

<!-- generated:pool — `node scripts/roster-report.mjs catalog` -->

## Generated pool entries — 65 models

Pool checkpoints that have no hand-written entry yet, composed from the loaded roster (architecture from each
model's config.json via `data/model-arch.json`, benchmarks from Artificial Analysis). Promote one to a hand-written,
fact-checked entry by moving it into its size section above.

### Qwen3.5 0.8B ★
**Alibaba** · 2026-03 · Apache-2.0 · 0.8B dense · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3.5-0.8B)
Benchmarks — GPQA-D 23.6 · IFBench 21.6 · LCR 6.7 · SciCode 2.9 · TB-Hard 0 · HLE 4.9  
Serving — hybrid-linear · KV 12.0 KB/token on 6 of 24 layers + 20 MB/request · BF16 weights (2 B/param) · answers without hidden reasoning  

Qwen3.5 0.8B: 0.8B dense on a linear/SSM hybrid — 6 of 24 layers keep KV (12 KB per token).

### Gemma 3 1B Instruct ★
**Google** · 2025-03 · Gemma · 1B dense · 33K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/google/gemma-3-1b-it)
Benchmarks — GPQA-D 23.7 · IFBench 19.9 · LCR 0 · SciCode 0.7 · TB-Hard 0 · HLE 5.2  
Serving — hybrid-swa · KV 4.0 KB/token on 4 of 26 layers + 12 MB/request · BF16 weights (2 B/param) · answers without hidden reasoning  

Gemma 3 1B Instruct: 1B dense on a sliding-window hybrid — 4 of 26 layers keep a growing KV (4 KB per token).

### K2 Horizon 0.9B ★
**Institute of Foundation Models** · 2026-09 · Apache-2.0 · 1.08B dense · reasoning · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/IFM/K2-Horizon-0.9B)
Benchmarks — GPQA-D 29.3 · IFBench ≈27.8 (bridged) · LCR 5.1 · SciCode 5.7 · TB-Hard ≈0.9 (bridged) · HLE 5.3  
Serving — GQA · KV 56.0 KB/token on 28 of 28 layers · BF16 weights (2 B/param) · always thinks (reasoning_effort (high / medium / low)): ~1500 hidden tokens per answer  

K2 Horizon 0.9B: 1.08B dense on full GQA attention (56 KB of KV per token).

### LFM2.5-1.2B-Thinking ★
**Liquid AI** · 2026-01 · LFM Open License v1.0 · 1.17B dense · reasoning · 33K ctx · spec: chat · lineage: — · confidence: high
[model card](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Thinking)
Benchmarks — GPQA-D 33.9 · IFBench 41.8 · LCR 0 · SciCode 4.2 · TB-Hard 0 · HLE 6.1  
Serving — hybrid-linear · KV 12.0 KB/token on 6 of 16 layers · BF16 weights (2 B/param) · always thinks (no off switch): ~1500 hidden tokens per answer  

LFM2.5-1.2B-Thinking: 1.17B dense on a linear/SSM hybrid — 6 of 16 layers keep KV (12 KB per token).

### LFM2 1.2B
**Liquid AI** · 2025-07 · LFM Open License v1.0 · 1.17B dense · 33K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/LiquidAI/LFM2-1.2B)
Benchmarks — GPQA-D 22.8 · IFBench 22 · LCR 0 · SciCode 2.5 · TB-Hard 0 · HLE 5.7  
Serving — hybrid-linear · KV 12.0 KB/token on 6 of 16 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

LFM2 1.2B: 1.17B dense on a linear/SSM hybrid — 6 of 16 layers keep KV (12 KB per token).

### Exaone 4.0 1.2B ★
**LG AI Research** · 2025-07 · EXAONE AI Model License · 1.28B dense · hybrid reasoning · 66K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/LGAI-EXAONE/EXAONE-4.0-1.2B)
Benchmarks — GPQA-D 51.5 · IFBench 23 · LCR 0 · SciCode 9.3 · TB-Hard 0 · HLE 5.8  
Serving — GQA · KV 60.0 KB/token on 30 of 30 layers · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 43 / 49 / 20 / 54 / 8 (from AA Exaone 4.0 1.2B (Non-reasoning)); thinks ~1500 hidden tokens elsewhere  

Exaone 4.0 1.2B: 1.28B dense on full GQA attention (60 KB of KV per token).

### Granite 4.0 H 1B
**IBM** · 2025-10 · Apache-2.0 · 1.5B dense · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/ibm-granite/granite-4.0-h-1b)
Benchmarks — GPQA-D 26.3 · IFBench 26.2 · LCR 6.3 · SciCode 8.2 · TB-Hard 0 · HLE 5  
Serving — hybrid-linear · KV 8.0 KB/token on 4 of 40 layers + 29 MB/request · BF16 weights (2 B/param) · answers without hidden reasoning  

Granite 4.0 H 1B: 1.5B dense on a linear/SSM hybrid — 4 of 40 layers keep KV (8 KB per token).

### Granite 4.0 1B
**IBM** · 2025-10 · Apache-2.0 · 1.6B dense · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/ibm-granite/granite-4.0-1b)
Benchmarks — GPQA-D 28.1 · IFBench 20.5 · LCR 4 · SciCode 8.7 · TB-Hard 0 · HLE 5.1  
Serving — GQA · KV 80.0 KB/token on 40 of 40 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Granite 4.0 1B: 1.6B dense on full GQA attention (80 KB of KV per token).

### Qwen3.5 2B ★
**Alibaba** · 2026-03 · Apache-2.0 · 2B dense · hybrid reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3.5-2B)
Benchmarks — GPQA-D 45.6 · IFBench 31.5 · LCR 23.7 · SciCode 2.8 · TB-Hard 3.8 · HLE 2.1  
Serving — hybrid-linear · KV 12.0 KB/token on 6 of 24 layers + 20 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 60 / 59 / 25 / 71 / 21 (from AA Qwen3.5 2B (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

Qwen3.5 2B: 2B dense on a linear/SSM hybrid — 6 of 24 layers keep KV (12 KB per token).

### LFM2 2.6B
**Liquid AI** · 2025-09 · LFM Open License v1.0 · 2.57B dense · 33K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/LiquidAI/LFM2-2.6B)
Benchmarks — GPQA-D 30.6 · IFBench 19.5 · LCR 0 · SciCode 2.5 · TB-Hard 0.8 · HLE 5.2  
Serving — hybrid-linear · KV 16.0 KB/token on 8 of 30 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

LFM2 2.6B: 2.57B dense on a linear/SSM hybrid — 8 of 30 layers keep KV (16 KB per token).

### LFM2.5-2.6B
**Liquid AI** · 2026-08 · LFM Open License v1.0 · 2.69B dense · reasoning · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/LiquidAI/LFM2.5-2.6B)
Benchmarks — GPQA-D 55.8 · IFBench ≈35.4 (bridged) · LCR 4.5 · SciCode 13.3 · TB-Hard ≈4 (bridged) · HLE 6.1  
Serving — hybrid-linear · KV 16.0 KB/token on 8 of 30 layers · BF16 weights (2 B/param) · always thinks (no off switch): ~1500 hidden tokens per answer  

LFM2.5-2.6B: 2.69B dense on a linear/SSM hybrid — 8 of 30 layers keep KV (16 KB per token).

### Jamba Reasoning 3B
**AI21 Labs** · 2025-10 · Apache-2.0 · 3B dense · reasoning · 262K ctx · spec: chat · lineage: — · confidence: high
[model card](https://huggingface.co/ai21labs/AI21-Jamba-Reasoning-3B)
Benchmarks — GPQA-D 33.3 · IFBench 52.4 · LCR 7 · SciCode 5.9 · TB-Hard 0.8 · HLE 4.6  
Serving — hybrid-linear · KV 1.0 KB/token on 2 of 28 layers + 5 MB/request · BF16 weights (2 B/param) · always thinks (no off switch): ~1500 hidden tokens per answer  

Jamba Reasoning 3B: 3B dense on a linear/SSM hybrid — 2 of 28 layers keep KV (1 KB per token).

### Ministral 3 3B
**Mistral** · 2025-12 · Apache-2.0 · 3.4B dense · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512)
Benchmarks — GPQA-D 35.8 · IFBench 26.8 · LCR 11.7 · SciCode 14.4 · TB-Hard 0 · HLE 5.3  
Serving — GQA · KV 104.0 KB/token on 26 of 26 layers · FP8 weights (1.21 B/param) · answers without hidden reasoning  

Ministral 3 3B: 3.4B dense on full GQA attention (104 KB of KV per token), released in FP8.

### Granite 4.1 3B
**IBM** · 2026-04 · Apache-2.0 · 3.4B dense · 131K ctx · spec: chat · lineage: — · confidence: high
[model card](https://huggingface.co/ibm-granite/granite-4.1-3b)
Benchmarks — GPQA-D 31.4 · IFBench 33.7 · LCR 3 · SciCode 11.9 · TB-Hard 2.3 · HLE 3.4  
Serving — GQA · KV 80.0 KB/token on 40 of 40 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Granite 4.1 3B: 3.4B dense on full GQA attention (80 KB of KV per token).

### Granite 4.2 3B
**IBM** · 2026-08 · Apache-2.0 · 3.66B dense · hybrid reasoning · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/ibm-granite/granite-4.2-3b)
Benchmarks — GPQA-D 55.9 · IFBench ≈39.3 (bridged) · LCR 21.4 · SciCode 24.3 · TB-Hard ≈10.2 (bridged) · HLE 6.5  
Serving — GQA · KV 80.0 KB/token on 40 of 40 layers · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 69 / 67 / 55 / 76 / 30 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

Granite 4.2 3B: 3.66B dense on full GQA attention (80 KB of KV per token).

### Qwen3.5 4B ★
**Alibaba** · 2026-03 · Apache-2.0 · 4B dense · hybrid reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3.5-4B)
Benchmarks — GPQA-D 77.1 · IFBench 52 · LCR 55.7 · SciCode 16.1 · TB-Hard 18.2 · HLE 7.8  
Serving — hybrid-linear · KV 32.0 KB/token on 8 of 32 layers + 52 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 78 / 84 / 53 / 88 / 41 (from AA Qwen3.5 4B (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

Qwen3.5 4B: 4B dense on a linear/SSM hybrid — 8 of 32 layers keep KV (32 KB per token).

### Gemma 3 4B Instruct
**Google** · 2025-03 · Gemma · 4.3B dense · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/google/gemma-3-4b-it)
Benchmarks — GPQA-D 29.1 · IFBench 28.3 · LCR 5.7 · SciCode 7.3 · TB-Hard 0.8 · HLE 5.2  
Serving — hybrid-swa · KV 20.0 KB/token on 5 of 34 layers + 122 MB/request · BF16 weights (2 B/param) · answers without hidden reasoning  

Gemma 3 4B Instruct: 4.3B dense on a sliding-window hybrid — 5 of 34 layers keep a growing KV (20 KB per token).

### Gemma 4 E2B
**Google** · 2026-04 · Apache-2.0 · 5.1B dense · hybrid reasoning · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/google/gemma-4-E2B-it)
Benchmarks — GPQA-D 43.3 · IFBench 38 · LCR 15 · SciCode 20.9 · TB-Hard 3 · HLE 4.8  
Serving — hybrid-swa · KV 6.0 KB/token on 3 of 35 layers + 6 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 67 / 57 / 52 / 67 / 21 (from AA Gemma 4 E2B (Non-reasoning)); thinks ~1500 hidden tokens elsewhere  

Gemma 4 E2B: 5.1B dense on a sliding-window hybrid — 3 of 35 layers keep a growing KV (6 KB per token).

### Gemma 3n E2B Instruct
**Google** · 2025-06 · Gemma · 5.4B dense · 33K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/google/gemma-3n-E2B-it)
Benchmarks — GPQA-D 22.9 · IFBench 22 · LCR 0 · SciCode 5.2 · TB-Hard 0.8 · HLE 4  
Serving — hybrid-swa · KV 8.0 KB/token on 4 of 30 layers + 17 MB/request · BF16 weights (2 B/param) · answers without hidden reasoning  

Gemma 3n E2B Instruct: 5.4B dense on a sliding-window hybrid — 4 of 30 layers keep a growing KV (8 KB per token).

### Gemma 3n E4B Instruct
**Google** · 2025-06 · Gemma · 7.9B dense · 33K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/google/gemma-3n-E4B-it)
Benchmarks — GPQA-D 29.6 · IFBench 27.9 · LCR 0 · SciCode 8.1 · TB-Hard 2.3 · HLE 4.4  
Serving — hybrid-swa · KV 8.0 KB/token on 4 of 35 layers + 17 MB/request · BF16 weights (2 B/param) · answers without hidden reasoning  

Gemma 3n E4B Instruct: 7.9B dense on a sliding-window hybrid — 4 of 35 layers keep a growing KV (8 KB per token).

### Gemma 4 E4B
**Google** · 2026-04 · Apache-2.0 · 8B dense · hybrid reasoning · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/google/gemma-4-E4B-it)
Benchmarks — GPQA-D 57.6 · IFBench 44.2 · LCR 30.7 · SciCode 24.4 · TB-Hard 8.3 · HLE 3.7  
Serving — hybrid-swa · KV 16.0 KB/token on 4 of 42 layers + 21 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 77 / 76 / 28 / 81 / 34 (from AA Gemma 4 E4B (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

Gemma 4 E4B: 8B dense on a sliding-window hybrid — 4 of 42 layers keep a growing KV (16 KB per token).

### Llama 3 Instruct 8B
**Meta** · 2024-04 · Llama 3 Community · 8B dense · 8K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct)
Benchmarks — GPQA-D 29.6 · IFBench 24.6 · LCR 0 · SciCode 11.9 · TB-Hard 0 · HLE 5.1  
Serving — GQA · KV 128.0 KB/token on 32 of 32 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Llama 3 Instruct 8B: 8B dense on full GQA attention (128 KB of KV per token).

### Granite 3.3 8B
**IBM** · 2025-04 · Apache-2.0 · 8.17B dense · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/ibm-granite/granite-3.3-8b-instruct)
Benchmarks — GPQA-D 33.8 · IFBench 22.4 · LCR 4.3 · SciCode 10.1 · TB-Hard 0 · HLE 4.2  
Serving — GQA · KV 160.0 KB/token on 40 of 40 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Granite 3.3 8B: 8.17B dense on full GQA attention (160 KB of KV per token).

### DeepSeek R1 0528 Qwen3 8B
**DeepSeek** · 2025-05 · MIT · 8.19B dense · reasoning · 131K ctx · spec: general · lineage: derived from Qwen3 8B · confidence: high
[model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-0528-Qwen3-8B)
Benchmarks — GPQA-D 61.2 · IFBench 19.9 · LCR 13 · SciCode 20.4 · TB-Hard 1.5 · HLE 5.6  
Serving — GQA · KV 144.0 KB/token on 36 of 36 layers · BF16 weights (2 B/param) · always thinks (no off switch): ~1500 hidden tokens per answer  

DeepSeek R1 0528 Qwen3 8B: 8.19B dense on full GQA attention (144 KB of KV per token).

### LFM2.5-8B-A1B
**Liquid AI** · 2026-05 · LFM Open License v1.0 · 8.3B total / 1.5B active (MoE) · reasoning · 128K ctx · spec: chat · lineage: — · confidence: high
[model card](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B)
Benchmarks — GPQA-D 51.3 · IFBench 55.6 · LCR 0 · SciCode 7.8 · TB-Hard 4.5 · HLE 6.9  
Serving — hybrid-linear · KV 12.0 KB/token on 6 of 24 layers · BF16 weights (2 B/param) · always thinks (no off switch): ~2000 hidden tokens per answer  

LFM2.5-8B-A1B: a 8.3B MoE with 1.5B active on a linear/SSM hybrid — 6 of 24 layers keep KV (12 KB per token).

### LFM2 8B A1B
**Liquid AI** · 2025-10 · LFM Open License v1.0 · 8.3B total / 1.5B active (MoE) · 33K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/LiquidAI/LFM2-8B-A1B)
Benchmarks — GPQA-D 34.4 · IFBench 26.3 · LCR 0 · SciCode 6.8 · TB-Hard 0 · HLE 4.9  
Serving — hybrid-linear · KV 12.0 KB/token on 6 of 24 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

LFM2 8B A1B: a 8.3B MoE with 1.5B active on a linear/SSM hybrid — 6 of 24 layers keep KV (12 KB per token).

### Ministral 3 8B
**Mistral** · 2025-12 · Apache-2.0 · 8.4B dense · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/mistralai/Ministral-3-8B-Instruct-2512)
Benchmarks — GPQA-D 47.1 · IFBench 29.1 · LCR 24 · SciCode 20.8 · TB-Hard 4.5 · HLE 4.3  
Serving — GQA · KV 136.0 KB/token on 34 of 34 layers · FP8 weights (1.17 B/param) · answers without hidden reasoning  

Ministral 3 8B: 8.4B dense on full GQA attention (136 KB of KV per token), released in FP8.

### Granite 4.1 8B
**IBM** · 2026-04 · Apache-2.0 · 8.8B dense · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/ibm-granite/granite-4.1-8b)
Benchmarks — GPQA-D 43.3 · IFBench 38.6 · LCR 12 · SciCode 21.8 · TB-Hard 0 · HLE 3.8  
Serving — GQA · KV 160.0 KB/token on 40 of 40 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Granite 4.1 8B: 8.8B dense on full GQA attention (160 KB of KV per token).

### Granite 4.2 8B ★
**IBM** · 2026-08 · Apache-2.0 · 8.8B dense · hybrid reasoning · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/ibm-granite/granite-4.2-8b)
Benchmarks — GPQA-D 63.1 · IFBench ≈46.7 (bridged) · LCR 40.1 · SciCode 30.5 · TB-Hard ≈14.3 (bridged) · HLE 9.3  
Serving — GQA · KV 160.0 KB/token on 40 of 40 layers · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 76 / 78 / 67 / 85 / 43 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

Granite 4.2 8B: 8.8B dense on full GQA attention (160 KB of KV per token).

### Qwen3.5 9B ★
**Alibaba** · 2026-03 · Apache-2.0 · 9B dense · hybrid reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3.5-9B)
Benchmarks — GPQA-D 80.6 · IFBench 66.7 · LCR 59 · SciCode 27.5 · TB-Hard 24.2 · HLE 13.3  
Serving — hybrid-linear · KV 32.0 KB/token on 8 of 32 layers + 52 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 82 / 87 / 76 / 90 / 57 (from AA Qwen3.5 9B (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

Qwen3.5 9B: 9B dense on a linear/SSM hybrid — 8 of 32 layers keep KV (32 KB per token).

### Gemma 4 12B ★
**Google** · 2026-06 · Apache-2.0 · 12B dense · hybrid reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/google/gemma-4-12B-it)
Benchmarks — GPQA-D 75.3 · IFBench 73.5 · LCR 55.3 · SciCode 38.2 · TB-Hard 18.2 · HLE 14.8  
Serving — hybrid-swa · KV 16.0 KB/token on 8 of 48 layers + 336 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 83 / 84 / 80 / 87 / 48 (from AA Gemma 4 12B (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

Gemma 4 12B: 12B dense on a sliding-window hybrid — 8 of 48 layers keep a growing KV (16 KB per token).

### Ministral 3 14B
**Mistral** · 2025-12 · Apache-2.0 · 13.5B dense · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/mistralai/Ministral-3-14B-Instruct-2512)
Benchmarks — GPQA-D 57.2 · IFBench 32 · LCR 22 · SciCode 23.6 · TB-Hard 4.5 · HLE 4.6  
Serving — GQA · KV 160.0 KB/token on 40 of 40 layers · FP8 weights (1.13 B/param) · answers without hidden reasoning  

Ministral 3 14B: 13.5B dense on full GQA attention (160 KB of KV per token), released in FP8.

### Apriel-v1.6-15B-Thinker ★
**ServiceNow** · 2025-11 · MIT · 15B dense · reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/ServiceNow-AI/Apriel-1.6-15b-Thinker)
Benchmarks — GPQA-D 73.3 · IFBench 69.1 · LCR 50.3 · SciCode 37.3 · TB-Hard 14.4 · HLE 9.8  
Serving — GQA · KV 192.0 KB/token on 48 of 48 layers · BF16 weights (2 B/param) · always thinks (no off switch): ~1500 hidden tokens per answer  

Apriel-v1.6-15B-Thinker: 15B dense on full GQA attention (192 KB of KV per token).

### Apriel-v1.5-15B-Thinker ★
**ServiceNow** · 2025-09 · MIT · 15B dense · reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/ServiceNow-AI/Apriel-1.5-15b-Thinker)
Benchmarks — GPQA-D 71.3 · IFBench 61.7 · LCR 20 · SciCode 34.8 · TB-Hard 10.6 · HLE 12  
Serving — GQA · KV 192.0 KB/token on 48 of 48 layers · BF16 weights (2 B/param) · always thinks (no off switch): ~1500 hidden tokens per answer  

Apriel-v1.5-15B-Thinker: 15B dense on full GQA attention (192 KB of KV per token).

### LFM2 24B A2B
**Liquid AI** · 2026-02 · LFM Open License v1.0 · 24B total / 2.3B active (MoE) · 33K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/LiquidAI/LFM2-24B-A2B)
Benchmarks — GPQA-D 47.4 · IFBench 45.9 · LCR 0 · SciCode 10.9 · TB-Hard 0 · HLE 4.4  
Serving — hybrid-linear · KV 20.0 KB/token on 10 of 40 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

LFM2 24B A2B: a 24B MoE with 2.3B active on a linear/SSM hybrid — 10 of 40 layers keep KV (20 KB per token).

### Gemma 4 26B A4B ★
**Google** · 2026-04 · Apache-2.0 · 25.2B total / 3.8B active (MoE) · hybrid reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/google/gemma-4-26B-A4B-it)
Benchmarks — GPQA-D 79.2 · IFBench 72.4 · LCR 55.7 · SciCode 40 · TB-Hard 13.6 · HLE 18.3  
Serving — hybrid-swa · KV 20.0 KB/token on 5 of 30 layers + 210 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 84 / 86 / 86 / 91 / 68 (from AA Gemma 4 26B A4B (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

Gemma 4 26B A4B: a 25.2B MoE with 3.8B active on a sliding-window hybrid — 5 of 30 layers keep a growing KV (20 KB per token).

### Qwen3.5 27B ★
**Alibaba** · 2026-02 · Apache-2.0 · 27B dense · hybrid reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3.5-27B)
Benchmarks — GPQA-D 85.8 · IFBench 75.6 · LCR 67.3 · SciCode 39.5 · TB-Hard 32.6 · HLE 22.2  
Serving — hybrid-linear · KV 64.0 KB/token on 16 of 64 layers + 154 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 87 / 92 / 87 / 96 / 81 (from AA Qwen3.5 27B (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

Qwen3.5 27B: 27B dense on a linear/SSM hybrid — 16 of 64 layers keep KV (64 KB per token).

### Granite 4.1 30B
**IBM** · 2026-04 · Apache-2.0 · 28.9B dense · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/ibm-granite/granite-4.1-30b)
Benchmarks — GPQA-D 48.1 · IFBench 44.4 · LCR 18.7 · SciCode 25.8 · TB-Hard 2.3 · HLE 4.2  
Serving — GQA · KV 256.0 KB/token on 64 of 64 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Granite 4.1 30B: 28.9B dense on full GQA attention (256 KB of KV per token).

### Granite 4.2 30B
**IBM** · 2026-08 · Apache-2.0 · 29.3B dense · hybrid reasoning · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/ibm-granite/granite-4.2-30b)
Benchmarks — GPQA-D 64.4 · IFBench ≈48.5 (bridged) · LCR 43.8 · SciCode 36.9 · TB-Hard ≈19.6 (bridged) · HLE 10.7  
Serving — GQA · KV 256.0 KB/token on 64 of 64 layers · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 77 / 80 / 78 / 86 / 50 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

Granite 4.2 30B: 29.3B dense on full GQA attention (256 KB of KV per token).

### Muse Glimmer ★
**Meta** · 2026-08 · Apache-2.0 · 29.8B dense · reasoning · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/meta-models/Muse-Glimmer-30B)
Benchmarks — GPQA-D 83.5 · IFBench ≈65 (bridged) · LCR 74.9 · SciCode 44 · TB-Hard ≈35.4 (bridged) · HLE 20.7  
Serving — hybrid-swa · KV 13.0 KB/token on 13 of 52 layers + 82 MB/request · BF16 weights (2 B/param) · always thinks (reasoning strength (low / medium / high / xhigh)): ~2000 hidden tokens per answer  

Muse Glimmer: 29.8B dense on a sliding-window hybrid — 13 of 52 layers keep a growing KV (13 KB per token).

### Gemma 4 31B ★
**Google** · 2026-04 · Apache-2.0 · 30.7B dense · hybrid reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/google/gemma-4-31B-it)
Benchmarks — GPQA-D 85.7 · IFBench 75.6 · LCR 62 · SciCode 43.4 · TB-Hard 36.4 · HLE 22.7  
Serving — hybrid-swa · KV 80.0 KB/token on 10 of 60 layers + 839 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 86 / 88 / 89 / 91 / 75 (from AA Gemma 4 31B (Non-reasoning)); thinks ~1736 hidden tokens elsewhere  

Gemma 4 31B: 30.7B dense on a sliding-window hybrid — 10 of 60 layers keep a growing KV (80 KB per token).

### Nemotron Cascade 2 30B A3B ★
**NVIDIA** · 2026-03 · NVIDIA Open Model License · 31.6B total / 3.2B active (MoE) · hybrid reasoning · 262K ctx · spec: chat · lineage: — · confidence: high
[model card](https://huggingface.co/nvidia/Nemotron-Cascade-2-30B-A3B)
Benchmarks — GPQA-D 75.8 · IFBench 80.4 · LCR 34 · SciCode 34.8 · TB-Hard 21.2 · HLE 11.4  
Serving — hybrid-linear · KV 6.0 KB/token on 6 of 52 layers + 49 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 83 / 83 / 81 / 86 / 54 (from the thinking→instant pair fit); thinks ~1500 hidden tokens elsewhere  

Nemotron Cascade 2 30B A3B: a 31.6B MoE with 3.2B active on a linear/SSM hybrid — 6 of 52 layers keep KV (6 KB per token).

### Nemotron 3.5 Lightning
**NVIDIA** · 2026-08 · OpenMDW-1.1 · 31.6B total / 3.2B active (MoE) · hybrid reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16)
Benchmarks — GPQA-D 74.3 · IFBench ≈53.2 (bridged) · LCR 54 · SciCode 31.1 · TB-Hard ≈17.4 (bridged) · HLE 10.2  
Serving — hybrid-linear · KV 6.0 KB/token on 6 of 52 layers + 49 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 81 / 83 / 71 / 88 / 52 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

Nemotron 3.5 Lightning: a 31.6B MoE with 3.2B active on a linear/SSM hybrid — 6 of 52 layers keep KV (6 KB per token).

### EXAONE 4.0 32B
**LG AI Research** · 2025-07 · EXAONE AI Model License · 32B dense · hybrid reasoning · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/LGAI-EXAONE/EXAONE-4.0-32B)
Benchmarks — GPQA-D 73.9 · IFBench 36.3 · LCR 14 · SciCode 34.4 · TB-Hard 3.8 · HLE 10.5  
Serving — hybrid-swa · KV 64.0 KB/token on 16 of 64 layers + 805 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 72 / 78 / 60 / 80 / 17 (from AA EXAONE 4.0 32B (Non-reasoning)); thinks ~1500 hidden tokens elsewhere  

EXAONE 4.0 32B: 32B dense on a sliding-window hybrid — 16 of 64 layers keep a growing KV (64 KB per token).

### EXAONE 4.5 33B
**LG AI Research** · 2026-04 · EXAONE AI Model License · 33B dense · hybrid reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/LGAI-EXAONE/EXAONE-4.5-33B)
Benchmarks — GPQA-D 79.4 · IFBench 58 · LCR 49.3 · SciCode 28 · TB-Hard 20.5 · HLE 11.6  
Serving — hybrid-swa · KV 64.0 KB/token on 16 of 64 layers + 805 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 82 / 85 / 69 / 88 / 54 (from the thinking→instant pair fit); thinks ~1500 hidden tokens elsewhere  

EXAONE 4.5 33B: 33B dense on a sliding-window hybrid — 16 of 64 layers keep a growing KV (64 KB per token).

### Qwen3.5 35B A3B ★
**Alibaba** · 2026-02 · Apache-2.0 · 35B total / 3B active (MoE) · hybrid reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3.5-35B-A3B)
Benchmarks — GPQA-D 84.5 · IFBench 72.5 · LCR 62.7 · SciCode 37.7 · TB-Hard 26.5 · HLE 19.7  
Serving — hybrid-linear · KV 20.0 KB/token on 10 of 40 layers + 64 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 86 / 91 / 79 / 95 / 57 (from AA Qwen3.5 35B A3B (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

Qwen3.5 35B A3B: a 35B MoE with 3B active on a linear/SSM hybrid — 10 of 40 layers keep KV (20 KB per token).

### Qwen3.6 35B A3B ★
**Alibaba** · 2026-04 · Apache-2.0 · 35B total / 3B active (MoE) · hybrid reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B)
Benchmarks — GPQA-D 84.1 · IFBench 64.4 · LCR 63.7 · SciCode 35.8 · TB-Hard 34.8 · HLE 20.2  
Serving — hybrid-linear · KV 20.0 KB/token on 10 of 40 layers + 64 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 84 / 90 / 32 / 95 / 72 (from AA Qwen3.6 35B A3B (Non-reasoning)); thinks ~4000 hidden tokens elsewhere  

Qwen3.6 35B A3B: a 35B MoE with 3B active on a linear/SSM hybrid — 10 of 40 layers keep KV (20 KB per token).

### G9v3-39A5B
**AI9Stars** · 2026-08 · Apache-2.0 · 39B total / 5B active (MoE) · hybrid reasoning · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/ai9stars/G9v3-39A5B)
Benchmarks — GPQA-D 80.5 · IFBench ≈58.8 (bridged) · LCR 58.6 · SciCode 35.9 · TB-Hard ≈24.1 (bridged) · HLE 16.6  
Serving — GQA · KV 38.0 KB/token on 38 of 38 layers · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 83 / 85 / 80 / 90 / 61 (from the thinking→instant pair fit); thinks ~1500 hidden tokens elsewhere  

G9v3-39A5B: a 39B MoE with 5B active on full GQA attention (38 KB of KV per token).

### Llama Nemotron Super 49B v1.5
**NVIDIA** · 2025-07 · NVIDIA Open Model License · 49B dense · hybrid reasoning · 131K ctx · spec: general · lineage: derived from Llama 3.3 70B Instruct · confidence: high
[model card](https://huggingface.co/nvidia/Llama-3_3-Nemotron-Super-49B-v1_5)
Benchmarks — GPQA-D 74.8 · IFBench 37 · LCR 34 · SciCode 34.8 · TB-Hard 5.3 · HLE 6.8  
Serving — GQA · KV 196.0 KB/token on 49 of 80 layers · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False (or /no_think)): instant on interactive traffic, judged 71 / 70 / 58 / 78 / 27 (from AA Llama Nemotron Super 49B v1.5 (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

Llama Nemotron Super 49B v1.5: 49B dense on full GQA attention (196 KB of KV per token).

### Hermes 4 - Llama-3.1 70B
**Nous Research** · 2025-08 · Llama 3 Community · 70B dense · hybrid reasoning · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/NousResearch/Hermes-4-70B)
Benchmarks — GPQA-D 69.9 · IFBench 31.3 · LCR 6.7 · SciCode 34.1 · TB-Hard 4.5 · HLE 7.9  
Serving — GQA · KV 320.0 KB/token on 80 of 80 layers · BF16 weights (2 B/param) · hybrid thinking (thinking=False): instant on interactive traffic, judged 56 / 61 / 61 / 57 / 9 (from AA Hermes 4 - Llama-3.1 70B (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

Hermes 4 - Llama-3.1 70B: 70B dense on full GQA attention (320 KB of KV per token).

### Llama 3.1 Nemotron Instruct 70B
**NVIDIA** · 2024-10 · Llama 3.1 Community · 70B dense · 131K ctx · spec: general · lineage: derived from Llama 3.1 Instruct 70B · confidence: high
[model card](https://huggingface.co/nvidia/Llama-3.1-Nemotron-70B-Instruct-HF)
Benchmarks — GPQA-D 46.5 · IFBench 30.7 · LCR 7 · SciCode 23.3 · TB-Hard 4.5 · HLE 4.6  
Serving — GQA · KV 320.0 KB/token on 80 of 80 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Llama 3.1 Nemotron Instruct 70B: 70B dense on full GQA attention (320 KB of KV per token).

### Llama 3.1 Instruct 70B
**Meta** · 2024-07 · Llama 3.1 Community · 70B dense · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/meta-llama/Llama-3.1-70B-Instruct)
Benchmarks — GPQA-D 40.9 · IFBench 34.4 · LCR 6.3 · SciCode 26.7 · TB-Hard 3 · HLE 4.6  
Serving — GQA · KV 320.0 KB/token on 80 of 80 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Llama 3.1 Instruct 70B: 70B dense on full GQA attention (320 KB of KV per token).

### Llama 3 Instruct 70B
**Meta** · 2024-04 · Llama 3 Community · 70B dense · 8K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/meta-llama/Meta-Llama-3-70B-Instruct)
Benchmarks — GPQA-D 37.9 · IFBench 37.1 · LCR 0 · SciCode 18.9 · TB-Hard 0.8 · HLE 4.4  
Serving — GQA · KV 320.0 KB/token on 80 of 80 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Llama 3 Instruct 70B: 70B dense on full GQA attention (320 KB of KV per token).

### Qwen2.5 Instruct 72B
**Alibaba** · 2024-09 · Qwen License · 72.7B dense · 33K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/Qwen/Qwen2.5-72B-Instruct)
Benchmarks — GPQA-D 49.1 · IFBench 36.9 · LCR 20.3 · SciCode 26.7 · TB-Hard 4.5 · HLE 4.2  
Serving — GQA · KV 320.0 KB/token on 80 of 80 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Qwen2.5 Instruct 72B: 72.7B dense on full GQA attention (320 KB of KV per token).

### Nemotron 3.5 Bolt 74B-A9B
**NVIDIA** · 2026-10 · OpenMDW-1.1 · 74.9B total / 9B active (MoE) · hybrid reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-74B-A9B-BF16)
Benchmarks — GPQA-D ≈78.8 (bridged) · IFBench ≈62.4 (bridged) · LCR 62.5 · SciCode 38.8 · TB-Hard ≈36.1 (bridged) · HLE 23.2  
Serving — hybrid-linear · KV 8.0 KB/token on 8 of 88 layers + 170 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 83 / 85 / 83 / 91 / 73 (from the thinking→instant pair fit); thinks ~1500 hidden tokens elsewhere  

Nemotron 3.5 Bolt 74B-A9B: a 74.9B MoE with 9B active on a linear/SSM hybrid — 8 of 88 layers keep KV (8 KB per token).

### Solar Open 100B
**Upstage** · 2025-12 · Upstage Solar License · 102.6B total / 12B active (MoE) · hybrid reasoning · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/upstage/Solar-Open-100B)
Benchmarks — GPQA-D 65.7 · IFBench 57.7 · LCR 36 · SciCode 26.9 · TB-Hard 2.3 · HLE 9.2  
Serving — GQA · KV 192.0 KB/token on 48 of 48 layers · BF16 weights (2 B/param) · hybrid thinking (reasoning_effort="low"): instant on interactive traffic, judged 79 / 80 / 60 / 85 / 29 (from the thinking→instant pair fit); thinks ~1500 hidden tokens elsewhere  

Solar Open 100B: a 102.6B MoE with 12B active on full GQA attention (192 KB of KV per token).

### ERNIE 4.5 300B A47B
**Baidu** · 2025-06 · Apache-2.0 · 300B total / 47B active (MoE) · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/baidu/ERNIE-4.5-300B-A47B-PT)
Benchmarks — GPQA-D 81.1 · IFBench 39.1 · LCR 2.3 · SciCode 31.5 · TB-Hard 6.1 · HLE 3.5  
Serving — GQA · KV 216.0 KB/token on 54 of 54 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

ERNIE 4.5 300B A47B: a 300B MoE with 47B active on full GQA attention (216 KB of KV per token).

### Nex-N2-Pro ★
**Nex AGI** · 2026-06 · Apache-2.0 · 397B total / 17B active (MoE) · hybrid reasoning · 262K ctx · spec: general · lineage: derived from Qwen3.5-397B-A17B · confidence: high
[model card](https://huggingface.co/nex-agi/Nex-N2-Pro)
Benchmarks — GPQA-D 89.2 · IFBench 66.2 · LCR 73.4 · SciCode 42.4 · TB-Hard ≈46.1 (bridged) · HLE 31.6  
Serving — hybrid-linear · KV 30.0 KB/token on 15 of 60 layers + 192 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 85 / 89 / 86 / 94 / 84 (from the thinking→instant pair fit); thinks ~1500 hidden tokens elsewhere  

Nex-N2-Pro: a 397B MoE with 17B active on a linear/SSM hybrid — 15 of 60 layers keep KV (30 KB per token).

### Hermes 4 - Llama-3.1 405B
**Nous Research** · 2025-08 · Llama 3 Community · 405B dense · hybrid reasoning · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/NousResearch/Hermes-4-405B)
Benchmarks — GPQA-D 72.7 · IFBench 32.7 · LCR 20.7 · SciCode 25.2 · TB-Hard 11.4 · HLE 10.3  
Serving — GQA · KV 504.0 KB/token on 126 of 126 layers · BF16 weights (2 B/param) · hybrid thinking (thinking=False): instant on interactive traffic, judged 73 / 74 / 80 / 80 / 36 (from AA Hermes 4 - Llama-3.1 405B (Non-reasoning)); thinks ~2000 hidden tokens elsewhere  

Hermes 4 - Llama-3.1 405B: 405B dense on full GQA attention (504 KB of KV per token).

### Llama 3.1 Instruct 405B
**Meta** · 2024-07 · Llama 3.1 Community · 405B dense · 131K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/meta-llama/Llama-3.1-405B-Instruct)
Benchmarks — GPQA-D 51.5 · IFBench 39 · LCR 24.3 · SciCode 29.9 · TB-Hard 6.8 · HLE 4.2  
Serving — GQA · KV 504.0 KB/token on 126 of 126 layers · BF16 weights (2 B/param) · answers without hidden reasoning  

Llama 3.1 Instruct 405B: 405B dense on full GQA attention (504 KB of KV per token).

### A.X-K2
**SK Telecom** · 2026-08 · Apache-2.0 · 688B total / 33B active (MoE) · hybrid reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/skt/A.X-K2)
Benchmarks — GPQA-D 85.7 · IFBench ≈66 (bridged) · LCR 62.8 · SciCode 40.1 · TB-Hard ≈31.6 (bridged) · HLE 27.8  
Serving — MLA · KV 83.9 KB/token on 61 of 61 layers · FP8 weights (1 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 84 / 87 / 83 / 92 / 70 (from the thinking→instant pair fit); thinks ~1500 hidden tokens elsewhere  

A.X-K2: a 688B MoE with 33B active on MLA latent attention (84 KB of KV per token), released in FP8.

### K-EXAONE 2.0 0803
**LG AI Research** · 2026-08 · Apache-2.0 · 750B total / 37B active (MoE) · hybrid reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/LGAI-EXAONE/K-EXAONE-2.0-750B-A37B)
Benchmarks — GPQA-D 82.9 · IFBench ≈58.8 (bridged) · LCR 53.7 · SciCode 41.1 · TB-Hard ≈28.9 (bridged) · HLE 17.6  
Serving — hybrid-swa · KV 80.0 KB/token on 20 of 78 layers + 47 MB/request · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False): instant on interactive traffic, judged 83 / 86 / 83 / 90 / 64 (from the thinking→instant pair fit); thinks ~1500 hidden tokens elsewhere  

K-EXAONE 2.0 0803: a 750B MoE with 37B active on a sliding-window hybrid — 20 of 78 layers keep a growing KV (80 KB per token).

### Inkling
**Thinking Machines** · 2026-07 · Apache-2.0 · 975B total / 41B active (MoE) · hybrid reasoning · 1049K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/thinkingmachines/Inkling)
Benchmarks — GPQA-D 87.2 · IFBench ≈68.9 (bridged) · LCR 69.4 · SciCode 46.1 · TB-Hard ≈40.6 (bridged) · HLE 29.9  
Serving — hybrid-swa · KV 44.0 KB/token on 11 of 66 layers + 233 MB/request · BF16 weights (2 B/param) · hybrid thinking (reasoning_effort="none" (effort 0)): instant on interactive traffic, judged 85 / 88 / 87 / 93 / 79 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

Inkling: a 975B MoE with 41B active on a sliding-window hybrid — 11 of 66 layers keep a growing KV (44 KB per token).

### LongCat 2.0
**LongCat** · 2026-06 · MIT · 1600B total / 48B active (MoE) · hybrid reasoning · 262K ctx · spec: general · lineage: — · confidence: medium
[model card](https://huggingface.co/meituan-longcat/LongCat-2.0)
Benchmarks — GPQA-D 78 · IFBench ≈64.6 (bridged) · LCR 58.3 · SciCode 35.3 · TB-Hard ≈37.1 (bridged) · HLE 31.6  
Serving — MLA · KV 95.0 KB/token on 76 of 76 layers · BF16 weights (2 B/param) · hybrid thinking (enable_thinking=False (/think_off)): instant on interactive traffic, judged 83 / 85 / 82 / 91 / 73 (from the thinking→instant pair fit); thinks ~2000 hidden tokens elsewhere  

LongCat 2.0: a 1600B MoE with 48B active on MLA latent attention (95 KB of KV per token).

### Qwen3.8 2.4T A95B ★
**Alibaba** · 2026-08 · Qwen3.8 Max License · 2446B total / 95B active (MoE) · reasoning · 262K ctx · spec: general · lineage: — · confidence: high
[model card](https://huggingface.co/Qwen/Qwen3.8-2.4T-A95B)
Benchmarks — GPQA-D 93.5 · IFBench ≈75.5 (bridged) · LCR 72.1 · SciCode 53.3 · TB-Hard ≈57.1 (bridged) · HLE 39.7  
Serving — hybrid-linear · KV 92.0 KB/token on 23 of 92 layers + 587 MB/request · BF16 weights (2 B/param) · always thinks (reasoning_effort (xhigh / medium / low)): ~2000 hidden tokens per answer  

Qwen3.8 2.4T A95B: a 2446B MoE with 95B active on a linear/SSM hybrid — 23 of 92 layers keep KV (92 KB per token).

<!-- /generated:pool -->
