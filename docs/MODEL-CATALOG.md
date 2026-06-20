# GPTD Model Catalog — real open-weight LLMs

> New here? GPTD is a tower-defense game simulating an LLM-inference data center — start with the README; this file is the model-roster reference.

The fact-checked source-of-truth list behind the in-game roster. Every model is a REAL
open-weight release; the in-game `ROSTER` (`src/sim/content.ts`) draws its picks from here
and `qualityBy` is calibrated from these benchmarks (`calibrate.ts`) — never hand-written.

<!-- Contributor reference (not player-facing):

How to maintain: when a notable open model ships, add it here first (developer · release ·
license · params · context · official link · lineage · the 5 benchmarks + the Artificial
Analysis Intelligence Index · a 3–4 sentence description · a confidence flag), THEN decide
whether it earns a roster slot. Put `—` for any benchmark you cannot verify; mark
`confidence: low` rather than guessing. Re-run the `gptd-model-catalog` + `gptd-newest-models`
research workflows to refresh from Artificial Analysis + Hugging Face model cards.

Inventory:
- 130 models catalogued · 46 flagged as roster picks (★).
- Confidence: 93 high · 34 med · 3 low.
- Includes the 2026 frontier wave (GLM-5.2, DeepSeek-V4, Kimi K2.6/K2.7, MiniMax M3, Xiaomi MiMo, Qwen3.5/3.6, Tencent Hunyuan Hy3, Nemotron 3).
-->


## Edge (≤4B total) — 20 models

### SmolLM2-135M-Instruct ★
**HuggingFace** · 2024-11 · Apache 2.0 · 0.135B dense · 8K ctx · spec: chat · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Smallest fully-open SmolLM2 model from HuggingFace, a 135M dense decoder trained from scratch on ~2T curated tokens for ultra-lightweight on-device rewriting and summarization. Too small to register on hard reasoning benchmarks; valued as a transparent edge baseline.

### SmolLM2-360M-Instruct
**HuggingFace** · 2024-11 · Apache 2.0 · 0.36B dense · 8K ctx · spec: chat · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

A 360M fully-open HuggingFace model trained from scratch on ~4T tokens, offering noticeably better instruction following than the 135M while still running on CPUs and phones. Non-reasoning chat model with documented data and training code.

### Qwen3-0.6B ★
**Alibaba/Qwen** · 2025-04 · Apache 2.0 · 0.6B dense · reasoning · 32K ctx · spec: general · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/Qwen/Qwen3-0.6B)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Smallest dense model in Alibaba's Qwen3 family, notable for still carrying the hybrid thinking/non-thinking switch at 0.6B. Targets extreme edge deployment, draft/speculative decoding and browser inference; 32K context. Per-model post-training benchmarks were not cleanly published.

### Gemma 3 1B
**Google** · 2025-03 · Gemma · 1B dense · 32K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/google/gemma-3-1b-it)  
Benchmarks — MMLU-Pro 14.7 · GPQA-D 19.2 · AIME — · LiveCodeBench 1.9 · SWE-bench —  

Smallest, text-only member of Google's Gemma 3 family, a 1B dense decoder trained from scratch with a Gemini-derived recipe and 32K context. Tuned for efficient on-device chat with improved math over Llama-3.2-1B. Non-reasoning edge model.

### Llama 3.2 1B Instruct ★
**Meta** · 2024-09 · Llama 3.2 Community License · 1.23B dense · 128K ctx · spec: chat · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/meta-llama/Llama-3.2-1B-Instruct)  
Benchmarks — MMLU-Pro — · GPQA-D 27.2 · AIME — · LiveCodeBench — · SWE-bench —  

Meta's smallest text-only Llama 3.2 model, a 1.23B dense decoder produced via pruning and distillation from Llama 3.1 with a 128K context. Targets on-device summarization, rewriting and tool use; non-reasoning with modest benchmarks (MMLU 49.3, GPQA 27.2).

### Qwen3-1.7B
**Alibaba/Qwen** · 2025-04 · Apache 2.0 · 1.7B dense · reasoning · 32K ctx · spec: reasoning · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/Qwen/Qwen3-1.7B)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

A 1.7B dense Qwen3 model (GQA, 28 layers) with the hybrid reasoning switch, roughly matching the older Qwen2.5-3B base. In thinking mode it is benchmarked against DeepSeek-R1-Distill-Qwen-1.5B; 32K context, tool-calling, 100+ languages. Per-size scores not published.

### SmolLM2-1.7B-Instruct
**HuggingFace** · 2024-11 · Apache 2.0 · 1.7B dense · 8K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct)  
Benchmarks — MMLU-Pro 19.3 · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Flagship of HuggingFace's SmolLM2 family, a 1.7B dense decoder trained from scratch on ~11T tokens with SFT+DPO. Beat Qwen2.5-1.5B and Llama-3.2-1B on several tasks at its era; non-reasoning chat with a short 8K context. Fully open with reproducible data.

### Granite 3.3 2B Instruct
**IBM** · 2025-04 · Apache 2.0 · 2B dense · reasoning · 128K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/ibm-granite/granite-3.3-2b-instruct)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME 3.3 · LiveCodeBench — · SWE-bench —  

IBM's 2B dense enterprise model with optional structured reasoning via think/response tags and a 128K context. Tuned for reliable instruction following, RAG, coding and tool use rather than competition math (MMLU 55.9, HumanEval 80.5). Apache 2.0 with enterprise governance.

### Gemma 2 2B
**Google** · 2024-07 · Gemma · 2.6B dense · 8K ctx · spec: general · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/google/gemma-2-2b-it)  
Benchmarks — MMLU-Pro — · GPQA-D 12.5 · AIME — · LiveCodeBench — · SWE-bench —  

Smallest Gemma 2 model, a 2.6B dense decoder trained from scratch via distillation from a larger teacher, using interleaved local/global attention and logit soft-capping with 8K context. Punches above its weight for on-device chat. Non-reasoning.

### Granite 4.0 Micro
**IBM** · 2025-10 · Apache 2.0 · 3B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/ibm-granite/granite-4.0-micro)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Smallest dense model in IBM's Granite 4.0 family, a ~3B all-transformer model for edge and high-throughput enterprise deployment with 128K context. The non-hybrid counterpart to Micro-H, positioned for fast, low-memory agentic and tool-calling tasks. Apache 2.0.

### SmolLM3-3B ★
**HuggingFace** · 2025-07 · Apache 2.0 · 3B dense · reasoning · 128K ctx · spec: reasoning · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/HuggingFaceTB/SmolLM3-3B)  
Benchmarks — MMLU-Pro — · GPQA-D 41.7 · AIME 36.7 · LiveCodeBench 30 · SWE-bench —  

HuggingFace's 3B dense decoder (GQA + NoPE) trained from scratch on 11.2T tokens, the most genuinely open model at 3B with full data and pipeline. Dual-mode reasoner (/think, /no_think), multilingual, 64K context extensible to 128K. With thinking: GPQA 41.7, AIME-2025 36.7, LiveCodeBench 30.

### Llama 3.2 3B Instruct
**Meta** · 2024-09 · Llama 3.2 Community License · 3.21B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct)  
Benchmarks — MMLU-Pro — · GPQA-D 32.8 · AIME — · LiveCodeBench — · SWE-bench —  

Meta's 3.21B text-only Llama 3.2 model, distilled and pruned from Llama 3.1, with a 128K context and strong on-device instruction following (MMLU 63.4, GPQA 32.8). Widely used small baseline for summarization and rewriting; non-reasoning.

### Phi-3.5-mini-instruct
**Microsoft** · 2024-08 · MIT · 3.8B dense · 128K ctx · spec: general · lineage: derived from Phi-3-mini · confidence: high  
[model card](https://huggingface.co/microsoft/Phi-3.5-mini-instruct)  
Benchmarks — MMLU-Pro 47.4 · GPQA-D 30.4 · AIME — · LiveCodeBench — · SWE-bench —  

Microsoft's refresh of Phi-3-mini, a 3.8B dense decoder with 128K context and enhanced multilingual and long-context training. Improves multilingual understanding and reasoning over its predecessor while keeping the compact size. Non-reasoning general instruct model.

### Phi-3-mini-128k-instruct
**Microsoft** · 2024-06 · MIT · 3.8B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/microsoft/Phi-3-mini-128k-instruct)  
Benchmarks — MMLU-Pro 43.9 · GPQA-D 29.7 · AIME — · LiveCodeBench — · SWE-bench —  

Microsoft's smallest Phi-3 model, a 3.8B dense decoder trained from scratch on ~4.9T tokens of filtered web and synthetic textbook-quality data, with 4K and 128K context variants. Delivered MMLU/reasoning scores rivaling larger models via the Phi data-quality philosophy.

### Phi-4-mini-instruct
**Microsoft** · 2025-02 · MIT · 3.8B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/microsoft/Phi-4-mini-instruct)  
Benchmarks — MMLU-Pro 52.8 · GPQA-D 33.1 · AIME — · LiveCodeBench — · SWE-bench —  

Microsoft's 3.8B dense model trained from scratch on heavily curated and synthetic data, the successor to Phi-3.5-mini, with 128K context, GQA and shared embeddings. Matches some 8B models on reasoning and math (MMLU 73, MMLU-Pro 52.8, GPQA 33.1). Non-reasoning, MIT-licensed.

### Phi-4-mini-reasoning ★
**Microsoft** · 2025-04 · MIT · 3.8B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Phi-4-mini-instruct · confidence: high  
[model card](https://huggingface.co/microsoft/Phi-4-mini-reasoning)  
Benchmarks — MMLU-Pro — · GPQA-D 52 · AIME 57.5 · LiveCodeBench — · SWE-bench —  

Microsoft's math-focused 3.8B reasoning model, fine-tuned from Phi-4-mini on ~150B tokens of synthetic chain-of-thought distilled from DeepSeek-R1. Scores exceptionally for its size (AIME-2024 57.5, MATH-500 94.6, GPQA 52). Always reasons step-by-step; 128K context, MIT.

### NVIDIA Nemotron 3 Nano 4B
**NVIDIA** · 2026-03 · NVIDIA Nemotron Open Model License · 3.97B dense · reasoning · 262K ctx · spec: reasoning · lineage: derived from NVIDIA-Nemotron-Nano-9B-v2 (compressed via Nemotron Elastic framework) · confidence: med  
[model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16)  
Benchmarks — MMLU-Pro — · GPQA-D 53.2 · AIME 78.5 · LiveCodeBench — · SWE-bench —  

Nemotron 3 Nano 4B is the edge-class member of the family, a ~3.97B-parameter dense Mamba2-Transformer hybrid (primarily Mamba-2 and MLP layers with just four Attention layers, so not MoE) released March 2026 under the NVIDIA Nemotron Open Model License. Unlike the from-scratch Ultra/Super/30B tiers, this 4B is derived: it is compressed from NVIDIA-Nemotron-Nano-9B-v2 using NVIDIA's Nemotron Elastic framework. It is a unified reasoning/non-reasoning model with controllable reasoning via system prompts and a 262K-token context window. Reported model-card scores include AIME25 78.5 and GPQA 53.2; MMLU-Pro, LiveCodeBench, and SWE-bench Verified are not published on the card, so they carry no published score.

### Qwen3-4B
**Alibaba/Qwen** · 2025-04 · Apache 2.0 · 4B dense · reasoning · 32K ctx · spec: reasoning · lineage: from-scratch · confidence: low  
[model card](https://huggingface.co/Qwen/Qwen3-4B)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Compact dense model from the original Qwen3 launch with hybrid thinking/non-thinking inference; the 4B base rivaled the larger Qwen2.5-7B base on over half of benchmarks. Native 32K context. Superseded by the 256K-context Qwen3-4B-2507 refreshes.

### Qwen3-4B-Instruct-2507 ★
**Alibaba/Qwen** · 2025-07 · Apache 2.0 · 4B dense · 262K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507)  
Benchmarks — MMLU-Pro 69.6 · GPQA-D 62 · AIME 47.4 · LiveCodeBench 35.1 · SWE-bench —  

Updated non-thinking 4B dense Qwen3 with a native 256K context. Posts remarkably strong non-reasoning scores for its size (MMLU-Pro 69.6, GPQA 62, AIME-2025 47.4, LiveCodeBench 35.1), rivaling larger prior-gen models. The canonical general-purpose edge model with tool-calling.

### Qwen3-4B-Thinking-2507 ★
**Alibaba/Qwen** · 2025-07 · Apache 2.0 · 4B dense · reasoning · 262K ctx · spec: reasoning · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/Qwen/Qwen3-4B-Thinking-2507)  
Benchmarks — MMLU-Pro 74 · GPQA-D 65.8 · AIME 81.3 · LiveCodeBench 55.2 · SWE-bench —  

Dedicated-reasoning 4B Qwen3 refresh with extended chain-of-thought and a native 256K context, one of the strongest small reasoners available (MMLU-Pro 74, GPQA 65.8, AIME-2025 81.3, LiveCodeBench 55.2). Targets math/code/agentic use on edge-class hardware.


## Small (4–15B) — 30 models

### Gemma 3 4B
**Google** · 2025-03 · Gemma · 4.3B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/google/gemma-3-4b-it)  
Benchmarks — MMLU-Pro 43.6 · GPQA-D 30.8 · AIME — · LiveCodeBench 12.6 · SWE-bench —  

Google's 4B multimodal (image+text) Gemma 3 model pairing a SigLIP encoder with a 128K-context decoder, competitive with the older Gemma 2 27B. Supports 140+ languages and function calling. Non-reasoning, targeting efficient multimodal edge assistants.

### Gemma 3n E2B
**Google** · 2025-06 · Gemma · 5B dense · 32K ctx · spec: general · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/google/gemma-3n-E2B-it)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Smaller of Google's mobile-first multimodal Gemma 3n models, built on the MatFormer architecture with Per-Layer Embeddings to cut memory; ~5B raw params with a ~2B effective footprint via selective activation. Accepts text, image, audio and video. Targets real-time on-device multimodal AI.

### Phi-3-small-128k-instruct
**Microsoft** · 2024-05 · MIT · 7B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/microsoft/Phi-3-small-128k-instruct)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

The 7B member of Microsoft's Phi-3 family, a dense decoder using alternating dense and blocksparse attention, trained from scratch on ~4.8T tokens with a 100K vocab and 128K context option. Scored ~75.5 MMLU. Non-reasoning general instruct model.

### Llama 2 7B Chat
**Meta** · 2023-07 · Llama 2 Community License · 7B dense · 4K ctx · spec: chat · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/meta-llama/Llama-2-7b-chat-hf)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Meta's smallest Llama 2 chat model, pretrained on ~2T tokens with a 4K context and RLHF. A landmark permissively-licensed open model in 2023 that seeded a huge fine-tune ecosystem, but weak by modern standards (MMLU ~45-48). Historically important rather than competitive.

### OLMo 2 7B Instruct
**Allen AI** · 2024-11 · Apache 2.0 · 7B dense · 4K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/allenai/OLMo-2-1124-7B-Instruct)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Fully-open dense model from Allen AI, pretrained from scratch and post-trained with the Tulu 3 recipe (SFT, DPO, RLVR), 4K context. Notable for releasing weights, data, code, recipes and thousands of checkpoints (MMLU ~63). A reference for open science. Non-reasoning.

### Granite 4.0 H Tiny
**IBM** · 2025-10 · Apache 2.0 · 7B total / 1B active (MoE) · 128K ctx · spec: agentic · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/ibm-granite/granite-4.0-h-tiny)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Small hybrid MoE in IBM's Granite 4.0 family, ~7B total / ~1B active across fine-grained experts plus shared experts, using a 9:1 Mamba-2-to-transformer hybrid with no positional encodings. Very low memory and fast long-context inference for edge agentic and tool-calling workloads. Apache 2.0.

### DeepSeek-R1-Distill-Qwen-7B
**DeepSeek** · 2025-01 · MIT (weights) / Apache 2.0 base · 7B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Qwen2.5-Math-7B · confidence: high  
[model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B)  
Benchmarks — MMLU-Pro — · GPQA-D 49.1 · AIME 55.5 · LiveCodeBench 37.6 · SWE-bench —  

Dense 7B reasoning model distilled from DeepSeek-R1 onto Qwen2.5-Math-7B, delivering strong math and coding reasoning far above its base (AIME-2024 55.5, GPQA 49.1). Inherits R1's long chain-of-thought style; 128K context.

### Mistral-7B-Instruct-v0.3
**Mistral AI** · 2024-05 · Apache 2.0 · 7.2B dense · 32K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Final instruct refresh of the 7B dense transformer that launched Mistral AI, adding a 32K vocab, v3 tokenizer and function calling. Popularized sliding-window/grouped-query attention and became a widely fine-tuned open base; 32K context. Non-reasoning.

### Qwen2.5-7B-Instruct
**Alibaba/Qwen** · 2024-09 · Apache 2.0 · 7.6B dense · 131K ctx · spec: general · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct)  
Benchmarks — MMLU-Pro 56.3 · GPQA-D 36.4 · AIME — · LiveCodeBench — · SWE-bench —  

The popular small-but-capable dense model of the Qwen2.5 generation, 7.6B params with a 131K context, widely adopted as a fine-tune base and for edge deployment. Non-reasoning general instruct model with strong multilingual and instruction-following ability.

### Ministral-8B-Instruct-2410
**Mistral AI** · 2024-10 · Mistral Research License · 8B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/mistralai/Ministral-8B-Instruct-2410)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Edge/on-device dense model from 'Les Ministraux' with interleaved sliding-window attention and a 128K context, strong reasoning, function calling and multilingual ability for its size (MMLU 65, HumanEval 76.8). Mistral Research License.

### Llama 3 8B Instruct
**Meta** · 2024-04 · Llama 3 Community License · 8B dense · 8K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct)  
Benchmarks — MMLU-Pro — · GPQA-D 34.2 · AIME — · LiveCodeBench — · SWE-bench —  

Meta's third-generation small dense model, pretrained on 15T+ tokens with an 8K context and a 128K-token tokenizer. Dramatically improved on Llama 2 7B/13B (MMLU ~68, GPQA ~34). One of the most widely deployed open small models of 2024.

### DeepSeek-R1-Distill-Llama-8B
**DeepSeek** · 2025-01 · MIT (weights) / Llama 3.1 Community (base) · 8B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Llama-3.1-8B · confidence: high  
[model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Llama-8B)  
Benchmarks — MMLU-Pro — · GPQA-D 49 · AIME 50.4 · LiveCodeBench 39.6 · SWE-bench —  

Dense 8B reasoning model distilling DeepSeek-R1's long chain-of-thought onto Meta's Llama-3.1-8B base (AIME-2024 50.4, GPQA 49). Brings R1-style reasoning to the popular Llama 8B footprint; 128K context.

### Llama 3.1 8B Instruct ★
**Meta** · 2024-07 · Llama 3.1 Community License · 8B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct)  
Benchmarks — MMLU-Pro 48.3 · GPQA-D 30.4 · AIME — · LiveCodeBench — · SWE-bench —  

Refreshed small dense model in Meta's 3.1 generation, extending context to 128K with improved multilingual and tool-use ability (MMLU-Pro 48.3, GPQA 30.4). A strong efficient general-purpose model for its size and one of the most-downloaded open small models.

### Gemma 3n E4B
**Google** · 2025-06 · Gemma · 8B dense · 32K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/google/gemma-3n-E4B-it)  
Benchmarks — MMLU-Pro 50.6 · GPQA-D 23.7 · AIME 11.6 · LiveCodeBench 25.7 · SWE-bench —  

Larger mobile-first multimodal Gemma 3n model using the MatFormer ('Matryoshka') architecture so a smaller E2B nests within it; ~8B raw params with a ~4B activation footprint, accepting text, image, audio and video. First sub-10B model to surpass 1300 on LMArena.

### Granite 3.3 8B Instruct
**IBM** · 2025-04 · Apache 2.0 · 8.17B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/ibm-granite/granite-3.3-8b-instruct)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

IBM's enterprise-focused 8B dense Granite model with a 128K context and optional fill-in-the-middle and thinking modes. Targets RAG, summarization, classification and tool/function calling with strong instruction following. Emphasizes governance and Apache 2.0 over leaderboards.

### Qwen3-8B ★
**Alibaba/Qwen** · 2025-04 · Apache 2.0 · 8.2B dense · reasoning · 131K ctx · spec: reasoning · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/Qwen/Qwen3-8B)  
Benchmarks — MMLU-Pro 56.7 · GPQA-D 44.4 · AIME — · LiveCodeBench 29 · SWE-bench —  

Popular small dense Qwen3 model with the hybrid thinking/non-thinking switch, a common choice for on-device and cost-sensitive deployment that can outperform the older Qwen2.5-14B base on many tasks. Native 32K context extendable to 128K.

### NVIDIA-Nemotron-Nano-9B-v2 ★
**NVIDIA** · 2025-08 · NVIDIA Open Model License · 9B dense · reasoning · 128K ctx · spec: reasoning · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-Nano-9B-v2)  
Benchmarks — MMLU-Pro — · GPQA-D 64 · AIME 72.1 · LiveCodeBench 71.1 · SWE-bench —  

From-scratch hybrid Mamba-2/Transformer reasoning model (mostly Mamba-2 + MLP, four attention layers), Minitron-distilled from a 12B base pretrained on 20T tokens. Up to 6x higher throughput than similar Transformers, 128K context on a single A10G. Reasoning ON: GPQA 64, AIME-2025 72.1, LiveCodeBench 71.1.

### GLM-4-9B-Chat
**Zhipu AI** · 2024-06 · GLM-4 Model License · 9B dense · 128K ctx · spec: chat · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/THUDM/glm-4-9b-chat)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Open 9B chat model from the GLM-4 generation by Zhipu AI, supporting 128K context, 26 languages and agent features (web browsing, code execution, function calling). Outperformed Llama-3-8B across math, reasoning and code at release. Dense, non-reasoning.

### Gemma 2 9B
**Google** · 2024-06 · Gemma · 9.2B dense · 8K ctx · spec: general · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/google/gemma-2-9b-it)  
Benchmarks — MMLU-Pro — · GPQA-D 24.8 · AIME — · LiveCodeBench — · SWE-bench —  

Mid-size dense Gemma 2 model trained from scratch on ~8T tokens with distillation, interleaved local/global attention, GQA and logit soft-capping. Among the strongest sub-10B open models at its July 2024 launch; 8K context. Non-reasoning.

### NVIDIA-Nemotron-Nano-12B-v2
**NVIDIA** · 2025-08 · NVIDIA Open Model License · 12B dense · reasoning · 128K ctx · spec: reasoning · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-Nano-12B-v2)  
Benchmarks — MMLU-Pro — · GPQA-D 65 · AIME 75.9 · LiveCodeBench 70 · SWE-bench —  

The 12B sibling and pre-compression base of the Nemotron Nano 2 family, a from-scratch hybrid Mamba-2/Transformer reasoning model pretrained on 20T tokens, parent of the Minitron-distilled 9B. Reasoning ON: GPQA 65, AIME-2025 75.9, LiveCodeBench 70. Toggleable thinking budget.

### Mistral-Nemo-Instruct-2407
**Mistral AI** · 2024-07 · Apache 2.0 · 12B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/mistralai/Mistral-Nemo-Instruct-2407)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Dense 12B model trained jointly by Mistral AI and NVIDIA, a more capable multilingual successor to Mistral 7B with a 128K context and the Tekken tokenizer (MMLU ~68). Quantization-friendly via FP8-aware training. Non-reasoning general chat model.

### Gemma 3 12B
**Google** · 2025-03 · Gemma · 12B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/google/gemma-3-12b-it)  
Benchmarks — MMLU-Pro 60.6 · GPQA-D 40.9 · AIME — · LiveCodeBench 24.6 · SWE-bench —  

Mid-large multimodal model in Google's Gemma 3 family with a 128K context and integrated SigLIP vision encoder, supporting text and image across 140+ languages (MMLU-Pro 60.6, GPQA 40.9). A balanced general-purpose multimodal chat model. Non-reasoning.

### Llama 2 13B Chat
**Meta** · 2023-07 · Llama 2 Community License · 13B dense · 4K ctx · spec: chat · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/meta-llama/Llama-2-13b-chat-hf)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Mid-size Llama 2 chat model trained from scratch on ~2T tokens with a 4K context and RLHF (MMLU ~54). A popular base for community instruction tuning in 2023-2024; predates the modern benchmark suite. Historically important.

### OLMo 2 13B Instruct
**Allen AI** · 2024-11 · Apache 2.0 · 13B dense · 4K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/allenai/OLMo-2-1124-13B-Instruct)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Mid-size fully-open dense model from Allen AI, pretrained from scratch on ~5T tokens and post-trained via Tulu 3 (SFT, DPO, RLVR), with full reproducibility of weights, data and artifacts (MMLU ~67). 4K context. Non-reasoning, open-science reference.

### Phi-3-medium-128k-instruct
**Microsoft** · 2024-05 · MIT · 14B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/microsoft/Phi-3-medium-128k-instruct)  
Benchmarks — MMLU-Pro 51.9 · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

The 14B flagship of Microsoft's Phi-3 family, a dense decoder trained from scratch on ~4.8T tokens of filtered and synthetic data with 4K and 128K context variants (~76.6 MMLU). Embodies the Phi small-but-capable philosophy. Non-reasoning instruct model.

### DeepSeek-R1-Distill-Qwen-14B
**DeepSeek** · 2025-01 · MIT (weights) / Apache 2.0 base · 14B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Qwen2.5-14B · confidence: high  
[model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-14B)  
Benchmarks — MMLU-Pro — · GPQA-D 59.1 · AIME 69.7 · LiveCodeBench 53.1 · SWE-bench —  

Dense 14B reasoning model distilled from DeepSeek-R1 onto Qwen2.5-14B, reaching AIME-2024 69.7 and LiveCodeBench 53.1, beating many far larger non-reasoning models on math and code. Long chain-of-thought; 128K context.

### Phi-4 ★
**Microsoft** · 2024-12 · MIT · 14B dense · 16K ctx · spec: reasoning · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/microsoft/phi-4)  
Benchmarks — MMLU-Pro 70.4 · GPQA-D 56.1 · AIME — · LiveCodeBench — · SWE-bench —  

Microsoft's 14B dense decoder trained from scratch on ~9.8T tokens with a heavy emphasis on synthetic reasoning-dense data. Despite a modest 16K context it posts strong STEM/math/reasoning results (MMLU-Pro 70.4, GPQA 56.1) rivaling larger models. Not long-CoT but reasoning-strong.

### Phi-4-reasoning
**Microsoft** · 2025-04 · MIT · 14B dense · reasoning · 32K ctx · spec: reasoning · lineage: derived from Phi-4 · confidence: high  
[model card](https://huggingface.co/microsoft/Phi-4-reasoning)  
Benchmarks — MMLU-Pro 74.3 · GPQA-D 65.8 · AIME 75.3 · LiveCodeBench 53.8 · SWE-bench —  

Microsoft's 14B open-weight reasoning model, fine-tuned from Phi-4 via SFT on ~8.3B tokens of chain-of-thought traces from o3-mini. Rivals much larger models on math, science and code (AIME-2024 75.3, GPQA 65.8, LiveCodeBench 53.8). Produces explicit long-form reasoning; 32K context.

### Phi-4-reasoning-plus
**Microsoft** · 2025-04 · MIT · 14B dense · reasoning · 32K ctx · spec: reasoning · lineage: derived from Phi-4 · confidence: high  
[model card](https://huggingface.co/microsoft/Phi-4-reasoning-plus)  
Benchmarks — MMLU-Pro 76 · GPQA-D 68.9 · AIME 81.3 · LiveCodeBench 53.1 · SWE-bench —  

RL-enhanced variant of Phi-4-reasoning (CoT SFT plus a GRPO RL phase), generating ~50% more reasoning tokens for higher accuracy (AIME-2024 81.3, AIME-2025 78, GPQA 68.9), approaching DeepSeek-R1 on math. Trades latency for top-tier reasoning at 14B.

### Qwen3-14B
**Alibaba/Qwen** · 2025-04 · Apache 2.0 · 14.8B dense · reasoning · 131K ctx · spec: reasoning · lineage: from-scratch · confidence: low  
[model card](https://huggingface.co/Qwen/Qwen3-14B)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Mid-size dense Qwen3 model with the hybrid thinking/non-thinking switch; Qwen noted Qwen3 dense models often match the prior-gen larger Qwen2.5 models. Native 32K context extendable to 128K. Clean per-model thinking-mode benchmarks were not published.


## Mid (15–40B) — 23 models

### gpt-oss-20b ★
**OpenAI** · 2025-08 · Apache 2.0 · 20.9B total / 3.6B active (MoE) · reasoning · 131K ctx · spec: reasoning · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/openai/gpt-oss-20b)  
Benchmarks — MMLU-Pro — · GPQA-D 71.5 · AIME 91.7 · LiveCodeBench 54 · SWE-bench 60.7  

The smaller of OpenAI's two open-weight gpt-oss MoE reasoning models, 20.9B total / 3.6B active with MXFP4 expert quantization that runs on ~16GB consumer/edge hardware. 131K context, configurable reasoning effort, tool use (GPQA 71.5, AIME-2025 91.7, SWE-bench 60.7). A capable lightweight reasoner. Apache 2.0.

### Mistral-Small-Instruct-2409
**Mistral AI** · 2024-09 · Mistral Research License · 22B dense · 32K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/mistralai/Mistral-Small-Instruct-2409)  
Benchmarks — MMLU-Pro 48.4 · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

The 22B dense first-generation 'Small' model, between Mistral NeMo 12B and Mistral Large 2, with a 32K context and native function calling (MMLU-Pro ~48). Non-commercial Mistral Research License; superseded by the 24B Apache-licensed Small 3 line.

### Codestral-22B-v0.1
**Mistral AI** · 2024-05 · Mistral Non-Production License (MNPL) · 22B dense · 32K ctx · spec: coding · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/mistralai/Codestral-22B-v0.1)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Mistral AI's first dedicated code model, a dense 22B trained from scratch on 80+ programming languages with instruction-following and fill-in-the-middle support; 32K context. Source-available MNPL. Preceded the agentic Devstral line; coding-specialist.

### Mistral Small 3 (24B, 2501)
**Mistral AI** · 2025-01 · Apache 2.0 · 24B dense · 32K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/mistralai/Mistral-Small-24B-Instruct-2501)  
Benchmarks — MMLU-Pro 66.3 · GPQA-D 45.3 · AIME — · LiveCodeBench — · SWE-bench —  

Dense 24B model re-licensed under Apache 2.0 for low-latency local deployment, competitive with Llama 3.3 70B and Qwen 2.5 32B (MMLU-Pro 66, GPQA 45). Native function calling, JSON output, Tekken tokenizer, 32K context. Base for the Devstral and Magistral derivatives.

### Magistral-Small-2506 (1.0)
**Mistral AI** · 2025-06 · Apache 2.0 · 24B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Mistral-Small-3.1-24B-Base-2503 · confidence: high  
[model card](https://huggingface.co/mistralai/Magistral-Small-2506)  
Benchmarks — MMLU-Pro — · GPQA-D 68.2 · AIME 70.7 · LiveCodeBench 55.8 · SWE-bench —  

Mistral AI's first open reasoning model, derived from Mistral Small 3.1 via SFT on Magistral Medium traces plus RL, using explicit [THINK] tokens (AIME-2024 70.7, GPQA 68.2, LiveCodeBench 55.8). Apache 2.0, 128K context. Reasoning specialist.

### Devstral Small 1.1 (24B, 2507) ★
**Mistral AI** · 2025-07 · Apache 2.0 · 24B dense · 128K ctx · spec: agentic · lineage: derived from Mistral-Small-3.1-24B-Base-2503 · confidence: high  
[model card](https://huggingface.co/mistralai/Devstral-Small-2507)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench 53.6  

Agentic software-engineering model fine-tuned from Mistral-Small-3.1-24B-Base, built with All Hands AI for code agents (OpenHands) rather than raw completion. Runs on a single RTX 4090/32GB Mac, 128K context, SWE-bench Verified 53.6 (state-of-the-art for open models at its size).

### Magistral-Small-2509 (1.2)
**Mistral AI** · 2025-09 · Apache 2.0 · 24B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Mistral-Small-3.2-24B-Instruct-2506 · confidence: high  
[model card](https://huggingface.co/mistralai/Magistral-Small-2509)  
Benchmarks — MMLU-Pro — · GPQA-D 70.1 · AIME 86.1 · LiveCodeBench 70.9 · SWE-bench —  

Updated open reasoning model built on Mistral Small 3.2 with an added vision encoder for multimodal reasoning, markedly improving over 1.0 (AIME-2024 86.1, GPQA 70.1, LiveCodeBench 70.9). Apache 2.0, 128K context, [THINK] tokens, fits a single RTX 4090 when quantized.

### Mistral Small 3.2 (24B, 2506) ★
**Mistral AI** · 2025-06 · Apache 2.0 · 24B dense · 128K ctx · spec: general · lineage: derived from Mistral-Small-3.1-24B-Base-2503 · confidence: high  
[model card](https://huggingface.co/mistralai/Mistral-Small-3.2-24B-Instruct-2506)  
Benchmarks — MMLU-Pro 69.1 · GPQA-D 46.1 · AIME — · LiveCodeBench — · SWE-bench —  

Refinement of Mistral Small 3.1, fine-tuned from its base to improve instruction following, reduce repetition and strengthen tool/function calling. Dense 24B multimodal (text+vision) with a 128K context (MMLU-Pro 69.1, GPQA 46.1, HumanEval+ ~93). General-purpose, Apache 2.0.

### Gemma 3 27B ★
**Google** · 2025-03 · Gemma · 27B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/google/gemma-3-27b-it)  
Benchmarks — MMLU-Pro 67.5 · GPQA-D 42.4 · AIME 20.8 · LiveCodeBench 29.7 · SWE-bench —  

Flagship of Google's Gemma 3 family, a dense multimodal (text+image) model trained from scratch with a 128K context and 140+ language support, marketed as a top single-accelerator open model (MMLU-Pro 67.5, GPQA 42.4). Integrates a SigLIP vision encoder. Non-reasoning.

### Qwen3.6-27B ★
**Alibaba Qwen Team** · 2026-04 · Apache-2.0 · 27B dense · reasoning · 262K ctx · spec: coding · lineage: from-scratch · confidence: high · AAII 37  
[model card](https://huggingface.co/Qwen/Qwen3.6-27B)  
Benchmarks — MMLU-Pro 86.2 · GPQA-D 87.8 · AIME 94.1 · LiveCodeBench 83.9 · SWE-bench 77.2  

Qwen3.6-27B is Alibaba's first open-weight model in the Qwen3.6 generation, released April 2026 under Apache 2.0 as a dense 27B multimodal model with a hybrid Gated DeltaNet + Gated Attention architecture (64 layers) and Multi-Token Prediction for speculative decoding. It is a reasoning model (thinking mode on by default) with native 262K context extensible to ~1.01M tokens via YaRN. Notably, this dense 27B model matches or beats the much larger Qwen3.5-397B-A17B MoE on agentic coding benchmarks (SWE-bench Verified 77.2, Terminal-Bench 2.0 59.3). It scores 37 on the Artificial Analysis Intelligence Index, making it the open-weights leader under ~150B parameters at release.

### Gemma 2 27B
**Google** · 2024-06 · Gemma · 27.2B dense · 8K ctx · spec: general · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/google/gemma-2-27b-it)  
Benchmarks — MMLU-Pro — · GPQA-D 26.3 · AIME — · LiveCodeBench — · SWE-bench —  

Flagship of Google's Gemma 2 family, a dense text-only decoder pretrained from scratch and competitive with larger models at a practical size (~75 MMLU), ranking highly on early Chatbot Arena. Interleaved local/global attention, 8K context. Non-reasoning.

### NVIDIA Nemotron 3 Nano 30B A3B ★
**NVIDIA** · 2025-12 · NVIDIA Nemotron Open Model License · 30B total / 3.5B active (MoE) · reasoning · 1000K ctx · spec: reasoning · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16)  
Benchmarks — MMLU-Pro 78.3 · GPQA-D 73 · AIME 89.1 · LiveCodeBench 68.3 · SWE-bench 38.8  

Nemotron 3 Nano 30B is the efficient agentic member of the Nemotron 3 family, a 30B-total / ~3.5B-active hybrid Mamba-2 + MoE model (23 Mamba-2/MoE layers plus 6 Attention layers; 128+1 experts, 5 active per token) trained from scratch on roughly 25T tokens. Released December 2025 under the NVIDIA Nemotron Open Model License as part of the open Nemotron 3 debut (open weights, data, and recipes), it supports up to 1M-token context (256k default) and a controllable reasoning mode. Model-card benchmarks include MMLU-Pro 78.3, GPQA 73.0 (no tools), AIME25 89.1 (no tools), LiveCodeBench v6 68.3, and SWE-bench Verified 38.8 (OpenHands). It is designed for fast, cost-efficient on-device and agentic deployment relative to the larger Super and Ultra tiers.

### Qwen3-30B-A3B
**Alibaba/Qwen** · 2025-04 · Apache 2.0 · 30.5B total / 3.3B active (MoE) · reasoning · 131K ctx · spec: reasoning · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/Qwen/Qwen3-30B-A3B)  
Benchmarks — MMLU-Pro 80.5 · GPQA-D 74.4 · AIME 83.1 · LiveCodeBench 64.2 · SWE-bench —  

Small MoE of the original Qwen3 launch, 30.5B total / 3.3B active (128 experts, 8 active), delivering reasoning near the 32B dense model at a fraction of the compute. Hybrid thinking/non-thinking; native 32K extendable to 128K. A popular efficient choice. Later refreshed as Instruct/Thinking-2507.

### Qwen3-30B-A3B-Instruct-2507
**Alibaba/Qwen** · 2025-07 · Apache 2.0 · 30.5B total / 3.3B active (MoE) · 262K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/Qwen/Qwen3-30B-A3B-Instruct-2507)  
Benchmarks — MMLU-Pro 78.4 · GPQA-D 70.4 · AIME 61.3 · LiveCodeBench 43.2 · SWE-bench —  

July 2025 non-thinking refresh of Qwen3's small MoE (30.5B total / 3.3B active), delivering strong general capability (MMLU-Pro 78.4, GPQA 70.4) at very low inference cost with a 262K context. A fast, deployment-friendly general/chat model.

### Qwen3-30B-A3B-Thinking-2507 ★
**Alibaba/Qwen** · 2025-07 · Apache 2.0 · 30.5B total / 3.3B active (MoE) · reasoning · 262K ctx · spec: reasoning · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/Qwen/Qwen3-30B-A3B-Thinking-2507)  
Benchmarks — MMLU-Pro 80.9 · GPQA-D 73.4 · AIME 85 · LiveCodeBench 66 · SWE-bench —  

July 2025 dedicated-reasoning refresh of Qwen3's small MoE (30.5B total / 3.3B active, 128 experts), packing flagship-level reasoning into a tiny active footprint (AIME-2025 85, MMLU-Pro 80.9, GPQA 73.4, LiveCodeBench 66). Native 262K context. Extremely efficient open reasoner.

### Qwen3-Coder-30B-A3B-Instruct ★
**Alibaba/Qwen** · 2025-07 · Apache 2.0 · 30.5B total / 3.3B active (MoE) · 262K ctx · spec: agentic · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench 51.6  

Small, efficient member of the Qwen3-Coder agentic-coding family, a 30.5B total / 3.3B active MoE bringing agentic coding and tool-use to commodity hardware with only ~3B active (SWE-bench Verified ~51.6). Native 262K context; non-thinking, well-suited to local coding agents.

### DeepSeek-R1-Distill-Qwen-32B
**DeepSeek** · 2025-01 · MIT (weights) / Apache 2.0 base · 32B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Qwen2.5-32B · confidence: high  
[model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B)  
Benchmarks — MMLU-Pro — · GPQA-D 62.1 · AIME 72.6 · LiveCodeBench 57.2 · SWE-bench —  

Largest dense R1 distill, distilled from DeepSeek-R1 onto Qwen2.5-32B; the strongest open dense reasoning model at launch (AIME-2024 72.6, GPQA 62.1, LiveCodeBench 57.2), rivaling o1-mini. R1-style long chain-of-thought; 128K context.

### OLMo 2 32B Instruct
**Allen AI** · 2025-03 · Apache 2.0 · 32B dense · 4K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/allenai/OLMo-2-0325-32B-Instruct)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Largest fully-open dense model from Allen AI, pretrained from scratch on up to ~6T tokens and post-trained with Tulu 3, billed as the first fully-open model to match GPT-3.5 Turbo / GPT-4o mini (MMLU 77.3, GSM8K 87.6). 4K context. Standout for complete transparency.

### Granite 4.0 H Small ★
**IBM** · 2025-10 · Apache 2.0 · 32B total / 9B active (MoE) · 128K ctx · spec: agentic · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/ibm-granite/granite-4.0-h-small)  
Benchmarks — MMLU-Pro 55.5 · GPQA-D 40.6 · AIME — · LiveCodeBench — · SWE-bench —  

Flagship of IBM's Granite 4.0 family, a hybrid Mamba-2/transformer MoE with 32B total / 9B active (72 experts, 10 active + shared) and a 128K context, pretrained on IBM's ~22T-token enterprise corpus (MMLU-Pro 55.5, GPQA 40.6, HumanEval ~88, BFCL ~64.7). Cost-efficient enterprise agentic workflows. Apache 2.0.

### QwQ-32B
**Alibaba/Qwen** · 2025-03 · Apache 2.0 · 32.5B dense · reasoning · 131K ctx · spec: reasoning · lineage: derived from Qwen2.5-32B · confidence: high  
[model card](https://huggingface.co/Qwen/QwQ-32B)  
Benchmarks — MMLU-Pro — · GPQA-D 65.9 · AIME 79.5 · LiveCodeBench 63.4 · SWE-bench —  

Alibaba Qwen's dedicated reasoning model built on Qwen2.5-32B with large-scale RL for long chain-of-thought. At only 32.5B dense params it rivaled the much larger DeepSeek-R1 on math and coding (AIME-2024 79.5, GPQA 65.9, LiveCodeBench 63.4). A landmark for RL-driven mid-size reasoners.

### Qwen2.5-32B-Instruct
**Alibaba/Qwen** · 2024-09 · Apache 2.0 · 32.8B dense · 131K ctx · spec: general · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/Qwen/Qwen2.5-32B-Instruct)  
Benchmarks — MMLU-Pro 69 · GPQA-D 49.5 · AIME — · LiveCodeBench 51.2 · SWE-bench —  

Mid-large dense model in the Qwen2.5 series, 32.8B params with a 131K context, balancing capability and deployability and serving as the base for QwQ-32B (MMLU-Pro 69, GPQA 49.5, LiveCodeBench 51.2). Non-reasoning general-purpose instruct model.

### Qwen2.5-Coder-32B-Instruct
**Alibaba/Qwen** · 2024-11 · Apache 2.0 · 32.8B dense · 131K ctx · spec: coding · lineage: derived from Qwen2.5-32B · confidence: med  
[model card](https://huggingface.co/Qwen/Qwen2.5-Coder-32B-Instruct)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench 31.4 · SWE-bench —  

Flagship code model of the Qwen2.5-Coder series, continued-pretrained from Qwen2.5-32B on ~5.5T code-heavy tokens; the first open model to match GPT-4o-class coding (HumanEval 92.7, Aider 73.7). 131K context, specializes in code generation, repair and reasoning across many languages.

### Qwen3-32B ★
**Alibaba/Qwen** · 2025-04 · Apache 2.0 · 32.8B dense · reasoning · 131K ctx · spec: reasoning · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/Qwen/Qwen3-32B)  
Benchmarks — MMLU-Pro 82.1 · GPQA-D 73.1 · AIME 83.7 · LiveCodeBench 65.6 · SWE-bench —  

Largest dense model of the original Qwen3 launch, a hybrid that toggles between thinking and fast non-thinking modes. In thinking mode it scores MMLU-Pro ~82, GPQA 73.1 and AIME-2025 83.7, outperforming QwQ-32B. Native 32K context extendable to 128K. A strong single-GPU-class reasoner.


## Large (40–130B) — 24 models

### Phi-3.5-MoE-instruct
**Microsoft** · 2024-08 · MIT · 42B total / 6.6B active (MoE) · 128K ctx · spec: general · lineage: derived from Phi-3.5 · confidence: high  
[model card](https://huggingface.co/microsoft/Phi-3.5-MoE-instruct)  
Benchmarks — MMLU-Pro 54.3 · GPQA-D 36.8 · AIME — · LiveCodeBench — · SWE-bench —  

Microsoft's MoE model in the Phi-3.5 family, 16 experts totaling ~42B with ~6.6B active (top-2), built on the Phi-3 data recipe with 128K context (MMLU-Pro 54.3, GPQA 36.8). Outperforms the dense Phi-3.5-mini and rivals larger dense models. The only MoE in the Phi line through 3.5.

### Mixtral-8x7B-Instruct-v0.1
**Mistral AI** · 2023-12 · Apache 2.0 · 46.7B total / 12.9B active (MoE) · 32K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/mistralai/Mixtral-8x7B-Instruct-v0.1)  
Benchmarks — MMLU-Pro 43.3 · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Mistral AI's first sparse MoE, 8 experts with 2 active per token (46.7B total / ~12.9B active). Matched or beat Llama 2 70B and GPT-3.5 at far lower cost, making MoE mainstream in open weights. General-purpose multilingual chat, 32K context (MMLU-Pro ~43).

### Llama-3.3-Nemotron-Super-49B-v1.5 ★
**NVIDIA** · 2025-07 · NVIDIA Open Model License + Llama 3.3 Community License · 49B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Llama-3.3-70B-Instruct · confidence: high  
[model card](https://huggingface.co/nvidia/Llama-3_3-Nemotron-Super-49B-v1_5)  
Benchmarks — MMLU-Pro 79.5 · GPQA-D 72 · AIME 82.7 · LiveCodeBench 73.6 · SWE-bench —  

Upgraded reasoning model NAS-compressed from Llama-3.3-70B-Instruct to a 49B dense footprint, the strongest of NVIDIA's single-GPU-class Nemotron reasoners (MMLU-Pro 79.5, GPQA 72, AIME-2025 82.7, LiveCodeBench 73.6). Toggleable reasoning; fits a single H200; strong price-to-performance.

### Llama-3.3-Nemotron-Super-49B-v1
**NVIDIA** · 2025-03 · NVIDIA Open Model License + Llama 3.3 Community License · 49B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Llama-3.3-70B-Instruct · confidence: high  
[model card](https://huggingface.co/nvidia/Llama-3_3-Nemotron-Super-49B-v1)  
Benchmarks — MMLU-Pro — · GPQA-D 66.7 · AIME 58.4 · LiveCodeBench — · SWE-bench —  

Reasoning-capable model NAS-compressed from Llama-3.3-70B-Instruct to 49B so it fits a single H200, with toggleable reasoning and post-training for math, coding, RAG and tool calling (GPQA 66.7, AIME-2025 58.4, MATH500 96.6). Superseded by the stronger v1.5.

### Llama 3 70B Instruct
**Meta** · 2024-04 · Llama 3 Community License · 70B dense · 8K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/meta-llama/Meta-Llama-3-70B-Instruct)  
Benchmarks — MMLU-Pro — · GPQA-D 39.5 · AIME — · LiveCodeBench — · SWE-bench —  

Meta's third-generation flagship dense model, pretrained on 15T+ tokens with GQA and an 8K context, a leading open-weight model at release (MMLU ~82, HumanEval ~81, GPQA 39.5). Quickly extended into the 128K-context Llama 3.1 generation. Non-reasoning.

### Llama 3.1 70B Instruct
**Meta** · 2024-07 · Llama 3.1 Community License · 70B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/meta-llama/Llama-3.1-70B-Instruct)  
Benchmarks — MMLU-Pro 66.4 · GPQA-D 41.7 · AIME — · LiveCodeBench — · SWE-bench —  

Meta's 3.1-generation mid-flagship dense model with a 128K context, improved long-context handling and stronger tool use (MMLU-Pro 66.4, GPQA 41.7). Among the better open dense models of late 2024, later largely superseded by Llama 3.3 70B. Non-reasoning.

### Llama 3.3 70B Instruct ★
**Meta** · 2024-12 · Llama 3.3 Community License · 70B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct)  
Benchmarks — MMLU-Pro 68.9 · GPQA-D 50.5 · AIME — · LiveCodeBench — · SWE-bench —  

Meta's late-2024 post-training refresh of the 70B dense model, delivering quality close to Llama 3.1 405B at a fraction of the cost, with a 128K context (MMLU-Pro 68.9, GPQA 50.5) and strong instruction following and tool use. Meta's go-to open dense model until Llama 4. Non-reasoning.

### Llama-3.1-Nemotron-70B-Instruct
**NVIDIA** · 2024-10 · NVIDIA Open Model License + Llama 3.1 Community License · 70B dense · 128K ctx · spec: chat · lineage: derived from Llama-3.1-70B-Instruct · confidence: high  
[model card](https://huggingface.co/nvidia/Llama-3.1-Nemotron-70B-Instruct-HF)  
Benchmarks — MMLU-Pro 62.8 · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

RLHF-aligned chat model from NVIDIA built on Llama-3.1-70B-Instruct, trained with REINFORCE and the HelpSteer2 reward model. At launch it topped Arena Hard (85.0) and AlpacaEval 2 LC (57.6), beating GPT-4o and Claude 3.5 Sonnet on those alignment benchmarks. Dense, non-reasoning.

### DeepSeek-R1-Distill-Llama-70B
**DeepSeek** · 2025-01 · MIT (weights) / Llama 3.3 Community (base) · 70B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Llama-3.3-70B-Instruct · confidence: high  
[model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Llama-70B)  
Benchmarks — MMLU-Pro — · GPQA-D 65.2 · AIME 70 · LiveCodeBench 57.5 · SWE-bench —  

Dense 70B reasoning model distilling DeepSeek-R1 onto Llama-3.3-70B-Instruct, pairing R1-style reasoning with Llama's strong knowledge base (AIME-2024 70, GPQA 65.2, LiveCodeBench 57.5). 128K context, R1-style long chain-of-thought.

### Qwen2.5-72B-Instruct
**Alibaba/Qwen** · 2024-09 · Qwen · 72.7B dense · 131K ctx · spec: general · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/Qwen/Qwen2.5-72B-Instruct)  
Benchmarks — MMLU-Pro 71.1 · GPQA-D 49 · AIME — · LiveCodeBench 55.5 · SWE-bench —  

Dense flagship of the Qwen2.5 generation, trained on ~18T tokens, a 72B transformer with a 131K context that at launch was among the strongest open general-purpose models, competitive with Llama-3.1-405B (MMLU-Pro 71.1, GPQA 49, LiveCodeBench 55.5). Non-reasoning instruct model.

### Qwen3-Next-80B-A3B-Instruct
**Alibaba/Qwen** · 2025-09 · Apache 2.0 · 80B total / 3B active (MoE) · 262K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/Qwen/Qwen3-Next-80B-A3B-Instruct)  
Benchmarks — MMLU-Pro 80.6 · GPQA-D 72.9 · AIME 69.5 · LiveCodeBench 56.6 · SWE-bench —  

Alibaba Qwen's next-gen ultra-sparse MoE, 80B total but only ~3B active across 512 experts (10 active + 1 shared), mixing Gated DeltaNet (linear attention) and Gated Attention for efficient long-context inference (262K, extendable to ~1M). Rivals Qwen3-32B at a fraction of active compute (MMLU-Pro 80.6, GPQA 72.9). Non-thinking.

### Qwen3-Next-80B-A3B-Thinking ★
**Alibaba/Qwen** · 2025-09 · Apache 2.0 · 80B total / 3B active (MoE) · reasoning · 262K ctx · spec: reasoning · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/Qwen/Qwen3-Next-80B-A3B-Thinking)  
Benchmarks — MMLU-Pro 82.7 · GPQA-D 77.2 · AIME 87.8 · LiveCodeBench 68.7 · SWE-bench —  

Reasoning variant of Alibaba Qwen's next-gen ultra-sparse MoE, 80B total / ~3B active (512 experts), built on the hybrid Gated DeltaNet + Gated Attention architecture for cheap long-context reasoning (AIME-2025 87.8, MMLU-Pro 82.7, GPQA 77.2, LiveCodeBench 68.7). Native 262K context. Flagship-class reasoning at tiny active cost.

### Command R+ (08-2024)
**Cohere** · 2024-08 · CC-BY-NC 4.0 (non-commercial) · 104B dense · 128K ctx · spec: agentic · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/CohereForAI/c4ai-command-r-plus-08-2024)  
Benchmarks — MMLU-Pro — · GPQA-D 34.3 · AIME — · LiveCodeBench — · SWE-bench —  

Cohere's 104B dense flagship of the R series, trained from scratch for advanced multi-step tool use, RAG with verifiable citations and 23-language enterprise tasks, with a 128K context (GPQA ~34). Cohere's most capable model before Command A. Non-commercial license.

### GLM-4.5-Air ★
**Zhipu AI (Z.ai)** · 2025-08 · MIT · 106B total / 12B active (MoE) · reasoning · 128K ctx · spec: agentic · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/zai-org/GLM-4.5-Air)  
Benchmarks — MMLU-Pro 81.4 · GPQA-D 73.3 · AIME 89.4 · LiveCodeBench 61.5 · SWE-bench 57.6  

Lighter from-scratch MoE sibling of GLM-4.5 (106B total / 12B active), designed for efficiency while retaining hybrid thinking/non-thinking reasoning and agentic ability (MMLU-Pro 81.4, AIME-2024 89.4, GPQA 73.3, LiveCodeBench 61.5, SWE-bench 57.6). MIT, 128K context. Cost-efficient agentic and coding model.

### Llama 4 Scout 17B-16E Instruct
**Meta** · 2025-04 · Llama 4 Community License · 109B total / 17B active (MoE) · 10000K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct)  
Benchmarks — MMLU-Pro 74.3 · GPQA-D 57.2 · AIME — · LiveCodeBench 32.8 · SWE-bench —  

Smaller of Meta's first natively-multimodal MoE models, 17B active across 16 experts (109B total) with an industry-leading 10M-token context that fits on a single H100 with Int4 (MMLU-Pro 74.3, GPQA 57.2, LiveCodeBench 32.8). Non-reasoning multimodal, targeting long-context document and image understanding.

### Command A (03-2025)
**Cohere** · 2025-03 · CC-BY-NC 4.0 (non-commercial) · 111B dense · 256K ctx · spec: agentic · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/CohereLabs/c4ai-command-a-03-2025)  
Benchmarks — MMLU-Pro — · GPQA-D 50.5 · AIME — · LiveCodeBench — · SWE-bench —  

Cohere's 111B dense enterprise flagship trained from scratch, optimized for agentic tool use, RAG and 23-language tasks, notable for running on just two A100/H100 GPUs with a 256K context (GPQA 50.5). Supersedes Command R+ with stronger code and instruction following. Non-commercial license.

### Command A Reasoning (08-2025)
**Cohere** · 2025-08 · CC-BY-NC 4.0 (non-commercial) · 111B dense · reasoning · 256K ctx · spec: reasoning · lineage: derived from c4ai-command-a-03-2025 · confidence: med  
[model card](https://huggingface.co/CohereLabs/command-a-reasoning-08-2025)  
Benchmarks — MMLU-Pro — · GPQA-D 66.7 · AIME — · LiveCodeBench — · SWE-bench —  

Reasoning-enabled variant of Command A, a 111B dense model fine-tuned with toggleable reasoning (START/END_THINKING tags) for higher accuracy or lower latency, targeting agentic, tool-use and multilingual enterprise reasoning with a 256K input context (GPQA 66.7). Non-commercial license.

### gpt-oss-120b ★
**OpenAI** · 2025-08 · Apache 2.0 · 116.8B total / 5.1B active (MoE) · reasoning · 131K ctx · spec: reasoning · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/openai/gpt-oss-120b)  
Benchmarks — MMLU-Pro 80.8 · GPQA-D 80.1 · AIME 92.5 · LiveCodeBench 63 · SWE-bench 62.4  

OpenAI's first major open-weight model since GPT-2, a from-scratch MoE reasoning model (116.8B total / 5.1B active) with MXFP4-quantized experts that fit on a single 80GB GPU. Configurable reasoning effort, 131K context, tool use (MMLU-Pro 80.8, GPQA 80.1, AIME-2025 92.5, SWE-bench 62.4). Strong agentic reasoning and coding. Apache 2.0.

### NVIDIA Nemotron 3 Super 120B A12B ★
**NVIDIA** · 2026-03 · NVIDIA Nemotron Open Model License · 120B total / 12B active (MoE) · reasoning · 1000K ctx · spec: reasoning · lineage: from-scratch · confidence: high · AAII 25  
[model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16)  
Benchmarks — MMLU-Pro 83.7 · GPQA-D 79.2 · AIME 90.2 · LiveCodeBench 81.2 · SWE-bench 60.5  

Nemotron 3 Super is the mid-tier member of NVIDIA's Nemotron 3 line, a 120B-total / 12B-active Latent Mixture-of-Experts (Mamba-2 + MoE + Attention hybrid with Multi-Token Prediction) released March 2026 under the NVIDIA Nemotron Open Model License. It is post-trained from NVIDIA's own from-scratch base model (the line is not derived from Llama), pre-trained on 25T+ tokens and refined with multi-stage RL for agentic and reasoning use, supporting up to 1M-token context. Its model card reports MMLU-Pro 83.73, GPQA-Diamond 79.23 (no tools), AIME25 90.21, LiveCodeBench v5 81.19, and SWE-bench Verified 60.47 (OpenHands). The Artificial Analysis model page lists an Intelligence Index of 25 at ~$0.28 blended/Mtok and ~150 tok/s (note: an AA launch article cited a higher 36.0 under a different index version).

### Qwen3.5-122B-A10B ★
**Alibaba Qwen Team** · 2026-02 · Apache-2.0 · 122B total / 10B active (MoE) · reasoning · 262K ctx · spec: general · lineage: from-scratch · confidence: high · AAII 32  
[model card](https://huggingface.co/Qwen/Qwen3.5-122B-A10B)  
Benchmarks — MMLU-Pro 86.7 · GPQA-D 86.6 · AIME 91.3 · LiveCodeBench 78.9 · SWE-bench 72  

Qwen3.5-122B-A10B is Alibaba's mid-tier multimodal foundation model in the Qwen3.5 series, released February 2026 under Apache 2.0 as a sparse MoE with 122B total and 10B active parameters (256 experts, 8 routed + 1 shared per token). It is a reasoning vision-language model with thinking mode enabled by default, built on a hybrid Gated Delta Network + sparse MoE architecture with early-fusion multimodal training. Native context is 262K tokens, extensible to ~1.01M via YaRN. It reports MMLU-Pro 86.7, GPQA-Diamond 86.6, AIME 2026 91.3, LiveCodeBench v6 78.9, and SWE-bench Verified 72.0, scoring 32 on the Artificial Analysis Intelligence Index.

### Mistral Large 2 (123B, 2407)
**Mistral AI** · 2024-07 · Mistral Research License · 123B dense · 128K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/mistralai/Mistral-Large-Instruct-2407)  
Benchmarks — MMLU-Pro 65.9 · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Mistral AI's flagship dense model, 123B with a 128K context and support for 80+ coding and many natural languages, built for state-of-the-art reasoning, knowledge and coding, competing with GPT-4-class and Llama 3.1 405B at far smaller size (MMLU 84, MMLU-Pro ~66). Non-commercial license.

### MiniMax-M2.7
**MiniMax** · 2026-03 · MiniMax Model License · 230B total / 10B active (MoE) · reasoning · 205K ctx · spec: agentic · lineage: derived from MiniMax-M2.5 · confidence: high · AAII 38  
[model card](https://huggingface.co/MiniMaxAI/MiniMax-M2.7)  
Benchmarks — MMLU-Pro — · GPQA-D 87.4 · AIME — · LiveCodeBench — · SWE-bench —  

MiniMax-M2.7, released March 18, 2026, is an open-weight Sparse Mixture-of-Experts reasoning model with ~230B total parameters and ~10B active parameters, 62 layers, and a ~205K-token (204,800) context window. It is notable as MiniMax's first model to deeply participate in its own evolution, having autonomously optimized a programming scaffold over 100+ rounds for a reported ~30% performance gain. Published benchmarks include GPQA-Diamond 87.4, SWE-bench Pro 56.22, Terminal-Bench 2 57.0, and HLE 28.1; MMLU-Pro, AIME, LiveCodeBench, and SWE-bench Verified were not officially reported. It scored 38 on the Artificial Analysis Intelligence Index.

### MiMo-V2-Flash
**Xiaomi (MiMo / LLM-Core team)** · 2025-12 · MIT · 309B total / 15B active (MoE) · reasoning · 256K ctx · spec: reasoning · lineage: from-scratch · confidence: med · AAII 33  
[model card](https://github.com/XiaomiMiMo/MiMo-V2-Flash)  
Benchmarks — MMLU-Pro 84.9 · GPQA-D 84.3 · AIME 94.1 · LiveCodeBench 85.1 · SWE-bench 73.4  

MiMo-V2-Flash is Xiaomi's efficient open-weight Mixture-of-Experts reasoning/coding/agentic foundation model with 309B total and 15B active parameters, released mid-December 2025 (Dec 16-17) under the MIT license. Its hybrid attention interleaves sliding-window and global attention at a 5:1 ratio with an aggressive 128-token window plus learnable attention-sink bias, cutting KV-cache ~6x while supporting a 256K context, and adds a lightweight multi-token-prediction module. Per its technical report (arXiv:2601.02780), the post-trained model scores MMLU-Pro 84.9, GPQA-Diamond 84.3, AIME 2025 94.1, LiveCodeBench-v6 85.1, and SWE-bench Verified 73.4. Artificial Analysis lists an Intelligence Index of 33; note the catalog anchor labeled this a Feb 2026 release, but authoritative sources (Xiaomi, Wikipedia, the arXiv report) date it to December 2025.

### MiMo-V2.5
**Xiaomi (MiMo / LLM-Core team)** · 2026-04 · MIT · 310B total / 15B active (MoE) · reasoning · 1024K ctx · spec: general · lineage: derived from MiMo-V2-Flash sparse-MoE language backbone (hybrid SWA+GA) plus dedicated vision (729M) and audio (261M) encoders via lightweight projectors · confidence: med · AAII 40  
[model card](https://huggingface.co/XiaomiMiMo/MiMo-V2.5)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

MiMo-V2.5 is a 310B-total / 15B-active sparse Mixture-of-Experts model from Xiaomi, released April 22, 2026 under the MIT license alongside the larger V2.5-Pro. Its language backbone inherits the MiMo-V2-Flash hybrid sliding-window/global-attention architecture and is extended into a unified multimodal (text, image, video, audio) reasoning model with dedicated vision and audio encoders, supporting up to a 1M-token context. Verified agentic benchmark results include SWE-bench Pro 56.1 and Terminal-Bench 2.0 65.8; the standard MMLU-Pro/GPQA-Diamond/AIME/LiveCodeBench/SWE-bench Verified figures were not text-verifiable from the official card and are left as unknown. Artificial Analysis reports an Intelligence Index of 40 at a blended price near $0.06/Mtok.


## Frontier (>130B) — 33 models

### Mixtral-8x22B-Instruct-v0.1
**Mistral AI** · 2024-04 · Apache 2.0 · 141B total / 39B active (MoE) · 64K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/mistralai/Mixtral-8x22B-Instruct-v0.1)  
Benchmarks — MMLU-Pro 56.3 · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

The larger sparse MoE in the Mixtral line, 141B total / 39B active (8 experts, 2 active), with a 64K context, strong multilingual performance, native function calling and math/coding ability at frontier-class efficiency for early 2024 (MMLU-Pro ~56). General-purpose, Apache 2.0.

### MiniMax-M2 ★
**MiniMax** · 2025-10 · Modified MIT · 230B total / 10B active (MoE) · reasoning · 205K ctx · spec: agentic · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/MiniMaxAI/MiniMax-M2)  
Benchmarks — MMLU-Pro 82 · GPQA-D 78 · AIME 78 · LiveCodeBench 83 · SWE-bench 69.4  

Compact, fast MoE with 230B total / only 10B active, built for coding and agentic workflows as an 'interleaved thinking' model. The tiny active footprint gives low latency and high throughput while posting frontier-class agentic scores (SWE-bench 69.4, LiveCodeBench 83, GPQA 78). One of the best price/performance open agentic coders.

### Qwen3-235B-A22B
**Alibaba/Qwen** · 2025-04 · Apache 2.0 · 235B total / 22B active (MoE) · reasoning · 131K ctx · spec: reasoning · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/Qwen/Qwen3-235B-A22B)  
Benchmarks — MMLU-Pro — · GPQA-D 71.1 · AIME 81.5 · LiveCodeBench 70.7 · SWE-bench —  

Flagship MoE of the original Qwen3 launch, 235B total / 22B active (128 experts, 8 active), pioneering Qwen3's unified hybrid thinking/non-thinking switch and competitive with DeepSeek-R1, o1 and Gemini 2.5 Pro at launch (AIME-2025 81.5, GPQA 71.1, LiveCodeBench 70.7). Native 32K extendable to 128K. Later split into Instruct/Thinking-2507.

### Qwen3-235B-A22B-Instruct-2507
**Alibaba/Qwen** · 2025-07 · Apache 2.0 · 235B total / 22B active (MoE) · 262K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/Qwen/Qwen3-235B-A22B-Instruct-2507)  
Benchmarks — MMLU-Pro 83 · GPQA-D 77.5 · AIME 70.3 · LiveCodeBench 51.8 · SWE-bench —  

July 2025 non-thinking refresh of Qwen3's flagship MoE (235B total / 22B active), dropping chain-of-thought for fast, high-quality direct answers and extending native context to 262K (~1M with YaRN). Posts large gains over the original (MMLU-Pro 83, GPQA 77.5). A top-tier open general/chat model.

### Qwen3-235B-A22B-Thinking-2507 ★
**Alibaba/Qwen** · 2025-07 · Apache 2.0 · 235B total / 22B active (MoE) · reasoning · 262K ctx · spec: reasoning · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/Qwen/Qwen3-235B-A22B-Thinking-2507)  
Benchmarks — MMLU-Pro 84.4 · GPQA-D 81.1 · AIME 92.3 · LiveCodeBench 74.1 · SWE-bench 64  

July 2025 dedicated-reasoning refresh of Qwen3's flagship MoE (235B total / 22B active, 128 experts), at release the strongest open reasoning model with SOTA open scores (AIME-2025 92.3, MMLU-Pro 84.4, GPQA 81.1, LiveCodeBench 74.1). Native 262K context extendable toward 1M. Thinking-only; rivals closed frontier reasoners.

### DeepSeek-V2.5
**DeepSeek** · 2024-09 · DeepSeek Model License · 236B total / 21B active (MoE) · 128K ctx · spec: general · lineage: from-scratch · confidence: low  
[model card](https://huggingface.co/deepseek-ai/DeepSeek-V2.5)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench 41.8 · SWE-bench —  

A 236B total / 21B active MoE from DeepSeek that merged V2-Chat and DeepSeek-Coder-V2 into one general+code assistant, using Multi-head Latent Attention (MLA) and fine-grained MoE with a 128K context (LiveCodeBench 41.8). Predates the reasoning era; the V2-to-V3 bridge model.

### DeepSeek-Coder-V2-Instruct
**DeepSeek** · 2024-06 · DeepSeek Model License · 236B total / 21B active (MoE) · 128K ctx · spec: coding · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/deepseek-ai/DeepSeek-Coder-V2-Instruct)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench 43.4 · SWE-bench —  

Code-specialized MoE from DeepSeek, 236B total / 21B active, continued-pretrained from a DeepSeek-V2 checkpoint on ~6T mostly-code tokens. The first open model to credibly challenge closed models on coding (HumanEval 90.2, LiveCodeBench 43.4), 128K context, 338 languages. Non-reasoning instruct coder.

### Llama-3.1-Nemotron-Ultra-253B-v1
**NVIDIA** · 2025-04 · NVIDIA Open Model License + Llama 3.1 Community License · 253B dense · reasoning · 128K ctx · spec: reasoning · lineage: derived from Llama-3.1-405B-Instruct · confidence: high  
[model card](https://huggingface.co/nvidia/Llama-3_1-Nemotron-Ultra-253B-v1)  
Benchmarks — MMLU-Pro 82.5 · GPQA-D 76 · AIME 72.5 · LiveCodeBench 66.3 · SWE-bench —  

NVIDIA's flagship open reasoning model, NAS-compressed from Llama-3.1-405B-Instruct to 253B dense so it fits a single 8xH100 node, with toggleable reasoning (MMLU-Pro 82.5, GPQA 76, AIME-2025 72.5, LiveCodeBench 66.3). At launch the first open model to beat DeepSeek R1 on GPQA Diamond and LiveCodeBench at roughly half R1's size.

### DeepSeek-V4-Flash ★
**DeepSeek** · 2026-04 · MIT · 284B total / 13B active (MoE) · reasoning · 1000K ctx · spec: reasoning · lineage: from-scratch · confidence: high · AAII 40  
[model card](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash)  
Benchmarks — MMLU-Pro 86.2 · GPQA-D 88.1 · AIME 94.8 · LiveCodeBench 91.6 · SWE-bench 79  

DeepSeek-V4-Flash is the smaller, faster member of the V4 line: a 284B-parameter Mixture-of-Experts model with 13B active parameters and a 1M-token context window, released open-weight under MIT on April 24, 2026. It shares the V4 hybrid attention architecture (CSA + HCA) for efficient long-context inference and, like Pro, is a hybrid reasoner with Non-think, Think High, and Think Max modes (Max/High are effort settings of this one model, scoring AAII 40 and 37). Tuned for high-throughput, lower-cost inference (~$0.06-0.08 blended/Mtok), it still holds up on reasoning and coding. Think-Max benchmarks include MMLU-Pro 86.2 (86.4 at Think High), GPQA-Diamond 88.1, LiveCodeBench 91.6, and SWE-bench Verified 79.0.

### Hy3-preview (Hunyuan 3) ★
**Tencent (Hunyuan / Hy Team)** · 2026-04 · Tencent Hy Community License Agreement · 295B total / 21B active (MoE) · reasoning · 256K ctx · spec: reasoning · lineage: from-scratch · confidence: med · AAII 34  
[model card](https://huggingface.co/tencent/Hy3-preview)  
Benchmarks — MMLU-Pro 65.8 · GPQA-D 73.2 · AIME — · LiveCodeBench 34.9 · SWE-bench 74.4  

Hy3-preview is Tencent Hunyuan's 295B-total / 21B-active Mixture-of-Experts model (192 experts, top-8 activated, 80 layers, plus a 3.8B MTP layer), released April 23, 2026 as the first model from Tencent's rebuilt training infrastructure. It supports a 256K context and a configurable reasoning_effort parameter (no_think vs high) for chain-of-thought, and is optimized for reasoning and agentic/search tasks at low cost (AAII 34, agentic index ~49.7). Base-model card scores include MMLU-Pro 65.76, LiveCodeBench-v6 34.86, and the instruct model reaches SWE-bench Verified 74.4 and GPQA Diamond ~73.2. AIME was not disclosed on the model card, so it is left unverified.

### Nemotron-4-340B-Instruct
**NVIDIA** · 2024-06 · NVIDIA Open Model License · 340B dense · 4K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/nvidia/Nemotron-4-340B-Instruct)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

A 340B dense decoder pretrained from scratch by NVIDIA on 9T tokens; the Instruct variant is aligned via SFT/DPO/RPO with over 98% synthetically-generated alignment data. Purpose-built as a permissively-licensed synthetic-data-generation engine (MMLU 78.7, HumanEval 73.2). Limited by a short 4K context. Non-reasoning.

### GLM-4.5 ★
**Zhipu AI (Z.ai)** · 2025-08 · MIT · 355B total / 32B active (MoE) · reasoning · 128K ctx · spec: agentic · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/zai-org/GLM-4.5)  
Benchmarks — MMLU-Pro 84.6 · GPQA-D 79.1 · AIME 91 · LiveCodeBench 72.9 · SWE-bench 64.2  

Z.ai's flagship from-scratch MoE foundation model (355B total / 32B active) unifying agentic, reasoning and coding (ARC) with switchable thinking/non-thinking modes. Among the top open models at release (MMLU-Pro 84.6, AIME-2024 91, GPQA 79.1, LiveCodeBench 72.9, SWE-bench 64.2). MIT-licensed; base of GLM-4.6.

### GLM-4.6 ★
**Z AI (Zhipu AI)** · 2025-09 · MIT · 355B total / ?B active (MoE) · reasoning · 200K ctx · spec: coding · lineage: derived from GLM-4.5 (355B MoE) · confidence: med · AAII 23  
[model card](https://huggingface.co/zai-org/GLM-4.6)  
Benchmarks — MMLU-Pro 83.1 · GPQA-D 78.8 · AIME 90.3 · LiveCodeBench 73 · SWE-bench —  

GLM-4.6 is Z AI's (Zhipu) ~355B-total Mixture-of-Experts model released September 30, 2025 under MIT, an iterative upgrade over GLM-4.5 that extends the context window to 200K tokens and improves real-world coding, reasoning, tool use, and agentic workflows. Reported benchmarks include MMLU-Pro ~83.1, AIME 2025 ~90.3, LiveCodeBench v6 ~73, and GPQA ~78.8. Its active-parameter count is not separately disclosed on the HF card, and its Artificial Analysis Intelligence Index of ~23 reflects the stricter v4.1 methodology. Active params and a clean SWE-bench Verified figure remain unverified.

### Qwen3.5-397B-A17B ★
**Alibaba Qwen Team** · 2026-02 · Apache-2.0 · 397B total / 17B active (MoE) · reasoning · 262K ctx · spec: reasoning · lineage: from-scratch · confidence: high · AAII 34  
[model card](https://huggingface.co/Qwen/Qwen3.5-397B-A17B)  
Benchmarks — MMLU-Pro 87.8 · GPQA-D 88.4 · AIME 91.3 · LiveCodeBench 83.6 · SWE-bench 76.4  

Qwen3.5-397B-A17B is the flagship of Alibaba's Qwen3.5 series, released February 2026 under Apache 2.0 as a sparse Mixture-of-Experts model with 397B total and 17B active parameters (512 experts, 11 routed + 1 shared per token). It is a unified vision-language reasoning model (thinking mode by default) using an efficient hybrid architecture combining Gated Delta Networks with sparse MoE and early-fusion multimodal training, supporting 200+ languages. Native context is 262K tokens, extensible to ~1.01M via YaRN; the hosted Qwen3.5-Plus variant defaults to 1M context. It posts strong benchmarks (MMLU-Pro 87.8, GPQA-Diamond 88.4, AIME 2026 91.3, SWE-bench Verified 76.4) and scores 34 on the Artificial Analysis Intelligence Index.

### Llama 4 Maverick 17B-128E Instruct ★
**Meta** · 2025-04 · Llama 4 Community License · 400B total / 17B active (MoE) · 1000K ctx · spec: general · lineage: from-scratch · confidence: med  
[model card](https://huggingface.co/meta-llama/Llama-4-Maverick-17B-128E-Instruct)  
Benchmarks — MMLU-Pro 80.5 · GPQA-D 69.8 · AIME — · LiveCodeBench 43.4 · SWE-bench 24  

Meta's flagship natively-multimodal MoE, 17B active across 128 experts (400B total) with a 1M-token context, designed to fit on a single H100 host (MMLU-Pro 80.5, GPQA 69.8, LiveCodeBench 43.4). Distilled in part from the unreleased Llama 4 Behemoth teacher. Non-reasoning; independent agentic-coding evals place SWE-bench Verified in the mid-20s.

### MiniMax-M3 ★
**MiniMax** · 2026-06 · MiniMax Community License · 428B total / 23B active (MoE) · reasoning · 1000K ctx · spec: agentic · lineage: derived from MiniMax-M2 · confidence: high · AAII 44  
[model card](https://huggingface.co/MiniMaxAI/MiniMax-M3)  
Benchmarks — MMLU-Pro — · GPQA-D 92.9 · AIME — · LiveCodeBench — · SWE-bench —  

MiniMax-M3, released June 1, 2026, is an open-weight frontier model built on the new MiniMax Sparse Attention (MSA) architecture, a 428B-total / 23B-active Mixture-of-Experts model with native multimodality and a 1M-token context window (512K guaranteed minimum). MSA delivers roughly 9.7x faster prefill and 15.6x faster decode at 1M context versus MiniMax M2. Published numbers include GPQA-Diamond ~92.9 and SWE-bench Pro 59.0 (surpassing GPT-5.5 and Gemini 3.1 Pro on that benchmark), plus Terminal-Bench 2.1 66.0 and BrowseComp 83.5; MMLU-Pro, AIME, LiveCodeBench, and SWE-bench Verified were not officially released. It scored 44 on the Artificial Analysis Intelligence Index, ranking #2 among tracked models.

### MiniMax-M1-80k
**MiniMax** · 2025-06 · Apache 2.0 · 456B total / 45.9B active (MoE) · reasoning · 1000K ctx · spec: reasoning · lineage: derived from MiniMax-Text-01 · confidence: high  
[model card](https://huggingface.co/MiniMaxAI/MiniMax-M1-80k)  
Benchmarks — MMLU-Pro 81.1 · GPQA-D 70 · AIME 76.9 · LiveCodeBench 65 · SWE-bench 56  

Hybrid-MoE reasoning model from MiniMax, 456B total / 45.9B active, built on MiniMax-Text-01 and RL-trained (CISPO). Its lightning (linear) attention gives a native 1M-token context at ~25% the FLOPs of DeepSeek-R1 at 100K generation (AIME-2025 76.9, GPQA 70, LiveCodeBench 65, SWE-bench 56). Extremely efficient for long reasoning.

### Qwen3-Coder-480B-A35B-Instruct ★
**Alibaba/Qwen** · 2025-07 · Apache 2.0 · 480B total / 35B active (MoE) · 262K ctx · spec: agentic · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/Qwen/Qwen3-Coder-480B-A35B-Instruct)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench 67  

Alibaba Qwen's flagship agentic code model, a 480B total / 35B active MoE (160 experts, 8 active) that set SOTA open results on agentic coding/tool-use (SWE-bench Verified 67 without test-time scaling, 69.6 with 500-turn scaling), comparable to Claude Sonnet 4. Native 262K context extendable to ~1M, for long-horizon repo-level agent workflows. Non-thinking.

### NVIDIA Nemotron 3 Ultra 550B A55B ★
**NVIDIA** · 2026-06 · OpenMDW License Agreement v1.1 · 550B total / 55B active (MoE) · reasoning · 1000K ctx · spec: reasoning · lineage: from-scratch · confidence: high · AAII 38  
[model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16)  
Benchmarks — MMLU-Pro 86.8 · GPQA-D 87 · AIME — · LiveCodeBench 89 · SWE-bench 70.7  

Nemotron 3 Ultra is NVIDIA's frontier-scale open-weight flagship, a 550B-total / 55B-active Latent Mixture-of-Experts model built on a hybrid Mamba-2 + MoE + Attention stack with Multi-Token Prediction, trained from scratch (not derived from Llama). Released June 2026 under the permissive OpenMDW v1.1 license, it targets demanding agentic, long-context (up to 1M tokens; ~262k as served by Artificial Analysis providers), and reasoning workloads. It scores 38 on the Artificial Analysis Intelligence Index at ~$0.58 blended/Mtok and ~153 tok/s, making it the strongest US open-weight model on that index at launch. Its own model card reports MMLU-Pro 86.8, GPQA 87.0, LiveCodeBench v6 89.0, and SWE-bench Verified 70.7, but uses IMOAnswerBench rather than AIME for math (so AIME is unverified).

### DeepSeek-V3
**DeepSeek** · 2024-12 · MIT (code) + DeepSeek Model License (weights) · 671B total / 37B active (MoE) · 128K ctx · spec: general · lineage: from-scratch · confidence: high  
[model card](https://huggingface.co/deepseek-ai/DeepSeek-V3)  
Benchmarks — MMLU-Pro 75.9 · GPQA-D 59.1 · AIME 39.2 · LiveCodeBench 37.6 · SWE-bench 42  

DeepSeek's 671B total / 37B active MoE foundation model (256 routed experts), trained from scratch for only ~2.79M H800 GPU-hours using MLA, auxiliary-loss-free load balancing, FP8 training and Multi-Token Prediction. A landmark efficient frontier-class open model and the base for the V3/R1/V3.1 family (MMLU-Pro 75.9, GPQA 59.1, SWE-bench 42). Non-reasoning.

### DeepSeek-R1
**DeepSeek** · 2025-01 · MIT · 671B total / 37B active (MoE) · reasoning · 128K ctx · spec: reasoning · lineage: derived from DeepSeek-V3-Base · confidence: high  
[model card](https://huggingface.co/deepseek-ai/DeepSeek-R1)  
Benchmarks — MMLU-Pro 84 · GPQA-D 71.5 · AIME 79.8 · LiveCodeBench 65.9 · SWE-bench 49.2  

DeepSeek's first large-scale reasoning model, post-trained from DeepSeek-V3-Base via large-scale RL (GRPO) plus cold-start SFT, sharing the 671B/37B MoE. Its January 2025 release stunned the field by matching OpenAI o1-class reasoning at open-weight cost under MIT (MMLU-Pro 84, GPQA 71.5, AIME-2025 79.8, SWE-bench 49.2). Parent of the R1 distill series.

### DeepSeek-R1-0528
**DeepSeek** · 2025-05 · MIT · 671B total / 37B active (MoE) · reasoning · 128K ctx · spec: reasoning · lineage: derived from DeepSeek-V3-Base · confidence: high  
[model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-0528)  
Benchmarks — MMLU-Pro 85 · GPQA-D 81 · AIME 87.5 · LiveCodeBench 73.3 · SWE-bench 57.6  

May 2025 refresh of DeepSeek-R1 with substantially deeper reasoning (average AIME token usage roughly doubled), pushing AIME-2025 to 87.5, GPQA to 81 and LiveCodeBench to 73.3, narrowing the gap to closed frontier reasoners (SWE-bench 57.6). Also reduced hallucination and improved tool/function calling. 671B/37B MoE, MIT.

### DeepSeek-V3.1 ★
**DeepSeek** · 2025-08 · MIT · 671B total / 37B active (MoE) · reasoning · 128K ctx · spec: agentic · lineage: derived from DeepSeek-V3-Base · confidence: high  
[model card](https://huggingface.co/deepseek-ai/DeepSeek-V3.1)  
Benchmarks — MMLU-Pro 84.8 · GPQA-D 80.1 · AIME 88.4 · LiveCodeBench 74.8 · SWE-bench 66  

Hybrid model supporting both thinking and non-thinking modes in one checkpoint, post-trained on a long-context-extended V3.1-Base, sharing the 671B/37B MLA MoE and adding much stronger tool calling and agentic behavior (MMLU-Pro 84.8, GPQA 80.1, AIME-2025 88.4, LiveCodeBench 74.8, SWE-bench 66). The campaign's frontier dense-MoE workhorse. MIT.

### DeepSeek-V3.1-Terminus
**DeepSeek** · 2025-09 · MIT · 671B total / 37B active (MoE) · reasoning · 128K ctx · spec: agentic · lineage: derived from DeepSeek-V3.1 · confidence: med  
[model card](https://huggingface.co/deepseek-ai/DeepSeek-V3.1-Terminus)  
Benchmarks — MMLU-Pro 85 · GPQA-D 80.7 · AIME 88 · LiveCodeBench 74.9 · SWE-bench 68.4  

September 2025 stability-and-agent refresh of DeepSeek-V3.1, keeping the 671B/37B hybrid-thinking MoE. Improved language consistency and sharpened the Code Agent and Search Agent, nudging SWE-bench Verified to ~68.4 (GPQA 80.7, AIME-2025 88, LiveCodeBench 74.9). Immediate predecessor of V3.2-Exp. MIT.

### DeepSeek-V3.2-Exp
**DeepSeek** · 2025-09 · MIT · 685B total / 37B active (MoE) · reasoning · 128K ctx · spec: agentic · lineage: derived from DeepSeek-V3.1-Terminus · confidence: med  
[model card](https://huggingface.co/deepseek-ai/DeepSeek-V3.2-Exp)  
Benchmarks — MMLU-Pro 85 · GPQA-D 79.9 · AIME 89.3 · LiveCodeBench 74.1 · SWE-bench 67.8  

Experimental release introducing DeepSeek Sparse Attention (DSA), the lab's first fine-grained sparse-attention mechanism, built on V3.1-Terminus to validate long-context efficiency. Keeps the ~685B/37B MoE shape while sharply cutting long-context cost at near-identical quality (AIME-2025 89.3, SWE-bench 67.8, LiveCodeBench 74.1). A step toward DeepSeek's next-gen architecture. MIT.

### GLM-5.2 (max) ★
**Z AI (Zhipu AI)** · 2026-06 · MIT · 753B total / 40B active (MoE) · reasoning · 1000K ctx · spec: agentic · lineage: derived from GLM-5 / GLM-5.1 (744B MoE base, DeepSeek Sparse Attention) · confidence: med · AAII 51  
[model card](https://huggingface.co/blog/zai-org/glm-52-blog)  
Benchmarks — MMLU-Pro — · GPQA-D 91.2 · AIME 99.2 · LiveCodeBench — · SWE-bench —  

GLM-5.2 is Z AI's (Zhipu) flagship open-weight Mixture-of-Experts model released June 2026, sharing the GLM-5 family's ~753B-total / 40B-active architecture with DeepSeek Sparse Attention but extending the context window to 1M tokens. It became the leading open-weight model on the Artificial Analysis Intelligence Index v4.1 (AAII 51), ranking 4th overall and trailing only top proprietary models. It is tuned for long-horizon agentic coding, scoring 62.1 on SWE-bench Pro and 81.0 on Terminal-Bench 2.1, plus AIME 2026 99.2 and GPQA-Diamond 91.2. Z AI did not publish standard SWE-bench Verified, MMLU-Pro, or LiveCodeBench numbers at launch, so those are left unverified.

### GLM-5.1
**Z AI (Zhipu AI)** · 2026-04 · MIT · 754B total / 40B active (MoE) · reasoning · 200K ctx · spec: agentic · lineage: derived from GLM-5 (744-754B MoE base, DeepSeek Sparse Attention) · confidence: med · AAII 40  
[model card](https://huggingface.co/zai-org/GLM-5.1)  
Benchmarks — MMLU-Pro — · GPQA-D 86.2 · AIME 95.3 · LiveCodeBench — · SWE-bench —  

GLM-5.1 is a post-training upgrade of Z AI's GLM-5 base, keeping the ~754B-total / 40B-active Mixture-of-Experts architecture with a 200K-token context and up to 128K output tokens, released April 2026 under MIT. It targets long-horizon agentic engineering, able to sustain a single coding task across hundreds of self-evaluation rounds and thousands of tool calls. Reported scores include AIME 2026 95.3, GPQA-Diamond 86.2, and SWE-bench Pro 58.4 (topping the SWE-bench Pro leaderboard at release). It scores 40 on the Artificial Analysis Intelligence Index; standard MMLU-Pro, LiveCodeBench, and SWE-bench Verified figures were not cleanly published.

### Kimi-K2-Instruct
**Moonshot AI** · 2025-07 · Modified MIT · 1000B total / 32B active (MoE) · 128K ctx · spec: agentic · lineage: derived from Kimi-K2-Base · confidence: high  
[model card](https://huggingface.co/moonshotai/Kimi-K2-Instruct)  
Benchmarks — MMLU-Pro 81.1 · GPQA-D 75.1 · AIME 49.5 · LiveCodeBench 53.7 · SWE-bench 65.8  

Moonshot AI's 1-trillion-total / 32B-active MoE (384 experts, 8 active + 1 shared, MLA), post-trained into a 'reflex-grade' non-thinking instruct model optimized for agentic and tool-use tasks. Strong agentic coding without long CoT (SWE-bench 65.8 single / 71.6 multi-attempt, MMLU-Pro 81.1); AIME-2025 49.5 reflects the no-reasoning design.

### Kimi-K2-Thinking ★
**Moonshot AI** · 2025-11 · Modified MIT · 1000B total / 32B active (MoE) · reasoning · 256K ctx · spec: agentic · lineage: derived from Kimi-K2-Base · confidence: high  
[model card](https://huggingface.co/moonshotai/Kimi-K2-Thinking)  
Benchmarks — MMLU-Pro 84.6 · GPQA-D 84.5 · AIME 94.5 · LiveCodeBench 83.1 · SWE-bench 71.3  

Moonshot AI's reasoning + tool-orchestration flagship, sharing the 1T-total / 32B-active MoE (384 experts) but adding long step-by-step thinking interleaved with function calls, 256K context. One of the strongest open models on hard reasoning and agentic coding (GPQA 84.5, LiveCodeBench 83.1, SWE-bench 71.3, AIME-2025 94.5 no-tools). Needs a giant cluster to fit but serves at ~32B-active speed once resident.

### Kimi K2.6 ★
**Moonshot AI** · 2026-04 · Modified MIT License · 1000B total / 32B active (MoE) · reasoning · 256K ctx · spec: agentic · lineage: derived from Kimi K2.5 · confidence: high · AAII 43  
[model card](https://huggingface.co/moonshotai/Kimi-K2.6)  
Benchmarks — MMLU-Pro — · GPQA-D 90.5 · AIME 96.4 · LiveCodeBench 89.6 · SWE-bench 80.2  

Kimi K2.6 is Moonshot AI's flagship open-weight, natively-multimodal agentic model, released April 20, 2026 under a Modified MIT License. It is a 1-trillion-parameter Mixture-of-Experts model (384 experts, 8 active + 1 shared) with 32B activated parameters, MLA attention, a 256K-token context window, and both thinking and instant modes. Official numbers include GPQA-Diamond 90.5, AIME 2026 96.4, LiveCodeBench v6 89.6, and SWE-bench Verified 80.2; MMLU-Pro was not published (only the vision MMMU-Pro at 79.4). It scored 43 on the Artificial Analysis Intelligence Index, making it the leading open-weights model at launch.

### Kimi K2.7 Code ★
**Moonshot AI** · 2026-06 · Modified MIT License · 1000B total / 32B active (MoE) · reasoning · 256K ctx · spec: coding · lineage: derived from Kimi K2.6 · confidence: high · AAII 42  
[model card](https://huggingface.co/moonshotai/Kimi-K2.7-Code)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench — · SWE-bench —  

Kimi K2.7 Code, released June 12, 2026, is a coding-specialized upgrade built on the Kimi K2.6 foundation, sharing the same 1T-parameter / 32B-active MoE architecture (384 experts), 256K context, native INT4 quantization, and Modified MIT License. It makes thinking mode mandatory (disabling it returns an API error) while cutting reasoning-token consumption roughly 30% versus K2.6. Moonshot only published gains on its own proprietary suites (Kimi Code Bench v2 62.0 / +21.8%, Program Bench 53.6, MLS Bench Lite 35.1) and did not release standard MMLU-Pro, GPQA-Diamond, AIME, LiveCodeBench, or SWE-bench Verified scores, drawing criticism for skipping independent benchmark submission. It scored 42 on the Artificial Analysis Intelligence Index.

### MiMo-V2.5-Pro ★
**Xiaomi (MiMo / LLM-Core team)** · 2026-04 · MIT · 1023B total / 42B active (MoE) · reasoning · 1024K ctx · spec: agentic · lineage: derived from MiMo-V2-Flash architecture (hybrid sliding-window + global attention, 3-layer MTP); MiMo-V2.5-Pro-Base · confidence: med · AAII 42  
[model card](https://huggingface.co/XiaomiMiMo/MiMo-V2.5-Pro)  
Benchmarks — MMLU-Pro — · GPQA-D — · AIME — · LiveCodeBench 80.6 · SWE-bench 78.9  

MiMo-V2.5-Pro is Xiaomi's flagship open-weight Mixture-of-Experts LLM with ~1.02T total parameters and 42B active per token, released April 22, 2026 under the MIT license. It uses the MiMo-V2-Flash hybrid-attention architecture (interleaved sliding-window and global attention) with 3 lightweight multi-token-prediction modules and a 1M-token context window, and is a reasoning/agentic model targeting long-horizon software-engineering and tool-use tasks. Verified post-training results include 78.9% SWE-bench Verified and 80.6 LiveCodeBench (plus 48.0 Humanity's Last Exam and 57.2 SWE-bench Pro); the model card's MMLU-Pro 68.5 / GPQA-Diamond 66.7 / AIME 37.3 figures are explicitly base-model scores, so instruct values for those three are left unverified. Artificial Analysis places it at Intelligence Index 42 with a blended price near $0.18/Mtok.

### DeepSeek-V4-Pro ★
**DeepSeek** · 2026-04 · MIT · 1600B total / 49B active (MoE) · reasoning · 1000K ctx · spec: reasoning · lineage: from-scratch · confidence: high · AAII 44  
[model card](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro)  
Benchmarks — MMLU-Pro 87.5 · GPQA-D 90.1 · AIME 95.2 · LiveCodeBench 93.5 · SWE-bench 80.6  

DeepSeek-V4-Pro is the flagship of DeepSeek's V4 line, a 1.6T-parameter Mixture-of-Experts model with 49B active parameters and a 1M-token context window, released open-weight under MIT on April 24, 2026. It introduces a new hybrid attention architecture (Compressed Sparse Attention + Heavily Compressed Attention) that cuts 1M-token inference to roughly 27% of the FLOPs and 10% of the KV cache versus DeepSeek-V3.2. The model is a hybrid reasoner with three effort modes (Non-think, Think High, Think Max); the Max/High leaderboard entries are effort settings of this single model, scoring AAII 44 (Max) and 41 (High). Think-Max benchmarks include MMLU-Pro 87.5, GPQA-Diamond 90.1, LiveCodeBench 93.5, and SWE-bench Verified 80.6.

