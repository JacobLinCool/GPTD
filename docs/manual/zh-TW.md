# GigaPrompt Tower Defense 玩家說明書

這份文件是給第一次打開遊戲的玩家看的。你不需要懂 AI serving，也不需要讀完整份設計藍圖。你只要記住一件事：GPTD 不是把敵人打死的塔防，而是一座**畫成塔防棋盤的真實 LLM 推論資料中心**。一波波使用者請求從四個入口 lane 匯入中央 Trust Core；你不是把它們打死，而是把它們**服務完成**——又快、又便宜、又正確、又安全——在它們漏進核心之前。

棋盤是隱喻，底層的數字是真的：一個請求帶著真實的 token 數，一座機架帶著一張真實 GPU 的 VRAM 與頻寬，金錢是真實的 $/Mtoken。整個 campaign 是一條**重現 2023→2026 真實資料中心歷史的 100 波淘汰賽**，難度持續往上爬——盡你所能守住中央 Trust Core 撐到越深越好，撐到終點再進入無盡模式。

**在哪裡玩：** 用任何瀏覽器打開 <https://jacoblincool.github.io/GPTD/> 即可——它完全在前端執行，不需安裝任何東西。（想從原始碼執行？請看倉庫的 [README](../../README.md)。）

## 目標

撐過 **100 波 campaign**。每一波都重現 2023→2026 推論時代的一個真實事件——GPT-4、H100 大缺貨、Mixtral MoE、Gemini 的百萬 token 脈絡、o1 推理、DeepSeek R1 與 2025 年 1 月的股災、Stargate、EU AI Act、agentic coding、推論價格戰——而且難度**每一波都在升**。這是一場淘汰賽：多數玩家會在中途陣亡，能撐到第 100 波（最終王關 **The Age of Inference**）就是頂尖。破關後 **無盡模式**會生成越來越難的「Surge」波次，難度永遠在往上爬——你的分數就是你撐到第幾波。

只要三條核心指標任何一條崩掉，你就立刻輸：

- **Trust** — 使用者是否相信你的平台。錯誤答案、不安全答案、漏掉請求，以及過度拒絕善意使用者，都會扣 Trust。
- **SLA** — 你是否準時服務。請求走完自己的整條 lane 還沒被服務，就以一次 504 逾時漏掉；正確但太晚的答案則是一次 Goodput 失分。兩者都扣 SLA。
- **Cash** — 公司是否還有 runway。建築、機架升級、訓練，以及依牆鐘計算的營運帳單（電、冷卻、$/GPU-hr、capex）都要花錢；只有服務成功才賺得回來。低於零就破產。

成功服務一個請求會賺 Cash（以真實 `$/Mtoken` 計價）與 Data，並小幅恢復 Trust 與 SLA。清掉整波還會得到 clear bonus。

## 顯示模式：一般與專家

在標題畫面你會選一種顯示模式。兩種模式跑的是**完全相同的遊戲**——同樣的波次、規則、難度，差別只在介面揭露多少平台內部。模式在這一局內鎖定，並記住你下次的偏好。

- **一般模式**維持精簡儀表：點開機架只看到載入的模型、品質、速度、batch、power/熱量，以及部署與升級按鈕。
- **專家模式**打開完整的 SRE 主控台——推論團隊真正盯的遙測：
  - **TopBar** — Trust / SLA / Cash / Data，加上即時的 **Power 對 Cooling** 餘裕（kW，到上限時有紅線）。
  - **LiveOps 列**（波次中）— **Goodput** 量表（頭條指標：回答正確、安全，且滿足 TTFT／TPOT／E2EL SLO 的請求百分比）、每秒請求數、p95 服務中時間、即時 **$/Mtoken**，以及 KV cache 壓力。
  - **Rack Inspect** — 每座機架四張卡：HARDWARE（真實 GPU、VRAM、HBM 頻寬、TDP、冷卻）、DEPLOYED MODEL（總/啟用參數、各軸品質）、ROOFLINE（prefill 算力瓶頸 vs decode 頻寬瓶頸兩條 bar，標出哪邊在卡）、LIVE（batch、KV 用量、吞吐）。
  - **Request Inspector** — 選中請求的 input/output token、latency class、各軸難度、prefix share 與 hazard。
  - **Wave Report** — 波末結算：六種終局、Goodput、TTFT／TPOT／E2EL 達標率、$/Mtoken 對比營運帳單，以及依 archetype 的計分板。
  - **Model Overview + Lineage Graph** — 你擁有的每個 checkpoint（base + derived），可篩選/排序，以及衍生模型如何從 base 繁衍的 DAG。
  - **TechLab + Post-Training Studio** — 依分類陳列的 infra 科技樹，以及帶 effort 滑桿的後訓練方法菜單。

Title panel 左上角的小 **展示** 按鈕會啟動一局固定 seed 的專家模式，由內建 autoplayer 自動規劃建造、部署機架、研究 infra、補 guardrail，並在 Studio 訓練衍生模型。它用來展示 expert UI，會撐進 100 波淘汰賽的深處，同時展示主要操作：硬體一路升到 DGX H200、部署模型、infra/eval/post-training 研究、衍生 checkpoint、Power/Cooling、Liquid Cooling Loop，以及 P/D rack role。（跟任何一局一樣，autoplayer 最終也會被持續升高的難度淘汰——這正是淘汰賽的設計。）展示模式中仍可點選 rack、request、Models 與 Training Lab 查看資訊；會改變策略的操作仍交給 autoplayer 控制。

新手請從一般模式開始，想知道某條 lane *為什麼*慢時再切到專家模式——roofline 卡和 Wave Report 通常會直接給你答案。

## 基本操作

| 操作                 | 用法                               |
| -------------------- | ---------------------------------- |
| 開始遊戲             | 在主選單按 START                   |
| 選擇顯示模式         | 標題畫面按一般／專家（局內鎖定）   |
| 放建築               | 點底部建築按鈕，再點地圖格子       |
| 連續放同一種建築     | 放完後工具會保持選取               |
| 檢查建築             | 點已放置的建築                     |
| 部署模型到機架       | 點機架，再點 DEPLOY 格的 checkpoint（免費；唯一閘是塞得進 VRAM） |
| 升級機架硬體         | 點機架，再點 RACK →（補層級差價）  |
| 開 Post-Training Studio／科技樹 | 蓋 Training Lab，再於 Build phase 按 TRAIN |
| 賣建築               | 在檢查面板按 SELL（退回現值 60%）  |
| 開始下一波           | 按 START WAVE，或 Space            |
| 暫停波次             | 波中按 Space，或暫停按鈕           |
| 調整速度             | 1／2／3／6／0（=12x），或速度按鈕循環 1x／2x／3x／6x／12x |
| 關閉面板／取消選取   | Escape                             |
| 靜音                 | M，或聲音按鈕                      |

你在 Build phase 蓋建築，也能波中用現金緊急補建築。研究與後訓練只能在 Build phase 進行。

## 請求 Archetype — 九種工作負載

一個請求由它的**工作負載物理**定義，而不是它的外觀。每個 archetype 帶著真實的 input/output token 數（ISL/OSL）、一個 **latency class**（IN 互動 · NR 近即時 · TO 吞吐/離線）、一個對著載入模型 `qualityBy` 判定的**各軸難度**向量、一個 **prefix share**（可快取程度），可能還有 **hazard**。

| Archetype | ISL → OSL（典型） | Latency class | 主要難度軸 | Prefix | Hazard | 它施加的壓力 |
| --------- | ----------------- | ------------- | ---------- | -----: | ------ | ------------ |
| **Embedding** (`embed`) | ~2000 → 0 | TO | general（易） | 0.3 | — | 純 prefill、不生成——單個沒價值，量大成洪流。 |
| **Interactive Chat** (`chat`) | 512 → 256 | IN | chat（易） | 0.4 | — | 均衡、高量。小模型配快機架整天吃得下。 |
| **Code Completion** (`comp`) | 1500 → 150 | IN（TTFT 200 ms） | coding | 0.5 | — | prefill 重、延遲最嚴。弱模型出爛 code，扣 Trust。 |
| **RAG / Long-Context QA** (`rag`) | 8000 → 512 | NR | general + reasoning | 0.6 | — | 巨大檢索 prompt。Cache 讓 prefill 撐得住；window 太小就直接拒收。 |
| **Summarization** (`summ`) | 12000 → 400 | NR | general | 0.2 | — | 極端 prompt、幾乎沒可重用前綴——一張不停的 prefill 帳單，壓榨 context window。 |
| **Reasoning** (`reason`) | 512 → 6000 | NR | reasoning（難） | 0.1 | — | 極端 decode（長 CoT）。只有 thinking model 過得了最難的 reasoning lane。 |
| **Agentic Task** (`agent`) | 6000 → 800 | NR（E2EL 9 s） | **agentic**（最難）+ reasoning | 0.7 | injection 0.3 | 自主、SWE 級、多步工具使用。Benchmark 在這軸*尚未*飽和——只有真正的前緣模型，或你自己訓練的模型，才合得上這個迴圈。 |
| **Batch / Offline** (`batch`) | 1000 → 4000 | TO（無延遲 SLO） | general | 0.1 | — | decode 重的離線生成——純吞吐與 $/token。機架有空就拿來消化。 |
| **Adversarial Prompt** (`jailbreak`) | 600 → 400 | IN | general（易） | 0.1 | jailbreak 0.9 | hazard 載體。模型要自己處理掉，或 guardrail 要攔下，否則不安全答案抵達 core，重傷 Trust。 |

**正確與否是「軸匹配」，不只是「工作量歸零」。** 判定是拿載入模型的 `qualityBy[主要難度軸]` 對比請求在該軸的難度。低於它，你就送出一個 `bad` 答案：請求照樣計費，但扣 Trust。**agentic** 軸很特別——分數來自尚未飽和的 SWE-bench，所以一個答 chat 漂亮的小型快 MoE，仍可能在每個 agentic request 失手。

## 硬體 — 真實 GPU 階梯

一座 serving tower 是兩個決策：你蓋並升級的**機架硬體**，以及你部署上去的**模型**。機架提供真實 GPU 規格（算力 FLOPS、VRAM、HBM 頻寬、TDP、冷卻）；模型提供它的參數、品質與架構。

build bar 賣兩種機架——**Edge**（便宜起手）與 **Frontier**——而且每座新機架都預載 **Llama-3.1-8B**。從一座放好的機架，你可以**原地升級**沿著階梯走，每一步補差價：

| 機架層級（原地升級） | GPU | GPU 數 | VRAM | HBM 頻寬 | 每 GPU TDP | 冷卻 |
| -------------------- | --- | -----: | ---: | -------: | ---------: | ---- |
| Edge GPU Rack（可建） | L4-class    | 1  | 24 GB  | 0.3 TB/s | 72 W   | 氣冷 |
| Standard GPU Rack    | L40S-class  | 1  | 48 GB  | 0.86 TB/s | 350 W | 氣冷 |
| Performance GPU Rack | H100-class  | 1  | 80 GB  | 3.35 TB/s | 700 W | 氣冷 |
| Frontier GPU Rack（可建） | H200-class | 1 | 141 GB | 4.8 TB/s | 700 W | 氣冷 |
| DGX H200             | 8× H200     | 8  | 1.1 TB | 38 TB/s（總） | 700 W | **液冷** |
| DGX B200             | 8× B200     | 8  | 1.5 TB | 64 TB/s（總） | 1000 W | **液冷** |
| GB200 NVL72          | 72× B200    | 72 | 13.8 TB | 576 TB/s（總） | 1000 W | **液冷** |

建築成本是**真實 capex** 除以 1000（Edge 機架幾個 credit；NVL72 約 3000）。兩個來自真實 serving 的硬事實：

- **Roofline 是兩道天花板。** 機架先 **prefill** 吃進 prompt（算力瓶頸，長 context 因 attention 是 O(n²) 而超線性），產出 time-to-first-token，再 **decode** 生成 token（頻寬瓶頸，可 batch）。讓 decode 飛起來的是 **HBM 頻寬**而非裸 FLOPS，這就是 H100/H200 是主力的原因。專家模式的 roofline 卡同時顯示兩條 bar 與哪邊在卡。
- **液冷是硬性 gate。** 液冷的多 GPU 叢集（DGX H200、DGX B200、GB200 NVL72）**在你先蓋好 Liquid Cooling Loop 之前都不能放置或升級進去**——這些機架物理上無法用氣冷壓住。單 GPU 的氣冷層級（到 Frontier H200 機架為止）只要有電與冷卻容量就能放。

## 模型 — 真實 open weights，部署免費

Open weights 是**下載**就有，所以部署**不花錢**，而且只有一道 gate：**VRAM**。機架必須裝得下模型的總參數（`paramsTotalB` × 每參數 bytes）——70B 塞得進 H200；117B+ 的 MoE 需要 DGX pod；671B/1T 前緣需要 DGX B200 或 NVL72。**沒有「架構解鎖才能部署」這回事**：MoE 與 reasoning 只是模型屬性（thinking model 的增益早已烤進它的 `qualityBy`）。*（Post-Training Studio 的訓練方法——LoRA、GRPO、RLHF…——確實各有研究解鎖，但那 gate 的是你能**訓練**什麼，從不 gate 你能**部署**什麼。）*

roster 是真實的 2025–2026 open-weight 模型（Llama、Qwen3 dense + MoE、gpt-oss、Gemma 3、Phi-4、Mistral/Devstral、GLM-4.5-Air、DeepSeek-V3.1、Nemotron、Kimi K2）。每個模型的品質都是**從公開 benchmark 校準**（Artificial Analysis / model card），從不手編——所以你看到的階梯就是真實的那個。

**MoE 把記憶體與速度解耦。** 一個 Mixture-of-Experts 模型的 VRAM 跟著它的**總**參數（所有 expert 都常駐），但它的算力與 decode 速度只跟著每 token 的**啟用**參數。這就是為什麼 30B-A3B 的 MoE 服務起來像 3B、回答起來卻像 30B——夢幻組合——*但* 在 agentic 軸例外：啟用本體太小就是真的不夠（它尚未飽和的 SWE-bench 分數，就是它快不過去的那道牆）。

## Post-Training Studio — 訓練你自己的模型

在 **Post-Training Studio**（在 Training Lab 裡）你衍生**你自己的 checkpoint**，無上限、可疊代——你甚至能微調一個微調過的模型。挑三件事：

1. **一個 base** — 任何你擁有的模型（base 或衍生的）。
2. **一個方法** — 真實的 per-model 菜單：

   | 方法 | 種類 | 作用 |
   | ---- | ---- | ---- |
   | **SFT** | finetune | 基準；不需研究。chat/coding/general/長 context 的紮實能力增益。 |
   | **LoRA / QLoRA / DoRA** | adapter | 最便宜的微調；一個 band 的能力，幾乎不遺忘。 |
   | **DPO** | finetune | 輕量便宜的偏好調校（chat/general/safety）。 |
   | **RLHF** | finetune | 強力 safety/chat 對齊——但最陡的品質稅與上升的 over-refusal。 |
   | **CAI**（Constitutional AI） | finetune | Pareto 安全增益：提升 safety *並* 降低 over-refusal（safe-completion）。 |
   | **GRPO** | finetune | Reasoning RL——把 base 變成會思考的模型；通往 reasoning/agentic 能力最強的路。 |
   | **Distillation** | finetune | 大 teacher 蒸餾成較小 student base：更便宜服務，上限被 teacher 卡住。 |
   | **Merge** | merge | 平均兩個同家族 checkpoint——不重訓就把專才融成一個。 |
   | **CPT** | finetune | 繼續預訓練：廣泛的領域/長 context 增益，但最高的災難性遺忘。 |
   | **QAT** | quantized | 為 INT4 推論而訓練：權重記憶體減半、decode 更快、−2 品質。 |

3. **一個目標軸**（chat / coding / reasoning / general / agentic / safety / 長 context / domain）與一個 **effort** 滑桿（effort 越高增益越多，但要更多算力、資料與波次才完成——而且報酬遞減）。

這趟 run 產出一個**新的衍生模型**，帶著固化的 **lineage**（base、方法、目標、effort、depth），可在 Lineage Graph 看到。越深的鏈邊際增益越小、遺忘累積越多——沒有無限刷品質的漏洞。這就是你的無盡模式品質天花板：在前緣 base 上做一趟 GRPO-agentic，就是你的 agentic 專才。

## Infra 科技樹 — 只管 serving

研究（在 Training Lab）跑在**三條獨立軌、共用一個算力池**上：**infra** 升級、**post-training** run、**eval**（red-teaming）。一趟 run 先花 **Data**，再在波次中**徵用你最強的機架**做 GPU 算力——它們會停止服務直到算力預算達成——所以要把 run 排在波次表周圍規劃。

infra 樹**只管 serving/基礎建設**（它從不碰模型權重——模型架構是模型的屬性）。22 個節點循著真實的 serving 歷史：

- **Scheduling** — Continuous Batching（一切之根：終結一次一個請求的時代）、Multi-Step Scheduling、Chunked Prefill **對上** P/D Disaggregation（硬性互斥：chunked 在吃 prompt 時仍持續 decode；disagg 把 prefill 與 decode 拆成獨立 pool）。
- **KV memory** — PagedAttention（利用率 30% → 96%，KV 效率之根）、Prefix Caching（命中上限到 85%）、FlashAttention、FP8 / INT4 KV-quant、KV Offloading。
- **Decoding** — Speculative Decoding（低 batch 的前哨倍率，batch 變大後逐漸失效）。
- **Weight quant（PTQ）** — FP8 / INT4（AWQ/GPTQ）/ NVFP4（限 Blackwell）：更少 VRAM、更便宜的 decode 頻寬，與 per-model 的 QAT 區隔。
- **Parallelism** — Tensor / Pipeline / Data / Expert（EP 是 MoE 的 serving 勝著）。
- **Routing / multi-LoRA / engine** — KV-Aware Routing、Multi-LoRA serving（S-LoRA），以及引擎層 vLLM → SGLang → TensorRT-LLM。

## 兩層安全

帶 hazard 的請求（`jailbreak`，以及帶 prompt injection 的 `agent`）必須被**處理掉**，否則不安全答案抵達 core 會重傷 Trust。有兩層：

- **第一層——模型內生對齊。** 烤進權重（由 RLHF/CAI/safety-SFT）。它以**零 serving 延遲**自處理 hazard，但帶著**對齊稅**（品質下降）與 **over-refusal** 風險。gpt-oss 家族是教學對比：高 safety 卻*低* over-refusal、低稅（safe-completion 風格），對比其他人的 hard-refusal。你不能逐請求切換它——它就是這個模型的本性。
- **第二層——guardrail 建築**（放在 lane 上，延遲疊加到請求）：

  | Guardrail | 類型 | 延遲 | 攔截 | 側 | 對你機架的占用 |
  | --------- | ---- | ---- | ---- | -- | -------------- |
  | **Prompt Guard** | encoder（BERT 86M） | ~92 ms | jailbreak、injection | input | 無——不占機架 |
  | **Llama Guard** | generative（12B） | 一次真實（較短）的 12B 推論 | 全部四種 hazard | 兩側 | 跑在它**自己的 H100 機架**上——抽真實電力、搶 batch |
  | **Moderation API** | 廠商託管 | ~120 ms | harmful、PII | 兩側 | 無——在別人的機架上 |

  關鍵的真實對比：encoder 是**毫秒級**；generative guardrail 是一次**完整推論**——慢上一到兩個數量級，而且耗你真實的 serving 資源。

guardrail 的**閾值**在 recall 與 **over-refusal** 之間取捨：調高抓更多，就會誤擋更多善意流量（`over_refused` 終局——營收 0 加輕度扣 Trust）。沒有免費午餐。**Red-Team Eval**（eval 研究軌）才是真正的解法——它把 guardrail 重新校準成依*意圖*而非關鍵字判斷，砍 over-refusal 並解鎖 injection/PII 偵測。

## 經濟 — 真實 $/Mtoken

- **收入**是 `$/Mtoken`：每個 archetype 有一個 input 與一個 output 的 token 價。reasoning 與 agentic 的 output 賣高價；embedding 與 chat 賣便宜。一次 prefix-cache 命中省下你的 prefill 算力（並以折扣計價快取的 input），所以快取是真實的利潤槓桿。
- **營運成本**是真實的且**依牆鐘計費**：capex 攤提 + $/GPU-hr + 電 + 冷卻。因為帳單由時間決定、而非由服務出的 token 決定，**閒置或過度建置的機架會燒錢**，低利用率會炸掉你的單位成本。過度建置是真實的破產途徑。
- **六種終局**結算每個請求：

  | 終局 | 意義 | 經濟 |
  | ---- | ---- | ---- |
  | `served` | 正確、準時、安全 | 全額 $/Mtoken + Data + Trust/SLA 上升 |
  | `slo_miss` | 正確且安全但**太晚**（沒達 TTFT、TPOT 或 E2EL） | 零現金（Goodput 失分）+ 扣 SLA |
  | `bad` | 品質低於請求的難度 | 照樣計費，但扣 Trust |
  | `unservable` | context 超過模型 window，或沒做完就漏掉 | leak：扣 SLA、扣 Trust |
  | `unsafe` | hazard 沒清就抵達 core | 重扣 Trust |
  | `over_refused` | 善意請求被誤拒（第一或第二層） | 營收 0 + 扣 SLA + 輕度扣 Trust |

## 讀 Wave Report — 下一步該修什麼

Wave Report 是你的波末事故報告。先看哪個非 `served` bucket 最大，再修對應的子系統：

| Report 結果 | 意思 | 優先嘗試的修法 |
| ----------- | ---- | -------------- |
| `slo_miss` | 回答正確且安全，但錯過延遲合約。 | 如果 **TPOT** 高，是 decode 太慢：從 L4 升到 Standard/H100、換啟用參數較小的模型、做 FP8 Weight Quant、Speculative Decoding、FlashAttention、SGLang/TRT-LLM。如果 **TTFT** p95 高，是 prefill 或排隊問題：在該 lane 更早的位置或中央匯流區補 coverage、增加機架、用 Cache/Prefix Caching，或透過 infra tree 拆 prefill/decode。 |
| `bad` | 機架做完請求了，但模型品質低於該請求的軸難度。 | 把模型配到正確流量：coding 要 Devstral、Qwen3-30B-A3B、Qwen3-32B，或你訓出的 coding checkpoint；reasoning 要 thinking model；agentic 要前緣模型或 GRPO-agentic 衍生模型。快但弱的模型仍然會 `bad`。 |
| `unservable` | 請求撞到模型硬限制，通常是 context window / VRAM fit，最後沒有完成。 | 換 context window 更大的模型，用 FlashAttention / Prefix / KV tech，或先做 FP8 Weight Quant、升更大的機架讓正確模型放得下。這首先不是速度問題。 |
| `unsafe` | 帶 hazard 的請求沒有被清掉，就被回答或漏進 core。 | 把正確 guardrail 放在 Trust Core 之前：Prompt Guard 處理 jailbreak/injection，Moderation API 處理 harmful/PII，Llama Guard 做廣泛覆蓋。也可以換更安全模型或做 safety 目標的 Studio run。 |
| `over_refused` | 善意使用者被模型對齊或 guardrail 誤擋。 | 不要在不需要時把重型 guardrail 鋪滿每條 lane。偏好低 over-refusal 模型、CAI/safe-completion 風格安全，並跑 Red-Team Eval 讓 guardrail 依意圖校準。 |
| `Timed out (504)` / `leaked` | 請求在完成服務前抵達 Trust Core。 | 補 coverage、補 serving capacity、處理 brownout/throttling、避免波中同時開太多 training，並用 Router/Cache 讓正確機架更早接到請求。 |

兩個常見陷阱：

- **服務時間從第一次接觸硬體開始算。** 請求碰到第一座 server 或 guardrail 之前的 lane 移動，是塔防站位時間，不算 TTFT/E2EL；接觸硬體之後的排隊、guardrail 檢查、prefill、decode 才會計入。
- **Inspect latency 只是必要條件，不是保證。** 一座機架單看 TTFT/TPOT 可能合格，但整波仍可能因為請求進入機架範圍後排隊太久而 miss。
- **速度和品質是兩件事。** 小模型配快 GPU 可能達標但 `bad`；強模型配慢機架可能正確但 `slo_miss`。

## 事件 Incident

清掉一波後，下一波的 **Incident** 會出現在橫幅上——它的效果在建造階段與該波**真的生效**。它是建置需求，不是背景故事。21 個 incident 全取材自 2023→2026 的真實事件，主要家族：

- **電價飆升** — *Capacity Auction Shock* / *On-Site Fuel Spike*：運轉帳單跳 ~1.6–1.9×。（罕見的 *Firm Nuclear PPA* 福利則讓電變便宜。）
- **冷卻不足** — *Liquid Loop Fault* / *Water-Use Restriction*：冷卻容量掉 35–45%（預期會 throttle）。
- **供應衝擊** — *H100 Allocation Crunch* / *HBM Sold Out* / *Chip Export Ban*：新建築貴 1.6–2.0×。（*Lead Times Ease* 則變便宜。）
- **價格戰** — *Token Price War* / *DeepSeek Market Shock*：每個請求的營收掉 30–40%——只有高 utilization 才划算。
- **安全壓力** — *Regulatory Audit* / *Adversarial Suffix Storm*：每個漏掉的不安全答案扣 1.6–1.8× Trust。
- **資料完整性** — *Training-Data Poisoning* / *Eval Set Contamination*：你存的 Data 被砍。
- **好運** — *Viral Demand Surge*（量爆增，但每個乾淨 serve 賺更多）、*Enterprise Demo Day*（獎勵 +50%）、*Firm Nuclear PPA* / *Lead Times Ease*（電便宜／建造便宜）、*Off-Peak Demand Lull*（量下降——喘口氣補進度）。
- **單一入口暴增** — *Undersea Cable Severed* / *Edge Provider Outage* / *Global IT Meltdown*：所有請求**全擠進單一入口 lane**，另外三條閒置。把服務與 guardrail 集中堆在那條暴增的 lane，不要平均分散。

真實事件波會強制套用它的招牌 incident；其他波則隨機抽一個（每第 10 波必帶一個硬的）。冷卻故障前先補 Cooling；稽核或越獄風暴前先補 guardrail；缺貨前先囤貨；海纜中斷時把容量集中。

## 無盡模式

清掉 **第 100 波**（最終王關 *The Age of Inference*，淘汰賽的頂點）解鎖 **∞ CONTINUE — ENDLESS MODE**：程序生成的「Surge」波次，難度（請求難度、量、工作量、獎勵）每波往上爬，每第 10 個 surge 必帶一個硬 incident。你的 roster 在真實前緣封頂，但你的 **Post-Training Studio** 不會——疊代的「微調再微調」鏈，就是你讓品質跑在上升難度線之前的方法。你的分數是你撐到的波次。

## 開局建議

### 第 1 波 — Launch Day

主要是 Interactive Chat。在第一批入口 lane 旁或中央匯流區放 3–4 座 Edge 機架；它們預載的 Llama-3.1-8B 應付 chat 沒問題。留一點現金緩衝給營運帳單。

### 第 2 波 — Coding Boom

Code Completion 開始考品質，8B 會答錯一些——可承受的 Trust 流失，這是遊戲在叫你**研究**。蓋 Training Lab，先做 **Continuous Batching**（便宜、快，而且是最大的早期倍率——它終結一次一個請求的服務）。接著做 **PagedAttention** 拿 KV 餘裕。升級一座機架並部署更強的模型（Qwen3-32B、gpt-oss-20b，或之後的前緣 MoE——任何模型只要塞得進 VRAM 就能部署）。

### 中期 — Mixed Traffic、安全、Reasoning

你需要專業化：用 Router 把對的模型送到對的 archetype；在機架群上蓋 Cache 給可快取流量（embed/chat/rag）；guardrail（先 encoder，agentic/jailbreak 突襲時加 Llama Guard）；一座配真實 reasoning 模型的 Performance/Frontier 機架；以及把 power/cooling 維持在需求之前。盯著利用率——別蓋一堆閒置機架。

### 後期與 agentic 之牆

`agent` 流量才是真正的考驗。便宜快的 MoE 其他都答得了，卻輸掉 agentic request——你需要一個真正的前緣模型，*或* 一個在 Studio 訓出來的 **GRPO-agentic** checkpoint。在任何 DGX/NVL72 叢集（DGX H200、DGX B200、GB200 NVL72）之前，先蓋一座 **Liquid Cooling Loop**——那些機架沒有它跑不起來。把優先入口路線維持在過度供給：一次 agentic 逾時就是災難。

## 常見失敗與修法

| 問題 | 症狀 | 修法 |
| ---- | ---- | ---- |
| 請求漏到 core | SLA 掉很快 | 更多機架覆蓋／batch（Continuous Batching、PagedAttention），或一座 Router |
| Trust 慢慢流失 | 有在服務，但 `bad` 答案堆積 | 模型品質低於請求的軸難度——部署更強模型或後訓練一個 |
| agentic request 老是失敗 | 用大 MoE 也在 `agent` 上 `bad` | agentic 軸尚未飽和——用前緣模型或 GRPO 訓一個 agentic 專才 |
| Jailbreak 重傷 Trust | core 出現 `unsafe` | guardrail 鋪更早；提升模型對齊（RLHF/CAI）；跑 Red-Team Eval |
| 過度拒絕善意使用者 | `over_refused`，Trust + SLA 雙掉 | 調低 guardrail 閾值；偏好 CAI（safe-completion）而非 hard-refusal RLHF；跑 Red-Team Eval |
| BROWNOUT | 機架掉線 | 加 Power Plant，或 weight-quant 降低抽電 |
| THROTTLING | 全部變慢 | 加 Cooling Tower（或一座 Liquid Loop） |
| 放不了高密度機架 | DGX/NVL72 蓋不了或升不上去 | 先蓋 Liquid Cooling Loop（每座液冷 DGX/NVL72 叢集的硬性 gate） |
| 現金歸零 | 有在服務卻破產 | 太多閒置／過度建置的機架在燒牆鐘帳單——把艦隊調整到正確規模、拉高利用率 |

## 核心策略

GPTD 的關鍵不是「買最大的機架」——而是「用最便宜且足夠可靠的方式服務每一種流量」。機架是槍；**模型是你為每座機架挑的彈藥**；Post-Training Studio 是你的軍械師。每一波都問自己：

1. 下一波主要考速度、品質、安全，還是經濟？
2. 我的 power/cooling（需要的話加一座 liquid loop）撐得住下一批機架嗎？
3. 我有把昂貴的前緣/agentic 能力留給真正需要它的請求，並把利用率維持得夠高、不燒錢嗎？

把這三題答好，你就不是在疊塔——你是在經營一座真的能撐進 The Age of Inference 深處的 AI 平台。
