# GPTD 實作藍圖 (Implementation Blueprint)

> 本文件是 GPTD 的權威設計規格，涵蓋六個子系統（models-finetune / requests / safety / tech-tree / ui / core-sim-econ），以單一資料模型、單一術語、單一單位系統描述整套設計。GPTD 首先是一款塔防遊戲：玩家守護的是使用者的請求，要答得對、不出事、而且夠快；棋盤是隱喻，棋盤底下的數字取自真實的 LLM 推論工程。設計原則是**一致性 + 物理正確**：以 core-sim 的 serving 數學為脊椎，脊椎的物理閉環（時間與單位、prefill/decode 速率、SLO 判定）先合上，其他子系統坐在其上。Slogan：**「the board is the metaphor, the numbers are real.」** 散文用正體中文（台灣）；identifier / 數字 / §ref verbatim，§ref 對應 `REFERENCE-DOSSIER.md`（同目錄）。程式碼是最終真相：`src/sim/**`、`src/core/types.ts`、`src/config.ts`；每個公式與常數的速查見 `MATH.md`。

**術語標準（全文一致）**：`paramsTotalB`/`paramsActiveB`、`nativeWeightBytes`、`kvBytesPerToken`/`kvStateMbPerReq`、`thinking`（`always`/`hybrid`/`never`）與 `AnswerMode`（`instant`/`thinking`）、`alignment.safety`、`CapabilityAxis` + `difficulty[axis]`、`inputTokens`/`outputTokens`/`contextLen`、`s.infra`、`s.derivedModels`、`resolveModel`、cohort（`COHORT_STREAMS` 條真實串流）、`ParallelPlan`（`g`/`tpDeg`/`stages`/`replicas`/`lanes`）、`Goodput`（乾淨服務 ÷ 全部終局）、`$/Mtoken`、`SIM_TIME_SCALE`、real-s / board-s。

**單一真相速覽（資料模型/單位）**：

- 模型的 serving 速率一律由 §6.2 的 lane step 計算：每個 decode step 重讀權重與每條串流的 KV，算力端以 `2 × paramsActiveB` FLOPs/token 計。模型不持有抽象速度欄位；架構事實（`paramsTotalB`、`paramsActiveB`、KV 版面、release precision、context window）來自各 checkpoint 的 Hugging Face `config.json`（`data/model-arch.json`）。
- KV 以架構真值計：`kvBytesPerToken` 只算會隨 context 成長的層（full attention、MLA latent + rope、CSA/HCA 壓縮項、sparse indexer keys），sliding-window 與 linear/SSM 層的固定成本歸 `kvStateMbPerReq`。`attn` 只是顯示標籤。
- 權重格式是**每座 rack 的選擇**（`Tower.precision`，未設定 = auto）：駐留 bytes = `min(nativeWeightBytes, 格式 bytes)`；只有量化到 release precision 以下才付品質稅。
- 能力是兩個向量：`qualityBy`（思考模式能力；從六個 benchmark cell 校準）與 hybrid 才有的 `qualityByInstant`。思考支援 `thinking` 來自 chat template；每個請求的回答模式由 `answerMode(model, def)` 決定。
- 第一層安全是 `ModelDef.alignment: AlignmentProfile{safety, refusalStyle, overRefusal}`；over-refusal 唯一真相是 `alignment.overRefusal × refusalExposure`。
- infra 狀態集中在 typed `s.infra: InfraState`；`s.upgrades` 只保存「已研究」標記與 method-unlock / red-team 計數。
- 衍生模型住在 `s.derivedModels`，由 `resolveModel(s,id)` O(1) 解析；建立當下就把所有欄位固化（snapshot）。
- 每個請求以七種終局之一結束（§2.5）：`served` / `sloMiss` / `bad` / `unsafe` / `overRefused` / `unservable` / `leaked`，全部經 `resolveOutcome`（`sim/resolve.ts`）結算。
- 時間用雙時鐘（§0.4）：SLO 在 real-s 軸以每個 token 的物理時間累計判定；`SIM_TIME_SCALE` 只壓縮 board 上的可見步調。

---

## 0. 願景與統一模擬模型 (Vision & the Unified Simulation Model)

### 0.1 願景

GPTD 是一款塔防遊戲。四條入口 lane 把使用者請求送向中央的 Trust Core，玩家擺放 GPU rack、Router、Cache、guardrail、電力與冷卻，把每個請求在抵達 core 之前答好。勝負由三個量表決定（Cash、Trust、SLA），一場百波淘汰賽從 2023 年的聊天機器人熱潮一路走到 2026 年的 agent 時代。

遊戲的樂趣與教學來自同一件事：**每個結果都看得出原因**。一個請求失敗時，玩家能看到是哪個延遲 bound 沒過（TTFT、TPOT、E2EL、或思考模型的 time to first answer）、哪個能力軸不夠、是被誤拒還是交付了不安全的回答、是 context 放不下還是根本沒有 rack 接。而背後的取捨是真實工程的方向：小模型快、大模型聰明；思考更準但更慢；guardrail 更安全但多一段延遲並且會誤拒；batch 提高總吞吐卻降低單一使用者的速度；KV 記憶體決定能同時服務多少人。每個 §ref 都掛在一個看得見的遊戲機制或 tooltip 上。

### 0.2 統一模擬脊椎（spine）

core-sim 是所有子系統插入的黏合層。一個請求的生命週期就是脊椎：

```
spawn（時代縮放後的真實 token 數，§2.6）
  → 沿四條入口 lane 之一走向中央 Trust Core（board 隱喻；lane 移動只用 board-s）
  → 首次硬體接觸：進入一座「能 prefill 它」的 rack 範圍
        · TTFT 計時開始（queueSec 只在這時累計）
        · 覆蓋這條 lane 的 guardrail 依 family 篩檢一次（§3.3）：input 延遲 → TTFT，output 延遲 → E2EL；
          input 端攔下的攻擊在任何運算之前就結束
  → rack 准入（離 core 最近的請求先）：完整序列的 context window 與「單一 model copy 的 KV」硬門檻；
        cohort 依剩餘 KV 准入；prefix cache 只查一次（§6.2）
        · prompt 只交給一座 rack：範圍內有空位、最快能開始它的那座（佇列中的 prompt 工作最少；同分取較小 tower id）；
          Router 範圍內改為 capability-aware dispatch：能答對且最快答完的那座（§4.3）
        · 串流中的答案由它的 home rack 優先准入；同模型的其他 rack 只用剩餘容量幫忙 decode
  → PREFILL：exclusive（每條 lane 依序背靠背跑 prompt，該 lane 的 decode 停頓）或 chunked token budget（§4.3）
  → 第一個 token：TTFT latch；由產生它的模型擲第一層對齊（§3.2）；回答模式決定 hidden reasoning tokens（§1.4）
  → DECODE：lane step = max(HBM 讀取, 運算) + 背景 prefill + 固定成本；每個 token 依產生它的 rack 計時與計分（§6.2）
        · KV 屬於算出它的模型：只有同模型的 rack 能接續；另一個模型只能把整段序列重新 prefill 後接手（recompute）
  → 交付：output 端 guardrail 先檢查 → TPOT / E2EL 判定 → 七終局之一（§2.5）
  → 經濟：依實際處理的 token 計價收入；GPU-hour 與能源兩行帳單；每波 SLA 合約依 Goodput 支付（§6.6）
```

**每個子系統掛在脊椎上的明確點**：
- Models (§1) 提供 `paramsTotalB/paramsActiveB`、KV 版面、`nativeWeightBytes`、`qualityBy/qualityByInstant`、`thinking/thinkTokens`、`longCtx`、`alignment` → 餵 lane step、KV 預算、品質判定與第一層安全。
- Requests (§2) 提供 `inputTokens/outputTokens/difficulty/latClass/thinkMul/prefixShare/refusalExposure/hazards` → 定義工作量、SLO、可快取性、誤拒暴露與安全種子。
- Safety (§3) 讀 `alignment`（第一層）並在 lane 上插 guardrail 建築（第二層）→ 決定 hazard 是否被清、良性請求是否被誤拒。
- Tech (§4) 寫 `s.infra` → 改 engine batch 上限、KV 配置、prefix 命中、權重格式、平行化、chunked prefill、spec decoding、routing、引擎。
- Core-sim (§6) 擁有 parallel plan、lane step、KV 預算、SLO/Goodput、真實 kW、兩行帳單、`step()` 順序與雙時鐘轉換。
- UI (§5) 唯讀以上全部，以真實單位呈現，**不改 sim**（`sim/**` 不得 import `mode.ts`；`m.real` 只供顯示）。

### 0.3 不可妥協的真實錨點（每個子系統 MUST 用）

prefill = compute-bound、decode = bandwidth-bound (§1.1)；prefill 因 O(n²) attention **長 prompt 超線性** (§1.1)；`FLOPs/token ≈ 2 × active_params` (§5.7)；**每個 decode step 重讀權重與 batch 中每條串流的 KV**，batch 變大時總吞吐上升至 compute roof、單一使用者速度下降 (§5.7)；MoE VRAM ∝ total、每步讀取 ∝ active 加上整個 batch 觸及的 expert 聯集 (§4.8)；KV 依層的種類計算，**seq 隨 decode 動態成長** (§4.6/§5.6)；BF16 / FP8 / 4-bit 權重約 2 / 1 / 0.5 bytes，W4A16 以 BF16 速率運算 (§4.5)；tensor parallel 效率 < 1 並帶 all-reduce 成本，多出的 GPU 變成副本＝並發而非單人速度 (§4.7)；8 卡 DGX 為氣冷、rack 級 NVL72 需直接液冷 (§5.5)；`$/Mtoken = ($/hr × 1e6)/(tok/s × 3600)`、閒置 rack 照付帳單 (§5.8)；後訓練幾乎都是 per-model，serving 層只有 PTQ 與 multi-LoRA (§2.10)；安全兩層 (§3)；能力壓縮後**唯在 agentic/SWE 維度規模仍拉開差距** (§6.4)；lineage 機器可讀 (§2.9)。

### 0.4 時間與單位系統（脊椎物理閉環）

所有 tok/s、bytes、watts、USD 都以真實單位計算；請求的延遲以**它實際走過的每一段物理時間**累計，再與真實 ms 門檻比較。

**兩個時鐘：**
1. **real-s（真實秒）**：請求的服務時間。每個 combat tick 推進 `realDt = dt × SIM_TIME_SCALE`（出貨值 10）真實秒，token 依 rack 的物理速率前進：
   ```
   ttftReal  = queueSec                      // 只在範圍內有「能 prefill 它」的 rack 時累計（佇列、slot/KV 爭用；
                                             //   在滿載 rack 範圍內等待也算，即使最後由另一座 rack 服務）
             + prefillWallSec                // 完成 prefill 的那個 tick 內的分數時間（含 chunked 的步驟）
             + guardInSec                    // 覆蓋 lane 的 input guard，每個 family 一次
             + admissionDelaySec             // pipeline bubble、multi-step 的排程等待
   ttfatReal = ttftReal + hidden tokens 的 decode wall time       // 思考模型的第一個「答案」token
   e2elReal  = ttftReal + Σ 每個 token 的 wall time + 停頓 + KV transfer + guardOutSec
   TPOT      = decodeSec / (maxWork − 1)     // 交付時判一次；hidden tokens 計入
   ```
   一個 token 的 wall time 是產生它的 lane 的物理時間：`1 / (rate × share)`，其中 `rate` 是該 lane 的 per-user 速率（§6.2），`share` 是 prefill 留給 decode 的時間比例。KV 不足而只放得進 `k < 28` 條串流的 cohort，其 sprite 要等串流輪流完成（`wall = sec × 28/k`），這段等待計入 E2EL 而不計入 TPOT。同一個請求被多座**同模型** rack 同時 decode 時（board 的「多座塔一起打一個敵人」），每個 token 仍以產生它的 rack 計時：它在 board 上更快完成，真實延遲卻是逐 token 的序列總和，不會變短。另一個模型讀不了這份 KV（KV tensor 綁定一個模型的層、head 與 K/V 投影）：當請求走出所有同模型 rack 的範圍、只剩其他模型的 rack 時，接手的 rack 必須把整段序列（prompt + 已生成的 token）重新 prefill（recompute preemption），第一個 token 不變，重算時間是 decode 內的停頓（計入 E2EL 與 TPOT）。
2. **board-s（可見步調）**：lane 移動、動畫與帳單的時間軸。請求在 lane 上走路本身不累計任何真實延遲；一座 rack 的帳單以 board-s 計時，再換算成 RACKS_PER_TILE 座真實 rack 的 real-s 成本（§6.6）。

**SLO 一律在 real-s 軸判定**：TTFT 在第一個 token 判；time to first answer 在 hidden tokens 結束的那一刻判；E2EL 在 decode 途中（含 output guard 尾段）與交付時判；TPOT 在交付時判一次。第一個違反的 bound 記為 `sloCause`。

**guardrail 延遲歸屬**：input 端檢查加進 TTFT（在 prefill 之前）；output 端檢查加進 E2EL（交付前一次性檢查，不逐 token 疊在 TPOT）；`side:'both'` 兩端各一次。每個請求只在首次硬體接觸時被篩檢一次，guard 擺在 lane 的哪個位置都一樣。

**cash / USD 單位**：1 credit = $1000（`CREDIT_USD`）。一個請求 sprite 代表 `TRAFFIC_SCALE` = 100000 個真實請求；一座 board rack 代表 `RACKS_PER_TILE = TRAFFIC_SCALE / COHORT_STREAMS` 座真實 rack，每座承載一個 sprite 的 28 條串流。capex、帳單與 token 收入都用同一個比例，所以 rack 卡片顯示的 `$/Mtoken` 就是 cash 實際遵守的速率，`cash < 0` 是真實意義的破產。

---

## 1. 模型 + 後訓練 (Models + Fine-tuning)

### 1.1 設計理念（grounded §2.10、§6.4）

後訓練是 per-model 的：每次後訓練產生一個新的 checkpoint，而不是全艦隊 buff。微調是資料驅動的可組合菜單，`qualityBy` 由公式計算（遵守 calibrate.ts 鐵律）。模型差異化的物理依據在 serving 成本、記憶體牆、思考模式與**正確的差異化維度**（agentic/SWE，§6.3）。

**三個 invariant：**
- **I1** — 一切後訓練都產生一個新的 derived `ModelDef`（§2.10）。微調不是 buff，是一個新 checkpoint。
- **I2** — base 的 `qualityBy` / `qualityByInstant` 由 benchmark 計算（calibrate.ts）；derived 的由 `computeDerivedFields` 計算。recipe 常數（`gainScale/gainCap/taxScale/forgetScale`）是**經 autoplay 校準的遊戲曲線**，`calibrateRecipes()` 是驗證排序不變式的 pass-through。誠實標記：base 校準是量測（benchmark → quality），derived 增益是遊戲曲線，並受 body 容量天花板約束。
- **I3** — VRAM ∝ `paramsTotalB × 駐留 bytes`；compute ∝ `paramsActiveB`；每步讀取 ∝ active 權重 + MoE expert 聯集 + KV（§4.8/§5.6/§5.7）。微調不改架構；只有 distill（換較小 student body）、merge（同一 body 的平均）、qat（release precision 變 4-bit）動到部署欄位。

### 1.2 無上限衍生模型架構（序列化/重現閉環）

`MODEL_DEFS` 是 module-level 靜態 `Record`（gate 後的 active roster）。無上限的 derived 模型住在 `GameState.derivedModels`，由單一解析點解析：

```ts
// sim/models.ts
export function resolveModel(s: GameState, id: string): ModelDef | null {
  return s.derivedModels[id] ?? MODEL_DEFS[id] ?? null
}
```

**非遞迴 snapshot 語意**：`deriveModel(s, meta)` 在訓練完成當下：
1. `base = resolveModel(s, baseIds[0])`（base 可以是另一個 derived → 支援「fine-tune a fine-tune」無上限）；merge 另解析第二個 checkpoint 並檢查 `mergeCompatible`；
2. 呼叫共用的純函式 `computeDerivedFields`（Studio 預覽 `studioPreview` 呼叫同一個函式，預覽永遠等於結果），把 `qualityBy/qualityByInstant/alignment/thinking/thinkTokens/部署欄位` 固化寫進新的 `ModelDef`；
3. serve 時不回溯 lineage——`resolveModel` 永遠是 O(1) 查表；
4. 重現只需 `seed + derivedSeq + 每筆 Lineage`（method/target/effort/baseIds/depth）。

`loadoutOf` / `loadout` / `deployModel` / deploy picker 全部走 `resolveModel(s,id)`。

**深鏈的四道收斂力**：每加一層，(a) 增益依 `depthDamp = 1/(1 + 0.15·depth)` 遞減；(b) 非目標軸的遺忘乘上 `forgetDepthMul = 1 + 0.5·(depth − 1)`；(c) 成本乘上 `1 + 0.6·baseDepth`；(d) 目標軸被 body 的容量天花板封頂（§1.4）。天花板只看 roster 的 base 模型，所以堆疊不能自己把天花板往上推：小 body 上的 RL 增益受 base 容量限制（DeepSeek-R1 distill 的觀察），而 agentic/SWE 是規模仍然拉開差距的軸。

### 1.3 後訓練方法菜單（PostTrainMethod / PostTrainTarget / MethodRecipe）

完全對應 §2 的真實 per-model 菜單，資料驅動：12 個 method（`cpt`/`sft`/`lora`/`qlora`/`dora`/`dpo`/`rlhf`/`cai`/`grpo`/`distill`/`merge`/`qat`），8 個 target（5 個 `CapabilityAxis` + `safety`/`longctx`/`domain`；`longctx`/`domain` 落在 `general` 軸）。型別見 §7。

**MethodRecipe 全表**（`content.ts METHOD_RECIPES_RAW`；成本錨定 §2.10 的算力相對量級，增益/稅/遺忘剖面模型化 §2.8 五大 tradeoff）：

| method | relation | allowedTargets | costCompute | costData | gainScale | gainCap | taxScale | forgetScale | reshapesDeploy | requiresTech | §依據 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `cpt` | finetune | domain/longctx/general | **60** | **40** | 22 | **40** | 0 | **3** | – | `pt_cpt` | §2.1 繼續預訓練、無 replay 的遺忘最重 |
| `rlhf` | finetune | safety/chat/general | **40** | 14 | 14 | 16 | **0.6** | 0.12 | – | `pt_pref` | §2.4 四模型同跑，最貴 |
| `grpo` | finetune | reasoning/agentic | 18 | 8 | **28** | 40 | 0.05 | 0.15 | – | `pt_rl` | §2.5 推理 RL |
| `cai` | finetune | safety | 16 | 9 | 12 | 14 | 0.25 | 0.08 | – | `pt_cai` | §2.4 中高安全、低稅、降誤拒 |
| `distill` | finetune | reasoning/coding/agentic | 12 | 16 | 24 | (student cap) | 0 | 0.04 | **✓** | `pt_distill` | §2.6 |
| `dpo` | finetune | chat/general/safety | 10 | 11 | 12 | 12 | 0.08 | 0.06 | – | `pt_pref` | §2.4 中 |
| `sft` | finetune | chat/coding/general/longctx | 6 | 8 | 16 | 14 | 0 | 0.08 | – | （起手免研究） | §2.2 基準 |
| `qat` | quantized | general（不推品質） | 6 | 3 | 0 | 0 | 0 | 0 | **✓** | `pt_qat` | §2.7 |
| `dora` | adapter | 五軸 | 1.4 | 6 | 14 | 10 | 0 | 0.03 | – | `pt_lora` | §2.3 略高於 LoRA |
| `lora` | adapter | 五軸 | **1** | 5 | 12 | 8 | 0 | 0.02 | – | `pt_lora` | §2.3 最便宜 |
| `qlora` | adapter | 五軸 | 0.8 | 5 | 11 | 8 | 0 | 0.02 | – | `pt_lora` | §2.3 門檻最低 |
| `merge` | merge | general（軸取平均） | **0.2** | 4 | – | – | 0 | **0** | – | `pt_merge` | §2.6 model soups / TIES |

> **校準標記**：`gainScale/gainCap/taxScale/forgetScale` 是 `autoplay-calibratable` 的遊戲曲線。`recipeGainOrderingOk` 守住 §6.3 的 band 位移排序：merge 增益 0 < adapters < 重型方法（sft/grpo/cpt），且 GRPO 是 reasoning/agentic 增益最高的方法。method unlock 是 infra 研究軌上的 `r_pt_*` 節點（§4.4）。

### 1.4 公式

**base `qualityBy`（calibrate.ts）**：每軸是六個 Artificial Analysis cell 的加權 composite（primary 0.6 + 兩個 secondary 各 0.2），再經 per-axis 分段線性曲線映射；曲線在最後一個 anchor 之上走飽和尾段，逼近 130 而不堆在 clamp 上：

| CapabilityAxis | composite（primary 0.6 · secondary 0.2 · 0.2） | 角色 |
|---|---|---|
| `chat` | IFBench · GPQA-Diamond · LCR | 指令遵循 / 對話 |
| `general` | GPQA-Diamond · IFBench · LCR | 廣泛知識 |
| `coding` | SciCode · Terminal-Bench Hard · IFBench | 科學程式 |
| `reasoning` | HLE · GPQA-Diamond · LCR | HLE 讓頂端不飽和 |
| `agentic` | **Terminal-Bench Hard** · IFBench · LCR | **未飽和、最具鑑別力** |

```
pwl(b) = b ≤ b0 ? q0·b/b0
       : b ≥ bn ? qn + (130 − qn)·(1 − e^(−1.5·(b − bn)/(130 − qn)))
       : 相鄰 anchor 線性內插          → clamp(round, 8, 130)
```

> **參考尺度（scheme H）**：AA 會重跑或退役 eval，單一快照的 % 不穩定。所有 cell 都表達在一個凍結的尺度上——曲線擬合所用的 2026-06-21 快照（`data/aa-reference-2026-06-21.json`）。建置時 `scripts/aa-cells.mjs` 以 AA UUID 逐 cell 解析：reference 值 → latest 值（凍結的 eval 原值；重新評分的 LCR/HLE/SciCode 以同 UUID 配對的 mean-sigma equating 映回）→ 只用量測值的 OLS bridge（夾在觀測範圍內，保留來源與殘差 sd 供 Expert 顯示）。擬合係數 commit 在 `data/aa-bridges.json`，遊戲只讀解析後的數字，所以完全決定性。agentic 軸由 Terminal-Bench Hard 主導，這是「大模型在 agent 任務仍值錢」的物理依據（§6.4）。

**思考支援與回答模式（§1.4 的核心規則）**：每個 checkpoint 的 `thinking` 來自它釋出的 chat template（`data/model-thinking.json`，每筆附原文引用）：`always` 每次都先思考；`hybrid` 可由 serving stack 逐請求關閉思考（`enable_thinking=False` 一類開關）；`never` 直接作答。引擎的政策：

```
answerMode(m, def) = never 或 def.outputTokens ≤ 0（embedding） → instant
                     always                                      → thinking
                     hybrid → def.latClass === 'IN' ? instant : thinking
qualityIn(m, mode) = mode === instant 且有 qualityByInstant ? qualityByInstant : qualityBy
hiddenTokens       = mode === instant ? 0 : round(m.thinkTokens × def.thinkMul)
```

hybrid 在互動流量（chat、code completion、混在其中的 jailbreak）上以 instant 向量即答，其他流量先思考再答；所以只有 `always` 模型會在互動流量上錯過 time-to-first-answer bound。`qualityByInstant` 用同一套 blend 與曲線，從 AA 同一 checkpoint 的 Non-reasoning 列校準；沒有該列的 hybrid 用逐 cell 的配對擬合 `instant = a + b·thinking`（夾在 `[0, thinking]`）。回答模式在第一個 token 時 latch 在請求上，並隨 `outcome` 事件送出。

**思考預算與長 context 能力（載入時）**：
```
thinkTokens = never ? 0
            : (ttfat − ttft) > 1 s ? clamp(round((ttfat − ttft) × tok/s), 300, 4000)   // AA serving telemetry
            : 1500                                                                    // 沒有量測的思考模型
longCtx     = clamp(lcr / 80, 0, 1)（無 LCR cell 時用 tier 預設）
```

**訓練成本**（§2.10；接 research.ts requisition）：
```
sizeFactor     = (max(0.1, activeB) / 8) ^ 0.7          // 8B-active 基準, 次線性
depthSurcharge = 1 + 0.6 × baseDepth                    // fine-tune-of-fine-tune 逐步變貴
dataSizeFactor = max(1, (max(0.1, totalB) / 8) ^ 0.45)  // 資料量看 total params
sparsityFactor = 1 + 0.12 × sqrt(max(1, totalB/activeB) − 1)   // MoE 駐留與 all-to-all 開銷
computeCost    = costCompute × sizeFactor × effort × 1000 × POSTTRAIN_COMPUTE_SCALE × depthSurcharge × sparsityFactor
dataCost       = round(costData × effort × depthSurcharge × dataSizeFactor)   // 開訓時預付
```
> **worked example（LoRA agentic on Qwen3.5 35B A3B：active 3B、total 35B、effort 1.0、baseDepth 0）**：`sizeFactor = (3/8)^0.7 ≈ 0.50`；`sparsityFactor = 1 + 0.12×√(11.67−1) ≈ 1.39`；`computeCost ≈ 1 × 0.50 × 1000 × 2 × 1.39 ≈ 1,400 TFLOPS·s`；`dataCost = round(5 × 1 × 1 × (35/8)^0.45) = round(9.7) = 10`。同 base 的 CPT 是 60× 的 compute（§2.1）。

**`effort` 滑桿**：離散五檔 `{0.25, 0.5, 1.0, 1.5, 2.0}`（Studio，§5.2 S9）；`startPostTrain` 只接受這五檔（負值、0、極小值或非數字的 effort 一律拒絕，agent bridge 會回報原因）。`effort` 同時抬 `gain(√effort)`、`computeCost(×effort)`、`dataCost(×effort)`；√ 的報酬遞減讓高 effort 不是無腦最優。

**`deriveQuality` 與容量天花板**：
```
baseDepth    = base.depth（merge：兩個 parent 中較深者，與列出順序無關）
depth        = baseDepth + 1
rawGain      = gainScale × √effort / (1 + 0.15 × depth)
headroom     = max(0, (130 − base[axis]) / 130)
uncapped     = min(rawGain, gainCap × headroom)
ceiling(body, axis) = min(130, 6 + max{ qualityBy[axis] : roster base, paramsTotalB ≤ 2 × body })
gain         = distill ? uncapped : max(0, min(uncapped, ceiling − base[axis]))   // safety target: 0
qualityBy[axis] = clamp(base + gain, 8, 130)
alignment tax（safety target / rlhf / cai）: general −= taxScale × {rlhf 1, cai 0.6, 其他 0.8} × √effort
forgetting: 每個非目標軸 −= forgetScale × √effort × (1 + 0.5 × max(0, depth − 1))
hybrid 的 instant 向量：每軸套用同一個 delta
```
Studio 預覽在天花板截斷增益時標示出來（`StudioPreview.ceiling`），讓玩家知道增益為何變小。

**內生狀態更新**：
- `safety` target / `rlhf` / `cai` → `alignment.safety += {rlhf 28, cai 26, 其他 18} × √effort × alignDamp`（上限 100；`alignDamp = 1/(1 + 0.15·baseDepth)`，第一次訓練拿到完整效果，疊在 derived 上的每一次遞減）；`cai` 同時 `overRefusal −= 0.04·√effort × alignDamp`，下限 `OVERREF_FLOOR = 0.02`（XSTest / OR-Bench 從未量到 0 誤拒；本來就低於下限的不會被拉高），並轉為 `safe-completion`；`rlhf` 與 safety-target 的 `dpo` 則 `overRefusal += 0.05·√effort`（§2.4 張力；`none` 轉為 `hard-refusal`）。
- `sft` → `instructFollow += 8·√effort`（上限 100）。
- 推理訓練（`grpo`，或任何 method 的 `reasoning` target）讓 `never` 模型變成 `always` 思考者（DeepSeek-R1 從 V3 長出的路線）；hybrid 保留它的開關，thinker 維持 thinker。變成思考者而 `thinkTokens = 0` 的模型得到 1500。
- `merge`：兩個 parent 的 safety、overRefusal、instructFollow 取平均；refusalStyle 兩者相同才保留，否則 `hard-refusal`；thinking 支援相同才保留，否則 `hybrid`（instant 向量取兩個 parent instant 路徑的平均；只有一個 parent 有 instant 路徑時沿用它，但每軸扣掉平均讓那個 parent 掉的分數：`path + min(0, merged − 該 parent 的 qualityBy)`，所以不會比提供路徑的 parent 更強，instruct parent 的路徑也不會高過合併後的 thinking 向量）；thinkTokens 取較大者。

> **worked example（GRPO reasoning on MiniCPM5-2B：base reasoning 91、effort 1.0、depth 1）**：`rawGain = 28 × 1 / 1.15 ≈ 24.3`；`headroom = 39/130 = 0.3` → `uncapped = min(24.3, 40 × 0.3 = 12) = 12`；body 2.52B 的天花板看 ≤ 5.04B 的 roster base，最高 reasoning 92（Qwen3.5 4B）→ `ceiling = 98` → `gain = min(12, 98 − 91) = 7` → `reasoning 98`；其他四軸各遺忘 0.15；MiniCPM5 是 hybrid，保留開關，instant 向量同步 +7。天花板截掉了四成的增益：小 body 再怎麼訓練，最多也只比兩倍大小以內最好的 base 高 6 分。

**部署欄位（只有 distill / qat / merge 動）**：derived 預設整組繼承 base 的 deploy body（`paramsTotalB/paramsActiveB/isMoE/layers/kvLayers/kvHeads/headDim/attn/kvBytesPerToken/kvStateMbPerReq/nativeWeightBytes`）。
- `distill`：換成 active roster 中 active 與 total 都比 teacher 小、active 最大的 student body；每軸封頂 `min(teacher, student + 18)`（instant 向量同理），context window 與 longCtx 取較小者；student 繼承 teacher 的思考支援。
- `qat`：`nativeWeightBytes = 0.5`（以 4-bit 訓練，所以在 4-bit 格式不付 PTQ 稅），兩個向量每軸 −2。per-model QAT 與 serving 層 PTQ（§4.3）分開（§2.7）。
- `merge`：兩者必須是同一 roster root、同一 body 的不同 checkpoint（`mergeBlock`：`missing`/`self`/`root`/`body`）；release precision 取較高者（平均會把低位元 parent 反量化），window 與 longCtx 取較小者。

### 1.5 內容（roster + balance）

**資料來源**：三個來源各管各的事實。(1) 手寫 `ROSTER` 與 `roster.generated.ts`（`gen-roster.mjs`，以 `data/model-arch.json` 中的 HF repo 為 open-weight 證據）——身分、lane 標籤、alignment、lineage、描述；(2) `MODEL_ARCH`（`data/model-arch.json`，各 checkpoint 的 `config.json` 與 safetensors dtype）——參數、KV layer groups、release precision、window、授權，加上 `data/model-thinking.json` 的思考支援；(3) `AA_BENCH` / `AA_BENCH_INSTANT` / `AA_META`（Artificial Analysis）——校準 `qualityBy` / `qualityByInstant` 的 cell 與推導思考預算的 serving telemetry。

**gate**：候選池 135 個 open-weight checkpoint（52 手寫 + 83 generated），經 `withinFrontierTolerance`（`ROSTER_FRONTIER_TOLERANCE = 0.06`）收斂為 58 個 active checkpoint，從 0.6B 到 2.78T total params：一個 checkpoint 只要在任一軸上落在「同尺寸或更小的最佳品質」6% 以內就保留，在每一軸都落後超過 6% 的才剔除。canonical 清單見 `content.ts MODEL_DEFS`，分析見 `PARETO.md`，逐筆事實見 `MODEL-CATALOG.md`。所有 open model 一開始就擁有（權重是免費下載）；能否部署只看 rack 的 parallel plan 能不能放下（§6.2）。

**起手模型**（`DEFAULT_MODEL_ID`）由規則選出：dense、不是 `always` 思考者、扣掉 alignment tax 後以 instant 向量清得過 chat 與 code completion 的線、以思考向量清得過 RAG 的 general 線的模型中最小的一個——MiniCPM5-2B。每座新 rack 都預載它，讓新玩家的第一批 rack 在任何部署決定之前就能服務 2023 年的流量。

**roster 架構欄實值（代表值，全部來自 `config.json`）**：

| 模型 | total / active | 層（KV-bearing） | `attn` | KV bytes/token（BF16） | 每請求固定狀態 | release precision | 思考 |
|---|---|---|---|---|---|---|---|
| MiniCPM5-2B | 2.52B dense | 42 (42) | GQA | 43,008 | — | BF16 | hybrid |
| Qwen3.5 9B | 9B dense | 32 (8) | hybrid-linear | 32,768 | 51.5 MB | BF16 | hybrid |
| K2-Horizon-7B | 9B dense | 36 (36) | GQA | 147,456 | — | BF16 | always |
| Gemma 4 31B | 30.7B dense | 60 (10) | hybrid-swa | 81,920 | 838.9 MB | BF16 | hybrid |
| gpt-oss 120B | 117B / 5.1B | 36 (18) | hybrid-swa | 36,864 | 4.7 MB | MXFP4（0.56） | always |
| Nemotron-3-Super-120B-A12B | 120B / 12B | 88 (8) | hybrid-linear | 8,192 | 170.2 MB | BF16 | hybrid |
| MiniMax-M3 | 428B / 23B | 60 (60) | GQA | 122,880 | — | BF16 | hybrid |
| GLM-5.2 | 753B / 40B | 78 (78) | MLA | 95,232 | — | BF16 | hybrid |
| DeepSeek-V4-Pro-0813 | 1.6T / 49B | 61 (61) | csa | 9,848 | 8 MB | FP4（0.54） | hybrid |
| Kimi K3 | 2.78T / 104B | 93 (24) | hybrid-linear | 27,648 | 449.4 MB | MXFP4（0.56） | always |

**模型差異化的物理依據**：

| 現象 | 機制 |
|---|---|
| 小模型快、大模型聰明 | 每步讀取 ∝ active 權重：同一座 FP8 的 H100 上，Qwen3.5 2B 單人約 540 tok/s、Qwen3.6 27B 約 80 tok/s；而 agentic 軸（Terminal-Bench Hard）在規模上仍拉開差距，晚期 `agent`（agentic 線 82 × 時代複雜度）只有前緣模型或 Studio 專精模型清得過。 |
| 小 active 的大 MoE | 120B 級 MoE（gpt-oss 120B、Nemotron Super、Qwen3.5-122B-A10B）單人速度接近小 dense，但必須整個駐留：gpt-oss 120B 的 MXFP4 權重約 65 GB，剛好放進一張 80 GB H100。batch 變大時 expert 聯集讓每步讀取往 total 靠攏（§6.2）。 |
| hybrid 與 always 思考者 | hybrid 在 chat / code completion 即答，在 RAG、摘要、batch、agent 上先思考；always 思考者（Kimi K3、GLM-5.3、Step 5、gpt-oss）在互動流量上也先燒 hidden tokens，chat 的 4 s 與 code completion 的 400 ms time-to-first-answer bound 會抓到它們。 |
| KV 輕的 hybrid 架構 | hybrid-linear / hybrid-swa / MLA / CSA 只在少數層存成長中的 KV，同一塊記憶體能放下更長的 context 與更多並發；GQA 全注意力模型（K2-Horizon、MiniMax-M3）KV 重，長 context 很快把 cohort 壓小。 |
| 長 context 能力 | 一個 prompt 填滿 window 的比例越高、`longCtx` 越低，品質扣分越多（§2.3）：1M window 且 LCR 強的模型幾乎不受 100K prompt 影響，128K 模型則明顯吃虧。 |

**內生安全/指令初值（手填）**：見 §3.4 的 `AlignmentProfile` 表 + `instructFollow`（instruct 預設 85）。

### 1.6 命名（derived id / 顯示名，§2.9）

id = `drv_{seq}`（`derivedSeq++`，序列化安全）。顯示名 `{base.name}-{Target}-{Method}`，Target 標籤為 `Chat/Code/Reason/General/Agent/Safe/LongCtx/Domain`（如 `Qwen3.5 35B A3B-Agent-GRPO`、`MiniCPM5-2B-Safe-CAI`）；merge = `{a}+{b}-Merge`。lineage 寫進 `ModelDef.lineage`（§7 型別），`depth` 是鏈深。

---

## 2. 請求 (Requests)

### 2.1 設計理念（§1.1、§1.2、§6.4）— 雙層分類

請求是 **token-first** 的，並**顯式分兩層**：

- **工作負載物理軸（root-property，first principles，§1.2）**：`inputTokens`（→ prefill 成本與 TTFT）、`outputTokens`（→ decode 成本與 TPOT）、`contextLen`（KV，隨 decode 成長）、`latClass` 與 per-type 覆寫（SLO）、`thinkMul`（思考模型為它燒多少 hidden tokens）、`prefixShare`/`cacheable`（可快取性）、`refusalExposure`（多少良性流量處在會被誤拒的邊界）、`hazards`/`adversarial`（安全種子與攻擊意圖）、`pricePerMtokIn/Out`（收入）。
- **能力匹配軸（capability，應用層映射，§6.4）**：`difficulty[primaryAxis]` 對上 model 在回答模式下的 `qualityBy[primaryAxis]` 決定「答對與否」。這層是「品質匹配」而非工作負載物理，顯式分離。`CapabilityAxis` 值為 `chat/coding/reasoning/general/agentic`。

per-axis `difficulty` 讓 §6.4 能力壓縮可玩：小模型清得過 chat 線、清不過 agentic 線。

### 2.2 資料模型

`RequestTypeDef` 是 token-native + per-axis 難度 + SLO 類別與覆寫 + 思考倍率 + prefix 可快取 + 誤拒暴露 + hazards + **per-type 收入價格**（型別見 §7）。`Request` runtime 以**真實 token** 為單位保留 prefill/decode 拆分，帶 SLO 計時、hazard 流程、token 加權品質與顯示用的 latch 欄位（`sloCause`、`refusedBy`、`thinkingMode`、`answeredBy`）。runtime 的純量難度 = `difficulty[primaryAxis] × complexityMul`。

### 2.3 公式（單位橋接 → lane step）— prefill/decode 歸 §6

requests 子系統**只提供 token，不定 serving 速率**。prefill 超線性、decode 的 lane step、KV 預算全部由 **§6（脊椎）單一擁有**：

- **Prefill（compute-bound，∝ inputTokens，O(n²) 超線性）**：requests 只給 `inputTokens`；§6.2 的 `prefillTokS(n)` 內含超線性因子。完成 → 第一個 token → `ttftReal`（§0.4）。
- **Decode（bandwidth-bound，∝ outputTokens + hidden tokens）**：requests 只給 `outputTokens` 與 `thinkMul`；§6.2 的 lane step 決定 per-user 速率。
- **KV 佔用**：§6.2 的 `kvPerReqGb`，**seq 用動態 `contextLen`**；准入時以完整序列（prompt + 答案 + hidden tokens）檢查 window 與單一 copy 的 KV。
- **Prefix-cache 命中（§1.2）**：每個請求在第一次被 cache aura 下的 rack 准入時查一次；重疊的 cache 取最好的一個（上限 0.7）；命中時只跳過共享前綴 `round(inputTokens × prefixShare)`，其餘 suffix 照樣 prefill，decode 照跑。cached prefix 仍照價計費。
- **答對（token 加權，§6.3/§6.4）**：每座 rack 以自己的 margin 為它產生的 token 計分，答案的 margin 是加權平均：
  ```
  margin(rack) = qualityIn(model, mode)[axis] − ptqTax − alignmentTax − longContextPenalty(contextLen) − difficulty
  bestQuality  = Σ(gen_i × margin_i) / Σ gen_i        // ≥ 0 答對；< 0 → bad
  ```
  寫出答案的模型決定答案品質，碰過它的最強模型不能替弱模型背書。embedding 沒有生成文字，由完成 prefill 的 rack 計分一次。
- **長 context 扣分**：`24 × (1 − 0.75 × longCtx) × ramp^1.5`，`ramp = clamp((contextLen/window − 0.25)/0.75, 0, 1)`；4-bit PTQ 在 8K token 以上再扣其長 context 稅，INT4 KV 在 32K 以上再扣 2。
- **context 硬門檻（§1.2）**：完整序列 > window，或一條串流的 KV > 一個 model copy 的 KV → 這座 rack 永不准入（`windowBlocked`）；只有在看過它的 rack 中**沒有任何一座**放得下它（`fitSeen` 未設）、且它抵達 core 時，才是 `unservable`——有 rack 放得下卻因容量滿而沒服務到的，是一般的 `leaked`。

### 2.4 內容（archetype 設計表，§1.4 IETF + NVIDIA ISL/OSL）

出貨遊戲有 9 個 archetype（canonical：`src/sim/content.ts` `REQUEST_TYPES`），以工作負載物理劃分：純 prefill、平衡、prefill-heavy 互動、prefill-heavy 長 context、極端 decode、agent loop、decode-heavy 無 SLO、對抗性 hazard 載體。下表是 2023 年（tier 1）的基礎值；時代縮放見 §2.6。

| id | 名稱 | glyph | ISL | OSL | primaryAxis : 線 | latClass | SLO 覆寫 | thinkMul | prefixShare / cacheable | refusalExposure | hazards | $in / $out per Mtok |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `embed` | Embedding | ⋯ | 2000 | 0 | general : 10 | TO | — | 0 | 0.3 / ✓ | 0 | — | 0.05 / 0.1 |
| `chat` | Interactive Chat | ? | 512 | 256 | chat : 18 | IN | ttfat 4 s | 0.5 | 0.4 / ✓ | 1.0 | — | 0.3 / 0.9 |
| `comp` | Code Completion | {} | 1500 | 150 | coding : 56 | IN | ttft 200 ms · ttfat 400 ms | 0.05 | 0.5 / ✓ | 0.1 | — | 1 / 3 |
| `rag` | RAG / Long-Context QA | ≡ | 8000 | 512 | general : 50 | NR | — | 0.5 | 0.6 / ✓ | 0.4 | — | 1 / 2 |
| `summ` | Summarization | ¶ | 12000 | 400 | general : 44 | NR | ttft 6 s | 0.5 | 0.2 / ✗ | 0.3 | — | 1 / 2 |
| `reason` | Reasoning (long CoT) | Σ | 512 | 6000 | reasoning : 82 | NR | — | 0 | 0.1 / ✗ | 0.5 | — | 1 / 5 |
| `agent` | Agentic Task | ⌖ | 6000 | 800 | agentic : 82 | NR | e2el 60 s | 1 | 0.7 / ✓ | （恆帶 hazard） | injection 0.3 | 3 / 12 |
| `batch` | Batch / Offline Gen | ▤ | 1000 | 4000 | general : 40 | TO | — | 0.5 | 0.1 / ✗ | 0.2 | — | 0.5 / 1.5 |
| `jailbreak` | Adversarial Prompt | ! | 600 | 400 | general : 38 | IN | ttfat 4 s | 0.5 | 0.1 / ✗ | （對抗性） | jailbreak 0.7 | 0.5 / 1.5 |

> **價格與懲罰**：前緣工作（`agent` $3/$12、`reason` $1/$5）單價最高，`embed`/`chat` 最便宜；每型另有 `trustPenalty`/`slaPenalty`/`data` yield（`jailbreak` 的 Trust 懲罰最重：9）。`reason` 的 `thinkMul = 0`：它的長 CoT 輸出本身就是推理。`summ` 的 6 s TTFT 引用 MLPerf v5.0 長 context 405B 的 p99 TTFT bound（§1.3）。`agent` 是真實使用者任務：它的 tool output 帶 prompt injection，hazard 清掉之後照一般請求判品質；`jailbreak` 是 `adversarial`：正確答案是擋下或拒答。
> **latClass 規則**：`IN` 400 ms / 40 ms、`NR` 2000 ms / 200 ms、`TO` 沒有延遲 SLO；per-type 覆寫收緊或放寬各自的 bound（§6.4）。`embed`（OSL 0）不套 TPOT、不會被誤拒、不會思考。

**campaign 與平衡 gate**：waves 由 **100 波真實歷史 campaign** 驅動（`campaign-data.ts` 的 `WaveTheme` 主題表 → `campaign.ts` 的 `buildCampaign` 展開成 `WaveDef`；難度曲線集中在 `campaign.ts` 的旋鈕：`waveBudget`、`STEP_CAP/BOSS_STEP_CAP`（每波實際帶來的量——預算 × 它強制事件的量倍率——最多是上一波的 1.6 倍，boss 1.8 倍）、`ERA_TOKEN_GROWTH` + `eraTokenRamp`、`tierComplexity`、`hazardMulOf`、`novelShareOf`、SLA 合約常數）。每一波是一個真實事件：需求轉移（聊天熱潮、RAG 與寫程式助手、推理洪流、agent 成為多數）或營運衝擊（H100 短缺、海纜中斷、電網緊急、出口管制、EU AI Act、價格戰、服務中斷、agent 攻擊）；模型與晶片發表不是 wave，那是玩家的工具。tier 1→12 單調不減，wave 100（*BOSS: The Always-On Agent Era*）是頂點，之後接 endless。這是一場淘汰賽：多數 run 在中途結束，結束的原因是累積的壓力——量、組合、品質線、攻擊與事件一起上升——而不是某一波突然塞進物理上服務不了的請求。平衡 gate（`tests/playthrough.test.ts`）檢查的是**深度 + 系統使用**而非勝利：production demo（`sim/demo.ts`）在四個 gate seed 上都要達到 `GAUNTLET_FLOOR = 45` 且在 wave 100 之前被淘汰、答出的請求八成以上乾淨、誤拒少於 served 的一成，並用到完整的 serving stack；只蓋便宜 rack 加起手模型的 naive build 必須撐過開場教學波、在 wave 6–14 之間倒下；一支能打 wave 100 的艦隊必須以 80% 以上 Goodput 清掉前三個 endless surge（每個的量不低於 wave 100 的 95%）。本版實測：demo 到達 W64–W91、naive 在 W8–W10（最晚在第一個 boss）倒下、endless 前三個 surge 的 Goodput 95–97%。

### 2.5 七終局（統一 movement + combat + safety，`sim/resolve.ts`）

| 終局 | 條件 | 收入 | Trust | SLA |
|---|---|---|---|---|
| `served` | 答對 ∧ 準時 ∧ 安全；或對抗性請求被正確處理（input guard 擋下、模型拒答 / safe-complete、output guard 攔下） | 處理過的 token 100% | +0.25 | +0.15 |
| `sloMiss` | 答對 ∧ 安全 ∧ 錯過任一延遲 bound（`sloCause`：ttft / ttfat / tpot / e2el） | 50%（SLA credit） | −0.25 × trustPen | −0.5 × slaPen |
| `bad` | 答案 margin < 0（能力不足，§6.4） | 0（退款） | −0.5 × trustPen | 0 |
| `unsafe` | 帶著未清的 hazard 被**交付**（breach，立即結算） | 0 | −trustPen × `safetyDamage` | 0 |
| `overRefused` | 良性請求被第一層（模型）或第二層（guard）誤拒（`refusedBy`） | 0 | −0.25 × trustPen | −0.2 × slaPen |
| `unservable` | 被硬門檻擋下（window 或單一 copy 的 KV），看過它的 rack 沒有一座放得下，抵達 core | 0 | −trustPen | −slaPen |
| `leaked` | 抵達 core 仍未回答（504）；對抗性請求的 leak 不扣 Trust | 0 | −trustPen（攻擊：0） | −slaPen |

> 每個 SLA 懲罰再乘上事件的 `slaDamage`（預設 1）。收入依**實際處理的 token**計價：已 ingest 的 prompt（cached prefix 也算）+ 已生成的答案 token；hidden reasoning tokens 永不計費。所以被擋下的攻擊收入為 0，被拒答的攻擊只收它的 prompt 與一段短拒答（hard refusal 30 token、safe completion 200 token）。答出答案的終局（`served`/`bad`）產生 Data。判定順序（交付時，最壞者優先）：未清 hazard → `unsafe`；對抗性且全清 → `served`；margin < 0 → `bad`；違反 SLO → `sloMiss`；否則 `served`。
> `overRefused` 的懲罰刻意設輕（Trust 與延遲相同、SLA 只有延遲的四成）：誤拒真實使用者會傷口碑，但一次誤拒不該抵掉好幾次乾淨服務；這讓「選低誤拒的模型、做 CAI」成為看得見的 Pareto 改善（§3.5）。

### 2.6 Spawn 與時代縮放（`spawn.ts`、`campaign.ts`）

每個 burst 依 seeded 的時間表生成，token 數是決定性的（不抽樣）：

```
ramp       = ((tier − 1) / 11)^1.5                         // 2023 接近基礎長度，2025–26 承擔大部分成長
workMul    = 1 + (answerGrowth − 1) × ramp                  // ERA_TOKEN_GROWTH[type].output
contextMul = (1 + (promptGrowth − 1) × ramp) / √workMul     // 讓 prompt 恰好成長 promptGrowth 倍
input      = round(ISL × contextMul × max(1, √workMul))
output     = round(OSL × workMul)                           // embed 維持 0
difficulty = 線 × (1 + 0.02 × min(tier − 1, 11))            // tier 12：× 1.22
hazards    = min(1, severity × min(1.45, 1 + 0.039 × (tier − 1)))
novel      = 第 k 個 hazard 請求，若 ⌊(k+1)·share⌋ > ⌊k·share⌋（share = clamp(0.05·(tier − 2), 0, 0.5)；不抽 RNG）
```

prompt 的成長遠大於答案（對話歷史、檢索內容、repo context、累積的 agent 狀態都落在 prompt 裡；OpenRouter 的 100T-token 研究：prompt 約 4×、completion 約 3×），每型在 tier 12 落在其 IETF 工作負載剖面的真實帶內（§1.4）：例如 RAG 8K → 48K prompt、summarization 12K → 96K、agent 每步 6K → 48K prompt 而輸出維持約 1K、reasoning 輸出 6K → 12K。每個請求的工作量在真實的 per-user 速度下都服務得了；晚期的難度來自量、組合、品質線、攻擊與事件。個別主題可以覆寫一條 lane 的 `contextMul` 或 hazards（例如某波把 RAG 武器化為 injection 載體）。lane 分配是 round-robin；single-lane-surge 主題把所有 burst 釘在一條 lane；集中型事件把 lane window 縮成一條。RNG（`s.rng`）只用在 prefix 查詢、第一層與 guard 的擲骰、事件抽選與 endless 生成，所以同一個 seed 與輸入重播出同一場遊戲。

---

## 3. 安全（兩層）(Safety — Two Layers)

### 3.1 設計理念（§3、§2.4）

**兩層信條**：第一層 model-intrinsic（RLHF / CAI / safety DPO / safe-completion）烤進權重、推論時 0 額外延遲、不可逐請求調（§3.7/§2.4）；第二層 external guardrails 是請求路徑上的 pipeline stage（input → guard → LLM → guard → user），代價是延遲、算力與誤報（§3.2/§3.3）。red-teaming 是 dev-time 一次性 eval（§3.6），不是 serving 旋鈕。guardrail 依 §3.3 的真實對比分化為三個 family：只看輸入的輕量 encoder、在自己 GPU 上做真推論的 generative judge、廠商託管的 moderation API。

### 3.2 第一層：`AlignmentProfile`（掛 `ModelDef`）

由 §1 的 finetune method 寫入、serve 時讀取（型別見 §7）。承擔 **alignment tax**（§2.4/§2.8/§3.6，從每一軸扣）：
```
alignmentTax(m) = TAX_K[m.alignment.refusalStyle] × max(0, alignment.safety − 40) / 100
  TAX_K = { none: 0, 'hard-refusal': 9, 'safe-completion': 4 }    // §3.1 safe-completion 稅更低
```
> **worked example**：`safety 58, hard-refusal`（Qwen 家族）→ tax 1.62；`safety 84, safe-completion`（gpt-oss）→ tax 1.76、over-refusal 0.03；同樣 84 的 hard-refusal 會付 3.96。

**擲骰時機**：第一層在**第一個輸出 token** 由產生它的 rack 的模型擲一次（prefill 完成，或 prefix 命中蓋過了整個 prompt）。安全對齊主要透過最初幾個輸出 token 起作用；只把請求放在範圍內、從未准入它的 rack 不能拒答或淨化它。embedding 沒有生成文字，不擲第一層。
```
良性：P(over-refuse) = clamp01(alignment.overRefusal × def.refusalExposure)
hazard：每個未清的 hazard h 以 pSelfHandle 清除
pSelfHandle(m, h, sev) = clamp01(alignment.safety/100 − sev × HAZARD_HARDNESS[h])
  HAZARD_HARDNESS = { jailbreak: 0.35, injection: 0.55, harmful: 0.20, pii: 0.30 }   // injection 最難擋
對抗性請求全清 → 以短拒答作答：tokens = min(work, {hard-refusal 30, safe-completion 200})
```
`refusalExposure` 把基準測量轉成日常流量：XSTest / OR-Bench 量的是刻意邊界的 prompt，而真實流量中只有一部分落在邊界上——開放式聊天全額（1.0），FIM 程式補全幾乎不會被拒（0.1），embedding 沒有文字可拒（0）。

### 3.3 第二層：guardrail 建築家族

`TowerKind` 為 `'guardrail'`；`TOWER_DEFS` 有 3 棟（型別 `GuardrailSpec` 見 §7；moderation API 保留在 defs 中但不在 build bar 上）：

| 建築 | family | 每次檢查成本 | side | catches | baseRecall | range | 電力 / 帳單 | §ref |
|---|---|---|---|---|---|---|---|---|
| `guard_encoder` | encoder（Prompt Guard 2 86M） | **10 ms 固定**（服務化的 BERT forward 數 ms + 服務往返與 tokenize；長 prompt 切段平行掃） | input | jailbreak, injection | 0.975 | 2.9 | 0.1 kW，無 GPU 帳單 | §3.3 |
| `guard_llm` | generative（Llama Guard 4 12B） | **自己 H100 上的真推論**：讀入 turn 的 prefill + 3 個 verdict token 的 decode | both | jailbreak, injection, harmful, pii | 0.92 | 3.0 | 一座 H100 的 kW + GPU-hour + 能源 | §3.3 |
| `guard_mod` | moderation（OpenAI omni） | **120 ms 固定**（廠商託管） | both | harmful, pii | 0.88 | 2.9 | 0.1 kW | §3.3 |

```
guardCheckMs(generative, T) = (T / prefillTokS(T) + (GUARD_VERDICT_TOKENS − 1) / perUser(一個 cohort, T + 3)) × 1000 + GUARD_SERVICE_MS(5)
turn tokens：input = min(tokensIn, 2048)；output = input turn + min(tokensOut, 2048)
readouts 以 GUARD_REF_TOKENS = 512 的 prompt 報價
```
> **generative guard 接上 roofline**：Llama Guard 的 verdict 是一個短分類（`safe`，或 `unsafe` 加類別代碼），所以它的成本是「讀完這個 turn」的 prefill 加幾個 token，再加上和 encoder 一樣的服務往返（5 ms）。一座 H100 上 512-token 的 prompt 約 53 ms（BF16；研究 FP8 後約 31 ms），2048 token 約 139 / 78 ms——在同等最佳化下是 encoder（10 ms）的 3–14 倍，隨 turn 長度成長、兩端都檢查，還要付自己那座 GPU 的電與帳單。encoder 便宜固定，卻在新型攻擊上大幅失準（下方）。這是 §3.3「模擬器中最重要的真實對比」的完整版本：選 guard 是在延遲曲線、覆蓋類別、對新型攻擊的韌性與成本之間取捨。

**依 lane 覆蓋篩檢（`sim/guards.ts`）**：guard 是 pipeline stage，不是砲塔。
```
covers(guard, lane) ⟺ guard 的 range 圓與 lane 折線相交（與 guard 擺在 lane 的哪裡無關）
每條 lane 的 stages：每個出現的 family 一個（順序 encoder → generative → moderation）
每個請求在首次硬體接觸時篩檢一次，對每個 family：
  · guardInSec  += 該 family 最慢的 input-side tower 檢查 input turn 的時間
  · guardOutSec += 該 family 最慢的 output-side tower 檢查 output turn 的時間（embedding 沒有）
  · 良性：在 input 檢查擲一次誤報 P = overRefuse(family) × refusalExposure
  · hazard：每個已解鎖、未清的 hazard 以該 family 覆蓋 tower 中最高的 recall 擲一次
交付前：有 output 端的 family 對仍未清的 hazard 再檢查一次（模型產生的不安全答案在這裡還能被攔）
```
同一 family 的副本只增加覆蓋、不增加 recall（同一個分類器對同一輸入給出同一判決）；不同 family 疊加（defense in depth）。input 端攔下對抗性請求時，它在任何 prefill 之前就以 `served` 結束、處理 token 為 0。每個 guard 結果都發出 `guard` 事件。

**閾值 → recall vs over-refusal（§3.6 no-free-lunch，XSTest）**：`s.guardrailThreshold` 是固定的校準工作點 0.5（沒有任何控制會改它；曲線本身由公式與測試涵蓋）：
```
effRecall  = clamp01(baseRecall × (0.6 + 0.8 × threshold) + 0.02 × redteamLevel) × (novel ? NOVEL_RECALL_MUL[family] : 1)
overRefuse = OVERREF_K[family] × (redteamLevel ≥ 1 ? 0.7 : 1) × threshold²
  OVERREF_K        = { encoder: 0.06, generative: 0.10, moderation: 0.05 }
  NOVEL_RECALL_MUL = { encoder: 0.45, moderation: 0.7, generative: 1 }
```
> 在 0.5 時 recall 即為 `baseRecall`（每級 red-team +0.02），誤報率為 encoder 1.5%、generative 2.5%、moderation 1.25%（red-team 後 ×0.7），再乘上請求的 `refusalExposure`。兩個 family 疊在同一條 lane 時，誤報與延遲都會疊加——這是 defense in depth 的真實代價。

### 3.4 整體判決（§3.7 第 1 點：第一層 OR 第二層）

```
handled ⟺ ∀ h ∈ hazards：第一層 pSelfHandle 清掉 ∨ 覆蓋 lane 的某個 guard family 清掉（input 或 output 端）
unsafe  ⟺ 帶著未清 hazard 的答案被交付（立即結算，不必走到 core）
leaked  ⟺ 帶 hazard 的請求從未被回答就抵達 core（沒有不安全的文字被交付：只是可用性損失）
overRefused ⟺ 良性請求被第一層或第二層誤拒（hazard 載體與攻擊永遠不算「誤」拒）
```

期望值上的複合（load forecast 與 deploy picker 共用的 helper）：
```
leak(h)  = (1 − pSelfHandle) × Π_family (1 − r_in)(1 − r_out)，r = 該 family 最高 recall × (1 − ns + ns × NOVEL_RECALL_MUL)
refusal  = 1 − (1 − overRefusal × exposure) × Π_family (1 − overRefuse × exposure)
```

**第一層 roster（手填，grounded §3.1；家族預設）**：

| 家族 | refusalStyle | safety | overRefusal | 代表 |
|---|---|---|---|---|
| gpt-oss（OpenAI） | **safe-completion** | 84 | 0.03 | gpt-oss 20B / 120B（§3.1 的 Pareto 點） |
| Gemma（Google） | hard-refusal | 70 | 0.15 | Gemma 3 / 4（偏保守） |
| Muse Spark Open（Meta） | hard-refusal | 72 | 0.13 | 卡片載明為無 moderation 的獨立使用加強安全後訓練 |
| Llama 系（Meta） | hard-refusal | 62 | 0.13 | Muse Glimmer |
| NVIDIA | hard-refusal | 64 | 0.12 | Nemotron 3 Nano / Super / Ultra、Cascade |
| frontier instruct | hard-refusal | 60 | 0.11 | GLM、DeepSeek、MiniMax、Kimi、Ling、MiMo、Step、Hy3 |
| Qwen | hard-refusal | 58 | 0.12 | Qwen3 / 3.5 / 3.6 / 3.8 |
| 一般 instruct | hard-refusal | 55 | 0.10–0.12 | MiniCPM、K2-Horizon、Granite、LFM、EXAONE、Apriel、Solar、Motif |

`instructFollow` 預設 85。

### 3.5 第一層取得：RLHF / CAI / safety DPO 進 finetune（§1 method）

由 §1 的 method 寫入 `AlignmentProfile`：RLHF → safety +28·√effort、誤拒上升、最高稅；CAI → safety +26·√effort、**safe-completion**、誤拒 −0.04·√effort（疊加時依深度遞減，最低到 0.02）、低稅；safety-target DPO → safety +18·√effort、誤拒上升。玩家做 RLHF 得高安全、高誤拒、高能力稅；做 CAI 得 Pareto 改善（教 §2.4 + §3.1）：一次 effort 2 的 CAI 把 Qwen 家族的 overRefusal 從 0.12 降到約 0.063、safety 從 58 升到約 95，模型造成的誤拒大約減半，這在每波的 SLA 帳上看得見。

### 3.6 dev-time red-teaming 與時代的攻擊壓力（§3.5/§3.6）

red-teaming 是 Lab 一次性 eval（`r_eval_redteam_v1/v2`，eval 研究軌）。**主效果是 §3.6 的真實校準**：(a) **解鎖偵測類別**——v1 解鎖 `injection`，v2 解鎖 `pii`（`jailbreak`/`harmful` 一開始就可偵測）；(b) **降低誤報凸度**（`OVERREF_K × 0.7`，XSTest 教系統靠意圖而非關鍵字判斷）；(c) 每級 recall +0.02，明示為「校準閾值，而非提升模型本身」。

攻擊的精緻度隨時代上升（手動 DAN 角色扮演 → GCG 可轉移後綴 → many-shot → 間接與 agentic injection）：
- **嚴重度**：每個 hazard 的 severity × `min(1.45, 1 + 0.039 × (tier − 1))`（夾到 1）；一個 2023 年的 jailbreak（0.7）到 tier 12 成為完全自適應的 1.0，agent 的 tool-borne injection 從 0.3 升到約 0.43，模型能自處理的比例跟著下降。
- **新型攻擊比例**：`clamp(0.05 × (tier − 2), 0, 0.5)` 的 hazard 請求是分類器沒見過的變體（依 spawn 順序指派，不抽 RNG）。encoder 對它只剩 45% 的 recall、moderation 70%、generative judge 不受影響。晚期的安全需要 generative judge 或對齊良好的模型，而不是更多份同一個分類器。

個別波次會強制自己的招牌事件（例如對抗性後綴風暴把 `safetyDamage` × 1.8、監管稽核 × 1.6），也可以把預設良性的 archetype 武器化（W48 的 reasoning 帶 harmful、W66 的 RAG 帶 injection）。

---

## 4. 科技樹（基礎建設）(Tech Tree — Infrastructure / Serving ONLY)

### 4.1 設計理念（§4、§2.10）

範圍宣告：本樹**只放 serving/infra 層**（scheduler / memory / decoding / weight format / parallelism / routing / multi-LoRA / engine；不改權重）。所有 post-training 歸 §1/§3；所有模型架構屬性（GQA/MLA/hybrid、MoE 稀疏度、思考支援）屬於 model，不是樹節點（§4.6/§4.8）。每個節點都附上它的真實取捨方向：數字可以為遊戲調整，真實的成本（電力、VRAM、品質、延遲）只能被軟化，不能被刪除，現實沒給的好處也不能被發明。

### 4.2 資料模型（`InfraState` + `InfraNodeDef`）

所有 infra 開關集中到 typed `s.infra: InfraState`（型別見 §7）。研究完成時 `completeResearch` 呼叫 `applyInfraEffects(s, node.effects)`（level 類取 max、`kvQuantBytes` 取 min、`multiStep`/`offloadGb`/`flash` 累加、其餘設開關），並在 `s.upgrades[node.id]` 留下「已研究」標記。effects getter 一律讀 `s.infra` + model 屬性 + rack 自己的狀態（`Tower.precision`、`Tower.role`）。

### 4.3 公式（每個節點的真實效果，接 §6 的 effects getter）

- **Continuous Batching（§4.1）**：engine 的 batch 上限 = 每條 lane `⌊ENGINE_MAX_STREAMS / COHORT_STREAMS⌋ = 9` 個 sprite（研究前每條 lane 一個靜態 batch）；實際能放多少由 KV 准入決定。2–4× 的吞吐由 batch 自然湧現，**不寫死乘數**。
- **Multi-Step Scheduling（§4.1）**：每次排程跑 8 個 decode step，把每步 1 ms 的 CPU 排程開銷攤成 1/8；代價是新請求要等下一次排程呼叫才能加入（TTFT 加 4 個 step 的時間）。
- **PagedAttention（§4.2）**：KV 配置利用率 0.55 → 0.96（SOSP'23：傳統配置浪費 60–80%）。
- **Prefix Caching（§4.2）**：prefix 命中天花板 0.85，cache tower 的命中率 0.35 + 0.4 → 封頂 0.7。命中只跳過共享前綴；cohort 的共享前綴 KV 只存一份。
- **KV-Aware Routing（Dynamo，§4.10）**：被 Router 覆蓋的 cacheable 流量被導向持有其前綴的副本：恢復 50% 的 miss，上限 0.85。它的 2× 是 prefix 重用（TTFT / prefill 重算），不是 decode 速度。
- **FlashAttention（§4.2）**：prefill 的 O(n²) 項變緩（`1 + n/(16000 × 1.5)`）、Flash-Decoding 的 KV 讀取快 1.2×、每 GPU 還回 0.5 GB activation 記憶體；不給品質、window 或 KV 大小的加成。
- **FP8 / INT4 KV Cache（§4.2）**：KV element bytes 2 → 1 → 0.5；INT4 KV 在 32K token 以上扣 2 品質（KIVI / KVQuant）。
- **KV Offloading（LMCache，§4.2）**：一個 CPU/SSD 的 prefix 層：命中率再 +0.12（上限 0.9），落在 offload 層的命中要先以 25 GB/s 經 PCIe 重載；不擴大 active attention 的 KV。
- **Chunked Prefill ⟂ P/D Disaggregation（§4.3，sim 層強制互斥）**：
  - **Chunked**（Sarathi-Serve）是 token-budget scheduler：每個 engine step 帶著 running decodes 與最多 `chunkBudgetTokens` 個 prompt token。budget 依 time-between-tokens 目標 profile：在參考負載下，把 step 撐到 `max(30 ms, decode step × 1.25)` 的 prompt 運算量（包含藏在 memory-bound 讀取底下的免費 token），以短 prompt prefill 速率 × 0.9 換成 token，夾在 256–8192（8192 是 vLLM V1 與 SGLang 的大 GPU 預設）。budget 內的 prompt 一個 step 完成，更長的切成 `tokens / budget` 個 step；decode 每個 step 都出一個 token，只付較長的 step（TPOT 干擾），從不停頓。分塊保留 90% 的 prefill 效率。沒有 chunked prefill 時，每條 lane 依先來先服務把 prompt 背靠背跑完（一個 tick 內可以完成好幾個短 prompt），該 lane 的 decode 在 prefill 期間停頓（OSDI'24）——所以 chunked prefill 的真實取捨方向成立：單一 prompt 稍慢一點，換來 decode 不停頓。
  - **Disagg**（DistServe）讓 rack 可釘成 prefill 或 decode pool：各自的速率 × 1.1（phase 專屬的平行化調校）；KV 以 50 GB/s 從 prefill pool 傳到 decode pool（decode 首步之前付）；decode pool 只接自己模型的 KV；cohort 其餘串流的 prompt 欠給 prefill pool（`prefillDebtSec`，prefill pool 先用 lane 時間償還）——拆開 phase 去掉了干擾，但 prompt 的工作沒有消失。只需要 PagedAttention。
- **Speculative Decoding（EAGLE，§4.4）**：draft head 每步提 4 個 token、target 一次驗證：記憶體共用、運算 × 5。依軸的小 batch 平均接受 token（coding 2.4、chat/general 2.0、agentic 1.9、reasoning 1.7）；增益隨 batch 衰減——每條 lane 32 條串流以下完整保留，128 條時歸零（之間對數線性；verify 轉為 compute-bound、引擎縮小每條串流的 draft）。引擎每一步比較兩種 step，只在 `tokens/specStep > 1/plainStep` 時使用，所以增益消失或 compute-bound 時自動關閉。代價：draft 佔 3% 權重的 VRAM（至少 0.5 GB）、每座 rack 的電力 +8%。
- **權重格式（PTQ，§4.5 + §2.7）**：FP8（W8A8，1 B/param，FP8 速率，視為無損）、INT4（AWQ/GPTQ，W4A16，0.53 B/param，**以 BF16 速率運算**，−2 品質、8K 以上再 −6）、NVFP4（W4A4，0.5625 B/param，FP4 速率，只在 Blackwell rack，−1、8K 以上再 −2）。每座 rack 在 build phase 自選格式；auto = 該模型可用、無損、放得下的格式中 tensor 速率最高者。checkpoint 的 release precision 是下限：4-bit 釋出的模型在 4-bit 格式不付稅，FP8 釋出的模型永遠不會被放大成 BF16。NVFP4 研究需要場上至少一座 Blackwell rack。
- **Parallelism（§4.7）**：Tensor Parallelism 讓一個 copy 跨最多 8 張 GPU（研究前模型必須放進一張 GPU，多 GPU rack 只能跑副本）；Pipeline Parallelism 讓 copy 跨 8 張以上（每多一個 stage：decode 每步 +30 µs、prefill +20 ms bubble，只增加記憶體與 pipelined 並發）；Data Parallelism 讓整座 rack 的副本成為一個排程群組（請求在所有 lane 與合併的 KV 上負載平衡）；Expert Parallelism 讓多副本的 MoE 把 expert 分片並合併 batch（每個副本只讀自己那份 expert 聯集，代價是每層的 all-to-all）。deploy picker 與 denied 理由會直接說「需要 Tensor / Pipeline Parallelism」。
- **Multi-LoRA Serving（S-LoRA，§4.10）**：同一 base 權重的 adapter 與 base 共駐一座 rack，wave 中途也能切換（不重載權重）；未合併的 adapter 以 0.93 的 decode 速度服務，直到下一個 build phase 合併。
- **引擎（§4.9，二選一）**：SGLang（RadixAttention：prefix 命中 +0.1、上限 0.8）⟂ TensorRT-LLM（編譯 kernel：MBU/MFU × 1.12）；未選時是 vLLM。

### 4.4 內容（22 個節點，8 分類）

22 個 `InfraNodeDef`（`content.ts INFRA_NODES`），分類 `scheduling`（Continuous Batching、Multi-Step、Chunked Prefill、P/D Disaggregation）、`kv-memory`（PagedAttention、Prefix Caching、FlashAttention、FP8 KV、INT4 KV、KV Offloading）、`decoding`（Speculative Decoding）、`weight-quant`（FP8、INT4、NVFP4）、`parallelism`（TP、PP、DP、EP）、`routing`（KV-Aware Routing）、`multi-lora`（Multi-LoRA Serving）、`engine`（SGLang、TensorRT-LLM）。關鍵前置鏈：`inf_batching` 是一切之根；`inf_paged` 是 KV、chunked、disagg、TP 與 Multi-LoRA 之根；`inf_prefix` → `inf_routing`；`inf_kvquant_fp8` → `inf_kvquant_int4`；`inf_wq_fp8` → `inf_wq_int4` / `inf_wq_nvfp4`；`inf_par_tp` → PP / DP / EP；互斥：`inf_chunked` ⟂ `inf_disagg`、`inf_engine_sglang` ⟂ `inf_engine_trtllm`（`researchUnlocked` 強制）。

同一條 infra 研究軌還跑 8 個 post-training method unlock（`r_pt_lora` → `r_pt_pref` → `r_pt_rl` / `r_pt_cai`；`r_pt_rl` → `r_pt_distill`；`r_pt_lora` → `r_pt_merge`；`r_pt_cpt`、`r_pt_qat` 直接接 `inf_batching`），eval 軌跑 2 個 red-team 節點。所有研究的 Data 成本 × `RESEARCH_DATA_SCALE`（4）、compute × `RESEARCH_COMPUTE_SCALE`（12）：一個節點在它解鎖時的艦隊上約佔一波中幾秒到幾十秒的訓練時間，借出去的 rack 是看得見的成本。

**UI 標記**：每節點顯示 `coupling`（pure-infra / infra×model）、`optimizes`（latency/throughput/memory/cost）、`sourceRef`（§ref tooltip）、前置與互斥狀態，並帶 `i18nKey`。

### 4.5 研究排程：多軌共享一個借用池（`research.ts`）

`s.research` 是**三軌 typed**：infra 研究（含 method unlock）、per-model post-training（UNLIMITED 衍生）、red-team eval 各佔一槽，可同時進行：
```
s.research: { infra: ResearchSlot | null; posttrain: ResearchSlot | null; eval: ResearchSlot | null }
```
開始研究需要 build phase、一座 Training Lab，並先付 Data。研究**只在 wave 進行中推進**：三軌共用一個借用池——
```
cap  = RESEARCH_MAX_SHARE (0.45) × 目前有電的 server rack 的 BF16 TFLOPS（brownout 或缺液冷而斷線的 rack 不服務，也不計入）
pick = online rack 依 TFLOPS 由強到弱，加入後不超過 cap 才借（整座 rack，往下取整）；
       一座都放不下且至少兩座 online → 借最弱的一座；永遠不借最後一座 online rack
rate = Σ 借出 rack 的 TFLOPS × throttle；每條進行中的軌平分 rate（沒有浪費）
```
借出的 rack 在 wave 中訓練而不服務（照付帳單、能源以滿載計）。純函式 `requisitionPreview(s, compute)` 給 Training Lab 與 Studio 預覽：會借哪幾座、損失多少線上服務算力（`servingLoss` = 借出 ÷ 有電艦隊）、需要多少 wave 秒。post-train 軌完成即釋放、可立刻排下一個；`effort` 滑桿（§1.4）是 post-train 的 runtime 參數。

---

## 5. UI / UX

### 5.1 設計理念（§0、§1.3、§5、§6）

真實 SRE 用 TTFT / TPOT / Goodput / $/Mtoken / tok/s。Normal 與 Expert 是同一個遊戲：sim 永遠收集完整 telemetry（`sim/telemetry.ts`），Expert Mode 只是顯示更多。**原則**：每個數字配名稱配單位；**Goodput 是主視覺**；每個失敗都說得出原因（哪個 bound、哪個軸、誰拒的）；MoE total/active 永遠雙寫；roofline 的 binding roof 恆標示；冷卻用兩個 pool 的真實 kW 上色。

### 5.2 表面（surface）

常駐層：
- **S1 TopBar（HUD）**：Trust / SLA / Cash / Data / Power / Cooling（kW）、runway（零收入下 cash 能付幾波帳單）、build phase 的「下一波」標題、wave 中的七終局即時計數、Trust/SLA 的 drain 帳本 tooltip。
- **S2 Metrics panel**（Expert，浮動 overlay）：Goodput、req/s、in-flight、p95、$/Mtoken、KV、fleet utilization 與 burn 的時間序列。
- **S3 RackInspect**：Overview / Deploy / Telemetry（Expert）分頁；deploy picker（每個 owned checkpoint 在這座 rack 對下一波的預估：★ 最佳、速度、判定軸品質、清得過幾型、安全與誤拒、HYBRID/THINKS 徽章、需要更大 rack 或 TP/PP 的灰列）、批次 rollout、硬體升級、權重格式按鈕、model split 行、P/D role、兩段式 SELL；guard 的 inspect 顯示有效 recall、誤報率、side 與每種 hazard 的鎖定狀態。
- **S4 RequestInspector**（兩種模式）：點擊請求看它在哪、為什麼會這樣結束（回答模式、hidden tokens、預估與即時診斷）。
- **S5 WaveReport**（兩種模式）：Normal 為白話摘要（太慢 / 答錯 / 不安全 / 誤拒 / 掉落計數、淨現金、下一步建議）；Expert 為完整報告（誠實 Goodput、七終局條、每終局的 Trust/SLA 帳本、延遲 bound 分佈、誰拒的、TTFT/E2E/TPOT、GPU-hour 與能源兩行帳單、per-type 表）。
- **S6 BuildBar**；**NextWaveCard**（build phase：名稱、時代、brief、教學點、事件、single-entry surge、每型的 SMART / FAST / FITS / SAFE 準備度）；**NotificationStack**；**IncidentBanner**；Codex；hotkey 說明；System menu / Settings；BYO-key 的 Codex 助手聊天。

模態層：**S7 ModelOverview**（Expert：全 checkpoint 表格 + 篩選/排序 + detail card，含兩個能力向量與 benchmark 來源）、**S8 LineageGraph**（`base → instruct/thinking → FT/merge/quantized` DAG）、**S9 Training Lab**（INFRA 研究樹，依 8 個 InfraCategory 分組，含 method unlock 與 red-team 節點）+ **Post-Training Studio**（base / method / target / effort 五檔 + 即時預覽：增益、天花板、遺忘、安全變化、借用預覽）。

### 5.3 可讀圖示與全名

請求在 board 上以外框形狀標示 latClass（圓角 IN、方形 NR、切角 TO、尖刺 = 帶 hazard），中央圖示對應 archetype，進度條依 prefill → hidden thinking → 答案分段上色。七終局共用一套 `OUTCOME_STYLE`（顏色 / 色盲色 / glyph / 音效 / i18n key），FX、音效、報告與 end screen 都讀同一套詞彙。統計縮寫 → 全名 + 單位 + tooltip（`metric.*` i18n 群組 + `ui/tooltip.ts`）。

### 5.4 圖表

Roofline 卡（prefill compute vs decode bandwidth，標 binding）；VRAM 佔用條（weights + framework + KV + headroom，§5.6）；per-axis quality sparkbars（5 條，hybrid 另標另一模式的值，**agentic 軸醒目標示**，§6.4）；Goodput gauge；$/Mtoken 與 burn 折線；Power vs Cooling headroom（兩個 pool）；utilization 折線。

### 5.5 UI 計算層（不改 sim）

`ui/metrics.ts` 純讀 GameState + effects，用**同一套 effects 函式**算 TTFT / TPOT / $/Mtoken / binding roof，所以 UI 的估計與 combat 判定一致：
- rack 卡片的參考請求是 1.5K in / 256 out，「忙碌 rack」= 每條 lane 2 個 cohort（≈ 每 copy 56 條串流）；`$/Mtoken = rack $/hr × 1e6 / (aggTokS × 3600)` 以**計費 token** 計：乘上即將到來的流量中「生成 token ÷ 答案 token」（思考模型的 hidden tokens 會生成但不計費），就是 cash 實際遵守的速率。deploy picker 的速度標籤用 ★ 同一個預測負載，取 TPOT 最接近上限的那一型，並以該上限上色。
- **共用的 load forecast**（`sim/loadForecast.ts`，純函式、不抽 RNG）驅動 deploy picker 的 ★、每型的 fit 列、next-wave 準備度、ESTIMATE 卡的 prompt 時間，**也驅動 demo autoplay**——玩家看到的推薦就是 autoplay 依據的推薦。它在下一波每型請求抵達的時刻，用 combat 的 lane step 估計該 rack 在**整個混合負載**下的表現：Little's law 估在途 cohort，負載分攤到請求在服務期間會走過的 rack（場上的幾何：每條 lane 第一次接觸後各段距離內碰到的 rack），prompt 集中在入口 rack；Pollaczek–Khinchine 估 prompt 佇列（一部分 prompt 等、多數不等）；入口 slot 的等待以「規律到達」計（請求以固定間隔輪流進入各 lane：同一型單獨 spawn 時不會撞到自己，與其他 burst 交錯時才會），共用入口的 lane 平分其 slot；每個延遲依 lognormal 散佈；再加上 guard 延遲、回答模式、長 context 扣分與 window 門檻；★ 是預期「乾淨服務比例」最高者（準時、答對、放得下、沒被誤拒、沒交付不安全內容）。`tests/forecast.test.ts` 確保 picker 每一列與 sim 實際服務比例相差在 10 個百分點內。公式見 `MATH.md` §3.15。
- Goodput = 乾淨 `served` ÷ 全部終局（`goodputPctOf` / `honestGoodputPct`；live gauge、wave report、end screen 與 agent bridge 共用）；`sloAttainPct` = 答出的請求中準時的比例，作為第二視角。

UI 檔案：`ui/metrics.ts`、`ui/nextWave.ts`、`ui/tooltip.ts`、`ui/modelOverview.ts`（S7+S8）、`ui/requestInspector.ts`（S4）、`ui/metricsPanel.ts`（S2）、`ui/panels.ts`（S3/S5/S9）、`ui/studio.ts`、`ui/charts.ts`。S2 與 S7/S8 只在 `isExpert()` 時開啟；其他表面在兩種模式都有，Expert 顯示更多。

### 5.6 lineage 必填

「lineage you can actually see」：roster 的真實血統（`real.baseModelId/real.relation`，例如 GLM-5.3 → GLM-5.2、Nex-N2-Pro → Qwen3.5-397B）手填齊全；derived 模型的 lineage 由機制自動產生 → S8 有實質內容，不退化為扁平清單。

---

## 6. 核心模擬與經濟 (Core Sim & Economics) — 脊椎

### 6.1 設計理念（§5、§1.1、§5.8）

prefill / decode 雙 roof 的結構以真實單位計算：所有 tok/s、watt、USD 都是真實量；延遲以每個 token 的物理時間在 real-s 軸累計並判定 SLO（§0.4）；`SIM_TIME_SCALE` 只壓縮視覺步調，不改任何比例。一座多 GPU rack 不是一張完美的大加速器：模型跨 GPU 有效率損失與通訊成本，多出來的 GPU 變成並發。

### 6.2 Parallel plan、prefill 與 lane step（§4.7/§5.6/§5.7）

**parallel plan**（`rackPlan`）：一個 model copy 佔用能放下它的最小 2 的次方 GPU 群組，其餘 GPU 跑更多副本。
```
weightGb = paramsTotalB × min(nativeWeightBytes, 格式 bytes)       // MoE 全部 expert 駐留
draftGb  = spec ? max(0.5, 0.03 × weightGb) : 0
g        = 最小的 2^k ≤ gpus，使 weightGb + draftGb + g × (1.5 − flash 0.5) < g × hbmGbPerGpu
允許的 g：無 TP → 1；TP → ≤ 8；TP + PP → ≤ gpus（否則 blocker 'tp' / 'pp'；放不下 → 'vram'）
tpDeg = min(g, 8)；stages = g / tpDeg；replicas = ⌊gpus / g⌋；lanes = replicas × stages
kvGbPerReplica = (g × hbmGbPerGpu − weightGb − draftGb − g × framework) × kv.utilization
```
副本與 pipeline stage 增加並發，從不增加單一使用者速度；單人速度由一個 copy 的 tensor-parallel 群組決定。

**prefill（compute-bound GEMM，超線性，§1.1）**：
```
prefillTokS(n) = rate(format) × tpDeg × tpEff × engineEff × MFU_PREFILL(0.55)
                 / (2 × paramsActiveB × (1 + n / (16000 × (1 + 0.5·flash))))
tpEff = {1: 1, 2: 0.9, 4: 0.8, 8: 0.65}；rate：FP8 格式用 FP8、NVFP4 用 FP4、BF16 與 INT4 用 BF16
```
一個 prompt 由**一座** rack 吃下：範圍內有空位、最快能開始它的那座（該 tick 已排入的 prompt 工作 ÷ lane 最少；同分取較小 tower id），Router 範圍內則依 capability 選擇。沒有 chunked prefill 時，每條 lane 依先來先服務把 prompt 背靠背跑完，一個 tick 內能完成幾個就完成幾個；排不進這個 tick 的 prompt 繼續等待（TTFT 計時中）。prefill 完成後同一個 tick 內就加入 decode。准入順序：(1) 每個串流中的答案先由它的 home rack（產生第一個 token 的 rack；走出範圍後由範圍內最空的同模型 rack 接任）准入；(2) prompt；(3) 同模型的其他 rack 以剩餘容量幫忙 decode。部分 ingest 的 prompt 與串流中的答案都只能由持有其 KV 的模型接續。

**decode：lane step**（`laneStep`）。一個 decode step 為 lane 上每條串流各出一個 token：
```
tMem  = (weightsRead + KV / (flash ? 1.2 : 1)) / (hbmTbsPerGpu × tpDeg × tpEff × engineEff × MBU 0.7)
tComp = streams × 2 × paramsActiveB / (rate × tpDeg × tpEff × engineEff × MFU_DECODE 0.5)
fixed = 1 ms 排程（multi-step ÷ 8）+ MoE 時 layers × 50 µs（router、top-k、permute 與 grouped expert GEMM 等小 kernel）
        + TP 時 2 × layers × 8 µs all-reduce + wide EP 時 2 × layers × 12 µs + (stages − 1) × 30 µs
step  = max(tMem, tComp) + 背景 prefill + fixed          // chunked：max(tMem, tComp + (背景 + chunk)/0.9) + fixed
per-user tok/s = (spec 開啟 ? 1 + (該軸接受 token − 1) × fade(串流數) : 1) / step     // fade：≤32 為 1，≥128 為 0
```
MoE 的 `weightsRead` = always-on 部分（active 的 35%：attention、embedding、shared experts）+ batch 觸及的 routed expert 聯集 `routedTotal × (1 − (1 − f)^b)`——一個 token 只讀 active，一整個 batch 的讀取往 total 靠攏。背景 prefill：decode 中的 cohort 其餘 `k − 1` 條串流的 prompt 在答案生成期間陸續 ingest，每步 `(k − 1) × (tokensIn − shared) / outTokens / prefillTokS`。熱節流時 memory-bound 部分保留少許優勢（`1 − (1 − thr) × 0.85`），compute-bound 部分全額受影響（Splitwise）。

**cohort 與 KV 准入**：一個 sprite 在它代表的每座真實 rack 上放 `COHORT_STREAMS = 28` 條串流——一個 sprite 本身就是 production 規模的 batch，兩三個就把 batch 推到 56–84 條，per-user 速度下降、總吞吐往 compute roof 上升。
```
kvPerReqGb(L) = kvBytesPerToken × L × (kv.quantBytes / 2) / 1e9 + kvStateMbPerReq / 1000
cohort 的 KV  = 第一條串流全部 + 其餘每條只存自己獨有的部分（共享 prefix 只存一份）
k = 該群組剩餘 KV 放得下的串流數（≤ 28）；k < 28 的 cohort 輪流服務，sprite 的 wall time × 28/k
```
准入群組：有 Data Parallelism 或只有一個副本時整座 rack 是一個群組（請求在所有 lane 與合併的 KV 上平衡），否則每個副本是一個群組，cohort 留在它落腳的副本上。每 tick 重新准入，`contextLen` 隨每個生成的 token 成長，長 OSL 的請求在生成過程中把 cohort 壓小（§5.6「長 context 把並發壓到個位數」）。

> **worked example（H100 × 1，Qwen3.5 9B，PagedAttention）**：BF16：`tMem = 18 GB / (3.35 TB/s × 0.7) = 7.7 ms`，加 1 ms 排程 → 單人上限 115 tok/s；FP8：9 GB → 4.8 ms → 207 tok/s。1.5K-token prompt 的 prefill 為 `989 TFLOPS × 0.55 / (2 × 9e9 × 1.094) ≈ 27.6K tok/s`（BF16，54 ms），FP8 速率下 27 ms。KV：8 個 KV-bearing 層 × 32 KB/token，8K context 一條串流 0.32 GB（含 51.5 MB 固定狀態）；FP8 權重後一個 copy 有 66.7 GB KV → 一個 cohort 28 條串流綽綽有餘。忙碌負載（2 cohort、56 條串流）下 FP8 每人 75 tok/s、整座 4.2K tok/s；加上 chunked prefill，背景 prompt 藏進 memory-bound 讀取底下，每人 116 tok/s、整座 6.5K tok/s。
> **worked example（H100 × 1，gpt-oss 120B，release MXFP4 0.56 B/param）**：權重 `117B × 0.56 ≈ 65.5 GB`，放得進一張 80 GB H100、留下約 12 GB KV。單人上限約 249 tok/s（一個 token 只讀 5.1B active，但 36 層的 expert routing kernel 每步固定約 1.8 ms；Artificial Analysis 的 production 中位數約 212 tok/s）；56 條串流時 expert 聯集與 KV 讓每人降到約 33 tok/s——大 MoE 的單人速度在 batch 變大時掉得比 dense 快。
> **worked example（GB200 NVL72，Kimi K3 2.78T）**：MXFP4 權重約 1.56 TB，一個 copy 需要 16 張 GPU = 2 個 TP8 stage（需 TP + PP），72 張 GPU 跑 4 個副本、8 條 lane（剩下 8 張放不下第五個副本）。單人上限約 109 tok/s（61 層的 expert routing 每步固定成本），忙碌負載下每人約 19 tok/s、整座約 8.7K tok/s：大 rack 買的是放得下與並發，不是單人速度。

### 6.3 硬體 + 模型資料模型（真實單位）

`ServerHardwareDef` 是真實 per-GPU 規格 × rack GPU 數（aggregate 在載入時算出，§5.2–5.5；型別見 §7）。一個 board tile 代表的 GPU 數由 `gpus` 顯式定義。rack 沿 `HARDWARE_TIERS` 原地升級（付差價、只能在 build phase、需要液冷的 tier 要先有 Liquid Cooling Loop），範圍跟著目前的硬體 tier。

| id | GPU | gpus | BF16 / FP8 / FP4 TFLOPS·GPU | HBM·GPU | TB/s·GPU | W·GPU | 冷卻 | capex → credits | $/hr（rack） | range |
|---|---|---|---|---|---|---|---|---|---|---|
| `hw_edge` | L4 | 1 | 121 / 242 / — | 24 GB | 0.3 | 72 | air | $5K → 5 | 0.4 | 2.8 |
| `hw_standard` | L40S | 1 | 362 / 733 / — | 48 GB | 0.864 | 350 | air | $16K → 16 | 1.0 | 3.0 |
| `hw_perf` | H100 | 1 | 989 / 1979 / — | 80 GB | 3.35 | 700 | air | $48K → 48 | 3.0 | 3.0 |
| `hw_frontier` | H200 | 1 | 989 / 1979 / — | 141 GB | 4.8 | 700 | air | $60K → 60 | 3.2 | 3.3 |
| `hw_pod` | DGX H200 | 8 | 989 / 1979 / — | 141 GB | 4.8 | 700 | air | $320K → 320 | 25.6 | 3.4 |
| `hw_superpod` | DGX B200 | 8 | 2250 / 4500 / 9000 | 192 GB | 8.0 | 1000 | air | $500K → 500 | 40 | 3.5 |
| `hw_giga` | GB200 NVL72 | 72 | 2250 / 4500 / 9000 | 192 GB | 8.0 | 1200 | **liquid** | $3M → 3000 | 360 | 3.6 |

單 GPU tier 用部署節點的 capex（卡 + 機箱 / CPU / NIC），不是裸晶片價。`ModelDef` 的 serving 欄位是 `paramsTotalB/paramsActiveB/isMoE/kvBytesPerToken/kvStateMbPerReq/nativeWeightBytes/contextWindowK/layers`（`layers` 用於 all-reduce 成本）；`kvLayers/kvHeads/headDim/attn` 是顯示欄位。

### 6.4 SLO + leak（§1.3，在 real-s 軸判定）

```
LAT_CLASS_SLO = {
  IN: { ttftMs: 400,  tpotMs: 40  },    // §1.3 MLPerf Interactive：chat、comp、jailbreak
  NR: { ttftMs: 2000, tpotMs: 200 },    // §1.3 Conversational：rag、summ、reason、agent
  TO: { /* 無延遲 SLO */ },              // embed、batch：只看 TPS / $
}
per-type 覆寫：comp.ttftSloMs 200（最嚴）；summ.ttftSloMs 6000（長 context 先讀完整份文件）；
               chat / jailbreak.ttfatSloMs 4000、comp.ttfatSloMs 400（思考模型的第一個答案 token）；
               agent.e2elSloMs 60000（一個 agent step：完整思考 + tool call，含 output guard 尾段）
```
TTFT 在第一個 token 判；TTFAT 在 hidden tokens 結束時判；E2EL 在 decode 途中與交付時判；TPOT = `decodeSec/(maxWork − 1)` 交付時判一次。抵達 core 仍未回答 → `leaked`；若曾被硬門檻擋下、且看過它的 rack 沒有一座放得下 → `unservable`（§2.5）。Goodput = 乾淨 served ÷ 全部終局，驅動 SLA 合約（§6.6）。

### 6.5 電力 / 冷卻（真實 kW，§5.5）

```
serverPower = tdpWatts/1000 × RACK_UTILIZATION(0.8) × (FP8 0.85 | 4-bit 0.85 × 0.95 | BF16 1) × (spec ? 1.08 : 1)
powerCap    = (6 kW 基礎 + 每座 Power Plant 8 kW) × powerCap 修飾
air pool    = (6 kW 基礎 chiller + 每座 Cooling Tower 8 kW) × coolingCap → 冷卻所有非液冷的 rack 與建築
liquid pool = 每座 Liquid Cooling Loop 75 kW × coolingCap × liquidCoolingCap → 只冷卻液冷 rack
```
**液冷 gate**：`cooling: 'liquid'` 的 rack（GB200 NVL72，每卡 1200 W，超過 §5.5 約 1000 W 的氣冷上限）沒有 Liquid Cooling Loop 時無法放置、無法升級進去、既有的會直接斷線；8 卡 DGX H200（700 W/卡）與 DGX B200（1000 W/卡）是氣冷。一座 Loop（75 kW）剛好撐住一座滿載的 NVL72（BF16 69 kW，加 speculative decoding 約 75 kW）。Loop 的 kW 只能冷卻液冷 rack（接在 cold plate 上的冷卻液迴路冷不了氣冷機箱），所以 Cooling Tower 對氣冷 rack 永遠必要。**brownout**：總用電 > powerCap 時，依 kW 由大到小關掉 server，仍超出才關支援建築（generative guard 的 rack 歸支援，最後才關），在狀態轉換時發出 `brownout` 事件。**熱節流**：每個 pool 只節流它冷卻的 rack：`heat ≤ cap ? 1 : max(THROTTLE_FLOOR 0.2, cap/heat)`；prefill 與 compute-bound decode 全額受影響，memory-bound decode 保留少許優勢（§6.2）。power / cooling 在每個 build-phase 動作之後與每個 wave step 重算，HUD 永遠是即時 kW。

### 6.6 經濟（真實 $/Mtoken，§5.8）

**收入**（`resolve.ts`）：
```
pay = TRAFFIC_SCALE × (tokIn × priceIn + tokOut × priceOut) / 1e6 × marketPriceMul / CREDIT_USD
tokIn  = 已 ingest 的 prompt（cached prefix 也算）；tokOut = 已生成的答案 token（hidden tokens 不計：型別單價代表答案的市場價值，這是已知偏差，見 REALISM）
served 全額、sloMiss 50%、其他終局 0；price = 型別單價 × 事件的 reward 修飾
```

**帳單：兩行，依 wall-clock**（`towerOpexPerSec`，updateEconomy、next-wave 帳單預估與 live burn 共用同一條規則）：
```
GPU-hour 行 = (gpuHrUsd − 滿載能源 tdpWatts/1000 × 0.8 × PUE × $0.10) → 攤提、維護、colo、網路；忙或閒都付
能源行     = serverPower × (0.3 + 0.7 × load) × throttle × PUE × $0.10/kWh × powerPrice
PUE = air 1.4 / liquid 1.15；load = 訓練中 ? 1 : 槽位佔用率；斷線或 throttle 0 的 rack 不付
換算：$/hr × (10/3600) × RACKS_PER_TILE / 1000 = 每 board 秒 credits
generative guard 自己那座 H100 以滿載付兩行
```
能源只佔一座 rack 全包時薪的幾個百分點（例：H100 $3.00/hr = GPU-hour 行 $2.92 + 滿載能源 $0.08）；電價事件只打能源行，因此在現金上影響有限，真正的電力槓桿是削減容量的電網事件（`powerCap`、`powerBuild`）。**cohort identity**：一座 board rack 付 RACKS_PER_TILE 座真實 rack 的帳，賺 TRAFFIC_SCALE × sprite 進度的 token，所以 rack 卡片顯示的 `$/Mtoken = rack $/hr × 1e6 / (aggTokS × 3600) × 生成/計費比` 就是它現金流的速率（例：一座 FP8 Qwen3.5 9B H100 rack 以 4.2K tok/s 服務，每生成 Mtok 約 $0.20；這個 hybrid 在 chat 波直接回答，卡片就是 $0.20，在需要思考的 near-real-time 流量上每個 256-token 答案先想約 1,000 個 hidden token，卡片顯示每計費 Mtok 約 $0.97）。**利用率經濟（§5.8）**：固定成本照 wall-clock、收入照服務 token → 閒置或過度配置的 rack 燒錢，單位成本隨低利用率爆炸。

**SLA 合約**（每波清場時支付）：
```
tierBonus(tier, boss) = 160 + 40 × tier + (boss ? 320 : 0)
contract = round(tierBonus × CLEAR_BONUS_SCALE(0.12) × Goodput/100)
```
它代表承諾客戶（訂閱、保留容量、企業合約）為乾淨服務付的錢：一座 board rack 代表幾千座真實 rack 服務幾分鐘的流量，開場幾波的 token 收入只付得起帳單的一小部分，合約讓乾淨準時的服務從第一波就有回報；一個 Goodput 60% 的 wave 只拿到 60%。到 2024 年的 tier，長 prompt 的 agent、RAG 與摘要讓 token 收入成為主要收入。

**Data**：`served` 與 `bad` 產生 `r.data × (1 + 0.25 × Training Lab 數)`；研究與 Studio 消耗它。

**勝負**：lose = `cash < 0`（破產）/ `trust ≤ 0` / `sla ≤ 0`，wave 中每個 step 檢查；清掉 wave 100 即勝利，之後可接 endless。

**endless**（`endless.ts`）：surge 從 wave 100 的負載接續——相同的 per-request 縮放（`groupMuls(MAX_TIER)`）、wave 100 的 boss 預算、tier 12 的節奏與攻擊壓力；合約從 wave 100 的 boss 合約（960）起算、每個 surge +40——然後每個 surge 量 +5%、工作量 +3.5%，前兩個 surge 之後品質線每 surge +0.01，攻擊嚴重度與新型比例也持續上升；每 10 個 surge 一次強制的困難事件，其他 surge 60% 機率抽事件。模型樹的頂端是 roster 最大的 open checkpoint，而難度沒有頂端，所以每場 endless 終會結束；分數是走得多深。

**事件**（`sim.ts rollIncident`）：每次清場為下一波抽一個事件：前兩波沒有；主題指定的招牌事件優先（47 個 wave 強制自己的事件）；否則 boss 波與每第 10 波保證一個困難事件（boss 自帶量的尖峰，所以它的困難事件不會是單一入口匯流，也不會是量的暴增；病毒式爆量算好運事件）；其他 60% 機率隨機。事件效果在 build phase 就生效並即時反映（`buildCost`、`powerBuild` 打在玩家即將擺放的東西上，`powerPrice`、`powerCap`、`coolingCap`、`liquidCoolingCap`、`safetyDamage`、`slaDamage`、`volume`、`reward` 在 wave 中生效；`coolingCap` 打兩個冷卻 pool，`liquidCoolingCap`（液冷迴路故障）只打 Liquid Loop 的 pool），下一次清場重設。

### 6.7 統一 step() 順序（`sim.ts`，只在 wave phase 執行）

```
1. refreshPower(s)        // 真實 kW：capacity、liquid gate、brownout（轉換時發事件）、兩個 pool 的 throttle (§6.5)
2. updateResearch(s,dt)   // 三軌共享借用池；借出的 rack 標記 training (§4.5)
3. updateSpawns(s,dt)     // 依 burst 時間表生成；lane window / surge pin (§2.6)
4. updateCombat(s,dt)     // Router 標記 → KV hand-off（另一模型 recompute）→ 首次接觸（TTFT 資格 + guard 篩檢）
                          //   → 准入（home 答案 → prompt 負載平衡 / Router dispatch → 同模型協助；KV/window/cohort/prefix）
                          //   → prefill（exclusive / chunked）→ 第一個 token（TTFT、第一層、hidden）→ lane-step decode
                          //   → 停頓計時 → 誤拒結算 → 交付（output guard、TPOT/E2EL、七終局） (§6.2/§3)
5. updateMovement(s,dt)   // board 移動；抵達 core → unservable / leaked (§6.4)
6. prune dead requests；peakConcurrent
7. updateEconomy(s,dt)    // 兩行帳單（wall-clock）；fleetCapexUsd；utilization EMA (§6.6)
8. pruneRecent(s)         // telemetry 的 req/s 視窗
9. lose-check             // trust ≤ 0 / sla ≤ 0 / cash < 0 (§6.6)
10. clearWave if done     // SLA 合約 × Goodput、wave report、重設修飾、抽下一個事件、refreshPower
```
收入在 `resolveOutcome` 中隨每個終局入帳。build phase 的動作（建造、出售、部署、升級、設定權重格式）各自立即 `refreshPower`；建造在 wave 中也允許（緊急擴容），部署與升級只在 build phase（換權重要清空 rack 並重啟引擎），唯一例外是 Multi-LoRA 的 adapter 熱切換。

---

## 7. 統一資料模型 (Unified Data Model)

> 以下是 `src/core/types.ts` 的權威型別摘錄（省略純顯示用的次要欄位；完整定義以程式碼為準）。

```ts
// ====== core/types.ts（摘錄） ======

export type ServerSpec = 'general' | 'chat' | 'coding' | 'reasoning' | 'agentic'
export type CapabilityAxis = ServerSpec                                   // 能力匹配軸的權威名稱
export type AttnVariant = 'MHA' | 'MQA' | 'GQA' | 'MLA' | 'hybrid-linear' | 'hybrid-swa' | 'csa'   // 顯示
export type LatencyClass = 'IN' | 'NR' | 'TO'
export type ThinkingSupport = 'always' | 'hybrid' | 'never'               // chat template 的事實
export type AnswerMode = 'instant' | 'thinking'                           // 每個請求的引擎政策
export type SafetyHazard = 'jailbreak' | 'injection' | 'harmful' | 'pii'
export type SafetyProfile = Partial<Record<SafetyHazard, number>>         // hazard → severity 0..1
export type WeightFormat = 'bf16' | 'fp8' | 'int4' | 'nvfp4'

// ---- 後訓練 (§1) ----
export type PostTrainMethod =
  | 'cpt' | 'sft' | 'lora' | 'qlora' | 'dora' | 'dpo' | 'rlhf' | 'cai' | 'grpo' | 'distill' | 'merge' | 'qat'
export type PostTrainTarget = CapabilityAxis | 'safety' | 'longctx' | 'domain'
export type LineageRelation = 'finetune' | 'quantized' | 'adapter' | 'merge'
export interface MethodRecipe {
  id: PostTrainMethod; name: string; relation: LineageRelation; allowedTargets: PostTrainTarget[]
  costData: number; costCompute: number
  gainScale: number; gainCap: number; taxScale: number; forgetScale: number   // autoplay-calibratable
  reshapesDeployment: boolean; requiresTech?: string; desc: string
}
export interface Lineage {
  baseModelIds: string[]; relation: LineageRelation; method: PostTrainMethod; target: PostTrainTarget; effort: number
  spent: { data: number; compute: number; waves: number }; depth: number; createdAtWave: number
}

// ---- 第一層安全 (§3) ----
export interface AlignmentProfile {
  safety: number                                                  // 0..100
  refusalStyle: 'none' | 'hard-refusal' | 'safe-completion'
  overRefusal: number                                             // 0..1，over-refusal 唯一真相
}

// ---- 模型 ----
export interface ModelDef {
  id: string; name: string; tier: 'small' | 'general' | 'coding' | 'frontier'
  variant: 'base' | 'instruct' | 'coding'; spec: CapabilityAxis; origin: 'base' | 'derived'
  paramsTotalB: number; paramsActiveB: number; isMoE: boolean          // VRAM 基礎 / 計算與讀取基礎
  thinking: ThinkingSupport; isReasoning: boolean; thinkTokens: number
  quality: number; qualityBy: Record<CapabilityAxis, number>           // 思考模式能力（校準）
  qualityByInstant?: Record<CapabilityAxis, number>                    // 只有 hybrid
  layers: number; kvLayers: number; kvHeads: number; headDim: number; attn: AttnVariant
  kvBytesPerToken: number                                              // BF16，只算成長中的 KV 層
  kvStateMbPerReq: number                                              // sliding window + linear/SSM 固定狀態
  nativeWeightBytes: number                                            // release precision（含 block scale）
  contextWindowK: number; longCtx: number                              // 硬 window / 長 context 能力 0..1
  alignment: AlignmentProfile; instructFollow: number; desc: string
  lineage?: Lineage                                                    // origin==='derived' 必填
  real?: RealModelMeta                                                 // 顯示用，sim 不讀
}
export interface RealModelMeta {
  developer: string; license: string; openWeights: boolean; released: string; contextWindowK: number
  benchmarks: Partial<Record<BenchmarkCell, number>>                   // 參考尺度
  benchmarkSource?: Partial<Record<BenchmarkCell, string>>             // 'latest' | 'eq' | 'bridge:… sd=…'
  benchmarksInstant?: Partial<Record<BenchmarkCell, number>>; benchmarkSourceInstant?: Partial<Record<BenchmarkCell, string>>
  instantVia?: string; thinkingToggle?: string; precision?: string
  confidence: 'high' | 'medium' | 'low'; source: string               // HF model card URL
  baseModelId?: string; relation?: LineageRelation                    // 真實血統（S8）
}

// ---- 硬體 (§6.3) ----
export interface ServerHardwareDef {
  id: string; name: string; gpuModel: string; gpus: number
  bf16TflopsPerGpu: number; fp8TflopsPerGpu: number; fp4TflopsPerGpu: number   // FP4 只有 Blackwell
  hbmGbPerGpu: number; hbmTbsPerGpu: number; tdpWattsPerGpu: number
  cooling: 'air' | 'liquid'; capexUsd: number; gpuHrUsdPerGpu: number
  bf16Tflops: number; fp8Tflops: number; fp4Tflops: number; hbmGb: number; hbmTbs: number
  tdpWatts: number; gpuHrUsd: number                                   // aggregate = perGpu × gpus（載入時）
  cost: number; range: number; color: number; accent: number; desc: string
}

// ---- 請求 (§2) ----
export interface RequestTypeDef {
  id: string; name: string; glyph: string; color: number
  inputTokens: number; outputTokens: number; latClass: LatencyClass
  ttftSloMs?: number; e2elSloMs?: number; ttfatSloMs?: number       // per-type 覆寫
  thinkMul: number                                                   // hidden tokens = thinkTokens × thinkMul
  speed: number                                                      // board tiles/s
  primaryAxis: CapabilityAxis; difficulty: Partial<Record<CapabilityAxis, number>>
  prefixShare: number; cacheable: boolean
  refusalExposure: number                                            // 誤拒暴露（第一層與第二層）
  adversarial?: boolean; toolUse?: boolean; hazards?: SafetyProfile; safetyRisk: number
  pricePerMtokIn: number; pricePerMtokOut: number
  trustPenalty: number; slaPenalty: number; data: number; desc: string
  work: number; context: number; reward: number                      // 抽象點數：只供顯示，serving 數學不讀
}

// ---- infra 狀態 (§4) ----
export interface InfraState {
  scheduling: { batch: boolean; multiStep: number; chunked: boolean }
  kv: { utilization: number; prefixHitCeil: number; quantBytes: number; offloadGb: number; flash: number }
  disagg: boolean
  spec: { enabled: boolean; level: number }
  quant: { fp8: boolean; int4: boolean; nvfp4: boolean }             // 已研究的權重格式；每座 rack 自選
  par: { tp: boolean; pp: boolean; dp: boolean; ep: boolean }
  routing: { kvAware: boolean }; loraSlots: number; engineTier: 0 | 1 | 2   // vLLM / SGLang / TensorRT-LLM
}
export type InfraCategory = 'scheduling' | 'kv-memory' | 'decoding' | 'weight-quant'
  | 'parallelism' | 'routing' | 'multi-lora' | 'engine'
export interface InfraNodeDef {
  id: string; category: InfraCategory; name: string; i18nKey: string
  effects: Partial<Record<string, number>>; level: number
  requires: string[]; conflicts?: string[]; requiresBlackwell?: boolean
  dataCost: number; compute: number
  optimizes: ('latency' | 'throughput' | 'memory' | 'cost')[]
  coupling: 'pure-infra' | 'infra-model'; sourceRef: string
}

// ---- 建築 / guardrail (§3) ----
export type TowerKind = 'server' | 'router' | 'cache' | 'guardrail' | 'power' | 'cooling' | 'cooling_liquid' | 'lab'
export type GuardrailArchetype = 'encoder' | 'generative' | 'moderation'
export interface GuardrailSpec {
  archetype: GuardrailArchetype; side: 'input' | 'output' | 'both'; catches: SafetyHazard[]
  checkLatencyMs?: number                                            // encoder / moderation 固定
  runsOnRoofline: boolean; guardParamsActiveB?: number; guardHardwareId?: string   // generative：自己的 rack
  baseRecall: number
}
export interface Tower {
  id: number; def: TowerDef; col: number; row: number; x: number; y: number; level: number
  online: boolean; throttle: number; load: number
  hwId?: string; modelId?: string; training?: boolean
  role?: 'prefill' | 'decode'; precision?: WeightFormat; loraHot?: boolean; prefillDebtSec: number
  decodeIds?: number[]; prefillId?: number | null; kvFrac?: number; batch?: number; streams?: number; tokS?: number   // 顯示
}

// ---- 請求 runtime ----
export interface Request {
  id: number; def: RequestTypeDef; laneId: number; dist: number; x: number; y: number; alive: boolean
  prefill: number; work: number; maxWork: number; tokensIn: number; tokensOut: number; contextLen: number
  queueSec: number; guardInSec: number; guardOutSec: number
  ttftReal: number; ttfatReal: number; e2elReal: number; decodeSec: number; hiddenTokens: number
  kvModelId?: string; kvTowerId?: number; homeTowerId?: number; kvTransferSec: number; recompute: boolean
  sloViolated: boolean; windowBlocked: boolean; fitSeen: boolean
  difficulty: number; hazards: SafetyProfile; hazardsOpen: SafetyProfile; novel: boolean; safetyRisk: number
  safetyCleared: boolean; overRefused: boolean; selfHandled: boolean; screened: boolean; attackHandled: boolean
  bestQuality: number; qualTokSum: number; qualTokW: number          // token 加權 margin
  routed: boolean; routedTo: number | null; cacheLooked: boolean; cachedTokens: number; tokBy: Record<number, number>
  pricePerMtokIn: number; pricePerMtokOut: number; trustPenalty: number; slaPenalty: number; data: number
  sloCause?: SloCause; refusedBy?: RefusedBy; thinkingMode?: AnswerMode; answeredBy?: number; answeredModelId?: string   // 顯示
}

// ---- 終局與事件 ----
export type Outcome = 'served' | 'sloMiss' | 'bad' | 'unsafe' | 'overRefused' | 'unservable' | 'leaked'
export type SloCause = 'ttft' | 'tpot' | 'e2el' | 'ttfat'
export type RefusedBy = 'model' | 'guard'
export type GameEvent =                                              // 每個生命週期 / 玩家動作 / 狀態轉換一次，從不逐 tick
  | { type: 'outcome'; requestId: number; typeId: string; outcome: Outcome; cash: number; dTrust: number; dSla: number
      cause?: SloCause; axis?: ServerSpec; margin?: number; refusedBy?: RefusedBy; towerId?: number; modelId?: string
      cached?: boolean; thinkingMode?: AnswerMode; hiddenTokens?: number /* + laneId, x, y */ }
  | { type: 'guard'; towerId: number; requestId: number; result: 'caught' | 'overRefused'; archetype: GuardrailArchetype; hazard?: SafetyHazard }
  | { type: 'selfHandle'; towerId: number; requestId: number; hazard: SafetyHazard }
  | { type: 'cache'; towerId?: number; requestId?: number }
  | { type: 'build'; towerId: number; defId: string } | { type: 'upgrade'; towerId: number; hwId: string }
  | { type: 'deploy'; towerId: number; modelId: string } | { type: 'sell'; towerId?: number; defId?: string; refund?: number }
  | { type: 'brownout'; on?: boolean }                                 // 只在狀態轉換時
  | { type: 'wave-start'; index: number; boss?: boolean; surgeLane?: number }
  | { type: 'wave-clear'; index: number; goodputPct?: number } | { type: 'incident'; id: string }
  | { type: 'research-start'; id: string; track?: string } | { type: 'research-done'; id: string }
  | { type: 'posttrain-done'; modelId: string }
  | { type: 'win' } | { type: 'lose'; meter?: 'cash' | 'trust' | 'sla' }
  // outcome / guard / selfHandle / cache / build / upgrade / deploy / sell 另帶 x, y 供 FX 定位

// ---- telemetry ----
export interface WaveStats {                                         // 一律以 newWaveStats() 建立
  served: number; sloMiss: number; bad: number; unservable: number; unsafe: number; overRefused: number; leaked: number
  total: number; goodput: number; answered: number; answeredInSlo: number
  cashIn: number; powerCost: number; gpuCost: number; energyCost: number; cacheHits: number
  trustLostBy: Partial<Record<Outcome, number>>; slaLostBy: Partial<Record<Outcome, number>>
  sloCauses: Partial<Record<SloCause, number>>; overRefusedBy: Partial<Record<RefusedBy, number>>
  guardCaught: number; selfHandled: number; latencies: number[]; ttfts: number[]; recentServes: number[]
  byType: Record<string, WaveTypeStat>
}
// WaveReport = 結算後的 WaveStats + clearBonus（實付合約）、goodputPct、sloAttainPct、avg/p95 latency 與 TTFT、duration

// ---- 波次 / 事件 ----
export interface SpawnGroup {
  typeId: string; count: number; interval: number; delay: number
  workMul?: number; contextMul?: number; complexityMul?: number; rewardMul?: number; speedMul?: number
  lane?: number; hazardMul?: number; novelShare?: number; hazards?: SafetyProfile
}
export interface WaveDef { name: string; brief: string; teaches: string; clearBonus: number; groups: SpawnGroup[] }
export type ModifierTarget = 'powerPrice' | 'coolingCap' | 'buildCost' | 'safetyDamage' | 'volume' | 'reward'
  | 'powerCap' | 'powerBuild' | 'slaDamage' | 'liquidCoolingCap'

// ---- 研究多軌 (§4.5) ----
export interface ResearchSlot { id: string; kind: 'infra' | 'posttrain' | 'eval'; progress: number; compute: number; meta?: PostTrainMeta }

// ---- GameState（摘錄） ----
export interface GameState {
  phase: 'menu' | 'build' | 'wave' | 'won' | 'lost'; time: number; waveIndex: number; waveTime: number
  meters: { trust: number; sla: number; cash: number }; data: number
  power: Capacity; cooling: Capacity; coolingLiquid: Capacity           // 真實 kW
  towers: Tower[]; requests: Request[]; rng: RNG; seed: number
  infra: InfraState; upgrades: Record<string, number>                    // upgrades：已研究標記 + 計數
  models: Record<string, true>; derivedModels: Record<string, ModelDef>; derivedSeq: number
  research: { infra: ResearchSlot | null; posttrain: ResearchSlot | null; eval: ResearchSlot | null }
  modifiers: Record<ModifierTarget, number>; pendingIncident: IncidentDef | null; laneWindow: number[]
  guardrailThreshold: number                                             // 固定 0.5
  stats: GameStats; waveStats: WaveStats | null; lastReport: WaveReport | null
  marketPriceMul: number; utilization: number; fleetCapexUsd: number
  endless: boolean; currentWave: WaveDef | null; events: GameEvent[]
}
```
