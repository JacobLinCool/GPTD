# 真實世界資料中心 LLM 推論：參考檔案 (Reference Dossier)

> 本檔案由六個獨立研究章節合併、去重、重新組織而成，作為「真實感模擬器重新設計」的事實基礎。
> 範圍：2024–2026 年資料中心 LLM 推論的請求工作負載、後訓練、安全防護、serving 系統技術、硬體現實、開放權重模型版圖。
> 原則：**保留所有具體數字、表格與行內引用**；來源分歧處保留範圍並標示分歧；正體中文(台灣)敘述，技術名詞 / 產品名 / 數字一律 verbatim。
> 可信度標註慣例：(confidence: high/med/low)；凡無法以 ≥2 個獨立來源交叉驗證者均已標明。

---

## 0. 一頁速覽 (10–15 條工程模擬器必須尊重的真相)

1. **一切請求差異 = prefill/decode 比例。** 輸入 token 驅動 **compute-bound** 的 prefill(決定 TTFT);輸出 token 驅動 **memory-bandwidth-bound** 的 decode(決定 TPOT 與總延遲)。算術強度 prefill 200–400 vs decode 60–80 ops/byte;H100 計算利用率 prefill 90–95% vs decode 20–40%。
2. **三種根本工作負載形態**:prefill-heavy(RAG/摘要/分類,I:O 可達 100:1)、decode-heavy(內容生成/推理 CoT,輸出可達 33K token)、balanced(聊天/翻譯)。
3. **SLO 隨「規模 × context × 互動性」分層**:程式碼補全 TTFT < 100–200 ms 最嚴;聊天 100–500 ms;405B 長 context 可放寬到 6 s;batch 不在意延遲只看 TPS/$。MLPerf 同模型分 Conversational(2000/200 ms)與 Interactive(450/40 ms)兩檔。
4. **Goodput(符合 SLO 的吞吐)才是真正的最佳化目標**,而非裸 throughput。
5. **可快取性是 production 第一要務**:prefix/KV cache 命中率 60–85% 可達,成本降 5–12×,TTFT 降可達 79–85%;agentic 與 RAG 收益最大。
6. **幾乎所有後訓練都是 per-model**:每做一次(CPT/SFT/DPO/GRPO/safety/distill/merge)就產生一個新權重 artifact;真正屬於 serving 層的只有 **multi-LoRA 動態服務** 與 **PTQ 量化版本部署**。
7. **安全分兩層且本質不同**:第一層 model-intrinsic(RLHF/CAI/safety SFT/safe-completion)烤進權重、推論時不可逐請求調整;第二層 external guardrails(分類器/moderation/規則)在 request path 上、可逐請求開關調閾值,代價是疊加延遲與成本。
8. **decode 是 memory-bandwidth-bound、prefill 是 compute-bound**——這是 PagedAttention、KV 量化、MLA、speculative decoding、chunked prefill、P/D disaggregation 等幾乎所有 serving 技術的根本動機。
9. **batch size 是調節器**:小 batch → speculative decoding 大勝、GPU 算力閒置;大 batch → throughput 飽和、speculative decoding 失效(batch ≥32–64)、轉為 compute-bound。
10. **MoE 的記憶體-算力解耦是成本結構最重要的單一事實**:**VRAM 帳單按總參數**(全部 expert 須常駐),**算力帳單按 active 參數**(每 token 只算被選中的 expert)。當前前沿稀疏比 active/total ≈ 3%–10%。
11. **記憶體速算**:FP16 下 1B 參數 ≈ 2 GB;FP8 ≈ 1 GB;INT4 ≈ 0.5 GB。KV cache 長 context 下會主導記憶體,GQA/MQA/MLA 是縮 KV 的關鍵。
12. **冷卻分界**:單卡 TDP ≲ 1,000 W 可氣冷;≳ 1,000–1,200 W(GB200/GB300/MI355X)需直接液冷(DLC)。NVL72 機櫃 ~120 kW 遠超傳統氣冷機櫃(~10–15 kW)。
13. **$/Mtoken = ($/GPU-hr × 3,600) / (聚合 tokens/s × 1,000,000)**;低利用率致命(10% 負載可使每 token 成本暴增 ×10,比 premium API 還貴)。
14. **能力壓縮(capability compression)是 2025–2026 核心真相**:Qwen3-4B-Thinking-2507(僅 4B)AIME25 81.3、GPQA-D 65.8,逼近一年前需 671B(DeepSeek-R1)的區間;但 **agentic / SWE-bench 維度規模與後訓練仍拉開明顯差距**——這是大模型仍值錢之處。
15. **lineage 是機器可讀的**:`base → instruct → reasoning/distill → community FT/merge → quantized`;HF `base_model` metadata 自動推斷 `finetune` / `quantized` / `adapter` / `merge` 關係。授權繼承基底。

---

# 1. 請求 / 工作負載的第一性原理分類

> 核心問題:「是什麼根本屬性讓一個推論請求不同於另一個?」答案是 **prefill 與 decode 的比例與絕對量**。不要用應用標籤(chatbot、客服、寫程式)分類,要用正交的根本屬性。

## 1.1 根本機制:Prefill 對 Decode 的分裂

每個自迴歸 LLM 請求在執行時被切成兩個物理性質截然不同的階段。

| 階段 | 計算內容 | 平行度 | 主要輸出 |
|---|---|---|---|
| **Prefill(預填充)** | 一次性平行處理整個輸入 prompt,建立 KV cache | 整個序列同時處理 → 矩陣×矩陣 (GEMM) | 第一個 token + 完整 KV cache |
| **Decode(解碼)** | 逐一自迴歸生成輸出 token,每步讀取完整 KV cache | 每次只算 1 個 token → 向量×矩陣 (GEMV) | 後續每一個 token |

[source: https://www.weka.io/learn/ai-ml/prefill-and-decode/] [source: https://towardsdatascience.com/prefill-is-compute-bound-decode-is-memory-bound-why-your-gpu-shouldnt-do-both/]

### 為什麼 Prefill 是 compute-bound、Decode 是 memory-bandwidth-bound

關鍵在 **arithmetic intensity(算術強度,每讀取一 byte 記憶體所執行的浮點運算數)**,以 roofline 模型解讀:

| 指標 | Prefill | Decode | 出處 |
|---|---|---|---|
| Arithmetic intensity | **200–400 ops/byte** | **60–80 ops/byte**(下降 3–5×) | [TDS] |
| GPU 計算利用率 (H100 SXM) | **90–95%**(tensor core 為瓶頸) | **20–40%**(記憶體匯流排飽和) | [TDS] |
| 運算型態 | 批次化矩陣×矩陣乘法 (GEMM) | 向量×矩陣乘法 (GEMV) | [TDS] [SARATHI] |
| 瓶頸資源 | Tensor core 算力 | HBM 記憶體頻寬 | [TDS] |

[source: https://towardsdatascience.com/prefill-is-compute-bound-decode-is-memory-bound-why-your-gpu-shouldnt-do-both/]

具體例子:**Llama 70B 在單張 H100 上,prefill 階段達 92% 計算利用率;約 30 ms 後進入 decode,同一張 GPU 掉到 30%。** [source: TDS]

> **數字分歧/補充**:TDS 給 decode 算術強度 60–80 ops/byte;更基礎的分析指出在 batch size = 1 時 decode 算術強度約等於 1(每個權重 byte 只用一次,§5 硬體節寫作 ~1–2 FLOP/byte),只有靠加大 batch 才能把算力拉高。SARATHI 證實:「prefill 即使在小 batch 也能飽和 GPU 算力,而 decode 因每次只生一個 token 導致計算利用率極低。」(confidence: high) [source: https://arxiv.org/abs/2308.16369]

**根本物理含義:**
- Prefill 成本 ∝ 輸入 token 數(且因 attention 為 O(n²),長 prompt 的 prefill 成本超線性成長);決定 **TTFT**。
- Decode 成本 ∝ 輸出 token 數 × (每步須重讀的 KV cache 大小);決定 **TPOT / 總生成時間**。
- 兩階段資源畫像相反,同機混跑會互相干擾(prefill 長尾延遲卡住 decode 平滑出 token),這是 **PD 分離(disaggregation)** 與 **chunked prefill** 兩條技術路線的動機(細節見 §4)。

## 1.2 請求的根本軸 (Root Axes)

任何真實請求都是這些正交軸上的一個座標點:

| # | 軸 | 範圍 / 兩極 | 主要影響 |
|---|---|---|---|
| 1 | **輸入 token 數(prompt 長度)** | 16 → 128K+ tokens | Prefill 成本、TTFT |
| 2 | **輸出 token 數(生成長度)** | 0(embedding) → 33K+(長 CoT) | Decode 成本、總延遲、$ 成本 |
| 3 | **輸入/輸出比** | summarization 可達 100:1;content gen / agentic loop 反向偏輸出 | 落在 prefill-heavy 或 decode-heavy |
| 4 | **總 context 長度** | 短(<4K)/ 中(8–32K)/ 長(128K–1M) | KV cache 記憶體佔用、decode 每步重讀量 |
| 5 | **任務難度 / 推理深度** | 直接回答 → 長鏈 CoT「思考」 | 輸出爆量(thinking tokens),test-time scaling |
| 6 | **延遲敏感度(延遲類別)** | Interactive(IN)/ Near-Real-Time(NR)/ Throughput-Oriented(TO, batch) | SLO 嚴格度、是否串流 |
| 7 | **工具使用 / agentic 多輪** | 單次 → 多步驟 loop(latency 跨步累積) | context 累積、prefix 可快取性 |
| 8 | **結構化輸出** | 自由文字 → JSON / function call / grammar 受限 | 解碼受約束、輸出較短且可預測 |
| 9 | **串流 vs 非串流** | streaming(看 ITL/TPOT)/ non-streaming(看 E2EL) | 使用者體感主導指標不同 |
| 10 | **可快取性(prefix / KV cache 命中率)** | 共享 system prompt、RAG 文件、agent 歷史 | 大幅降低 prefill 成本與 TTFT |

來源:工作負載分檔依 [source: https://datatracker.ietf.org/doc/html/draft-mondal-llm-serving-workload-profiles-00];輸入序列組成(系統 prompt + 歷史 + CoT + RAG 文件)依 [source: https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts/];可快取性依 [source: https://bentoml.com/llm/inference-optimization/prefix-caching]。

### 可快取性(軸 10)——量化

- **Prefix caching(= prompt caching / context caching)**:不同請求若共享相同前綴(system message、工具定義、RAG 文件、長對話歷史),可重用該前綴的 KV cache,跳過重算。最佳實務:靜態內容前置、動態/使用者內容後置。 [source: https://bentoml.com/llm/inference-optimization/prefix-caching]
- **可達命中率**:在 agent loops、多租戶 SaaS、repo Q&A、長文件工作流中,**60–85%** 命中率可達,每次呼叫成本降 **5–12×**。 [source: https://llm-d.ai/blog/kvcache-wins-you-can-see]
- **Anthropic prompt caching(GA 2024-12-17)**:長 prompt 成本最多降 **90%**、延遲最多降 **85%**;cache 讀取價為標準輸入的 1/10;cache 寫入為 1.25×(5 分鐘 TTL)或 2.0×(1 小時 TTL)。100K-token 快取 prompt 實測:成本降 90%、TTFT 降 **79%**。 [source: https://www.anthropic.com/news/prompt-caching] [source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching]
- **Agentic 的極端比例**:agent 系統的 prefix 含目標、工具定義、長動作/觀察歷史,production 資料顯示 input:output 比可超過 **100:1**,使 prefix 壓倒性地大——也使 prefix caching 收益最大。 [source: https://bentoml.com/llm/inference-optimization/prefix-caching]

> serving 層的 prefix caching 技術實作(Automatic Prefix Cache / RadixAttention / LMCache offloading)見 §4.2。

## 1.3 真實 SLO 指標與量測公式

| 指標 | 定義 | 公式 | 主導階段 |
|---|---|---|---|
| **TTFT**(Time To First Token) | 送出請求到收到第 1 個 token;含排隊 + prefill + 網路 | — | Prefill |
| **TPOT**(Time Per Output Token) | 除第 1 token 外,平均每個輸出 token 的間隔 | `(E2EL − TTFT) / (Output_tokens − 1)` | Decode |
| **ITL**(Inter-Token Latency) | 相鄰兩 token 的實際間隔(單請求時其平均 = TPOT) | `Σ ITL / 總輸出 token` | Decode |
| **E2EL**(End-to-End Latency) | 送出到收到最後一個 token | `TTFT + generation_time` | 兩者 |
| **Throughput (TPS)** | 全系統每秒輸出 token 數 | `總輸出 token / (T_end − T_start)`;在最大 batch 附近飽和 | Decode 主導 |
| **TPS per user** | 單一使用者觀感速度 | `OSL / E2EL`,輸出愈長愈趨近 `1/ITL` | Decode |
| **RPS** | 每秒完成請求數 | `完成請求數 / 時間窗`(未計請求複雜度差異) | — |
| **Goodput** | **滿足 SLO 的**每秒請求/ token 數(= 被品質過濾後的 throughput) | 例:同時滿足 `TTFT ≤ 200 ms 且 E2EL ≤ 3000 ms` 的請求率 | — |

[source: https://bentoml.com/llm/inference-optimization/llm-inference-metrics] [source: https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts/]

**Goodput 是現代服務最重要的最佳化目標**:throughput 告訴你系統做了多少工,goodput 告訴你其中多少符合品質門檻。PD 分離與多 SLO 排程的核心目標都是最大化 goodput。 [source: https://qainsights.com/throughput-vs-goodput-the-performance-metric-you-are-probably-ignoring-in-llm-testing/] [source: https://arxiv.org/pdf/2401.09670]

> 換算常數:**1 token ≈ 0.75 個英文字**。 [source: NVIDIA]

### 各工作負載類別的典型 SLO 目標(交叉驗證)

| 工作負載 | TTFT 目標 | TPOT / ITL 目標 | 主導指標 | 來源 |
|---|---|---|---|---|
| 互動式聊天 | < 200 ms(嚴格)~ < 500 ms(寬鬆) | ~ 20–50 ms(≈ 人類閱讀速度,20–50 tok/s) | TTFT,再看 ITL | [BentoML] [IETF] [MLPerf] |
| 程式碼補全 (code completion) | **< 100–200 ms**(最嚴) | 低 | TTFT | [BentoML] [IETF] |
| 長文件串流生成 | 寬鬆 | ITL/TPOT 平滑 | ITL/TPOT + E2EL | [BentoML] |
| Agentic 工作流 | 各步寬鬆,但**跨步累積** | — | E2EL(端到端) | [BentoML] [IETF] |
| 離線批次處理 | 不重要 | 不重要 | TPS + 每 token 成本 | [BentoML] [IETF] |
| Near-Real-Time(NR) | — | — | 總延遲 < 5 秒 | [IETF] |

> **TTFT 聊天目標的來源分歧**:BentoML 與 IETF 草案以 < 500 ms 為「使用者體驗目標」;goodput 範例與部分系統論文用 ≤ 200 ms;業界常用「人類感知門檻 ~ 100–200 ms」。**結論:互動聊天 TTFT 合理範圍為 100–500 ms,程式碼補全更嚴格(100–200 ms)。** [source: https://bentoml.com/llm/inference-optimization/llm-inference-metrics] [source: https://datatracker.ietf.org/doc/html/draft-mondal-llm-serving-workload-profiles-00]

### MLPerf Inference 的權威 SLO 約束 (p99)

MLPerf 把同一模型分成不同情境,直接體現「同模型、不同 SLO 類別」:

| Benchmark / 情境 | p99 TTFT | p99 TPOT | ISL / OSL | 來源 |
|---|---|---|---|---|
| Llama-2-70B,**Conversational** | 2000 ms | 200 ms | — | [MLCommons v5.0] |
| Llama-2-70B,**Interactive**(v5.0 新增,更嚴) | **450 ms** | **40 ms**(≈ 25 tok/s @ p99) | — | [MLCommons v5.0] |
| Llama-3.1-405B(長 context) | **6 s** | **175 ms** | mean ISL/OSL = **9,400 / 680**;context window 128K | [MLCommons v5.0] |

[source: https://mlcommons.org/2025/04/llm-inference-v5/]

> 觀察:模型愈大、context 愈長,SLO 必然放寬(405B 的 TTFT 上限 6 s vs 70B interactive 的 450 ms)。這量化了「難度/規模 ↔ 延遲容忍度」的真實取捨。

## 1.4 真實工作負載原型:token 分布與 SLO

### NVIDIA 官方各用途的 ISL/OSL 基準

| 用途 | ISL(輸入) | OSL(輸出) | 形態 |
|---|---|---|---|
| Translation(翻譯) | ~ 500–2000 | ~ 500–2000 | 均衡 |
| Generation(內容生成) | ~ 100 | ~ 1000 | decode-heavy |
| Summarization(摘要) | ~ 1000 | ~ 100 | prefill-heavy |
| Reasoning(推理) | ~ 100 | **~ 1000–10000** | 極度 decode-heavy |

[source: https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts/]

### IETF 工作負載剖面草案:25 個 profile / 6 群組(最完整的真實分類)

> 目前最系統化的「以根本屬性分類」標準化嘗試;延遲類別:IN = Interactive、NR = Near-Real-Time、TO = Throughput-Oriented。 [source: https://datatracker.ietf.org/doc/html/draft-mondal-llm-serving-workload-profiles-00]

| 群組 | Profile | 輸入 tokens | 輸出 tokens | 延遲類 | 特性 |
|---|---|---|---|---|---|
| A 非生成 | EMBED(embedding) | 16–8192 | 0 | TO | 純 prefill,無 decode |
| A | XRANK(cross-encoder rerank) | 128–1K | 1 個 scalar 分數 | NR | 純 prefill |
| A | LOGPR(logprob 評分) | 64–4K | 機率分布 | batch | — |
| B 極短輸出 | CLAS(分類) | 32–2K | 1–10 | NR–TO | prefill-heavy |
| B | SFQA(短問答) | 16–512 | 5–100 | IN–NR | 短 prompt |
| B | FUNC(function calling) | 512–4K | 20–200 | NR | 結構化,目標 sub-second |
| C 互動串流 | CHAT(對話) | 64–16K(成長中) | 50–1K | IN | TTFT 關鍵 |
| C | COMP(程式碼補全) | 256–8K | 5–200 | IN | **sub-200ms TTFT** |
| C | PERS(角色對話) | 2K–10K(system prompt) | 100–2K | IN | 大型共享 context(高可快取) |
| D 預填重 | SUMM(摘要) | 1K–32K | 64–1K | NR | **prefill 主導總延遲** |
| D | LDQA(長文件 QA) | **4K–128K** | 16–512 | NR | 量測 KV cache 效益 |
| D | RAGN(RAG) | 528–8K(context+query) | 64–1K | IN–NR | 文件可快取 |
| E 解碼重 | CGEN(內容生成) | 32–1K | **256–8K** | — | 輸出吞吐為主 |
| E | REAS(推理 / CoT) | 64–2K | **544–33K**(thinking+answer) | NR | 極端 decode 壓力 |
| E | DGEN(資料生成) | 128–2K | 512–16K | TO | — |
| E | TRNS(翻譯) | 32–8K | 32–10K | NR–TO | 語言對相依 |
| F 多步驟 | AGNT(agentic) | 512–16K(累積) | 20–500 / 步 | — | **延遲跨步累積** |
| F | PLAN(規劃) | 128–4K | 256–2K(結構化計畫) | — | 可帶 refinement loop |

### 推理(「思考」)工作負載的輸出爆量——交叉驗證

- DeepSeek-R1 訓練最大輸出長度:8.2k step 前 **32,768**,之後 **65,536** tokens;benchmark 取 20K 上限。 [source: https://arxiv.org/html/2501.12948v1] [source: https://mlcommons.org/2025/09/deepseek-inference-5-1/]
- 商用推理模型實測:單一複雜查詢可產 **10,000** thinking tokens;code review 約 **8,000** reasoning tokens 才產出 300-token 答案;一般「乘 3–5×」估算可見輸出。o3 一個典型 coding 任務:1K 輸入 + 5K 隱藏推理 + 500 可見答案 = **5,500** 計費輸出 token。 [source: https://aioutlooks.com/thinking-tokens-explained/] [source: https://tokenmix.ai/blog/openai-o3-pricing]
- 機制:test-time scaling——讓模型「想」愈久,產生愈多 token、品質持續上升;這是 decode 端負載放大的根本來源。 [source: https://blogs.nvidia.com/blog/deepseek-r1-nim-microservice/]

### 真實 production 的整體分布形態(統計學)

- **輸入長度**最適配 **Pareto / Log-normal**(冪律,有肥尾);**輸出長度**較適配 **Exponential**。 [source: ServeGen, https://arxiv.org/pdf/2505.09999;另見 BlendServe / Intelligent Router]
- 聊天請求多 < 1K 輸出;長生成 / 影片 trace 可輕易 > 5K token。summarization 輸入常為輸出的 10–100×。 [source: 同上搜尋結果群]
- **時間趨勢(放大效應)**:平均 prompt token 從 ~1.5K 增至 > 6K(約 4×),completion 從 ~150 增至 ~400(約 3×)——反映 RAG、長 context、agentic 累積與 CoT 的普及。 [source: OpenRouter 100T study, https://arxiv.org/pdf/2601.10088] (confidence: med,僅取自摘要片段,未能讀全文)
- 常用公開 trace:ShareGPT、WildChat、BurstGPT、Azure-Trace;多模態 OpenVid;benchmark MMLU。 [source: ServeGen / 上述搜尋]

## 1.5 真實系統如何分類 / 路由請求

真實服務並非「先到先服務」,而是依根本屬性做三層分流:

1. **長度感知路由(length-based / length-aware-prefill routing)**:依 prompt 長度把請求分派到不同 worker,避免「短請求被排在長 prefill 後面」的 head-of-line(HoL)阻塞,使短請求不致超出 SLO。 [source: LAPS, https://arxiv.org/pdf/2601.11589] [source: SCORPIO, https://arxiv.org/pdf/2505.23022]
2. **請求型態分類**:Router 依「輸入 token 數 + 預測輸出 token 數」把請求分為例如 *short-prompt-long-response* 與 *long-prompt-short-response*,據此估端到端延遲並選排程策略。 [source: SLO-Aware Scheduling, https://arxiv.org/html/2504.14966v1]
3. **多 SLO / 優先級分層(priority tiers)**:每種任務有各自 SLO;排程器(如模擬退火、PolyServe、Ascendra、SCORPIO)依 SLO + 輸入長度 + 預測輸出長度排優先序;常見兩層架構——上層 cluster router 當流量閘道分派到下游 engine,各 engine 再自行 batching/scheduling。 [source: PolyServe, https://arxiv.org/html/2507.17769] [source: Ascendra, https://openreview.net/pdf?id=PcO3KGW2hs] [source: 兩層排程框架, https://arxiv.org/pdf/2509.23384]

## 1.6 總表:原型 × 根本屬性 (archetype × root-property)

> 統一以根本屬性(非應用標籤)分類。「P/D 偏向」= prefill-heavy / decode-heavy / balanced;延遲類:IN / NR / TO;數字主要源自 §1.4。

| 原型 | 輸入 tokens | 輸出 tokens | 總 context | 難度/推理 | 延遲類 | 可快取 | 工具/多輪 | P/D 偏向 |
|---|---|---|---|---|---|---|---|---|
| Embedding / 向量化 | 16–8K | 0 | 短–中 | 低 | TO(batch) | 低 | 否 | 純 prefill |
| Rerank(cross-encoder) | 128–1K | 1(分數) | 短 | 低 | NR | 中 | 否 | 純 prefill |
| 分類 / 抽取 | 32–2K | 1–10 | 短 | 低 | NR–TO | 中 | 否 | prefill-heavy |
| 短問答 (SFQA) | 16–512 | 5–100 | 短 | 低 | IN–NR | 低 | 否 | 均衡偏 prefill |
| Function calling | 512–4K | 20–200 | 中 | 中 | NR(<1s) | 高(工具定義) | 是(單步) | prefill-heavy |
| 互動聊天 (CHAT) | 64–16K↑ | 50–1K | 短–中(成長) | 中 | IN(TTFT<200–500ms) | 高(歷史/系統prompt) | 可 | 均衡 |
| 程式碼補全 (COMP) | 256–8K | 5–200 | 中 | 中 | IN(**TTFT<100–200ms**) | 高(repo 前綴) | 否 | prefill-heavy |
| RAG / 長 context QA | 528–128K | 16–1K | 中–長 | 中 | IN–NR | 高(文件前綴) | 可 | **prefill-heavy** |
| 摘要 (SUMM) | 1K–32K | 64–1K | 中–長 | 中 | NR | 中 | 否 | **prefill 主導** |
| 內容生成 (CGEN) | 32–1K | 256–8K | 短 | 中 | IN/NR | 低 | 否 | **decode-heavy** |
| 翻譯 (TRNS) | 32–8K | 32–10K | 短–中 | 中 | NR–TO | 低 | 否 | 均衡 |
| 推理 / 長 CoT (REAS) | 64–2K | **544–33K** | 短輸入、長生成 | **高(test-time scaling)** | NR | 中 | 可 | **極端 decode-heavy** |
| Agentic tool-use loop | 512–16K(**累積**) | 20–500 / 步 | 隨步成長(可達極長) | 中–高 | E2EL(跨步累積) | **極高**(系統+工具+歷史,可達 100:1) | **是(多步)** | prefill-heavy / step 級 |
| 規劃 (PLAN) | 128–4K | 256–2K | 中 | 中–高 | — | 中 | 可 | 均衡 |
| 批次 / 離線資料生成 (DGEN) | 128–2K | 512–16K | 中 | 中 | TO | 低 | 否 | decode-heavy |
| 視覺 / 多模態 | 高(影像 token 多) | 視任務 | 中–長 | 中 | IN–NR | 中 | 可 | prefill-heavy(影像編碼) |

> 視覺/多模態列:ServeGen 確認多模態為新興類別 [source: https://arxiv.org/pdf/2505.09999];影像被編碼為大量 input token 使 prefill 負擔重 (confidence: med,token 換算依模型而異)。

---

# 2. Post-training / 微調 分類學

> 核心區分:絕大多數方法是 **per-model(後訓練,寫進權重,每個模型訓一次)**;只有少數(multi-LoRA serving、PTQ 後的權重交換)觸及 **serving/infra 層**。安全對齊(safety alignment)是 **per-model 的後訓練步驟**,不是推論時的開關。

## 2.0 全景:現代後訓練堆疊 (modular post-training stack)

2024–2026 的共識是把後訓練拆成模組化管線,而非單一 RLHF:**SFT(指令遵循)→ preference optimization(DPO/SimPO/KTO,對齊偏好)→ RLVR(GRPO/DAPO,可驗證獎勵的推理 RL)**。RLHF 並未被完全取代,但 DPO 系與 RLVR 系大幅蠶食其地盤 [source: https://llm-stats.com/blog/research/post-training-techniques-2026]。

## 2.1 Continued / Domain-Adaptive Pretraining (CPT / DAPT)

- **做什麼**:在既有 base model 上,用 **未標註的領域語料**(法律、醫療、程式碼、特定語言)以原本的 next-token 目標繼續預訓練,把領域知識寫進權重。
- **改善什麼**:領域內困惑度(perplexity)、領域術語與知識覆蓋;適合「擴充知識/語言」而非「改變行為格式」。
- **資料需求**:大 — 通常數億到數十億 token 等級的領域語料(文獻示例顯示 400M → 1B token 即見效)[source: https://ai.meta.com/blog/adapting-large-language-models-llms/][source: https://arxiv.org/abs/2504.09687]。
- **算力成本**:**所有後訓練方法中最高**(僅次於從頭預訓練),全參數、大語料;相對量級約為 SFT 的 10–100×。
- **主要取捨**:**catastrophic forgetting(災難性遺忘)** — 吸收新領域時會「突然」喪失通用能力,尤其遺忘先前 instruction-following 行為。緩解:混入通用語料(replay)、只更新新增層、遮罩通用關鍵神經元、token-swap 自蒸餾 [source: https://openreview.net/forum?id=Mg6pVmTWlo][source: https://arxiv.org/pdf/2502.12598]。
- **層級**:**per-model(後訓練)**。

## 2.2 SFT / Instruction Tuning(監督式微調 / 指令微調)

- **做什麼**:用 **(prompt, 理想 response)** 配對做監督式學習,教模型「遵循指令、按特定格式回應」。是 base → instruct 的關鍵一步。
- **改善什麼**:指令遵循、輸出格式、對話風格、工具呼叫格式;把「續寫器」變成「助手」。
- **資料需求**:中等但 **品質 > 數量**。從數千到數十萬筆高品質範例;業界共識是少量精選資料常勝過大量雜訊資料(data quality > quantity 是反覆驗證的鐵律)。
- **算力成本**:中。全參數 SFT 仍需與模型同級的顯存;常與 LoRA 合用降本(見 §2.3)。
- **主要取捨**:在窄資料上易 **overfitting**;模仿表面格式而非真正能力;是後續 alignment 的前置(冷啟動)。
- **層級**:**per-model(後訓練)**。

## 2.3 Parameter-Efficient Fine-Tuning (PEFT)

只訓練極少數新增/低秩參數,凍結 base 權重。核心吸引力是「便宜得多」。

| 方法 | 機制 | 可訓練參數 | 顯存/算力 | 能改 / 不能改 | 推論開銷 |
|---|---|---|---|---|---|
| **LoRA** | 凍結 base,於各線性層注入低秩矩陣 ΔW = BA(rank r) | 相對 GPT-3 175B 全 FT **少 ~10,000×** | GPU 顯存 **降 ~3×** | 可改行為/風格/任務適配;不易灌大量新知識 | **零額外延遲**(可合併回權重)[source: https://arxiv.org/abs/2106.09685] |
| **QLoRA** | base 量化為 **4-bit NF4** + Double Quantization + Paged Optimizers,再跑 LoRA | 同 LoRA(僅訓 adapter) | **65B 模型可在單張 48GB GPU 微調**,且維持 16-bit FT 表現 | 同 LoRA;極大降低門檻(8B 可進 8GB VRAM) | 訓練後合併;推論需處理量化基座 [source: https://arxiv.org/abs/2305.14314] |
| **DoRA** | 把預訓練權重分解為 **magnitude(幅度)+ direction(方向)**,方向用 LoRA 更新 | 略多於 LoRA(多一組 magnitude) | 略高於 LoRA、遠低於全 FT | 在 commonsense/視覺指令等任務 **一致勝過 LoRA**,更接近全 FT | **無額外推論開銷** [source: https://arxiv.org/abs/2402.09353] |
| **Adapters(經典)** | 在層間插入小型 bottleneck 模組 | 少 | 低 | 任務適配 | **有額外推論延遲**(LoRA 正是為解此問題而生) |

- **PEFT 共通取捨**:便宜、可多任務切換,但 **容量受限** — rank 太低難承載大幅能力改變或大量新知識;窄資料仍會 overfit。實務 2026 預設值:`r=16` + DoRA + `target_modules="all-linear"`,僅訓 ~0.5% 參數。
- **層級**:**訓練是 per-model;但「以 adapter 形式 serving」橫跨到 serving 層** — 見下。

### Multi-LoRA Serving(adapter 服務化 → SERVING 層)

少數真正屬於 **infra/serving 層** 的後訓練衍生機制:同一 base 上掛載成千上萬個 LoRA adapter,動態批次服務。

- **S-LoRA**:單張 A100 80GB 可同時服務 **up to 2,000 adapters**;以 **Unified Paging**(KV cache 與 adapter 權重共用記憶體池)+ 自訂 CUDA kernel 做異質批次;吞吐相對 vLLM(naive LoRA)**up to 4×**、相對 HuggingFace PEFT **up to 30×** [source: https://www.lmsys.org/blog/2023-11-15-slora/][source: https://arxiv.org/abs/2311.03285]。(詳見 §4.10 serving 層)
- **Punica**:多租戶 LoRA 場景吞吐達 baseline 的 **~12×**,每 token 延遲開銷僅 **~2 ms** [source: 搜尋彙整;原始 Punica 論文]。
- **意義**:adapter 讓「一個 base + N 個輕量人格/領域版本」在同一卡上共存,是 per-model 訓練成果在 infra 層的放大器。

## 2.4 Preference Optimization / Alignment(偏好優化 / 對齊)

> **關鍵釐清**:**安全對齊(safety alignment)是 per-model 的後訓練步驟,把「該拒絕什麼、該如何有幫助」寫進權重**,不是推論時可調的旋鈕。同一 base 的不同對齊版本是 **不同的模型**(不同權重)。推論時能調的只有 system prompt、decoding 參數、外掛 guardrail/分類器(見 §3)。

| 方法 | 機制 | 需要 reward model? | 資料形式 | 算力(相對) | 主要取捨 |
|---|---|---|---|---|---|
| **RLHF (PPO)** | 三階段:SFT → 訓 reward model → PPO 對 RM 做 RL | 是 | 成對偏好 + RM | **最高**(policy+critic+RM+ref 四模型同跑) | 不穩定、超參敏感、貴;**alignment tax**;InstructGPT 用 **PPO-ptx**(混入預訓練梯度)緩解遺忘 [source: https://proceedings.neurips.cc/paper_files/paper/2022/file/b1efde53be364a73914f58805a001731-Paper-Conference.pdf] |
| **DPO** | 把 RM 的最優策略改寫成 **閉式解**,用一個分類損失直接優化 | **否** | 成對偏好 (x, y_w, y_l) | 中(免 RM、免 LM 取樣) | 穩定、輕量、易實作;情感控制勝 PPO-RLHF,摘要/對話相當或更佳 [source: https://arxiv.org/abs/2305.18290] |
| **IPO** | DPO 變體,用 squared loss,避免 DPO「以點估獎勵取代成對偏好」的假設 | 否 | 成對偏好 | 中 | 理論上更抗 overfitting 偏好;實務增益視資料 |
| **KTO** | 受 prospect theory 啟發(loss aversion),用 **二元 desirable/undesirable** 訊號(HALO 損失) | 否 | **非成對的二元標籤**(更便宜易收集) | 中 | 免成對偏好,適合不平衡/稀少回饋;Ethayarajh 2024 [source: https://huggingface.co/papers/2402.01306] |
| **GRPO** | online RL,對單一 prompt 取樣多個輸出,**組內標準化分數當 baseline**,**無 critic/value 網路** | 否(可用 rule-based verifier) | prompt + 可驗證獎勵/驗證器 | **比 PPO 省 40–60% 記憶體**,某些情境 cost-efficiency 達 PPO 的 ~18×;保留 clipped objective + KL | 仍是 online RL;獎勵設計是關鍵;DeepSeekMath 2024 提出 [source: https://huggingface.co/blog/garg-aayush/derive-grpo-loss][source: https://cameronrwolfe.substack.com/p/grpo] |
| **RLAIF** | 用 **AI 產生的偏好/回饋** 取代人工標註 | 是(AI 當標註者) | 模型生成回饋 | 中–高 | 大幅省人工標註成本,可與 RLHF 競爭;回饋品質受標註模型限制 [source: https://rlhfbook.com/c/13-cai] |
| **Constitutional AI (CAI)** | Anthropic:以 ~16 條自然語言「憲法」原則,經 **critique-revision 監督階段 + RLAIF**,把 harmlessness 訊號全改為模型生成 | RLAIF | 紅隊 prompt + 憲法原則 | 中–高 | 降低人工標 harmful 成本、減少「一律拒答」;Claude 系列核心對齊法 [source: https://rlhfbook.com/c/13-cai] |

- **alignment tax(對齊稅)**:安全/指令對齊改善時,通用能力呈 **單調下降** 的取捨。緩解:PPO-ptx、**model averaging(在 RLHF 前後權重間插值,能取得最佳 alignment-forgetting Pareto 前緣)**、online merging [source: https://arxiv.org/abs/2309.06256]。
- **capability vs safety tension**:helpfulness 與 harmlessness 常拉鋸;CAI 正是為了「既安全又不一味拒答」而設計。
- **層級**:**全部是 per-model(後訓練)**。

## 2.5 Reasoning RL / RFT(推理強化學習 — R1-style long CoT)

- **做什麼**:用 RL(典型為 GRPO)獎勵 **可驗證正確的最終答案**(數學/程式),讓模型自發長出 long chain-of-thought、自我驗證、反思。
- **代表**:**DeepSeek-R1**(arXiv 2501.12948,2025;後登 Nature)。**R1-Zero** 純 RL、無 SFT 冷啟動即湧現推理;**R1** 採「小量精選 CoT 冷啟動 SFT → 迭代 RL」混合策略 [source: https://arxiv.org/pdf/2501.12948][source: https://www.nature.com/articles/s41586-025-09422-z]。
- **資料需求**:不需大量人工標註推理軌跡 — 靠 **可驗證獎勵(RLVR)**;但需要可自動判分的題庫。
- **算力成本**:高(online RL、長序列取樣),但 GRPO 比 PPO 省記憶體。
- **主要取捨**:獎勵 hacking、輸出冗長(模型傾向越寫越長);需平衡推理長度與成本 [source: https://arxiv.org/pdf/2602.09591]。
- **層級**:**per-model(後訓練)**。

## 2.6 Distillation / Model Merging / Soups

| 方法 | 做什麼 | 資料/算力 | 取捨 | 層級 |
|---|---|---|---|---|
| **Distillation(teacher→student)** | 用強 teacher 生成的資料(或 logits)訓練小 student。**DeepSeek-R1 distill**:用 R1 生成的 **~800K 樣本** SFT 到 Qwen(1.5B/7B/14B/32B)與 Llama(8B/70B);R1-Distill-Qwen-32B 在多項基準勝 o1-mini [source: https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B][source: https://github.com/deepseek-ai/deepseek-r1] | 中(主要是 SFT 成本 + teacher 推論生成資料) | 小模型得大模型能力;但受 teacher 上限與資料分布限制;DeepSeek 指出「小模型直接 distill 常勝過對小模型做 RL」 | per-model |
| **Model Soup** | 平均多個 **同 base、不同超參** 微調模型的權重;Uniform / Greedy Soup;不增推論成本 | 低(只是權重平均,免再訓練) | 需同源權重;greedy 需驗證集 | per-model(產出新權重) |
| **Model Stock** | ECCV 2024;只需 **2 個** 微調模型,layer-wise 用 cosine similarity 近似「中心接近」權重,勝 Model Soup [source: https://github.com/naver-ai/model-stock][source: https://dl.acm.org/doi/10.1007/978-3-031-72784-9_12] | 極低 | 僅適用同源微調;非萬靈丹 | per-model |
| **Task/Merge(TIES、DARE 等)** | 合併不同任務的微調權重/task vectors,產出多任務模型 | 低 | 任務衝突、干擾;社群 merge 模型氾濫 | per-model |

## 2.7 Quantization:QAT vs PTQ — 它座落在哪一層?

| 類型 | 何時做 | 機制 | 成本 | 品質 | 層級 |
|---|---|---|---|---|---|
| **PTQ(後訓練量化)** | **訓練後**,僅需小型 **calibration set** 即可定參數,免重訓 | **GPTQ**(二階資訊逐步更新剩餘權重,多 bit-width 彈性)、**AWQ**(activation-aware,保護 0.1–1% 顯著權重的精度,4-bit 表現尤佳,通常勝 GPTQ) | 低 | 4-bit 多可接受,極低 bit 掉分 | **產出的量化權重交給 serving 載入** → 偏 infra/部署層 [source: https://arxiv.org/pdf/2306.00978][source: https://www.newline.co/@zaoyang/gptq-vs-awq-quantization--d792476e] |
| **QAT(量化感知訓練)** | **訓練中** 就嵌入量化目標,讓權重適應低精度 | 需更新權重、訓練開銷大,難擴到超大 LLM | 高 | 通常 **品質較高**(尤其極低 bit) | **per-model(後訓練/訓練的一環)** [source: https://medium.com/better-ml/quantization-aware-training-qat-vs-post-training-quantization-ptq-cd3244f43d9a] |

> 釐清:**PTQ 主要是部署/serving 層的壓縮**(同一組 FP 權重可衍生多種量化版本給不同硬體);**QAT 把量化寫進權重,是 per-model 的訓練步驟**。LLM 社群因 QAT 成本高,**絕大多數用 PTQ**。serving 端的量化格式與精度影響數字見 §4.5。

## 2.8 必須建模的關鍵取捨(彙整)

| 取捨 | 內涵 | 來源 |
|---|---|---|
| **Alignment tax** | 對齊/安全越強,通用能力單調下降;可用 model averaging / PPO-ptx 緩解 | [source: arxiv 2309.06256] |
| **Catastrophic forgetting** | CPT/對齊吸收新知時遺忘舊能力(尤其指令遵循);需 replay/遮罩/merge | [source: openreview Mg6pVmTWlo] |
| **Capability vs safety tension** | helpfulness 與 harmlessness 拉鋸;CAI 為此而生 | [source: rlhfbook c/13-cai] |
| **Data quality > quantity** | 少量精選資料常勝大量雜訊;SFT/偏好資料皆然 | 業界共識 |
| **Overfitting on narrow FT** | 窄資料微調會記表面格式、損通用性;PEFT 低 rank 尤其受限 | §2.2/§2.3 |

## 2.9 真實 LINEAGE 慣例(血統追蹤與命名)

> 與 §6.5 的 roster lineage 互補:此處側重通用慣例與 metadata 機制。

- **典型血統鏈**:`base → instruct → distill → community FT/merge → quantized`(例:`Llama-3.1-8B` → `Llama-3.1-8B-Instruct` → `DeepSeek-R1-Distill-Llama-8B` → 社群再 FT → `…-GGUF/AWQ` 量化版)。
- **Hugging Face `base_model` metadata**:model card YAML 可填 `base_model`(單一或多個 Hub ID),Hub 會自動推斷關係類型 **`adapter` / `merge` / `quantized` / `finetune`**,也可用 `base_model_relation:` 明確指定。此欄位建立 **lineage**,用於可重現性、信任、搜尋過濾,並自動在模型頁顯示衍生關係 [source: https://huggingface.co/docs/hub/en/model-cards]。
- **Model cards**:標準化文件,記錄用途、訓練資料、評估、限制、授權與血統;社群 card 慣例會 reference 原始 card 以保血統清晰。
- **命名實務**(HF 實證研究):命名最常編入 **Architecture(63.9%)、Model size(57.4%)、Task(52.8%)**;社群對「fine-tune 命名收斂」仍在討論中 [source: https://arxiv.org/html/2310.01642v3]。

## 2.10 PER-MODEL vs SERVING/INFRA 層 — 一張總表

| 方法 | 改變什麼 | 資料需求 | 算力成本(相對量級) | 主要取捨 | **層級** |
|---|---|---|---|---|---|
| Continued/Domain pretraining | 領域知識(全參數) | 大(1e8–1e9+ token 領域語料) | **最高**(僅次預訓練,~SFT 的 10–100×) | 災難性遺忘 | **per-model** |
| SFT / Instruction tuning | 指令遵循、格式、人格 | 中,品質 > 數量 | 中 | 窄資料 overfit | **per-model** |
| LoRA | 低秩行為適配 | 小–中 | 低(參數 ~少 10⁴×、顯存 ~降 3×) | 容量受限,難灌大量新知 | per-model(訓);零推論延遲 |
| QLoRA | 同 LoRA,基座 4-bit | 小–中 | 極低(65B 進單 48GB) | 量化基座 | per-model(訓) |
| DoRA | 幅度+方向分解適配 | 小–中 | 低(略高於 LoRA) | 比 LoRA 強,無推論開銷 | per-model(訓) |
| **Multi-LoRA serving (S-LoRA/Punica)** | 同 base 動態掛多 adapter | — | infra 開銷低(~2ms/token) | 記憶體/批次調度 | **SERVING/INFRA** |
| RLHF (PPO) | 偏好對齊 | 成對偏好 + RM | 最高(四模型同跑) | 不穩、貴、alignment tax | **per-model** |
| DPO / IPO / KTO | 偏好對齊(免 RM) | 成對偏好 / 二元標籤 | 中 | 視資料品質 | **per-model** |
| GRPO / Reasoning RL (R1) | 推理能力(long CoT) | 可驗證獎勵題庫 | 高(但比 PPO 省 40–60% 記憶體) | 獎勵 hacking、冗長 | **per-model** |
| RLAIF / Constitutional AI | 安全對齊(AI 回饋) | 憲法原則 + 紅隊 | 中–高 | 回饋品質、過度拒答 | **per-model(安全是後訓練,非推論旋鈕)** |
| Distillation | 把 teacher 能力壓進 student | teacher 生成樣本(R1: ~800K) | 中 | 受 teacher 上限 | **per-model** |
| Model soup / stock / merge | 平均/合併同源權重 | 免再訓 | 極低 | 需同源、任務干擾 | **per-model(產新權重)** |
| **PTQ (GPTQ/AWQ)** | 壓縮權重供部署 | 小 calibration set | 低 | 低 bit 掉分 | **SERVING/INFRA(部署壓縮)** |
| QAT | 量化寫進權重 | 需重訓 | 高 | 成本高難擴 LLM | **per-model** |

**核心結論:**
1. **幾乎所有後訓練都是 per-model**:每做一次就產生一個 **新權重 artifact**,適合用血統樹/科技樹建模。
2. **真正屬於 serving 層的只有兩類**:**multi-LoRA 動態服務** 與 **PTQ 量化版本部署**。
3. **安全對齊不是推論旋鈕**:它是寫死在某個權重版本裡的後訓練成果。
4. 反覆出現的五大物理約束:**alignment tax、catastrophic forgetting、capability-safety tension、data quality > quantity、窄域 overfitting**。

---

# 3. Production Safety / Guardrails(兩層模型)

> 安全分成兩個截然不同的層次,所屬位置(post-training vs serving)、成本結構、可調整性完全不同。把它們混為一談是設計「真實感模擬器」時最常見的錯誤。

## 3.1 第一層:模型內生安全(model-intrinsic safety)— 屬於 post-training,綁定在「每一個模型」上

這層安全在**訓練階段**(更精確說是 post-training / alignment 階段,見 §2.4)烤進模型權重,推論時沒有任何旋鈕可調。技術:

- **RLHF**:三步驟 — 收集人類偏好資料、訓練 reward model、用 PPO 等 RL 演算法微調 LLM;是 post-training 階段提升安全性的主力 [source: Large Language Model Safety: A Holistic Survey, arxiv 2412.17686]。
- **Constitutional AI / RLAIF**:Anthropic 首創,用一組「憲法」原則(取自世界人權宣言、DeepMind Sparrow Rules、Apple 服務條款等)透過監督式學習 + RL 對齊模型;RLAIF 用 AI 回饋取代昂貴人類標註,被證實可與 RLHF 競爭 [source: https://blog.bluedot.org/p/what-is-constitutional-ai ; rlhfbook.com/c/13-cai]。
- **Safety SFT**:用安全範例直接微調拒答/安全行為。

關鍵事實:這層安全的成果就是模型「自己會拒答」或「自己給安全的回答」。**無法在 serving 時逐請求開關**,只能換一個訓練得不同的模型版本(或做進一步微調)來改變。

### 2025 年重要演進:從 hard refusal 走向 safe-completions
OpenAI 在 2025-08 的 GPT-5 中導入 **safe-completions**,把安全訓練重心從「判斷使用者意圖是否安全(二元拒答)」改為「判斷自己的輸出是否安全」。動機是 dual-use 情境(生物、資安):同一問題在高層次回答安全,但給足夠可執行細節就造成 uplift。訓練時每個 completion 同時被評 helpfulness 與 safety,不安全輸出得零獎勵。OpenAI 報告此法同時提升安全性(尤其 dual-use)與 helpfulness [source: https://openai.com/index/gpt-5-safe-completions/ ; GPT-5 System Card, https://cdn.openai.com/gpt-5-system-card.pdf]。這顯示「拒答 vs 安全完成(safe-completion)」是 post-training 層的設計選擇,**不是 serving 旋鈕**。

## 3.2 第二層:外部 Guardrails — 屬於 serving pipeline,是「分開的模型/過濾器」

這層部署在**請求路徑(request path)**上、與主 LLM **分離**的模型或分類器/規則,可逐請求、逐部署設定。典型結構:

```
使用者輸入 → [輸入端 guardrail 模型/分類器] → 主 LLM → [輸出端 guardrail 模型/分類器] → 回傳使用者
```

輸入端做 prompt classification(safe/unsafe);輸出端做 response classification [source: Llama Guard 4 model card, https://huggingface.co/meta-llama/Llama-Guard-4-12B]。精髓:它是**獨立的一次(或多次)模型/分類器推論**,因此疊加延遲與成本,而且**廠商/部署者可自行選擇開或關、調閾值**。

## 3.3 主要 Guardrail 系統一覽(serving 層)

| 系統 | 類型/大小 | 輸入 vs 輸出 | 涵蓋類別/能力 | 延遲/成本 |
|---|---|---|---|---|
| **Llama Guard 4 (Meta)** | 12B,由 Llama 4 Scout 微調,原生多模態(文字+多圖) | 兩者皆可 | MLCommons 14 類危害:S1 Violent Crimes、S2 Non-Violent Crimes、S3 Sex-Related Crimes、S4 Child Sexual Exploitation、S5 Defamation、S6 Specialized Advice、S7 Privacy、S8 Intellectual Property、S9 Indiscriminate Weapons、S10 Hate、S11 Suicide & Self-Harm、S12 Sexual Content、S13 Elections、S14 Code Interpreter Abuse(僅文字) | 12B 生成式模型,需一次完整 LLM 推論 → 比編碼器分類器昂貴許多 [source: https://huggingface.co/meta-llama/Llama-Guard-4-12B ; https://www.llama.com/docs/model-cards-and-prompt-formats/llama-guard-4/] |
| **Llama Guard 3 (1B/8B/11B-vision)** | 1B-INT4 為輕量版 | 兩者皆可 | 同 MLCommons 系統,8 類起 | 1B-INT4 為延遲敏感場景設計 [source: arxiv 2411.17713] |
| **Llama Prompt Guard 2 (Meta)** | 86M(mDeBERTa-base)/ 22M(DeBERTa-xsmall),BERT 系編碼器分類器 | **僅輸入** | jailbreak + prompt injection 二類偵測 | **86M ≈ 92.4 ms / 22M ≈ 19.3 ms**(512 tokens, A100);22M 比 86M 降約 75% 延遲。Recall@1% FPR:86M=97.5%、22M=88.7%(英文) [source: https://github.com/meta-llama/PurpleLlama/blob/main/Llama-Prompt-Guard-2/86M/MODEL_CARD.md] |
| **NVIDIA NeMo Guardrails** | 框架(編排層)+ NemoGuard NIM 模型(content-safety 8B、topic-control 8B、jailbreak-detect) | 五種 rails(見下) | 內容安全(Aegis 2.0 / Nemotron Content Safety taxonomy)、topic control、jailbreak 偵測;NemoGuard content-safety 8B 由 Llama 3.1 8B Instruct 微調,用 30K 對話的 Nemotron Content Safety Dataset V2(前身 Aegis 2.0) | 8B 生成式 NIM:TTFT 約 48–5653 ms 視 concurrency/序列長度;2025 用串流、speculative/parallel 執行、in-memory caching 隱藏延遲 [source: https://developer.nvidia.com/blog/stream-smarter-and-safer... ; https://huggingface.co/nvidia/llama-3.1-nemoguard-8b-content-safety ; https://docs.nvidia.com/nim/llama-3-1-nemoguard-8b-contentsafety/] |
| **OpenAI Moderation API** | `omni-moderation-latest`(基於 GPT-4o,文字+圖)/ `text-moderation-latest`(僅文字) | 輸入/輸出皆可 | 13 類:`harassment`, `harassment/threatening`, `hate`, `hate/threatening`, `illicit`, `illicit/violent`, `self-harm`, `self-harm/intent`, `self-harm/instructions`, `sexual`, `sexual/minors`, `violence`, `violence/graphic`。其中 self-harm*、sexual、violence* 支援圖片;harassment/hate/illicit/sexual-minors 僅文字 | **完全免費使用**;一次額外模型呼叫 [source: https://developers.openai.com/api/docs/guides/moderation ; https://openai.com/index/upgrading-the-moderation-api-with-our-new-multimodal-moderation-model/] |
| **Azure AI Content Safety** | 託管服務 | Prompt Shields(輸入)+ 內容類別(輸入/輸出) | 4 類內容:hate、sexual、violence、self-harm,各 4 級嚴重度(safe/low/medium/high),閾值可調(Low+Med+High / Med+High / High)。**Prompt Shields**(原 Jailbreak risk detection):偵測 direct(使用者越獄)與 indirect(文件/圖片內嵌)注入;2025 Build 推出 **Spotlighting** 區分可信/不可信輸入 | Prompt Shields 為即時(real-time)GA 能力 [source: https://learn.microsoft.com/en-us/azure/ai-services/content-safety/whats-new ; .../concepts/jailbreak-detection ; https://azure.microsoft.com/en-us/blog/enhance-ai-security-with-azure-prompt-shields-and-azure-ai-content-safety/] |
| **ShieldGemma 2 (Google)** | 4B,基於 Gemma 3,**影像內容審核**;前代 ShieldGemma(Gemma 2)有 2B/9B/27B 文字版 | 接受「使用者自定安全政策 + 影像」輸入 | 4 類:sexually explicit、dangerous content、hate、harassment | 4B 模型,生成式分類 [source: https://ai.google.dev/gemma/docs/shieldgemma/model_card_2 ; https://arxiv.org/html/2504.01081v1] |
| **IBM Granite Guardian (3.x)** | 2B / 8B,由 Granite 3.0 instruct 微調 | prompt 與 response 皆可 | 危害類:social bias、profanity、violence、sexual content、unethical behavior、jailbreaking +「harm」總類;**RAG 專屬**:context relevance、groundedness、answer relevance(即幻覺偵測)。輸出 Yes/No + 機率分數可設閾值 | 8B 生成式;harm AUC 0.871、AUPRC 0.846;RAG groundedness 平均 AUC 0.854 [source: https://arxiv.org/html/2412.07724v1] |
| **WildGuard (Ai2 / AllenAI)** | 7B(Mistral 基底),NeurIPS 2024 | 三任務:prompt harm、response harm、**response refusal** | 13 風險類(Privacy、Misinformation、Harmful language、Malicious uses 四大群);WildGuardMix 92K 標註樣本 | F1 上勝過 Llama-Guard2 / Aegis-Guard,refusal 偵測高出 25.3%,對抗式 prompt harm 上勝 GPT-4 達 4.8% [source: https://arxiv.org/pdf/2406.18495 ; https://huggingface.co/allenai/wildguard] |
| **Qwen3Guard (Alibaba)** | 多尺寸(含 8B) | input/output | 在 12 類攻擊上 Qwen3Guard-8B 達 85.3% 最高整體準確率,WildGuard-7B 82.8%,Granite-Guardian-3.3-8B 81.0% [source: arxiv 2511.22047] | 8B 生成式 |
| **Meta LlamaFirewall** | agent 安全框架(生產於 Meta) | 多層 | 三組件:**PromptGuard 2**(越獄/注入分類器)、**AlignmentCheck**(CoT 審計 agent 推理是否偏離使用者目標)、**CodeShield**(線上靜態分析阻擋不安全程式碼) | PromptGuard 2 即時;PromptGuard 2 把 ASR 從 17.6%→7.5%,AlignmentCheck 達 2.9%,合併達 ASR 1.75%(降約 90%)[source: https://arxiv.org/abs/2505.03574 ; https://ai.meta.com/research/publications/llamafirewall-...] |

> 架構要點:**輕量編碼器分類器(Prompt Guard 22M/86M、GLiNER 系)是 BERT 系、單次前向、毫秒級**;而 **Llama Guard 4 12B、NemoGuard 8B、Granite/WildGuard 7-8B 是生成式 LLM,每次判斷等同一次完整(雖較短)的 LLM 推論**,成本與延遲高出一到兩個數量級。這是模擬器中最重要的真實對比。

### NeMo Guardrails 的五種 rails(編排層的標準分類)
依「請求生命週期中觸發時機」分五類 [source: https://developer.nvidia.com/blog/stream-smarter-and-safer... ; https://docs.nvidia.com/nemo/guardrails/]:
1. **Input rails**:使用者輸入到達主 LLM 之前處理(可拒絕/改寫)。
2. **Dialog rails**:控制對話流程、引導/限制 LLM 如何回應。
3. **Retrieval rails**:對 RAG 取回的 chunk 做檢查/遮罩(防止有毒或不相關內容進入 context)。
4. **Execution rails**:對 LLM 呼叫的自訂動作/工具(tool calls)輸入輸出做把關 — 對 agent 安全關鍵。
5. **Output rails**:在回傳使用者前對 LLM 生成內容做最後過濾。

2025 年延遲優化:**speculative/parallel 執行**讓 input rails 與主 LLM 生成平行跑以「隱藏」input rail 延遲;**串流模式**讓 token 邊出邊驗;NemoGuard 模型可用 in-memory caching [source: https://developer.nvidia.com/blog/stream-smarter-and-safer...]。

## 3.4 威脅類別(serving 層要防的東西)

對應 OWASP Top 10 for LLM Applications (2025) [source: https://genai.owasp.org/llmrisk/llm01-prompt-injection/ ; aembit.io/blog/owasp-top-10-llm-risks-explained/]:

- **越獄 / Prompt Injection(LLM01,連兩屆榜首)**:direct(使用者直接越獄)與 indirect(注入藏在文件、網頁、圖片裡)。範例:email 助理被注入惡意指令、履歷藏拆解後的惡意 prompt、圖片內嵌 prompt。
- **有害內容類別**:暴力、仇恨、性、自殘、犯罪指導、CSAM、武器(化生放核)、選舉操弄等(各 guardrail 的 taxonomy 即對應這些)。
- **PII / DLP 外洩**:模型暴露個資、客戶紀錄、認證 token、API key、內部文件、原始碼、財務/法務資料。
- **資料外洩(data exfiltration)**:agent 場景中,一封惡意 email 的 indirect injection 即可命令使用特權服務帳號的 agent 把所有使用者敏感資料送出。
- **Prompt-leaking(系統提示外洩)**:誘使模型吐出 system prompt(其中可能藏 API key 或商業邏輯)。
- **Agent 不安全工具使用(unsafe tool use)**:越權呼叫工具、執行危險動作 — NeMo execution rails 與 LlamaFirewall AlignmentCheck/CodeShield 即針對此。

## 3.5 防禦技術(哪些是 serving,哪些是 dev-time)

| 技術 | 屬於 | 說明 |
|---|---|---|
| Input classification | serving | 用輸入端 guardrail 模型把 prompt 分類 safe/unsafe(Prompt Guard、Llama Guard input、Moderation API) |
| Output filtering | serving | 生成後再過一次 guardrail(Llama Guard output、output rails、Moderation API) |
| System-prompt hardening / spotlighting | serving(部分 dev-time) | 用 system prompt 約束行為、區隔不可信外部內容(Azure Spotlighting) |
| Prompt-injection detection | serving | 專用偵測器(Prompt Guard 2、Azure Prompt Shields、PromptGuard) |
| Refusal vs safe-completion | **post-training** | 注意:這是訓練層的設計選擇(GPT-5 safe-completions),不是 serving 旋鈕 |
| Human-in-the-loop review | serving / ops | 對高風險動作(轉帳、刪除、外送資料)插入人工核可 |
| Red-teaming | **dev-time / eval**(非 serving 旋鈕) | 上線前的對抗測試活動,用來找漏洞與校準,不是請求路徑上的機制 |

> 模擬器設計關鍵分野:**red-teaming 與 RLHF/safe-completion 訓練是「上線前」的活動/屬性;input/output classification、prompt-injection 偵測、moderation pass、HITL 是「上線後逐請求」的機制。**

## 3.6 安全的代價(safety tax / 延遲 / 誤報權衡)

- **延遲疊加**:依 guardrail 類型差異巨大。規則式 ≈ 5–10 ms;AI gateway 轉發開銷 ≈ 3–4 ms(TrueFoundry)甚至微秒級(Bifrost 11 µs @ 5000 RPS);專用編碼器 guardrail 模型決策延遲 2.4–9.5 ms(105–420 decisions/s);**LLM-as-Judge / 生成式 guardrail 開銷最大**,每次評估需一次額外 LLM 推論,顯著增加延遲與成本 [source: https://www.truefoundry.com/blog/benchmarking-llm-guardrail-providers ; arxiv 2605.05277 GLiNER Guard]。具體模型例:Prompt Guard 86M=92.4 ms、22M=19.3 ms;NemoGuard 8B TTFT 數十 ms 到數秒視負載。
- **品質的 safety tax / alignment tax**:當防禦策略需持續啟用,會犧牲模型能力與 helpfulness;安全對齊顯著提升安全但帶來高 over-refusal [source: arxiv 2412.17686 ; arxiv 2510.18081 Any-Depth Alignment]。
- **誤報 / 過度拒答(over-refusal)權衡**:over-refusal = guardrail 錯擋良性查詢的 False Positive Rate;生產級 guardrail 須同時壓低 over-refusal 與 Attack Success Rate(ASR)。**XSTest** 即為量測「誇張安全(exaggerated safety)」的基準,用對比 prompt 對(含敏感關鍵字的安全 prompt vs 真正不安全的對照)測系統是否靠意圖而非關鍵字判斷 [source: arxiv 2604.05179 ; XSTest]。
- **「沒有白吃的午餐」**:加強安全往往犧牲可用性;反之更寬鬆系統留下對抗攻擊缺口。研究實測 Azure Content Safety、Bedrock Guardrails、OpenAI Moderation、Guardrails AI、NeMo Guardrails 等皆受此 tradeoff 約束 [source: No Free Lunch with Guardrails, https://arxiv.org/abs/2504.00441]。
- **對抗式繞過**:多項 2025 研究顯示輸入端 guardrail(prompt injection / jailbreak 偵測器)可被 evasion attack 繞過 [source: arxiv 2504.11168 Bypassing LLM Guardrails]。

## 3.7 直接回答:RLHF 屬於哪裡?serving 層的安全機制是什麼?

- **RLHF / Constitutional AI / safety SFT / safe-completion 訓練 → 屬於 post-training,綁定在「每一個模型」上、烤進權重、推論時不可逐請求調整。** 換安全行為只能換模型版本或再微調。
- **serving 層的安全機制 = 與主 LLM 分離的 guardrail 模型 / moderation pass / 分類器 / 規則**,部署在 request path 上(input 端、output 端、retrieval、execution),可逐請求啟用與調閾值,代價是疊加延遲與額外推論成本。

### 總表:(機制, 層, 攔截什麼, 成本/延遲, 權衡)

| 機制 | 層 | 攔截什麼 | 成本/延遲 | 權衡 |
|---|---|---|---|---|
| RLHF / PPO | post-training(per-model) | 模型內生拒答有害請求 | 訓練期成本;推論期 0 額外延遲 | alignment tax:可能降低 helpfulness;不可逐請求調 |
| Constitutional AI / RLAIF | post-training(per-model) | 依憲法原則對齊行為 | 訓練期(RLAIF 省人工標註) | 同上;原則設計影響行為傾向 |
| Safe-completions training | post-training(per-model) | dual-use 情境給「安全但有用」輸出而非硬拒 | 訓練期 | 取代 hard refusal;降 over-refusal、提 helpfulness(GPT-5) |
| Safety SFT | post-training(per-model) | 直接植入拒答/安全範例 | 訓練期 | 可能 over-refusal |
| Prompt Guard 2(22M/86M) | serving(輸入) | jailbreak + prompt injection | 19.3 ms / 92.4 ms(A100, 512 tok) | 編碼器分類器便宜;可被 evasion 繞過;只看輸入 |
| Llama Guard 4(12B) | serving(輸入+輸出) | 14 類危害內容(含多模態) | 一次 12B 生成式推論(高) | 涵蓋廣但昂貴;閾值/類別可選 |
| OpenAI Moderation(omni) | serving(輸入+輸出) | 13 類有害內容(文字+圖) | 免費;一次額外模型呼叫 | 不偵測越獄/注入;類別固定 |
| Azure Prompt Shields | serving(輸入) | direct + indirect prompt injection | 即時(real-time) | indirect 偵測仍有缺口;Spotlighting 改善 |
| Azure Content Safety(4 類) | serving(輸入+輸出) | hate/sexual/violence/self-harm,4 級嚴重度 | 託管 API 每呼叫計費 | 閾值可調 → over-block vs 漏放 |
| NeMo Guardrails(5 rails) | serving(輸入/對話/檢索/執行/輸出) | 內容安全、topic、越獄、RAG、工具呼叫 | 8B NIM 生成式;可用平行/串流/快取隱藏延遲 | 編排彈性高;LLM 式 rail 延遲高 |
| Granite Guardian(2B/8B) | serving(輸入+輸出) | 危害類 + RAG 幻覺/groundedness | 7-8B 生成式 | 兼顧 RAG;成本中高 |
| WildGuard(7B) | serving(輸入+輸出) | prompt harm / response harm / refusal | 7B 生成式 | 三任務一體;refusal 偵測強 |
| ShieldGemma 2(4B) | serving(輸入/輸出,影像) | 影像 4 類(性/危險/仇恨/騷擾) | 4B 生成式 | 專注影像;政策可自定 |
| LlamaFirewall(PromptGuard+AlignmentCheck+CodeShield) | serving(agent 多層) | 越獄/注入、agent 目標偏離、不安全程式碼 | 即時 + CoT 審計(AlignmentCheck 較貴) | 合併達 ASR 1.75%(降 90%);AlignmentCheck 為 CoT 開銷 |
| HITL review | serving / ops | 高風險動作(轉帳、外送資料) | 人力延遲(秒~分) | 安全最高、吞吐最低 |
| Red-teaming | **dev-time / eval(非 serving)** | 上線前找漏洞、校準閾值 | 開發期人力/算力 | 非請求路徑機制;改善後續模型與 guardrail 設定 |

> 驗證註記:OpenAI moderation 的 13 類與文字/圖片支援、Prompt Guard 2 的 19.3/92.4 ms 與 recall、Llama Guard 4 的 S1–S14、guardrail 延遲級距(規則式 ms vs 生成式 8-12B 數十~數千 ms)等關鍵數字皆由 ≥2 來源(官方 model card/docs + 第三方基準或論文)交叉確認。NeMo Guardrails 五種 rails 以官方部落格 + docs 確認。少數第三方基準(TrueFoundry、GLiNER Guard)為單一來源量級參考,實際數字隨硬體/序列長度/concurrency 變動大。

---

# 4. Serving-system 技術

> 聚焦「執行階段／基礎設施層」——不改變模型權重,純粹在 serving runtime / 排程 / 記憶體管理 / 平行化層級做的事。每項技術標注它優化的是 **latency / throughput / memory / cost** 的哪一面、量化效果,以及它是「純基礎設施(pure-infra)」還是「與模型耦合(model-interacting / infra×model)」。

## 4.1 Continuous / In-flight Batching 與排程器

**做什麼**:傳統 static batching 必須等整批中最長的那個生成完才釋放,造成 GPU 大量閒置。Continuous batching(NVIDIA 稱 in-flight batching)改為 **iteration-level scheduling**:每生成一個 token 就重新排程一次,任何序列一結束就立刻塞新請求進空 slot,讓 GPU 持續滿載。是現代 serving 引擎(vLLM、TGI、TensorRT-LLM、SGLang)的預設行為。

**量化效果**:
- Anyscale 基準(OPT-13B,單張 A100 40GB,無 TP):continuous batching 相對 naive static batching 達 **8x** throughput;再加上 vLLM PagedAttention 記憶體最佳化共達 **23x**。重要 caveat:此 23x 是「continuous batching + PagedAttention 合計」、而非單純 continuous batching;且只在「生成長度高變異」工作負載成立——低變異時 static 與 continuous 表現相近 [source: https://www.anyscale.com/blog/continuous-batching-llm-inference]。
- 一般引用值:相對 Orca/FasterTransformer 等 SOTA,throughput 提升 **2–4x**(同 latency 下)[source: https://dl.acm.org/doi/10.1145/3600006.3613165]。

**排程器演進(vLLM v0.6.0, 2024-09)**:**multi-step scheduling**(一次排程、連跑 n 步)讓 Llama 70B / 4×H100 throughput +28%;**asynchronous output processing** 讓同配置 TPOT 改善 8.7%;object caching 讓 end-to-end throughput +24%。整體 v0.6.0 對 Llama 8B 達 **2.7x throughput / 5x 更快 TPOT**,Llama 70B 達 **1.8x throughput / 2x 更低 TPOT** [source: https://vllm.ai/blog/2024-09-05-perf-update]。

**層級/耦合**:純基礎設施。優化 throughput(主)、cost。Tradeoff:對單一請求 latency 幾乎無害,但排程器本身的 CPU 開銷在小模型上可能成為瓶頸。

## 4.2 PagedAttention、KV-cache 管理、KV 量化、KV offloading、Prefix Caching

### PagedAttention(vLLM 核心)
**做什麼**:借用 OS 虛擬記憶體分頁概念,把 KV cache 切成固定大小 block(page),非連續配置、用 page table 映射。消除內部與外部碎片。

**量化效果**:傳統 serving 浪費 **60–80%** 的 KV cache 記憶體於碎片化;PagedAttention 把浪費壓到 **<4%**。藉此放大 batch size,使 throughput 提升 **2–4x**(同 latency)。block 共享機制讓 beam search 等場景記憶體再省最多 **55%** [source: https://dl.acm.org/doi/10.1145/3600006.3613165] [source: https://developers.redhat.com/articles/2025/07/24/how-pagedattention-resolves-memory-waste-llm-systems]。

**層級/耦合**:純基礎設施。優化 memory(主)→ throughput。Tradeoff:分頁 attention kernel 比連續記憶體稍複雜。

### Prefix Caching / Automatic Prefix Cache / RadixAttention
**做什麼**:快取已處理請求的 KV blocks,新請求若有相同前綴(system prompt、few-shot、RAG context、多輪對話歷史)即重用、跳過該段 prefill。vLLM 用 `hash(prefix tokens, block tokens)` 識別可共享 block;SGLang 的 **RadixAttention** 用 radix tree 索引 token 序列自動偵測重用。

**量化效果**:直接降低 **TTFT**(省去重算 prefill)並降記憶體 → 放大 batch。共享 system prompt / RAG 前綴的工作負載受益最大(命中率與成本降幅見 §1.2 可快取性:60–85% 命中、成本降 5–12×)[source: https://docs.vllm.ai/en/stable/design/prefix_caching/] [source: https://arxiv.org/pdf/2312.07104]。

**層級/耦合**:純基礎設施。優化 latency(TTFT)、memory、cost。Tradeoff:cache 命中高度依賴工作負載前綴重複度;cache 有記憶體與 eviction 成本。

### KV cache 量化
**做什麼**:把 KV cache 以低位元(FP8 / INT8 / INT4 / NVFP4)儲存,降低記憶體與記憶體頻寬(decode 階段是 memory-bound,故直接提速)。

**量化效果**:
- FP8 KV:**2x** 記憶體縮減,H100/B200 原生支援;最佳情況下 per-token KV 成本降到 BF16 的 **54%** [source: https://arxiv.org/pdf/2503.24000]。
- INT4 KV:**4x** 縮減,品質影響輕微;naive INT8/INT4 KV 在 HumanEval/MBPP 幾乎無精度損失 [source: https://docs.vllm.ai/en/latest/features/quantization/quantized_kvcache/]。
- KVQuant:**4.8x** 壓縮、僅 0.1 perplexity 退化(LLaMA / Mistral)[source: https://arxiv.org/pdf/2401.18079]。
- NVFP4 KV cache:MMLU-PRO 等 benchmark 精度損失 **<1%** [source: https://developer.nvidia.com/blog/optimizing-inference-for-long-context-and-large-batch-sizes-with-nvfp4-kv-cache/]。

**層級/耦合**:偏基礎設施,但**與模型耦合**——精度退化視模型/任務而定(長 context 任務較敏感)。優化 memory、latency(decode)。

### KV offloading(CPU/SSD)
**做什麼**:把不活躍的 KV blocks(含 prefix cache)卸載到 CPU RAM 或更慢儲存,需要時取回,擴大有效 cache 容量。代表實作 **LMCache**。

**量化效果**:對「共用 system prompt 或 RAG 前綴」的工作負載,LMCache 提供 **3–10x latency 縮減** [source: 搜尋彙整 / arxiv 2503.24000 相關](confidence: med,廠商/部落格區間值)。

**層級/耦合**:純基礎設施。優化 memory(容量)、latency。Tradeoff:取回 KV 走 PCIe/網路有頻寬與延遲成本,需與重算成本權衡。

## 4.3 Chunked Prefill 與 Prefill/Decode(P/D)Disaggregation

### Chunked Prefill(Sarathi-Serve)
**做什麼**:把長 prompt 的 prefill 切成近似等大的 chunk,與正在進行的 decode 交錯(piggyback / stall-free scheduling),避免一次大 prefill 卡住對延遲敏感的 decode 步。token 預算設在「線性層 roofline 曲線的膝點(knee)」:一個 decode 請求消耗 1 個 token 額度,一個 prefill 請求消耗等同其 prompt 長度的額度 [source: https://arxiv.org/abs/2308.16369] [source: https://www.usenix.org/system/files/osdi24-agrawal.pdf]。

**量化效果**:Mistral-7B 單張 A100,相對 vLLM 在 SLO 內提升 serving capacity 達 **2.6x**;Falcon-180B / 8×A100 相對 Orca 與 vLLM 達 **6.9x**。注意:chunked prefill 效果**高度依賴工作負載**,主要在 decode 主導場景(如 reasoning,output 可達 input 10×)時才能維持良好尾延遲 [source: https://www.usenix.org/conference/osdi24/presentation/agrawal] [source: https://arxiv.org/abs/2403.02310]。

**層級/耦合**:純基礎設施。優化 throughput 同時控制 latency。

### Prefill/Decode Disaggregation(DistServe)
**做什麼**:prefill 與 decode 兩階段運算特性相反(prefill compute-bound、decode memory-bound),互相干擾。P/D disaggregation 把 GPU 分成兩個 pool:prefill pool 算 prompt 與初始 KV,decode pool 專做自回歸生成,KV cache 在兩者間傳遞。可獨立擴縮、各自選最佳平行化策略。

**量化效果**:DistServe 在滿足 SLO 前提下,相對 vLLM 可達 **1.8x–3.2x** 更嚴格的 SLO(goodput),相對 DeepSpeed-MII 達 **1.7x–1.8x** [source: https://www.usenix.org/system/files/osdi24-zhong-yinmin.pdf] [source: https://arxiv.org/pdf/2401.09670]。已在 DeepSeek、Meta、LinkedIn、Mistral、HuggingFace、NVIDIA Dynamo、Perplexity、Moonshot 等量產環境部署,依工作負載與硬體可帶來 **2× 至 6.4×** 吞吐增益 [source: https://bentoml.com/llm/inference-optimization/prefill-decode-disaggregation]。

**何時用**:大規模、有嚴格 TTFT/TPOT SLO、prefill/decode 比例不均;需在多 GPU/多節點搬 KV,故需高速互連。Tradeoff:KV 傳輸成本、系統複雜度。

**層級/耦合**:純基礎設施(架構層)。優化 latency(SLO/goodput)、cost。

> **Chunked prefill vs P/D disaggregation 是兩種對立解法**:前者「融合」兩階段於同批次,後者「分離」兩階段於不同硬體。小規模/單節點偏 chunked prefill;大規模/嚴格 SLO 偏 disaggregation。

## 4.4 Speculative Decoding(推測解碼)

**做什麼**:用便宜的方式一次「猜」多個 token,再讓目標大模型一次平行驗證、接受對的部分。輸出分布與原模型相同(lossless)。

| 方法 | 機制 | 典型加速 |
|---|---|---|
| Draft model（標準推測） | 另一個小模型起草 | ~2–3x（視 draft/target 對齊度）|
| **Medusa** | 在目標模型上加多個非自回歸 head | **2.3–2.8x**（Vicuna/Zephyr，品質幾乎無損）|
| **EAGLE / EAGLE-2 / EAGLE-3** | 輕量自回歸 drafter 用目標模型隱藏狀態蒸餾；EAGLE-2 加動態 draft tree；EAGLE-3 直接 token 預測 + 多層融合特徵 | EAGLE 相對 Medusa 約 **1.5–1.6x**、相對 Lookahead 約 **1.7–2.1x**；EAGLE-3 為系列最高 |
| **N-gram / Lookahead**（training-free） | 從近期輸出的 n-gram 快取檢索草稿 | 對重複/結構化文字最有效 |

[source: https://openreview.net/pdf?id=1NdN7eXyb4] [source: https://arxiv.org/html/2503.01840v1]

**生產關鍵 caveat(極重要)**:speculative decoding 只在 **memory-bound(低並發/小 batch)** 階段有效。batch size 變大時,GPU 算力的「冗餘」被吃掉,加速遞減:
- EAGLE-3 在 **batch size ≈56** 達峰值,**batch 64+ 增益趨近於零**;實務建議 **batch ≥32 就關閉**,讓引擎退回標準 decode [source: https://developers.redhat.com/articles/2025/07/01/fly-eagle3-fly-faster-inference-vllm-speculative-decoding]。
- EAGLE 3.1 在 coding 資料集:concurrency=1 時 **2.03x** per-user output throughput,C=4 時 **1.71x**、C=16 時 **1.66x** [source: https://vllm.ai/blog/2026-05-26-eagle-3-1]。

**層級/耦合**:**與模型耦合**(draft 模型/head 需訓練或對齊目標模型;n-gram 例外為純 infra)。優化 latency(單請求 TPOT/TTFT)。Tradeoff:高並發不划算甚至拖慢;需額外 VRAM 放 drafter。

## 4.5 Serving 用量化（Quantization）

**做什麼**:以低位元表示權重 / KV / 激活,降低 VRAM 與記憶體頻寬。命名慣例:`W{權重位元}A{激活位元}`(KV 另計)。

| 格式 | 縮減 | 精度影響（驗證來源） | 適用 |
|---|---|---|---|
| **FP8 (W8A8-FP)** | 2x vs BF16 | **essentially lossless 跨所有規模** | H100/Blackwell 原生；高階 GPU async continuous batching 首選 |
| **INT8 (W8A8-INT)** | 2x | 適當校準下僅 **1–3%** 退化 | 無 FP8 硬體時的替代 |
| **INT4 weight-only (W4A16, GPTQ/AWQ)** | ~4x（權重） | 多數任務與 W8A8-INT 相當；但 GPTQ 在困難數學（AIME24）可能掉 **15–25%** | 同步/中階 GPU 最具 cost 效益 |
| **AWQ** | ~4x | 各資料集表現穩，但 vLLM 上 E2E 時間近乎翻倍、throughput 減半 | 重視品質、不極致追 throughput |
| **GGUF（llama.cpp）** | 多種（Q2–Q8） | 視位元 | CPU/邊緣/混合推論 |
| **FP4 / NVFP4（Blackwell）** | ~4x，且硬體加速 | DeepSeek-R1 MMLU 從 FP8→FP4 僅掉 **0.1%**（90.8→90.7）；NVFP4 比 INT4 快 **2.35x**、相同精度下比同位元方案達 ~2.3x throughput | 第五代 Tensor Core，20 PetaFLOPS FP4 |

[source: https://arxiv.org/abs/2411.02355]（「Give Me BF16 or Give Me Death」，>500,000 次評測，Llama-3.1 全家族）[source: https://developer.nvidia.com/blog/optimizing-llms-for-performance-and-accuracy-with-post-training-quantization/] [source: https://developers.redhat.com/articles/2026/02/04/accelerating-large-language-models-nvfp4-quantization] [source: https://introl.com/blog/fp4-inference-efficiency-nvidia-2025]

**權重 vs KV vs 激活量化的差異**:權重量化省「容量」(載入);KV 量化省「decode 階段頻寬與容量」;激活量化(W8A8 的 A8)才能真正用上 INT8/FP8 Tensor Core 算力(W4A16 只省記憶體、算時還原成高精度)。

**GPTQ vs AWQ 機制**:GPTQ 用近似二階(Hessian)資訊逐層量化;AWQ 假設約 ~1% 顯著權重通道(依激活統計挑出)先放大再均勻量化。

**層級/耦合**:**與模型耦合**(精度退化視模型/任務)。優化 memory、cost、(激活量化時)throughput。(訓練側 QAT vs PTQ 區分見 §2.7)

## 4.6 Attention 變體與 KV cache 成本：MHA / MQA / GQA / MLA

decode 是 memory-bandwidth-bound,瓶頸在 KV cache 大小與讀取。四種變體用不同方式縮 KV:

| 變體 | 機制 | KV 縮減 | 品質 |
|---|---|---|---|
| **MHA** | 每 head 各自 K/V | 基準(1x) | 基準 |
| **MQA** | 所有 query head 共用 1 組 K/V | 最多 **~64x**(依 head 數) | 長 context 檢索可能退化 |
| **GQA** | 數個 query head 共用 1 組 K/V | 按 group factor(Llama-2-70B:64 heads / 8 KV heads = **8x**) | 4–8 組可挽回 MQA 的損失,幾乎無損 |
| **MLA(DeepSeek)** | 把 K/V 壓成低秩 latent 向量存,用時再投影回 | DeepSeek-V2 相對 MHA **KV cache 減 93.3%** | 「壓縮內容」而非「減少 head 數」,論文宣稱優於 MHA |

關鍵區別:GQA/MQA 靠「減少存幾組 K/V」(共享 head),同時也減了 attention 參數;**MLA 靠「壓縮存什麼」**(低秩投影),不減 head 數。DeepSeek-V2(236B 總 / 21B active)藉 MLA 把 KV 減 **93.3%**、最大生成 throughput 提升至 **5.76x** [source: https://arxiv.org/abs/2405.04434] [source: https://aclanthology.org/2025.acl-long.1597.pdf]。

**層級/耦合**:**模型架構層**(需在訓練時決定,非純 runtime),但直接決定 serving 的 KV 記憶體成本,故 serving 系統會針對 MLA 寫專用 kernel(SGLang、vLLM)。

## 4.7 平行化（Parallelism）

| 策略 | 切什麼 | 何時用 | 通訊成本 |
|---|---|---|---|
| **Tensor Parallelism (TP)** | 每層矩陣運算切到多 GPU,逐層 all-reduce | 受 **compute/latency** 限制;可達 ~3x TTFT 改善 | 高——每層 2 次 all-reduce 在關鍵路徑上;**僅限單節點 NVLink** |
| **Pipeline Parallelism (PP)** | 把不同層分到不同 GPU | 受 **GPU 記憶體** 限制、無 NVLink(PCIe)、需跨節點塞大模型 | 低——只傳層間 input/output;高並發下 P99 TTFT 改善 2.5–3x |
| **Data Parallelism (DP)** | 整個模型複製、分流請求 | 受 **請求量** 限制;無高速互連時 | 低(請求層級) |
| **Expert Parallelism (EP)** | MoE 的不同 expert 分到不同 GPU | MoE 模型;expert 數 ≥ GPU 數 | all-to-all(路由時) |
| **Sequence Parallelism (SP)** | 沿序列維度切(搭配 TP 切 LayerNorm/dropout) | 長 context 省激活記憶體 | 中 |

vLLM 官方原則:「請求量受限 → DP;記憶體受限 → PP;compute/latency 受限 → TP」。4 GPU 有 NVLink 的密集模型預設 **PP+TP**;MoE 預設 **EP+TP=4**。TP 因通訊重,跨節點(無 NVLink)不划算,改用 PP/DP [source: https://docs.vllm.ai/en/stable/serving/parallelism_scaling/] [source: https://docs.jarvislabs.ai/blog/scaling-llm-inference-dp-pp-tp]。

**層級/耦合**:純基礎設施。優化 latency(TP)/ memory(PP)/ throughput(DP)。

## 4.8 MoE Serving 細節

**核心事實(VRAM vs compute 的分離)**:**總參數驅動 VRAM**,**active 參數驅動 compute**。MoE 必須把**所有** expert 權重常駐記憶體(不知下個 token 路由到哪),但每 token 只算被選中的 expert,故算力等同小密集模型 [source: https://www.spheron.network/blog/moe-inference-optimization-gpu-cloud/] [source: https://introl.com/blog/mixture-of-experts-moe-infrastructure-scaling-sparse-models-guide]。

| 模型 | 總參數 | active 參數 | FP8 權重 VRAM（近似） |
|---|---|---|---|
| DeepSeek-V3 | 671B | 37B | ~685 GB（需 8×H200 141GB） |
| Mixtral 8x22B | 141B | ~39B | ~141 GB（+~15% 框架開銷 ≈ 162 GB，未含 KV） |
| DeepSeek-V2 | 236B | 21B | — |

[source: https://arxiv.org/html/2412.19437v1] [source: https://www.spheron.network/blog/moe-inference-optimization-gpu-cloud/]

**Expert Parallelism**:每 GPU 持有完整一組 expert 權重,路由時做 all-to-all。expert 數 > GPU 數 或 GPU 數 = expert 數時用 EP;單一 expert 層太大塞不下單 GPU 時改 TP。

**層級/耦合**:模型架構(MoE)+ 基礎設施(EP)。優化 cost(用小算力跑大模型品質),但 memory 代價高。

## 4.9 推論引擎（Engines）差異

| 引擎 | 定位 | 差異化 | 部署成本 |
|---|---|---|---|
| **vLLM** | 高吞吐多用戶 serving 的事實標準 | PagedAttention 起家；模型覆蓋最廣、文件最佳、免編譯；併發越高 throughput 越好 | 分鐘～小時 |
| **SGLang** | 結構化/agent + 前綴重用 | RadixAttention（自動 prefix 重用）、優化排程；在 DeepSeek-V3 等新架構上常追平甚至超越 vLLM | 分鐘～小時 |
| **TensorRT-LLM** | NVIDIA 硬體極致最佳化 | 低階 kernel 最佳化，相對 vLLM 約 **10–30%** 領先，但需編譯、營運複雜度高 | 數天～數週 |
| **llama.cpp** | 單流效率與可攜性 | GGUF 量化、CPU/邊緣/Apple Silicon；單請求穩定但併發吞吐不擴展 | 立即（本機）|

效能排序(H100 基準彙整):**TensorRT-LLM > SGLang ≳ vLLM > TGI ≫ llama.cpp > Ollama**。多數團隊應從 vLLM 起步。註:HuggingFace TGI 於 2026-03 進入封存/維護模式 [source: https://www.spheron.network/blog/vllm-vs-tensorrt-llm-vs-sglang-benchmarks/] [source: https://developers.redhat.com/articles/2025/09/30/vllm-or-llamacpp-choosing-right-llm-inference-engine-your-use-case]。

**層級/耦合**:純基礎設施。

## 4.10 Autoscaling / Load Balancing / Request Routing / Multi-LoRA

**KV-aware routing(NVIDIA Dynamo / llm-d / Baseten)**:請求進來時計算它與各 GPU 上已活躍 KV blocks 的 overlap score,依「cache locality vs worker load」的成本函數路由,最小化 KV 重算同時平衡負載。可調偏向 cache 重用(prefill-heavy)或負載分散(decode-heavy);支援 vLLM / SGLang / TensorRT-LLM。Baseten 報告 KV-cache-aware routing 達 **2x 更快推論** [source: https://docs.nvidia.com/dynamo/latest/user-guides/kv-cache-aware-routing] [source: https://www.baseten.co/blog/how-baseten-achieved-2x-faster-inference-with-nvidia-dynamo/]。

**Multi-LoRA serving(S-LoRA)**:只在伺服器放一份 base 模型,依需求即時切換各 LoRA adapter。Unified Paging 統一管理動態 adapter 權重 + KV cache。相對「naive LoRA 的 vLLM / vLLM-packed」**throughput 達 4x**、相對 PEFT 達 **30x**,可同時服務 **2,000 個 adapter**(vLLM-packed 因須多份權重副本,<5 個)[source: https://arxiv.org/abs/2311.03285] [source: https://proceedings.mlsys.org/paper_files/paper/2024/file/906419cd502575b617cc489a1a696a67-Paper-Conference.pdf]。(後訓練視角見 §2.3)

**Autoscaling**:依 SLO(TTFT/TPOT)、佇列深度、KV 利用率擴縮 replica;P/D disaggregation 允許 prefill 與 decode pool 獨立擴縮。

**層級/耦合**:純基礎設施。優化 cost、latency、throughput。

## 4.11 彙總表：技術 × 層級 × 優化目標 × 量化效果 × 取捨

| 技術 | 層級 | 優化 | 典型量化效果 | 主要取捨 | infra vs model |
|---|---|---|---|---|---|
| Continuous batching | 排程 | throughput, cost | 2–4x vs SOTA；8x vs static（高變異）| 高並發下排程 CPU 開銷 | **pure-infra** |
| Multi-step / async scheduling (v0.6.0) | 排程 | throughput, latency | +28% throughput；TPOT +8.7%（70B/4×H100）| 實作複雜 | **pure-infra** |
| PagedAttention | KV 記憶體 | memory → throughput | 浪費 60–80%→<4%；2–4x throughput | kernel 稍複雜 | **pure-infra** |
| Prefix caching / RadixAttention | KV 記憶體 | latency(TTFT), memory | 命中 60–85%、成本降 5–12×；大幅降 TTFT | 命中率依工作負載 | **pure-infra** |
| KV 量化 (FP8/INT8/INT4/NVFP4) | KV 記憶體 | memory, latency(decode) | 2–4.8x 縮減；FP8 KV→54% per-token；NVFP4<1% MMLU 損 | 長 context 任務較敏感 | **infra×model** |
| KV offloading (LMCache) | KV 記憶體 | memory(容量), latency | 3–10x latency（共用前綴）| PCIe/網路頻寬 | **pure-infra** |
| Chunked prefill (Sarathi) | 排程 | throughput+latency | 2.6x（7B/A100）；6.9x（180B/8×A100）| 效果依工作負載 | **pure-infra** |
| P/D disaggregation (DistServe) | 架構 | latency(SLO/goodput), cost | 1.8–3.2x 更嚴 SLO vs vLLM；量產 2–6.4x 吞吐 | KV 傳輸、複雜度 | **pure-infra** |
| Speculative decoding (EAGLE/Medusa) | 解碼 | latency(單請求) | 2–2.8x（低並發）；batch≥32–64 失效 | 高並發不划算、額外 VRAM | **model-interacting** |
| Weight quant (FP8/INT4 AWQ/GPTQ) | 模型權重 | memory, cost | FP8 lossless；INT8 1–3%；INT4 競爭力強 | GPTQ 數學掉 15–25% | **infra×model** |
| FP4/NVFP4 | 模型權重/KV | memory, throughput | DeepSeek-R1 MMLU 掉 0.1%；2.35x vs INT4 | 需 Blackwell | **infra×model** |
| GQA | attention 架構 | memory(KV) | 8x（Llama-2-70B）| 訓練時決定 | **model** |
| MQA | attention 架構 | memory(KV) | 最多 ~64x | 長 context 檢索退化 | **model** |
| MLA (DeepSeek) | attention 架構 | memory(KV) | 減 93.3%；5.76x throughput | 投影增少量 compute | **model** |
| Tensor Parallelism | 平行化 | latency | ~3x TTFT | 高通訊；需 NVLink | **pure-infra** |
| Pipeline Parallelism | 平行化 | memory(容量) | P99 TTFT 2.5–3x（高並發）| pipeline bubble | **pure-infra** |
| Expert Parallelism | 平行化 | cost(MoE) | 跑大 MoE | all-to-all 通訊 | **infra×model(MoE)** |
| KV-aware routing (Dynamo) | 路由 | latency, cost | ~2x（Baseten）| 需 KV 事件廣播 | **pure-infra** |
| Multi-LoRA (S-LoRA) | serving | throughput, cost | 4x vs vLLM、30x vs PEFT；2000 adapters | 自訂 kernel | **pure-infra** |

> **數字分歧處**已標範圍:continuous batching「23x」是合成基準上限值且含 PagedAttention;多數學術 throughput 增益落在 **1.8–4x** 區間。

---

# 5. 硬體現實

> 2024–2026 資料中心 AI 推論硬體規格。所有關鍵數字均對照原廠 datasheet 與至少兩個獨立來源交叉驗證。除特別標註外為原廠公布值。

## 5.1 術語與計數慣例(務必先讀)

廠商標示 TFLOPS/PFLOPS 時常混用兩種慣例,這是規格表最大的混淆來源:

- **Dense(密集)**:實際無稀疏化時的峰值算力。
- **With sparsity / sparse(2:4 結構化稀疏)**:硬體跳過 2:4 模式中的零權重,數字約為 dense 的 **2 倍**。實務推論大多用不上,**工程估算應以 dense 為準**。
- NVIDIA 官網 datasheet 通常**同時列出** dense 與 sparse(如 H100 SXM FP8「1,979 / 3,958 TFLOPS」)。AMD 官方 datasheet 以「peak」(dense)與「with sparsity」兩欄並列。許多二手網站只引用 sparse 數字,導致看似比實際高一倍 [source: lenovopress.lenovo.com/lp1944-nvidia-h200-141gb-gpu]。

本節表格一律標明 dense / sparse。**FLOPS 等級**:1 PFLOPS = 1,000 TFLOPS = 10^15 FLOP/s。

## 5.2 NVIDIA 資料中心 GPU 規格表

### Hopper 世代 (H100 / H200)

| 規格 | H100 SXM5 | H100 PCIe | H100 NVL(每 GPU) | H200 SXM |
|---|---|---|---|---|
| 架構 / 製程 | Hopper / TSMC 4N | Hopper / 4N | Hopper / 4N | Hopper / 4N |
| FP64 (vector) | 34 TFLOPS | 26 TFLOPS | ~34 TFLOPS | 34 TFLOPS |
| FP64 Tensor Core | 67 TFLOPS | 51 TFLOPS | 67 TFLOPS | 67 TFLOPS |
| TF32 Tensor (dense/sparse) | 495 / 989 | ~378 / 756 | 495 / 989 | 495 / 989 |
| BF16 / FP16 Tensor (dense/sparse) | **989 / 1,979** | ~756 / 1,513 | 989 / 1,979 | **990 / 1,979** |
| FP8 Tensor (dense/sparse) | **1,979 / 3,958** | ~1,513 / 3,026 | 1,979 / 3,958 | **1,979 / 3,958** |
| INT8 Tensor (dense/sparse) TOPS | 1,979 / 3,958 | 1,513 / 3,026 | 1,979 / 3,958 | 1,979 / 3,958 |
| HBM 容量 / 類型 | 80 GB HBM3 | 80 GB HBM2e | 94 GB HBM3 | **141 GB HBM3e** |
| 記憶體頻寬 | **3.35 TB/s** | ~2.0 TB/s | ~3.9 TB/s | **4.8 TB/s** |
| NVLink 頻寬 | 900 GB/s | 600 GB/s(橋接) | 600 GB/s | 900 GB/s |
| 最大 TDP/TGP | **700 W** | 300–350 W | 350–400 W | 700 W |

說明:H100 PCIe 為 datasheet 列出的 80GB HBM2e 版(FP8 dense 1,513,3,026 為 sparse),與 SXM HBM3 版需區分清楚 [source: pny.com nvidia-h100-datasheet.pdf]。H200 與 H100 SXM 同為 GH100 die,**算力相同**,差異僅在 HBM3e 容量(80→141 GB)與頻寬(3.35→4.8 TB/s)[source: lenovopress.lenovo.com/lp1944-nvidia-h200-141gb-gpu;source: spheron.network/blog/nvidia-h200-specs/]。

### Blackwell / Blackwell Ultra 世代 (B200 / GB200 / B300 / GB300)

| 規格(每 GPU,dense) | B200 (HGX/DGX, 氣冷) | GB200 內 B200 (液冷) | B300 / GB300 (Blackwell Ultra, 液冷) |
|---|---|---|---|
| 架構 / 製程 | Blackwell / TSMC 4NP | Blackwell / 4NP | Blackwell Ultra / 4NP |
| FP4 Tensor (dense / sparse) | **9 / 18 PFLOPS** | 10 / 20 PFLOPS | **~15 / 30 PFLOPS** |
| FP8 / FP6 Tensor (dense) | **4.5 PFLOPS** | 5 PFLOPS | ~7.5 PFLOPS |
| INT8 Tensor (dense) | 4.5 POPS | 5 POPS | ~7.5 POPS |
| BF16 / FP16 Tensor (dense) | 2.25 PFLOPS | 2.5 PFLOPS | ~3.75 PFLOPS |
| FP64 Tensor | ~40 TFLOPS | 40 TFLOPS | ~40 TFLOPS (Ultra 大幅削減 FP64) |
| HBM 容量 / 類型 | **192 GB HBM3e** | 192 GB HBM3e (NVIDIA 標 186 GB) | **288 GB HBM3e** |
| 記憶體頻寬 | **8 TB/s** | 8 TB/s | 8 TB/s |
| NVLink 頻寬(第 5 代) | 1.8 TB/s | 1.8 TB/s | 1.8 TB/s |
| 最大 TDP | **~1,000 W** | **1,200 W** | **1,400 W** |

重要釐清(交叉驗證後):
- NVIDIA 官網 GB200 NVL72 規格頁把「per-superchip」算成 2 個 GPU(列 40/20 PFLOPS FP4 = 每 GPU 20/10),而 DGX B200(8×B200 氣冷)系統 datasheet 列 FP4 **144 / 72 PFLOPS = 每 GPU dense 9 / sparse 18**;故 **HGX/DGX 氣冷 B200 每 GPU dense FP4 ≈ 9 PFLOPS、FP8 ≈ 4.5 PFLOPS**,液冷 GB200 版略高(FP4 dense 10、FP8 5)[source: nvidia.com/en-us/data-center/dgx-b200/;source: nvidia.com/en-us/data-center/gb200-nvl72/]。
- B200 氣冷 ~1,000 W、液冷 GB200 內 1,200 W,為兩來源一致 [source: amax.com/comparing-nvidia-blackwell-configurations/;source: nvidia.com/en-us/data-center/dgx-b200/]。
- B300/GB300(Blackwell Ultra):288 GB HBM3e、每 GPU dense FP4 ~15 PFLOPS、TDP 1,400 W,強制液冷 (confidence: med — 來源多為廠商部落格而非單一原廠 datasheet)[source: developer.nvidia.com/blog/inside-nvidia-blackwell-ultra-the-chip-powering-the-ai-factory-era/;source: spheron.network/blog/nvidia-b300-blackwell-ultra-guide/]。

## 5.3 AMD Instinct 規格表 (官方 datasheet 確認)

| 規格 | MI300X | MI325X | MI350X | MI355X |
|---|---|---|---|---|
| 架構 / 製程 | CDNA 3 / 5nm+6nm | CDNA 3 / 5nm+6nm | CDNA 4 / 3nm+6nm | CDNA 4 / 3nm+6nm |
| FP16/BF16 (dense / sparse) TFLOPS | 1,307.4 / 2,614.9 | 1,307.4 / 2,614.9 | 2,306.9 / 4,613.8 (PFLOPS:2.31/4.61) | 同 MI350X 等級, 略高 |
| FP8 (dense / sparse) | 2,614.9 / 5,229.8 | 2,614.9 / 5,229.8 | 4,614 / 9,227 (PFLOPS) | ~5,030 / 10,100 |
| INT8 (dense / sparse) | 2,614.9 / 5,229.8 TOPS | 2,614.9 / 5,229.8 | 4,614 / 9,227 POPS | ~5,030 / 10,100 |
| FP6 / FP4 (dense / sparse) | 不支援 | 不支援 | 9,227 / 18,455 (PFLOPS, FP6=FP4) | ~10,100 / 20,200 |
| FP64 (vector / matrix) | 81.7 / 163.4 | 81.7 / 163.4 | 72.1 / 72.1 | 72.1 / 72.1 |
| HBM 容量 / 類型 | **192 GB HBM3** | **256 GB HBM3E** | **288 GB HBM3E** | **288 GB HBM3E** |
| 記憶體頻寬 | **5.3 TB/s** | **6 TB/s** | **8 TB/s** | **8 TB/s** |
| Infinity Fabric (scale-up) | 7×128 GB/s | 7×128 GB/s | 7×144 GB/s | 7×144 GB/s |
| 最大 TBP | **750 W** | **1,000 W** | **1,000 W (氣冷/液冷)** | **1,400 W (液冷)** |

說明:MI300X 與 MI325X 為同算力 die,差異在 HBM(192 GB HBM3 / 5.3 TB/s vs 256 GB HBM3E / 6 TB/s)與 TBP(750 vs 1,000 W)[source: amd.com .../amd-instinct-mi300x-data-sheet.pdf;source: amd.com .../instinct-mi325x-datasheet.pdf]。MI350X(1,000 W,可氣冷或液冷)與 MI355X(1,400 W,純液冷)同為 CDNA 4、288 GB HBM3E / 8 TB/s,新增 FP6/FP4;MI355X 為高功耗液冷版,FP16/FP8 較 MI325X 約 +80% [source: koicomputers.com/.../amd-instinct-mi350x-gpu-datasheet.pdf;source: tomshardware.com AMD MI350X/MI355X]。**關鍵記憶體優勢**:AMD 單卡 192–288 GB HBM 高於同期 NVIDIA H100(80)/H200(141),可在較少卡上裝下更大模型。

## 5.4 其他加速器(高階概覽)

### Google TPU

| 規格(每 chip) | TPU v5e | TPU v5p | TPU v6e (Trillium) |
|---|---|---|---|
| BF16 峰值 | ~197 TFLOPS | ~459 TFLOPS | ~918 TFLOPS |
| INT8 峰值 | ~394 TOPS | — | ~1,836 TOPS |
| HBM 容量 | 16 GB | 95 GB | 32 GB |
| HBM 頻寬 | 819 GB/s | 2,765 GB/s (2.76 TB/s) | 1,640 GB/s (1.6 TB/s) |
| ICI 互連 | — | — | 3,200 Gbps/chip |
| Pod 規模 | 256 chips | 8,960 chips | 256 chips/pod |

[source: cloud.google.com/blog/products/compute/introducing-trillium-6th-gen-tpus;source: jax-ml.github.io/scaling-book/tpus/] (confidence: med-high;TPU 規格 Google 揭露較少)。TPU v7「Ironwood」(第 7 代,2025 發表)更高,但本表聚焦 v5e/v5p/v6。

### AWS 自研晶片

| 規格(每 chip) | Trainium2 | Inferentia2 |
|---|---|---|
| FP8 (dense / sparse) | 1,299 / 2,563 TFLOPS | — |
| BF16/FP16 (dense) | 667 TFLOPS | 190 TFLOPS (FP16) |
| HBM 容量 / 頻寬 | 96 GiB / 2.9 TB/s | 32 GB |
| 晶片間互連 | NeuronLink-v3 1.28 TB/s | — |

Trn2 instance = 16 chips(20.8 PFLOPS FP8、1.5 TB HBM3、46 TB/s);Trn2 UltraServer = 64 chips(83.2 PFLOPS FP8、6 TB HBM、185 TB/s)[source: aws.amazon.com/ec2/instance-types/trn2/;source: awsdocs-neuron.readthedocs-hosted.com .../trainium2_arch.html]。

## 5.5 機櫃 / 叢集尺度

| 系統 | GPU 數 | 總 HBM | NVLink 域 | 總算力 (dense) | 機櫃功耗 | 冷卻 |
|---|---|---|---|---|---|---|
| **HGX/DGX H100/H200** (8 GPU 節點) | 8 | 640 GB (H100) / 1,128 GB (H200) | 7.2 TB/s 聚合 (節點內) | FP8 ~16 PFLOPS | ~10.2 kW (DGX H100) | 氣冷 |
| **DGX B200** (8 GPU 節點) | 8 | **1,440 GB HBM3e** | 14.4 TB/s 聚合 | FP4 72 / FP8 36 PFLOPS (dense) | **~14.3 kW** | 氣冷 |
| **GB200 NVL72** (機櫃) | **72 B200 + 36 Grace CPU** | **13.4 TB HBM3e** (576 TB/s 聚合) | **130 TB/s** (72-GPU 單一 NVLink 域) | FP4 720 / FP8 360 PFLOPS (dense);FP4 1,440 PFLOPS = 1.44 EF (sparse) | **~120 kW** (Supermicro 列 ~132–140 kW) | **強制液冷** |
| **GB300 NVL72** (機櫃) | 72 B300 + 36 Grace | **~20.7 TB HBM3e** | 130 TB/s | FP4 ~1.1 EF (dense) | ~120 kW (部分列 132–140 kW) | **強制液冷** |

[source: nvidia.com/en-us/data-center/dgx-b200/;source: nvidia.com/en-us/data-center/gb200-nvl72/;source: supermicro.com/datasheet/datasheet_SuperCluster_GB200_NVL72.pdf]。

關鍵冷卻分界:**單卡 TDP ≲ 1,000 W 可氣冷;≳ 1,000–1,200 W(GB200/GB300/MI355X)需直接液冷(DLC)**。NVL72 機櫃 ~120 kW 遠超傳統氣冷機櫃(~10–15 kW),是「AI factory」必須液冷的根本原因。

## 5.6 記憶體數學(工程實用公式)

### 1. 模型權重 VRAM
```
權重 VRAM (bytes) ≈ 參數量 × bytes/param
  FP16/BF16 = 2 bytes
  FP8 / INT8 = 1 byte
  FP4 / INT4 = 0.5 byte
```
速算:FP16 下 **1B 參數 ≈ 2 GB**;FP8 ≈ 1 GB;INT4 ≈ 0.5 GB。
範例:Llama-3.1 70B → FP16 ≈ 140 GB(裝不進單張 H100 80GB,需 2 卡或量化);FP8 ≈ 70 GB(可單張 H100);INT4 ≈ 35 GB。
**MoE 修正**:VRAM 由「總參數」決定(全部專家都要常駐),但算力/頻寬由「active 參數」決定。例:DeepSeek-V3 671B 總 / 37B active → 需 ~671 GB(FP8)常駐,但每 token 只算 37B。

### 2. KV cache(常被低估,長 context 下主導記憶體)
```
KV cache (bytes) = 2 × num_layers × num_kv_heads × head_dim × seq_len × batch × bytes/element
```
- 因子 2 = Key + Value;bytes/element:FP16=2、FP8=1。
- **GQA(Grouped-Query Attention)** 用 `num_kv_heads`(遠小於 query heads),大幅降低 KV cache,是現代模型可服務長 context 的關鍵(attention 變體機制見 §4.6)。

範例(Llama-3.1 70B:80 層、8 KV heads、head_dim 128、FP16):
- 每 token = 2×80×8×128×2 = **327,680 bytes ≈ 0.32 MB/token**
- 8K context 單請求 ≈ **2.6 GB**;batch 32 ≈ **~83 GB**(已超過單張 H100 的權重 vs KV 預算,故批次規模受 HBM 嚴格限制)[source: buildfastwithai.com/blogs/kv-cache-llms-explained;source: medium.com/@plienhar LLM Inference Series 4]。

### 3. 總 VRAM 預算
```
總 VRAM ≈ 權重 + KV cache(全 batch) + 啟動值/框架開銷(~1–2 GB + ~5–10% 緩衝)
可服務 batch ≈ (HBM 容量 − 權重) / (每請求 KV cache)
```

## 5.7 吞吐量現實(tokens/s)

### Roofline 物理(decode 階段為記憶體頻寬綁定)
LLM 推論分兩階段(同 §1.1):
- **Prefill(處理 prompt)**:大矩陣乘,**compute-bound**,看 FLOPS。
- **Decode(逐 token 生成)**:batch=1 時算術強度僅 ~1–2 FLOP/byte,遠低於 GPU roofline 的 ridge point(常 200–600×),故 **memory-bandwidth-bound** [source: medium.com/.../the-memory-wall-is-strangling-your-llm;source: medium.com/@plienhar LLM Inference Series 5]。

**單序列 decode 上限速算**:
```
tokens/s (batch=1) ≈ HBM 頻寬 / (2 × active_params × bytes/param)
```
例:H100 (3.35 TB/s)、70B FP16 → 3.35e12 / (2×70e9×2) ≈ **~12 tok/s**(理論上限,實測因開銷略低)。提高 batch 可攤平權重讀取、把瓶頸推向算力,**總吞吐隨 batch 上升**直到受 compute 或 KV cache 記憶體限制。

### 代表性實測吞吐(Llama-3.1/3.3 70B,單張或多張 H100)

| 設定 | 吞吐量 | 來源 |
|---|---|---|
| H100 ×1,TensorRT-LLM,單請求類 | ~250–300 tok/s | [source: cerebrium.ai/blog/...llama-3-1-api] |
| H100,SGLang,batch 64 | ~460 tok/s(聚合) | 同上 |
| H100 ×4,TP=4,vLLM(高並發聚合) | ~3,245 tok/s | 同上 |
| B200 ×1,Llama 70B | ~17,500 tok/s(高並發聚合,廠商宣稱) | [source: spheron.network/blog/nvidia-b200-complete-guide/] (confidence: med) |

**驅動因素總結**:(1) active 參數越小越快(MoE 優勢);(2) HBM 頻寬決定 decode 上限(H200 4.8 TB/s > H100 3.35;B200 8 TB/s);(3) batch size 提升聚合吞吐但受 KV cache 容量上限;(4) 量化(FP8/FP4)同時降記憶體並提升等效頻寬利用。vLLM PagedAttention / SGLang RadixAttention 較 naive HF 約 +20–40%。

## 5.8 經濟學(資本、租賃、$/Mtoken、利用率)

### 資本成本與雲端租賃(2025–2026)

| GPU | 採購價(單卡) | 雲端 on-demand $/GPU-hr | 備註 |
|---|---|---|---|
| H100 80GB | $25,000–$40,000+ | **$1.49–$6.98**(中位 ~$2.85–$3.60;GCP/AWS 約 $3.0–$3.9) | 2025 中多次降價 |
| H200 141GB | ~$30,000–$45,000 | ~$3.0–$4.5 | — |
| B200 192GB | **~$45,000–$50,000** (OEM 報價) | **$2.12(spot)–$6.02**(中位 ~$4.8;36 個月保留可至 ~$2.25–$2.80) | — |

[source: cloudzero.com/blog/h100-gpu-cost/;source: intuitionlabs.ai/articles/h100-rental-prices-cloud-comparison;source: spheron.network/blog/gpu-cloud-pricing-comparison-2026/;source: northflank.com/blog/how-much-does-an-nvidia-b200-gpu-cost]。

### 全成本(TCO)
原始 GPU 租金外,加冷卻、機房、維運約 **+$2–$7/hr**;故 8×H100 真實營運成本約 **$8–$15/hr**(攤提後)[source: introl.com/blog/inference-unit-economics...]。

### $/Mtoken 核心公式
```
$/Mtoken = ($/GPU-hr × 3,600) / (聚合 tokens/s × 1,000,000)
```
範例:$3.0/hr ÷ 3,600 × 500 tok/s → $3.0/(3600×500) × 1e6 ≈ **$1.67 / Mtoken**(單卡 500 tok/s、100% 利用率)。

### 利用率現實(成本主導變數)
- 自架要勝過 API,通常需 **>8,000 對話/日**;7B 模型約需 **~50% 利用率**才低於 GPT-3.5-Turbo 等級成本;13B 約 10% 利用率達 GPT-4-turbo 平價 [source: introl.com/blog/inference-unit-economics...]。
- **低利用率致命**:同一 GPU 在 10% 負載下,$0.013/1K token 會暴增至 $0.13/1K token(×10),比 premium API 還貴。
- 市場 $/Mtoken 落差極大:小模型(Llama 3.2 3B)約 **$0.06/Mtoken**;前緣託管模型 output 達 **$15–$25/Mtoken**。歷史趨勢:2022 年底約 $20/Mtoken 的能力,2026 年同等已降至 ~$0.40/Mtoken。

> **可信度與分歧註記**:Dense vs sparse 所有 FLOPS 已標明慣例,遊戲對應算力請用 **dense** 欄。B200 氣冷 vs 液冷算力分歧已交叉確認(氣冷 FP8 dense 4.5/FP4 9;液冷 GB200 內 5/10,差異來自 SKU 功耗 1,000 vs 1,200 W)。B300/GB300、MI355X、TPU v6 部分數字依賴廠商部落格(非單一原廠 datasheet),標 (confidence: med)。採購價為市場報價區間,波動大,僅供量級參考。

---

# 6. 開源模型現況 + benchmark + 血緣慣例

> **範圍與可信度**:聚焦「真實存在、可下載權重」的模型。研究期間 web 搜尋環境當前月份為 2026-06,部分結果回傳尚無法以權威一手來源(HF model card、官方技術報告、arXiv)交叉驗證的「未來/傳聞」型號(DeepSeek-V4-Pro-Max、GLM-5.2、Qwen3.7、Kimi K2.7 等)。凡無法雙來源驗證者一律**排除於主名冊外**或標註「未驗證 / 傳聞」(見 §6.6)。所有數字盡量以 ≥2 個獨立來源比對,分歧處直接點出。

## 6.1 旗艦級 MoE：total / active 參數的「現代慣例」

當前前沿開放權重模型幾乎全面採用 **Mixture-of-Experts (MoE)**。命名慣例已固定為兩種寫法:

- **「total B / active B」對寫**:例如 DeepSeek 671B/37B、Qwen3 235B-A22B、Kimi K2 1T/32B。
- **型號名嵌入 active**:阿里巴巴的 `A22B`、`A3B` 後綴即「Activated 22B / 3B」;NVIDIA 的 `120B-A12B` 同理。

active 參數(每個 token 實際走過的權重)決定**推論算力與延遲**;total 參數決定**記憶體佔用與知識容量**(對應 §4.8、§5.6 的 VRAM vs compute 解耦)。當前前沿稀疏比(active/total)約落在 **3%–10%**:

| 稀疏度範例 | total | active | active/total |
|---|---|---|---|
| Kimi K2 | 1T (~1000B) | 32B | ~3.2% |
| DeepSeek V3/V3.1/R1 | 671B | 37B | ~5.5% |
| Qwen3-235B-A22B | 235B | 22B | ~9.4% |
| GLM-4.5 / 4.6 | 355B (一處 357B) | 32B | ~9% |
| Llama 4 Maverick | 400B | 17B | ~4.3% |
| MiniMax-M1 | 456B | 45.9B | ~10% |
| gpt-oss-120b | 117B | 5.1B | ~4.4% |

> 註:DeepSeek 模型權重檔的「685B」是含 MTP(multi-token prediction)模組的磁碟參數量;論文標稱純模型量是 **671B total / 37B active**。[source: arxiv.org/abs/2412.19437; api-docs.deepseek.com/news/news1226]

## 6.2 主名冊（roster）

> 分數欄以各模型「主打/最佳設定」(通常為 thinking/reasoning 模式)官方或 Artificial Analysis 報告值為主,並標註基準版本。空欄表示未官方報告或無可靠雙來源。`Ctx K` = 原生 context window(千 token),括號為可延伸值。

### 6.2.1 大型 / 前沿 MoE（≥100B total）

| 模型 | total B | active B | MoE | Ctx K | 授權 | 釋出 | 關鍵基準（來源報告值） |
|---|---|---|---|---|---|---|---|
| **DeepSeek-V3** | 671 | 37 | ✓ | 128 | DeepSeek (MIT-style) | 2024-12 | MMLU-Pro ~75；非推理模型 |
| **DeepSeek-R1 (orig.)** | 671 | 37 | ✓ | 128(64 orig) | MIT | 2025-01 | MMLU-Pro 84.0；GPQA-D 71.5；AIME24 79.8；AIME25 ~70 |
| **DeepSeek-R1-0528** | 671 | 37 | ✓ | 128 | MIT | 2025-05 | GPQA-D 81.0；AIME25 87.5；LCB v6 73.3 |
| **DeepSeek-V3.1** | 671 | 37 | ✓ | 128 | MIT | 2025-08 | hybrid thinking/非thinking 合一 |
| **DeepSeek-V3.2-Exp** | 671 | 37 | ✓ | 128 | MIT | 2025-09 | 與 V3.1-Terminus 約略持平；主打 DSA 稀疏注意力長文本省成本 |
| **Qwen3-235B-A22B-Thinking-2507** | 235 | 22 | ✓ | 262(→1000) | Apache-2.0 | 2025-07 | MMLU-Pro 84.4；GPQA 81.1；AIME25 92.3；LCB v6 74.1；τ²-Retail 71.9 |
| **Qwen3-235B-A22B-Instruct-2507** | 235 | 22 | ✓ | 262(→1000) | Apache-2.0 | 2025-07 | AIME24 85.7；AIME25 81.5；LCB v5 70.7 |
| **Kimi K2-Instruct** | ~1000 | 32 | ✓ | 256 | Modified MIT | 2025-07 | SWE-bench Verified 69.2 |
| **Kimi K2 Thinking** | ~1000 | 32 | ✓ | 256 | Modified MIT | 2025-11 | HLE (w/ tools) 44.9；BrowseComp 60.2；原生 INT4 |
| **GLM-4.5** | 355 | 32 | ✓ | 128 | MIT | 2025-07 | agentic/coding 導向 |
| **GLM-4.6** | 355（一處 357） | 32 | ✓ | 200 | MIT | 2025-09/10 | coding/agent 強化；Terminal-Bench ~24.5 |
| **Llama 4 Scout** | 109 | 17 | ✓ (16 exp) | 10,000 | Llama 4 Community | 2025-04 | 主打超長 context |
| **Llama 4 Maverick** | 400 | 17 | ✓ (128 exp) | 1,000 | Llama 4 Community | 2025-04 | 多模態 MoE |
| **Llama 4 Behemoth** | ~2,000 | 288 | ✓ (16 exp) | — | (未公開權重) | 2025-04 預告 | 截至研究時點仍未以開放權重釋出 |
| **MiniMax-M1** | 456 | 45.9 | ✓ | 1,000 | Apache-2.0 | 2025-06 | SWE-bench Verified 55.6–56.0；hybrid lightning attention |
| **MiniMax-M2** | 230 | 10 | ✓ | (長) | MIT/Apache 類 | 2025-10 | SWE-bench Verified 69.4；agentic tool-calling 強 |
| **gpt-oss-120b** | 117 | 5.1 | ✓ (128 exp, top-4) | 128 | Apache-2.0 | 2025-08 | GPQA-D 80.8；MMLU-Pro 80.8；近 o4-mini；單卡 80GB 可跑 |
| **NVIDIA Nemotron-3-Super-120B-A12B** | 120 | 12 | ✓ | — | NVIDIA Open Model | 2025-12 | hybrid MoE reasoning |

### 6.2.2 中型（~12–70B，多為 dense）

| 模型 | total B | active B | MoE | Ctx K | 授權 | 釋出 | 關鍵基準 |
|---|---|---|---|---|---|---|---|
| **Llama 3.1-405B** | 405 | 405 | dense | 128 | Llama Community | 2024-07 | MMLU-Pro 73.4 |
| **Llama 3.3-70B** | 70 | 70 | dense | 128 | Llama Community | 2024-12 | MMLU-Pro 68.9；GPQA-D 50.5；IFEval 92.1；MATH 77.0 |
| **Llama 3.1-8B** | 8 | 8 | dense | 128 | Llama Community | 2024-07 | 通用小模 |
| **Qwen3-32B** | 32 | 32 | dense | 128 | Apache-2.0 | 2025-04 | 旗艦 dense |
| **Qwen3-30B-A3B (-2507)** | 30 | 3 | ✓ (128 exp, top-8) | 128(→256) | Apache-2.0 | 2025-04/07 | 以 ~1/10 active 勝過 QwQ-32B |
| **Qwen3-14B** | 14 | 14 | dense | 128 | Apache-2.0 | 2025-04 | — |
| **gpt-oss-20b** | 20.9 | 3.6 | ✓ | 128 | Apache-2.0 | 2025-08 | ~ o3-mini；16GB 可跑 |
| **EXAONE 4.0 32B** | 32 | 32 | dense (hybrid reasoning) | 130 | EXAONE NC 1.2（非商用） | 2025-07 | AA Intelligence Index 62（32B 最高） |
| **Gemma 3 27B** | 27 | 27 | dense | 128 | Gemma ToU（source-available） | 2025-03 | 多模態、140 語言 |
| **Gemma 3 12B** | 12 | 12 | dense | 128 | Gemma ToU | 2025-03 | — |
| **Mistral Small 3.x (24B)** | 24 | 24 | dense | 128 | Apache-2.0 | 2025-01～06 | — |
| **Magistral Small (24B)** | 24 | 24 | dense | 128 | Apache-2.0 | 2025-06 | 基於 Mistral-Small-3.1 的推理 fine-tune |
| **Mixtral 8x7B** | 46.7 | ~12.9 | ✓ (8 exp) | 32 | Apache-2.0 | 2023-12 | 元老級開放 MoE |
| **Phi-4 (14B)** | 14 | 14 | dense | 16 | MIT | 2024-12 | 數理/科學表現超越同級 |
| **Phi-4-reasoning(-plus) 14B** | 14 | 14 | dense | 32 | MIT | 2025-04 | 推理特化 |
| **DeepSeek-R1-Distill-Llama-70B** | 70 | 70 | dense | 128 | MIT/Llama | 2025-01 | AIME24 70.0；MATH-500 94.5 |
| **DeepSeek-R1-Distill-Qwen-32B** | 32 | 32 | dense | 128 | Apache-2.0 (Qwen2.5 基底) | 2025-01 | AIME24 72.6；MATH-500 94.3 |

### 6.2.3 小型（~1–9B）

| 模型 | total B | Ctx K | 授權 | 釋出 | 備註 |
|---|---|---|---|---|---|
| **Qwen3-8B / 4B / 1.7B / 0.6B** | 8/4/1.7/0.6 | 128 (8B); 32→256 (4B/1.7B) | Apache-2.0 | 2025-04～07 | 4B-Thinking-2507 達 AIME25 81.3 / GPQA-D 65.8（見 §6.4） |
| **Gemma 3 4B / 1B** | 4 / 1 | 128 / 32 | Gemma ToU | 2025-03 | 邊緣裝置 |
| **Phi-4-mini (3.8B)** | 3.8 | 128 | MIT | 2025-02 | 200K 詞表、GQA |
| **Phi-4-mini-reasoning** | 3.8 | 128 | MIT | 2025-04 | 推理蒸餾 |
| **Llama 3.2 1B / 3B** | 1 / 3 | 128 | Llama Community | 2024-09 | 行動端 |
| **EXAONE 4.0 1.2B** | 1.2 | — | EXAONE NC | 2025-07 | 裝置端 |
| **DeepSeek-R1-Distill-Qwen-1.5B / 7B** | 1.5 / 7 | 128 | Apache-2.0 | 2025-01 | 7B: AIME24 55.5（超越 QwQ-32B-Preview） |
| **NVIDIA Nemotron-3-Nano** | 31.6 total / 3.2 active | — | NVIDIA Open Model | 2025-12 | 小型 hybrid MoE |

## 6.3 基準測試版圖與典型分數帶（calibration 用）

主流評測的「難度層級」與目前分數區間(用於把遊戲能力值對齊真實世界):

| 基準 | 衡量什麼 | 前沿/旗艦帶 | 中型帶 | 小型帶 | 飽和狀態 |
|---|---|---|---|---|---|
| **MMLU-Pro** | 研究所級知識+推理（14 領域、10 選項） | 84–90 | 68–80 | 50–65 | **接近飽和**：頂部群聚於 83–90，差距已無統計意義 |
| **GPQA-Diamond** | 198 題 PhD 級科學（專家 65%、非專家 34%） | 80–94 | 50–75 | 40–66 | 頂部漸飽和，但 60–90 區間仍可鑑別 |
| **AIME 2024/2025** | 競賽數學（pass@1） | 87–92+ | 70–85 | 55–81 | 推理模型已逼近頂；非推理模型落差大 |
| **LiveCodeBench (v5/v6)** | 防汙染競賽程式（按版本滾動） | 70–75+ | 55–70 | 45–55 | 持續更新以抗飽和 |
| **SWE-bench Verified** | 真實 GitHub issue 修復（agentic） | 69–80 | 55–69 | 低 | **未飽和**、最具鑑別力的硬指標 |
| **指令遵循 (IFEval / IFBench)** | 格式/約束遵循 | 90+ (IFEval) | 85–92 | — | IFEval 飽和；IFBench 較新較難 |
| **agentic：τ-bench / τ²-bench、Terminal-Bench (Hard)、BFCL** | 多輪工具呼叫/終端任務 | 變異大；Qwen3-235B τ²-Retail 71.9、Telecom 45.6 | — | — | **最未飽和**，正成為新主戰場 |
| **Humanity's Last Exam (HLE)** | 「天花板測試」 | Kimi K2 Thinking 44.9 (w/ tools)、GPT-5 41.7 | — | — | 遠未飽和，刻意設計反飽和 |

**Artificial Analysis Intelligence Index v3.0**(業界最常引用的綜合分):等權平均 **10 項** 評測——MMLU-Pro、GPQA-Diamond、HLE、LiveCodeBench、SciCode、AIME 2025、IFBench、AA-LCR、Terminal-Bench Hard、τ²-Bench Telecom。刻意納入 agentic/長文本/終端基準,以反制傳統知識題飽和。[source: artificialanalysis.ai/methodology/intelligence-benchmarking]

## 6.4 「能力壓縮 / 基準飽和」現象（Capability Compression）

2025–2026 最重要、且最該被遊戲機制反映的真相:

1. **小型 thinking 模型在特定基準上逼近巨型模型。** 最鮮明的一手例子:**Qwen3-4B-Thinking-2507(僅 4B dense)** 報告 **AIME25 81.3、GPQA-Diamond 65.8、LiveCodeBench 55.2**——數學/科學上已進入一年前需 671B 等級(DeepSeek-R1 原版 AIME25 ~70、GPQA-D 71.5)才能達到的區間。[source: huggingface.co/Qwen/Qwen3-4B-Thinking-2507; datalearner.com]
2. **蒸餾把巨人塞進小身體。** DeepSeek-R1-Distill-Qwen-7B(7B)AIME24 55.5,超越 QwQ-32B-Preview;32B 版達 72.6。[source: huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B]
3. **知識題已飽和、頂部群聚。** MMLU-Pro 頂部群聚 83–90、GPQA-D 達 94.3(前沿閉源),使「分數高低」在頂端失去鑑別力。產業轉向 **SWE-bench、Terminal-Bench、τ-bench、HLE、FrontierMath** 等未飽和的硬/agentic 基準。[source: aiacceleratorinstitute.com; explainx.ai]

> **對校準的啟示**:在「知識問答」維度上,小模型可極接近大模型(壓縮嚴重);但在 **agentic/長程工具使用/真實程式修復(SWE-bench)** 維度上,規模與後訓練仍拉開明顯差距——這是真實世界中「大模型仍值錢」的地方。

## 6.5 同一基底如何衍生眾多後代（lineage 慣例）

真實生態的衍生鏈高度規律,且**機器可讀**(通用 metadata 機制見 §2.9)。

**衍生鏈(典型)**:
```
base (pretrain) → instruct/chat (SFT+RLHF) → reasoning/thinking 變體 (RL, e.g. R1, Magistral)
                                            → distilled (大模型生成資料蒸餾到小基底, e.g. R1-Distill-Qwen-32B)
                                            → community fine-tunes (LoRA/QLoRA、領域微調、merge)
                                            → quantized 變體 (GGUF/AWQ/GPTQ/MXFP4/INT4)
```

**具體真實範例**:
- DeepSeek-R1 的 6 個蒸餾子代**並非新基底**,而是把 R1 的輸出蒸餾到既有開源基底上:1.5B/7B/14B/32B 基於 **Qwen2.5**(Apache-2.0),8B/70B 基於 **Llama-3.1-8B-Base / Llama-3.3-70B-Instruct**(沿用各自授權)。**授權會繼承基底**。[source: huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B]
- Magistral Small(24B)= 在 **Mistral-Small-3.1** 上,用 Magistral Medium 的推理 trace 做 SFT,再加 RL。
- Llama-Nemotron 系列(NVIDIA)= 在 Llama 基底上做推理後訓練(Nano-8B 基於 Llama-3.1-8B;Ultra-253B 基於 Llama)。

**血統如何被記錄(HF 慣例)**:
- model card metadata 的 **`base_model`** 欄位宣告上游模型;Hub 自動推斷關係類型,允許值 **`finetune` / `quantized` / `adapter` / `merge`**(亦可顯式指定)。用於可重現性、信任、搜尋過濾,並自動在頁面顯示「fine-tuned from / quantized from」血統圖。[source: huggingface.co/docs/hub/model-cards]
- 量化變體(GGUF/AWQ/GPTQ/MXFP4)標 `base_model_relation: quantized`;merge(SLERP/TIES)標 `merge`;LoRA 介接標 `adapter`。
- 截至 2025–2026,HF 上已逾 200 萬個模型,絕大多數是少數基底的衍生(fine-tune/quant/merge),形成「少數基底 → 海量後代」拓撲。[source: arxiv.org/html/2508.06811v1]

## 6.6 須留意的數字分歧與不確定處

- **GLM-4.6 total 參數**:多數來源寫 **355B**,但 HF 頁面顯示 **357B**。採 355B 為主、註記 357B 差異。
- **GLM-4.6 釋出日**:行銷/新聞稿多寫 **2025-09-30**;HF 引用之 arXiv 2508.06471 顯示較早。以官方公告 9/30 為準。
- **gpt-oss-120b total**:官方標 **117B**(精確 116.8B);坊間「120B」是型號行銷名,非實際 total。active **5.1B**、128 experts top-4、context **131,072 (128K)** 三來源一致。[source: arxiv.org/abs/2508.10925; huggingface.co/blog/welcome-openai-gpt-oss]
- **DeepSeek 685B vs 671B**:685B 含 MTP;模型本體 671B/37B。
- **MiniMax-M2 context window**:一處宣稱 4M token,與其他較保守來源有出入,列為待查。
- **環境日期 2026-06 的「未來型號」**:DeepSeek-V4-Pro-Max、GLM-5/5.2、Qwen3.5/3.6/3.7、Kimi K2.5/2.6/2.7、Nemotron-3-Ultra、Mistral Large 3 等於搜尋中出現,但**缺乏可雙重驗證的一手 model card/技術報告**,故未納入主名冊;若日後擴充 roster,應先以 HF model card 逐一核對 param/context/license。

---

## 主要來源彙整

### §1 工作負載
- TDS — Prefill compute-bound / decode memory-bound: https://towardsdatascience.com/prefill-is-compute-bound-decode-is-memory-bound-why-your-gpu-shouldnt-do-both/
- WEKA — Prefill and Decode: https://www.weka.io/learn/ai-ml/prefill-and-decode/
- SARATHI / Sarathi-Serve: https://arxiv.org/abs/2308.16369 ; https://www.usenix.org/system/files/osdi24-agrawal.pdf
- DistServe(PD 分離): https://arxiv.org/pdf/2401.09670 ; BentoML PD disaggregation: https://bentoml.com/llm/inference-optimization/prefill-decode-disaggregation
- BentoML — LLM inference metrics: https://bentoml.com/llm/inference-optimization/llm-inference-metrics
- NVIDIA — LLM Benchmarking Fundamental Concepts: https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts/
- MLCommons — MLPerf Inference v5.0: https://mlcommons.org/2025/04/llm-inference-v5/ ; DeepSeek v5.1: https://mlcommons.org/2025/09/deepseek-inference-5-1/
- IETF draft — LLM serving workload profiles: https://datatracker.ietf.org/doc/html/draft-mondal-llm-serving-workload-profiles-00
- ServeGen: https://arxiv.org/pdf/2505.09999
- Prefix/KV caching: https://bentoml.com/llm/inference-optimization/prefix-caching ; https://llm-d.ai/blog/kvcache-wins-you-can-see ; Anthropic: https://www.anthropic.com/news/prompt-caching
- 路由/排程: LAPS https://arxiv.org/pdf/2601.11589 ; SCORPIO https://arxiv.org/pdf/2505.23022 ; PolyServe https://arxiv.org/html/2507.17769 ; SLO-Aware Scheduling https://arxiv.org/html/2504.14966v1
- 推理 token: DeepSeek-R1 https://arxiv.org/html/2501.12948v1 ; Goodput vs throughput: https://qainsights.com/throughput-vs-goodput-the-performance-metric-you-are-probably-ignoring-in-llm-testing/

### §2 後訓練
LoRA [arxiv 2106.09685]、QLoRA [arxiv 2305.14314]、DoRA [arxiv 2402.09353]、DPO [arxiv 2305.18290]、KTO [hf papers 2402.01306]、GRPO/DeepSeekMath [hf blog garg-aayush]、DeepSeek-R1 [arxiv 2501.12948 / Nature s41586-025-09422-z]、Constitutional AI/RLAIF [rlhfbook c/13-cai]、InstructGPT/alignment tax [NeurIPS 2022 / arxiv 2309.06256]、S-LoRA [lmsys blog / arxiv 2311.03285]、Model Stock [ECCV 2024 / naver-ai]、AWQ [arxiv 2306.00978]、QAT vs PTQ [medium better-ml]、HF base_model lineage [huggingface.co/docs/hub/model-cards]、命名實證 [arxiv 2310.01642]、post-training 2026 概覽 [llm-stats.com]。

### §3 安全
- Llama Guard 4: https://huggingface.co/meta-llama/Llama-Guard-4-12B ; https://www.llama.com/docs/model-cards-and-prompt-formats/llama-guard-4/
- Llama Prompt Guard 2: https://github.com/meta-llama/PurpleLlama/blob/main/Llama-Prompt-Guard-2/86M/MODEL_CARD.md
- OpenAI Moderation: https://developers.openai.com/api/docs/guides/moderation ; https://openai.com/index/upgrading-the-moderation-api-with-our-new-multimodal-moderation-model/
- OpenAI safe-completions: https://openai.com/index/gpt-5-safe-completions/ ; GPT-5 System Card https://cdn.openai.com/gpt-5-system-card.pdf
- NeMo Guardrails: https://developer.nvidia.com/blog/stream-smarter-and-safer-learn-how-nvidia-nemo-guardrails-enhance-llm-output-streaming/ ; https://huggingface.co/nvidia/llama-3.1-nemoguard-8b-content-safety ; https://docs.nvidia.com/nim/llama-3-1-nemoguard-8b-contentsafety/
- Azure Content Safety / Prompt Shields: https://learn.microsoft.com/en-us/azure/ai-services/content-safety/whats-new ; .../concepts/jailbreak-detection ; https://azure.microsoft.com/en-us/blog/enhance-ai-security-with-azure-prompt-shields-and-azure-ai-content-safety/
- ShieldGemma 2: https://ai.google.dev/gemma/docs/shieldgemma/model_card_2 ; https://arxiv.org/html/2504.01081v1
- Granite Guardian: https://arxiv.org/html/2412.07724v1
- WildGuard: https://arxiv.org/pdf/2406.18495 ; https://huggingface.co/allenai/wildguard
- LlamaFirewall: https://arxiv.org/abs/2505.03574 ; https://ai.meta.com/research/publications/llamafirewall-an-open-source-guardrail-system-for-building-secure-ai-agents/
- Constitutional AI / RLHF: https://blog.bluedot.org/p/what-is-constitutional-ai ; https://rlhfbook.com/c/13-cai ; LLM Safety Survey arxiv 2412.17686
- Guardrail 延遲/成本: https://www.truefoundry.com/blog/benchmarking-llm-guardrail-providers ; GLiNER Guard arxiv 2605.05277
- Safety tax / over-refusal / tradeoff: No Free Lunch with Guardrails arxiv 2504.00441 ; XSTest arxiv 2604.05179 ; Bypassing LLM Guardrails arxiv 2504.11168
- OWASP Top 10 for LLM (2025): https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- 跨模型 guardrail 準確率比較: arxiv 2511.22047

### §4 Serving-system 技術
- vLLM v0.6.0 perf: https://vllm.ai/blog/2024-09-05-perf-update
- PagedAttention (SOSP'23): https://dl.acm.org/doi/10.1145/3600006.3613165
- Anyscale continuous batching: https://www.anyscale.com/blog/continuous-batching-llm-inference
- Sarathi-Serve (OSDI'24): https://www.usenix.org/conference/osdi24/presentation/agrawal
- DistServe (OSDI'24): https://www.usenix.org/system/files/osdi24-zhong-yinmin.pdf
- EAGLE / EAGLE-3: https://openreview.net/pdf?id=1NdN7eXyb4 , https://arxiv.org/html/2503.01840v1
- EAGLE-3 in vLLM（batch caveat）: https://developers.redhat.com/articles/2025/07/01/fly-eagle3-fly-faster-inference-vllm-speculative-decoding
- "Give Me BF16 or Give Me Death" 量化研究: https://arxiv.org/abs/2411.02355
- NVFP4: https://developer.nvidia.com/blog/optimizing-llms-for-performance-and-accuracy-with-post-training-quantization/ , https://developers.redhat.com/articles/2026/02/04/accelerating-large-language-models-nvfp4-quantization
- DeepSeek-V2 (MLA): https://arxiv.org/abs/2405.04434
- DeepSeek-V3 (MoE): https://arxiv.org/html/2412.19437v1
- vLLM parallelism docs: https://docs.vllm.ai/en/stable/serving/parallelism_scaling/
- 引擎比較: https://www.spheron.network/blog/vllm-vs-tensorrt-llm-vs-sglang-benchmarks/
- KV-aware routing (Dynamo / Baseten): https://docs.nvidia.com/dynamo/latest/user-guides/kv-cache-aware-routing , https://www.baseten.co/blog/how-baseten-achieved-2x-faster-inference-with-nvidia-dynamo/
- S-LoRA: https://arxiv.org/abs/2311.03285
- KV quant: https://arxiv.org/pdf/2401.18079 (KVQuant), https://docs.vllm.ai/en/latest/features/quantization/quantized_kvcache/

### §5 硬體
- NVIDIA H100 datasheet (PNY/原廠): https://www.pny.com/File%20Library/Company/Support/Product%20Brochures/NVIDIA%20Data%20Center%20GPUs/nvidia-h100-datasheet.pdf
- NVIDIA H200 (Lenovo Press): https://lenovopress.lenovo.com/lp1944-nvidia-h200-141gb-gpu
- NVIDIA DGX B200: https://www.nvidia.com/en-us/data-center/dgx-b200/
- NVIDIA GB200 NVL72: https://www.nvidia.com/en-us/data-center/gb200-nvl72/
- NVIDIA Blackwell Ultra (B300/GB300): https://developer.nvidia.com/blog/inside-nvidia-blackwell-ultra-the-chip-powering-the-ai-factory-era/
- AMD MI300X datasheet: https://www.amd.com/content/dam/amd/en/documents/instinct-tech-docs/data-sheets/amd-instinct-mi300x-data-sheet.pdf
- AMD MI325X datasheet: https://www.amd.com/content/dam/amd/en/documents/instinct-tech-docs/product-briefs/instinct-mi325x-datasheet.pdf
- AMD MI350X/MI355X datasheet: https://www.koicomputers.com/wp-content/uploads/2025/08/amd-instinct-mi350x-gpu-datasheet.pdf
- Google Trillium TPU: https://cloud.google.com/blog/products/compute/introducing-trillium-6th-gen-tpus
- AWS Trainium2 架構: https://awsdocs-neuron.readthedocs-hosted.com/en/latest/nki/guides/architecture/trainium2_arch.html
- KV cache / 推論物理: https://medium.com/@plienhar/llm-inference-series-4-kv-caching-a-deeper-look-4ba9a77746c8
- 吞吐量 benchmark: https://cerebrium.ai/blog/benchmarking-vllm-sglang-tensorrt-for-llama-3-1-api
- 推論單位經濟學: https://introl.com/blog/inference-unit-economics-true-cost-per-million-tokens-guide
- GPU 雲端定價: https://www.spheron.network/blog/gpu-cloud-pricing-comparison-2026/

### §6 開源模型
- Qwen3 技術報告 arxiv.org/abs/2505.09388；HF Qwen/Qwen3-235B-A22B-Thinking-2507、Qwen3-4B-Thinking-2507
- gpt-oss model card arxiv.org/abs/2508.10925；huggingface.co/openai/gpt-oss-120b；huggingface.co/blog/welcome-openai-gpt-oss
- DeepSeek-V3 技術報告 arxiv.org/abs/2412.19437；api-docs.deepseek.com；HF deepseek-ai/DeepSeek-R1-0528、DeepSeek-V3.2-Exp、DeepSeek-R1-Distill-Qwen-32B
- Llama 4 ai.meta.com/blog/llama-4-multimodal-intelligence；Llama 3.1/3.3 huggingface.co/blog/llama31、ai.meta.com/blog/meta-llama-3-1
- GLM huggingface.co/zai-org/GLM-4.6；glm45.org
- Kimi K2 huggingface.co/moonshotai/Kimi-K2-Instruct、Kimi-K2-Thinking；moonshotai.github.io/Kimi-K2/thinking.html
- MiniMax github.com/MiniMax-AI/MiniMax-M1、M2；arxiv.org/abs/2506.13585
- Gemma 3 ai.google.dev/gemma/docs/core/model_card_3；Phi-4 huggingface.co/microsoft/Phi-4-mini-instruct；EXAONE artificialanalysis.ai/models/exaone-4-0-32b；Mistral docs.mistral.ai
- 基準/校準 artificialanalysis.ai/methodology/intelligence-benchmarking；HF model-cards docs huggingface.co/docs/hub/model-cards；arxiv.org/html/2508.06811v1
