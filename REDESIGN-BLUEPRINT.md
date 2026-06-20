# GPTD 真實化重設計 — 最終藍圖 v2 (Finalized Implementation-Ready Blueprint)

> 本文件由六份子系統設計（models-finetune / requests / safety / tech-tree / ui / core-sim-econ）整合為 v1，再依對抗式設計批評（CRITIC v1，C1–C7 / H1–H8 / M1–M10 / L1–L5）逐項修訂為 v2。整合者職責是**一致性 + 物理正確**：單一資料模型、單一術語、單一單位系統；以 core-sim serving 數學為脊椎，且**脊椎本身的物理閉環必須先合上**（時間/單位系統、prefill/decode 速率、SLO 判定），上層子系統才坐得穩。所有跨子系統衝突顯式裁決，所有 critic 發現顯式吸收（標 `[fix Cx/Hx/Mx/Lx]`）；真正屬於使用者抉擇者一律下放到 §9 OPEN QUESTIONS，不臆測。Slogan 全文落實：**「the board is the metaphor, the numbers are real.」** 散文用正體中文（台灣）；identifier / 數字 / §ref verbatim，§ref 對應 `/Users/jacoblincool/Documents/GitHub/GPTD/REFERENCE-DOSSIER.md`。範圍：Expert (Professional) Mode 完整；Normal-mode 僅標 hook（D2）。

---

## 整合層裁決摘要（CONFLICT RESOLUTIONS — 先讀這個）

六份設計各自正確，但在資料模型/單位/欄位命名上有交集需要統一。以下裁決後續所有章節一律遵守（v2 在 R4/R8 補上 critic 修正）：

| # | 衝突 | 各方立場 | **最終裁決（單一真相）** |
|---|---|---|---|
| **R1** | `ModelDef` 的計算成本欄位 | core-sim **移除** `flopsPerWork`/`bandwidthPerWork`，改 `2×active_params` 真實公式；tech-tree / models-finetune **沿用** `flopsPerWork` / `serveCost` | **採 core-sim**：移除 `flopsPerWork`/`bandwidthPerWork`/`COST_POINTS`/`serveCost`/`memoryGb`。serving 速率一律由 §6 的真實 roofline（`2×paramsActiveB`）計算。models-finetune 的「derived 繼承 base 部署數字」改述為「繼承 `paramsActiveB/paramsTotalB/layers/kvHeads/headDim/attn`」——這些就是真實公式的輸入。**[fix C3]** quant 的兩個作用點明確下放到 §6.2（`weightQuantBytes` 改 VRAM + decode 頻寬項；W4A16 compute roof 不變），不再用懸空欄位名。 |
| **R2** | 請求的根本欄位 | requests / core-sim **token-native**（`inputTokens`/`outputTokens`）；現碼是抽象 `work`/`complexity`/`context` | **token-native**：`RequestTypeDef` 改為 `inputTokens`/`outputTokens`/`latClass`；`complexity` **退役為純 derived**（**[fix M2]** 從 `RequestTypeDef` 移除，runtime 由 `difficulty[primaryAxis]` 算）；`contextLen` 改 derived = `inputTokens + 已生成 outputTokens`（真實 token，動態成長）。 |
| **R3** | 第一層安全欄位命名 | models-finetune 用扁平 `intrinsicSafety`/`instructFollow`/`overRefusal`；safety 用巢狀 `AlignmentProfile{safety,refusalStyle,overRefusal}` | **採 safety 的 `AlignmentProfile`**（含 `refusalStyle` 的 §3.1 演進），併入 models-finetune 的 `instructFollow`。最終：`ModelDef.alignment: AlignmentProfile` + `ModelDef.instructFollow`。**[fix L1]** 刪除重複的 `ModelDef.overRefusal?`，over-refusal 唯一真相為 `alignment.overRefusal`。 |
| **R4** | attention/KV 欄位 | tech-tree 用 `attnVariant`/`kvShrink`（係數）；core-sim 用 `attn`/`layers`/`kvHeads`/`headDim`（一手物理量） | **採 core-sim 的一手量** `attn`/`layers`/`kvHeads`/`headDim`（直接餵 §5.6 KV 公式）。`kvShrink` 為 **derived**。**[fix M5]** MLA 不適用 GQA 式 `kvHeads×headDim` 結構——MLA 模型以 `attn:'MLA'` 標記，KV 改走 latent 近似：`kvPerReqGb_MLA = baseKV × 0.067`（DeepSeek-V2 KV 減 93.3% → 剩 6.7%，§4.6），且 UI/§5 tooltip 明示「MLA 為等效縮放近似，真實 latent 維度與 GQA 結構不同」（誠實對齊 slogan）。GQA/MQA 由低 `kvHeads` 自然反映。 |
| **R5** | 參數欄位命名 | 現碼註解說 `paramsB` 別名 `paramsTotalB`；多份設計混用 | **統一 `paramsTotalB` / `paramsActiveB`**。VRAM ∝ `paramsTotalB`；compute/decode ∝ `paramsActiveB`（§0#10、§4.8、§5.6）。 |
| **R6** | infra 狀態存放 | tech-tree 新增 typed `s.infra: InfraState`；現碼全在 `s.upgrades` | **採 `s.infra`**。`s.upgrades` 只留「花現金買的 UPGRADES」。core-sim effects getter 一律改讀 `s.infra` + model 屬性。 |
| **R7** | 衍生模型存放 | models-finetune 新增 `s.derivedModels` + `resolveModel()`；現碼全靜態 `MODEL_DEFS` | **採 `s.derivedModels` + `resolveModel(s,id)`**（無上限 + 可序列化）。**[fix C4]** `resolveModel` 不做遞迴解析權重——derived 在「建立當下」就把 base 解析完並把最終 `qualityBy/alignment/部署欄位` **固化（snapshot）寫進自身**，lineage 只存血統與 `depth`（重播只需 seed + lineage）。深層數值穩定性見 §1.4 的 `depth` 衰減項。 |
| **R8** | 難度：純量 vs 向量 | requests **per-axis `difficulty` 向量**；現碼 + core-sim 契約用純量 `complexity` | **per-axis `difficulty` 向量為唯一真相**（能力壓縮 §6.4 必須向量）。`complexity` 不再是欄位（見 R2/M2）。**[fix H7/M1]** 統一術語：能力匹配軸一律稱 `CapabilityAxis`（值同 `ServerSpec`），與「請求工作負載物理軸」（token/SLO/prefix）顯式分層；`affinity`/`spec`/`primaryAxis` 全部收斂到 `CapabilityAxis` 命名（型別 alias 保留 `ServerSpec` 以最小化改動）。 |
| **R9** | leak / 終局數量 | requests 五終局；safety 加 `overRefused`；core-sim 三類 leak | **統一六終局**（§2.5、§6.4）：`served` / `slo_miss` / `bad` / `unservable` / `unsafe` / `over_refused`。 |
| **R10** | 時間單位 | core-sim 引入 `SIM_TIME_SCALE`；其他子系統用 board tick | **採雙時鐘模型（v2 重寫，[fix C5/C6/M10]）**：見 §0.4「時間與單位系統」——單一明確的 board-tick ↔ 真實秒 ↔ 真實 ms SLO 轉換鏈，且 SLO 以**並發攤平後的等效延遲**判定（不是裸 b=1 延遲），確保 Goodput 不恆為 0。`SIM_TIME_SCALE` 與 cash 單位在 P0 一次定清。 |

**術語標準（全文一致）**：`paramsTotalB`/`paramsActiveB`、`alignment.safety`、`CapabilityAxis` + `difficulty[axis]`、`inputTokens`/`outputTokens`/`contextLen`、`s.infra`、`s.derivedModels`、`resolveModel`、`Goodput`（同時滿足 TTFT∧E2EL SLO 的服務率）、`prefillTokS`/`decodeTokS`（真實 roofline）、`$/Mtoken`、`SIM_TIME_SCALE`、`effLatencyMs`（並發攤平後等效延遲）。

---

## 0. 願景與統一模擬模型 (Vision & the Unified Simulation Model)

### 0.1 願景

GPTD 把資料中心 LLM 推論的真實工程，包裝成塔防的**體驗層**（D1：四個全球入口 lane、中央 Trust Core、rack 擺放、range、請求匯流壓力），但**底層數學全部真實**。玩家學到的是真工程師的決策：prefill/decode roofline、MoE 記憶體-算力解耦、KV 預算、Goodput、$/Mtoken、冷卻分界、per-model 後訓練 vs serving 技術、兩層安全。每個 §ref 都掛在一個可見的遊戲機制或 tooltip 上。

### 0.2 統一模擬脊椎（spine）

core-sim 是所有子系統插入的黏合層。一個請求的生命週期就是脊椎：

```
spawn (真實 token 抽樣, §2)
  → 沿四個入口 lane 之一流向中央 Trust Core (movement, board metaphor)
  → router 長度感知/SLO-aware 分流 (§4 routing)
  → guardrail 輸入檢查 (§3 第二層, 疊 TTFT)
  → rack: PREFILL (compute roof, 超線性 §6.2) → TTFT
         → DECODE (bandwidth roof, batch 攤平) → TPOT
         其中模型內生對齊嘗試自處理 hazard (§3 第一層, 0 延遲)
  → guardrail 輸出檢查 (§3 第二層, 疊 E2EL)
  → resolve: served / slo_miss / bad / unservable / unsafe / over_refused (§6.4)
  → economy: 真實 $/Mtoken 收入 − capex/gpu-hr/電/冷卻 (§6)
```

**每個子系統掛在脊椎上的明確點**：
- Models (§1) 提供 `paramsTotalB/paramsActiveB/layers/kvHeads/headDim/attn/qualityBy/alignment` → 餵 roofline + KV + quality gate。
- Requests (§2) 提供 `inputTokens/outputTokens/difficulty/latClass/hazards/prefixShare` → 定義工作量、SLO、安全種子、可快取性。
- Safety (§3) 讀 `alignment` (第一層) + 在 lane 上插 guardrail 建築 (第二層) → 決定 hazard 是否被清。
- Tech (§4) 寫 `s.infra` → 改 batch 上限 / KV 利用率 / cache 命中 / spec 倍率 / parallelism roof / routing。
- Core-sim (§6) 擁有 roofline tok/s、KV 預算、SLO/Goodput、真實 watt、$/Mtoken、`step()` 順序、**雙時鐘轉換**。
- UI (§5) 唯讀以上全部，呈現真實單位與圖表，**不改 sim**（`sim/**` 不得 import `mode.ts`，AGENTS.md）。

### 0.3 不可妥協的真實錨點（每個子系統 MUST 用）

prefill=compute-bound/decode=bandwidth-bound (§1.1)；prefill 因 O(n²) attention **長 prompt 超線性** (§1.1#63)；`FLOPs/token ≈ 2×active_params`、`decode tok/s(b=1) ≈ HBM_BW/(2×active×bytes)` (§5.6/§5.7)；**decode 聚合吞吐隨 batch 線性上升直到 compute roof 飽和** (§5.7#841)；MoE VRAM∝total、speed∝active (§4.8/§6.1)；KV bytes `=2×layers×kv_heads×head_dim×seq×batch×bytes`、**seq 隨 decode 動態成長** (§5.6)；FP16/FP8/INT4 = 2/1/0.5 bytes (§5.6)；冷卻分界 ≲1000W 氣冷 / ≳1000–1200W 液冷 / NVL72 ~120kW (§5.5)；`$/Mtoken = ($/GPU-hr×3600)/(tok/s×1e6)`、低利用率 ×10 (§5.8)；幾乎所有後訓練 per-model、唯 multi-LoRA serving + PTQ 在 serving 層 (§2.10)；安全兩層 (§3)；能力壓縮 **唯在 agentic/SWE 維度規模仍拉開差距** (§6.4)；lineage 機器可讀 (§2.9/§6.5)。

### 0.4 時間與單位系統（v2 新增 — 脊椎物理閉環，[fix C5/C6/M10]）

> **批評 C5 指出 v1 的致命裂縫**：若 TTFT 用真實秒算（70B b=1 decode 1000 token ≈ 80 真實秒），但 SLO 用真實 ms（IN class TTFT 400ms），則「裸 b=1 延遲」幾乎永遠超 SLO → Goodput 恆為 0，整個 §6 地基是錯的。v2 用一條明確的轉換鏈與「並發攤平後等效延遲」修復。

**三個時鐘，一條鏈：**
1. **真實物理量**：所有 tok/s、bytes、watts、USD 以真實單位計算（§6.2 roofline）。
2. **真實秒（real-s）**：請求的真實服務時間。**關鍵修正**：延遲不取 b=1 裸值，而取**並發攤平後的等效延遲** `effLatencyMs`——一個請求在一個跑著 `batch` 並發的 rack 上，其 per-user 出 token 速率 ≈ `aggDecodeTokS / batch`（§5.7「TPS per user = OSL/E2EL，趨近 1/ITL」），且 prefill 與其他請求**交錯/排隊**。亦即：
   ```
   ttftReal   = queueWaitSec + prefillTimeSec + inputGuardLatSec        // 真實秒, [fix C6 input guard → TTFT]
   tpotReal   = 1 / perUserDecodeTokS                                    // perUser = aggDecodeTokS / batch
   e2elReal   = ttftReal + (outputTokens − 1) × tpotReal + outputGuardLatSec  // [fix C6 output guard → E2EL]
   ```
   SLO 判定**比較 `effLatencyMs = real-s × 1000` 與真實 ms 門檻**（§6.4 `LAT_CLASS_SLO`）。這樣高並發、低 OSL 的 chat 能落回 SLO 內；長 OSL 的 reason 自然吃緊——Goodput 成為「rack 能不能在 SLO 內服務這個並發量」的真實函數，**不會恆為 0**。
3. **board 秒（board-s，可見步調）**：lane 移動與動畫只壓**視覺步調**，不參與 SLO 判定。`SIM_TIME_SCALE`（建議 8–12，P0 playtest 校準，OQ-G2）只把「請求在 rack 內停留的真實秒」映射成「board 上停留的可見秒」供動畫與 lane 推進使用：`boardDwellSec = realDwellSec / SIM_TIME_SCALE`。**SLO 一律在 real-s 軸判定（步驟 2），board-s 只負責畫面**——兩個時鐘職責不再混淆。

**guardrail 延遲歸屬（[fix C6]）**：`side:'input'` 的 guardrail 延遲加進 `ttftReal`（prefill 前）；`side:'output'` 加進 `e2elReal`（decode 後，對 streaming 的 TPOT 影響：output guard 在末端一次性檢查，記為 E2EL 尾延遲，不逐 token 疊 TPOT）；`side:'both'` 兩端各加一次。92ms encoder 相對「chat 並發攤平後 ~數百 ms TTFT」是有意義的 23% 預算佔用（§3.6），相對長 reason 的 e2el 才顯得小——這正是真實取捨，現在數值上成立。

**cash / USD 單位（[fix M10]，P1 一次定清，OQ-G3）**：勝負 `cash<0` 的閾值意義取決於 cash 單位。v2 將「cash 單位 + `SIM_TIME_SCALE`」綁為**單一單位決策包**在 P0/P1 一次定清（不下放到散落 OQ 拖延地基）；OQ-G3 僅保留「真實 USD vs ÷1000 縮放」的 game-feel 選項供使用者拍板，但無論選哪個，capex/gpu-hr/電/冷卻/收入**全部用同一比例**，破產判定隨之確定。

---

## 1. 模型 + 後訓練 (Models + Fine-tuning)

### 1.1 設計理念（grounded §2.10、§6.4）

現況把後訓練拆成兩個與現實牴觸的機制：(1) 科技樹混淆 per-model 與 serving（`r_tech_reasoning`/`saf_rlhf`/`saf_redteam` 是全艦隊 buff，但 §2.10 明確這些是 per-model 後訓練）；(2) 微調是封閉寫死的兩張卡（`ft_agent`/`pt_giga`，`qualityBy` 手編，違反 calibrate.ts 鐵律）。三個 balance bug（`qwen3_30b_a3b` OP、`deepseek_v31` 冗餘、`nemotron_ultra` trap）的根因在 cost curve、缺 serving 規模牆、與**差異化維度選錯**，須用 calibration / cost / serving 牆修。

**三個 invariant：**
- **I1** — 一切後訓練都產生一個新的 derived `ModelDef`（§2.10）。微調不是 buff，是一個新 checkpoint。
- **I2** — base 的 `qualityBy` 由 benchmark% 計算（保留 calibrate.ts）；derived 的由 `deriveQuality(base, method, target, effort)` 計算。**[fix C4]** `deriveQuality` 的 recipe 常數（`gainScale/gainCap/taxScale/forgetScale`，§1.3）不假裝是第一性原理——它們是**待 autoplay 校準的可調表**，校準目標明定於 §1.3 末（「LoRA 一次的 quality delta ≈ §6.3 一個 band 內的位移」）。誠實標記：base 校準是物理（benchmark→quality），derived 增益是**經校準的遊戲曲線**。
- **I3** — VRAM ∝ `paramsTotalB`；compute/speed ∝ `paramsActiveB`；bytes/param 由 FP/quant 決定（§4.8/§5.6/§5.7）。微調不改架構（LoRA/DPO/RLHF/CAI/QAT 不動 total/active）；只有 distill（換較小 student base）、merge（同源）、qat（換 bytes/param）動到部署數字。

### 1.2 無上限衍生模型架構（[fix C4 序列化/重現閉環]）

`MODEL_DEFS` 是 module-level 靜態 `Record`。無上限 derived 模型住在 `GameState.derivedModels`，並新增單一解析點 `resolveModel(s,id)`（R7）：

```ts
// sim/models.ts (新檔)
export function resolveModel(s: GameState, id: string): ModelDef | null {
  return MODEL_DEFS[id] ?? s.derivedModels[id] ?? null
}
```

**非遞迴 snapshot 語意（[fix C4]）**：`deriveModel(s, baseId, method, target, effort)` 在建立當下：
1. `base = resolveModel(s, baseId)`（base 可以是另一個 derived → 支援「fine-tune a fine-tune」無上限）；
2. 立即計算最終 `qualityBy/alignment/instructFollow/部署欄位` 並**固化寫進新 derived `ModelDef`**；
3. 不在 serve 時遞迴回溯——`resolveModel` 永遠是 O(1) 查表，數值已固化。
4. 重現只需 `seed + derivedSeq + 每筆 Lineage`（method/target/effort/baseIds）即可重播整條鏈。

`loadoutOf` / `loadout` / `deployModel` / `deployableModels` 全部改走 `resolveModel(s,id)`（`loadoutOf` 改吃 `(s, t)`）。

**深層 lineage 數值穩定（[fix C4]）**：`deriveQuality` 套用 `depth` 衰減，防止無限刷分與數值崩壞：
```
depthDamp = 1 / (1 + 0.15 × lineage.depth)     // 每加一層，增益遞減；headroom 仍是天花板
```
`headroom=(130−base.qualityBy[axis])/130` 已是天花板上限；疊加 `depthDamp` 後，深鏈微調的邊際增益單調收斂、且因 `forgetScale` 累積而有真實「過度微調反退化」的下行壓力——深鏈不再是免費刷分。

### 1.3 後訓練方法菜單（PostTrainMethod / PostTrainTarget / MethodRecipe）

完全對應 §2 的真實 per-model 菜單，資料驅動：12 個 method（`cpt`/`sft`/`lora`/`qlora`/`dora`/`dpo`/`rlhf`/`cai`/`grpo`/`distill`/`merge`/`qat`），8 個 target（5 個 `CapabilityAxis` 軸 + `safety`/`longctx`/`domain`）。型別見 §7。

**MethodRecipe 全表**（成本錨定 §2.10「算力相對量級」；增益/稅剖面模型化 §2.8 五大 tradeoff）：

| method | relation | allowedTargets | costCompute | costData | gainScale | gainCap | taxScale | forgetScale | reshapesDeploy | requiresTech | §依據 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `cpt` | finetune | domain/longctx/general | **60** | **40** | 22 | **40** | 0 | **0.5** | – | `r_pt_cpt` | §2.1「~SFT 10–100×」 |
| `rlhf` | finetune | safety/chat/general | **40** | 14 | 14 | 16 | **0.6** | 0.12 | – | `r_pt_pref` | §2.4「四模型同跑，最高」 |
| `grpo` | finetune | reasoning/agentic | 18 | 8 | **28** | 40 | 0.05 | 0.15 | – | `r_pt_rl` | §2.4「PPO −40–60% 記憶體」 |
| `cai` | finetune | safety | 16 | 9 | 12 | 14 | 0.25 | 0.08 | – | `r_pt_pref`(+`r_pt_cai`) | §2.4 中-高，低稅 |
| `distill` | finetune | reasoning/coding/agentic | 12 | 16 | 24 | min(teacher) | 0 | 0.04 | **✓** | `r_pt_distill` | §2.6 |
| `dpo` | finetune | chat/general/safety | 10 | 11 | 12 | 12 | 0.08 | 0.06 | – | `r_pt_pref` | §2.4 中 |
| `sft` | finetune | chat/coding/general/longctx | 6 | 8 | 16 | 14 | 0 | 0.08 | – | (起手免研究) | §2.2 基準 |
| `qat` | quantized | (壓部署,不改質目標) | 6 | 3 | 0 | – | 0 | 0 | **✓** | `r_pt_qat` | §2.7 |
| `dora` | adapter | chat/coding/reasoning/general/agentic | 1.4 | 6 | 14 | 10 | 0 | 0.03 | – | `r_pt_lora` | §2.3「略高於 LoRA」 |
| `lora` | adapter | 同 dora | **1** | 5 | 12 | 8 | 0 | 0.02 | – | `r_pt_lora` | §2.3 最便宜 |
| `qlora` | adapter | 同 dora | 0.8 | 5 | 11 | 8 | 0 | 0.02 | – | `r_pt_lora` | §2.3 門檻最低 |
| `merge` | merge | (繼承上游軸取均) | **0.2** | 0 | – | – | 0 | **0** | – | `r_pt_merge` | §2.6 免再訓 |

> **[fix C4] 校準標記**：上表 `gainScale/gainCap/taxScale/forgetScale` 共 48 個值為 v2 起手值，**標為 `autoplay-calibratable`**。校準鐵律：「`lora` 一次（effort=1.0）在目標軸的 quality delta 應對應 §6.3 一個 band 內的位移（約 +6~10）；`cpt`/`grpo` 一次可跨半個 band；`merge` 增益≈0 但無稅」。calibrate.ts 新增 `calibrateRecipes()` 對這些值做迴歸，**不再宣稱是第一原理**。

### 1.4 公式

**base `qualityBy`（不變）**：沿用 `qualityFromBenchmarks(bench, QUALITY_FLOOR[tier])`（calibrate.ts）。

**benchmark → CapabilityAxis 映射表（v2 新增，[fix M6]，§6.3）**：calibrate.ts 與 H2 差異化的共同前置。
| CapabilityAxis | 主 benchmark | 次 benchmark | 飽和狀態（§6.3） |
|---|---|---|---|
| `general` | MMLU-Pro | GPQA-Diamond | 接近飽和（83–90 群聚） |
| `chat` | MMLU-Pro | IFEval（指令遵循） | IFEval 飽和 |
| `coding` | LiveCodeBench (v5/v6) | HumanEval | 持續滾動抗飽和 |
| `reasoning` | GPQA-Diamond | AIME 2024/2025 | 推理模型逼近頂 |
| `agentic` | **SWE-bench Verified** | **τ²-bench / Terminal-Bench** | **未飽和、最具鑑別力** |
| (`context` 分數) | longContext / RULER | — | — |

> **關鍵**：`agentic` 軸**唯一**來自未飽和的 SWE-bench/τ²-bench——這是 §6.4「大模型仍值錢」與 H2（qwen 差異化）的物理依據。小 MoE 在此軸**真實落後**（校準事實，非手編）。

`alignment.safety/instructFollow` 是**手填 base 屬性**（無公開安全基準可校準，§OQ-G12）。

**訓練成本**（§2.10 + §2.3/§2.5/§2.6；接 research.ts 既有 requisition）：
```
sizeFactor  = (base.paramsActiveB / 8) ^ 0.7          // 8B-active 基準, 次線性
computeCost = recipe.costCompute × sizeFactor × effort × 1000   // FLOPS·s
dataCost    = recipe.costData × effortDataMul(target) × effort
waves       = ceil(computeCost / requisitionThroughput)  // 由 research.ts 真實 aggregate TFLOPS 決定
```
> **worked example（LoRA agentic on Qwen3-30B-A3B，active 3.3B，effort=1.0）**：`sizeFactor=(3.3/8)^0.7≈0.52`；`computeCost=1×0.52×1000=520 FLOPS·s`。CPT 同 base：`60×0.52×1000=31,200` ≈ 60×（§2.1）。

**`effort` 滑桿定義（v2 補齊，[fix M9]）**：`effort ∈ [0.25, 2.0]`，UI 為離散五檔滑桿 `{0.25, 0.5, 1.0, 1.5, 2.0}`（Post-Training Studio，§5.2 S9）。語意：`effort` 同時抬 `gain(√effort)`、`computeCost(×effort)`、`dataCost(×effort)`、`waves(隨 computeCost)`。**校準目標斜率**（autoplay 定值，OQ-G11）：「effort 1.0→2.0 約 +40% gain 但 ×2 compute + ×2 data + 約 ×2 waves」——報酬遞減（√）讓 high-effort 不無腦最優。worked example 一律標 effort 值。

**`deriveQuality(base, recipe, target, effort)`**（取代手編，模型化 §2.8）：
```
rawGain[targetAxis] = recipe.gainScale × sqrt(effort) × depthDamp       // 精選資料報酬遞減 §2.2 + 深鏈衰減
headroom            = (130 − base.qualityBy[axis]) / 130                // 越接近天花板越難推 §2.3
gain[targetAxis]    = min(rawGain, recipe.gainCap × headroom)           // PEFT 容量 cap; cpt gainCap 高可破 cap
if (target==='safety' || method∈{rlhf,cai}):
  general 軸 −= recipe.taxScale × alignmentTaxFactor(method)            // alignment tax 單調 §2.4
非 target 軸 −= forgetScale(method) × spreadFactor                      // catastrophic forgetting §2.1/§2.8
if (effort>overfitThreshold && 窄資料): targetAxis 在非該領域請求上打折  // narrow-FT overfit §2.2
```
**內生狀態更新**：`target==='safety'`/method∈{rlhf,cai} → `alignment.safety += safetyGain`（cai 同時 `alignment.overRefusal −=`；粗暴 rlhf/safety-sft `overRefusal +=`，§2.4 tension）；`sft` → `instructFollow +=`；`grpo`/reasoning → `isReasoning=true`（冷啟動把 dense 通用模型變思考模型，§2.5）。

> **worked example（GRPO reasoning on Llama-3.3-70B，base reasoning=72，effort=0.8，depth=0）**：`depthDamp=1`；`headroom=(130−72)/130=0.45`；`rawGain=28×√0.8=25.0`；`gain=min(25.0, 40×0.45=18)=18` → `derived.reasoning=90`（過 reason 線 82）；`forgetScale(grpo)≈0.15` 讓 chat/general −2~3；`isReasoning=true`。R1-style 自製路線（§2.5）。

**部署數字（§4.8/§5.6/§5.7，只有 distill/merge/qat 動）**：derived 預設繼承 base 的 `paramsTotalB/paramsActiveB/isMoE/layers/kvHeads/headDim/attn`（R1）。`distill` 換 student base 的這些欄位（`qualityBy` 上限 = `min(teacher, student-capacity)`）；`qat` 把 `weightQuantBytes` 降（FP16→INT4=0.5，§5.6），`qualityBy −2`（§4.5 INT4 競爭力強但非無損）。**per-model QAT 與 serving 層 PTQ（`inf_wq_*`）區隔**（§2.7）。

### 1.5 內容（roster 更新 + balance 修正）

保留 16 個 roster 計算管線（用 §6.2 真值，欄位改 `paramsTotalB/paramsActiveB` + 新增 `layers/kvHeads/headDim/attn/alignment/instructFollow`）。

**16-roster 架構欄實值（v2 補齊，[fix L3]）**：KV 公式需 `layers/kvHeads/headDim/attn`。從各 model card 補；無一手值者標 `confidence:'low'` 並用同家族近似（UI tooltip 註記）。代表值（其餘按家族類推，content 子系統填齊）：

| 模型 | layers | kvHeads | headDim | attn | confidence | 來源 |
|---|---|---|---|---|---|---|
| Llama-3.3-70B | 80 | 8 | 128 | GQA | high | §5.6 範例 |
| Llama-3.1-8B | 32 | 8 | 128 | GQA | high | model card |
| Qwen3-235B-A22B | 94 | 4 | 128 | GQA | med | Qwen3 tech report |
| Qwen3-30B-A3B | 48 | 4 | 128 | GQA | med | Qwen3 tech report |
| Qwen3-32B | 64 | 8 | 128 | GQA | med | Qwen3 tech report |
| DeepSeek-V3.1 | 61 | (MLA) | (latent) | **MLA** | med | §4.6（KV 走 ×0.067 近似） |
| gpt-oss-120b | 36 | 8 | 64 | GQA | med | gpt-oss card |
| gpt-oss-20b | 24 | 8 | 64 | GQA | med | gpt-oss card |
| Gemma-3-27B | 62 | 16 | 128 | GQA | med | Gemma3 card |
| Phi-4-14B | 40 | 10 | 128 | GQA | med | Phi-4 card |
| Mistral-Small-24B | 40 | 8 | 128 | GQA | med | Mistral card |
| Kimi-K2 | 61 | (MLA) | (latent) | **MLA** | low | §6.5（DeepSeek 系架構） |
| GLM-4.5-Air | 46 | 8 | 128 | GQA | low | 近似 |
| Nemotron(見下) | — | — | — | — | — | §6.5 |

**三個 balance bug — 用 cost/calibration/serving 牆，並走對差異化維度：**

| bug | 根因 | v2 解法 |
|---|---|---|
| `qwen3_30b_a3b` OP | **[fix H2 — v1 修法與物理相反]** v1 想靠「吞不下量」，但 3.3B active 的小 MoE decode **最快**（§5.7 active 越小越快），serving 牆只會讓它更 OP。 | **走 agentic 維度**：`qwen3_30b_a3b` 的 `difficulty`/`qualityBy[agentic]` 依 §6.3 SWE-bench/τ²-bench **真實落後**（校準事實，非手編）。高 wave 的 `agent`/SWE 類請求（§2.4 primaryAxis=agentic、difficulty 高）成為它過不去的牆——答得快但答不對 agentic。**此為 P0 必解 balance 設計**，非 OQ。serving 牆仍保留（KV 與 batch budget），但差異化主力是 agentic capability gap。 |
| `deepseek_v31` 冗餘 | qualityBy 與 235B 飽和平手是事實（§6.4 知識題飽和） | 不刪（它是真的）；靠 `paramsActiveB 37>22` + `paramsTotalB 671` 需 SuperPod + 差異化 `context`/agentic 軸自然分層（OQ-G5）。 |
| `nemotron_ultra` trap | **[fix M3 — 純 tooltip 不算修復]** dense 253B 貴卻不強。 | **二選一（OQ-G26 拍板）**：(a) 換成 dossier §6.2.1 已驗證的 **Nemotron-3-Super-120B-A12B**（hybrid MoE，120B/12B active）——它有真實 active 優勢，自然不再是 trap；或 (b) 保留 dense 253B 但給它**唯一的真實差異化**：在未飽和 agentic/SWE 軸給 frontier 級 `qualityBy[agentic]`（§6.3「規模仍拉開差距」），使它成為「貴但 agentic 最強」的高端選擇而非陷阱。v2 預設**建議 (a)**（與已驗證 roster 一致）。 |

**內生安全/指令初值（手填，§OQ-G12）**：見 §3.4 的 `AlignmentProfile` roster 表 + `instructFollow`（base 變體≈25、instruct≈85）。

### 1.6 命名（derived id / 顯示名，§2.9）

id = `drv_{seq}`（`derivedSeq++`，序列化安全）。顯示名 `{baseShort}-{Target}-{Method}`（如 `Llama-3.3-70B-Reason-GRPO`、`Qwen3-30B-A3B-Agent-LoRA`）；merge = `{a}+{b}-Merge`。lineage 寫進 `ModelDef.lineage`（§7 型別）。

---

## 2. 請求 (Requests)

### 2.1 設計理念（§1.1、§1.2、§6.4）— 雙層分類（[fix H7]）

現況 8 型是純主題標籤，`work` 被臨時公式硬拆 prefill/decode。v2 改 **token-first**，並**顯式分兩層**：

- **工作負載物理軸（root-property，真正的 first principles，§1.2）**：`inputTokens`（→ prefill cost & TTFT）、`outputTokens`（→ decode cost & TPOT）、`contextLen`（KV）、`latClass`（SLO）、`prefixShare`（可快取性）、`hazards`（安全種子）。這些**正交描述工作負載物理**，是 Jacob 要的 root-property。
- **能力匹配軸（capability，必要的應用層映射，§6.4）**：`difficulty: Record<CapabilityAxis, number>` 對上 model `qualityBy[CapabilityAxis]` 決定「答對與否」。這層本質是「品質匹配」而非工作負載物理——v2 顯式承認並分離，不讓 `primaryAxis` 假裝是 root property。`CapabilityAxis` 值仍為 `chat/coding/reasoning/general/agentic`（能力分類非應用標籤；spawn 的應用主題僅是命名與圖示）。

per-axis `difficulty` 向量讓 §6.4 能力壓縮可玩（4B thinking 清得過 reasoning 線、清不過 **agentic** 線）。

### 2.2 資料模型

`RequestTypeDef` 改 token-native + per-axis 難度 + SLO 類別 + prefix 可快取 + hazards + **per-type 收入價格（[fix H4]）**（型別見 §7）。`Request` runtime 保留 prefill/decode 拆分結構，但以**真實 token** 為單位，新增 SLO 計時與 hazard 流程欄。`complexity` 欄位移除（[fix M2]），runtime 需要時由 `difficulty[primaryAxis]` 算。

### 2.3 公式（單位橋接 → 真實 roofline）— [fix C1] prefill 超線性歸 §6

requests 子系統**只提供 token，不定 serving 速率**（[fix C1] 消除「兩個子系統各算一半」）。prefill 超線性、decode batch 攤平、KV 動態全部由 **§6（脊椎）單一擁有**：

- **Prefill（compute-bound，∝ inputTokens，§1.1#63 O(n²) 超線性）**：requests 只給 `inputTokens`；§6.2 的 `prefillTokS(inputTokens)` 內含超線性因子。完成 → `prefillDoneAt` → 進 `ttftReal`（§0.4）。
- **Decode（bandwidth-bound，∝ outputTokens × KV，§1.1/§5.7）**：requests 只給 `outputTokens`；§6.2 的 `aggDecodeTokS` 隨 batch 線性攤平、per-user 速率推進。`tpotReal/e2elReal` 依 §0.4。
- **KV 佔用**：由 §6.2 的真實 §5.6 公式算，**seq 用動態 `contextLen`**（[fix H1]）。
- **Prefix-cache 命中（§1.2：命中率 60–85%、成本 5–12×、TTFT 79–85%）**：命中時 `prefill ×= (1 − prefixShare)`，decode 仍跑。embedding `prefixShare≈0`；agentic `prefixShare≈0.9`（§1.2 100:1）。
- **答對（per-axis，§6.3/§6.4）**：`correct = effQ ≥ difficulty[primaryAxis]`，`effQ = serverQualityVs(...) − contextGapPenalty − alignmentTax`（effects.ts 既有 + R3）。
- **context 硬門檻（§1.2#4）**：`contextLen > serverCtxWindow` → `unservable`。

### 2.4 內容（14 grounded archetype，§1.4 IETF + NVIDIA ISL/OSL）

退役舊 8 型，改 14 archetype（每列即一個 `RequestTypeDef`；token=§1.4 中位、difficulty[primaryAxis]=§6.3 band、ttft/tpot=§1.3/§1.4、**價格=§5.8 [fix H4]**）：

| id | name | ISL | OSL | primaryAxis | diff(主軸) | latClass | TTFT | TPOT | prefixShare | steps | hazards | $in/Mtok | $out/Mtok | §來源 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `embed` | Embedding | 16–8K | 0 | general | 30 | TO | — | — | 0 | 1 | — | 0.02 | 0 | §1.4 EMBED |
| `rerank` | Rerank | 128–1K | 1 | general | 35 | NR | 1.0s | — | 0.3 | 1 | — | 0.03 | 0.10 | §1.4 XRANK |
| `classify` | Classification | 32–2K | 1–10 | general | 40 | NR | 0.5s | 0.05 | 0.3 | 1 | — | 0.05 | 0.20 | §1.4 CLAS |
| `sfqa` | Short-QA | 16–512 | 5–100 | chat | 45 | IN | 0.3s | 0.04 | 0.2 | 1 | — | 0.06 | 0.30 | §1.4 SFQA |
| `func` | Function-calling | 512–4K | 20–200 | coding | 55 | NR | 0.8s | 0.05 | 0.6 | 1 | — | 0.20 | 0.80 | §1.4 FUNC |
| `chat` | Interactive-chat | 64–16K | 50–1K | chat | 50 | IN | 0.3s | 0.04 | 0.5 | 1 | — | 0.06 | 0.30 | §1.4 CHAT |
| `comp` | Code-completion | 256–8K | 5–200 | coding | 55 | IN | **0.15s** | 0.03 | 0.7 | 1 | — | 0.10 | 0.40 | §1.4 COMP |
| `rag` | RAG / Long-ctx QA | 528–128K | 16–1K | general | 55 | NR | 2.0s | 0.06 | 0.8 | 1 | — | 0.30 | 1.20 | §1.4 LDQA/RAGN |
| `summ` | Summarization | 1K–32K | 64–1K | general | 50 | NR | 3.0s | 0.06 | 0.3 | 1 | — | 0.20 | 0.80 | §1.4 SUMM |
| `cgen` | Content-gen | 32–1K | 256–8K | chat | 50 | NR | 1.0s | 0.05 | 0.1 | 1 | — | 0.10 | 1.50 | §1.4 CGEN |
| `reason` | Reasoning / long-CoT | 64–2K | **544–33K** | reasoning | 80 | NR | 2.0s | 0.06 | 0.2 | 1 | — | 0.50 | **18.0** | §1.4 REAS |
| `agent` | Agentic-loop | 512–16K↑ | 20–500/步 | **agentic** | **70** | TO+e2el | (步寬鬆) | 0.05 | **0.9** | 5 | inject:0.3 | 0.50 | **20.0** | §1.4 AGNT |
| `batch` | Batch / offline | 128–2K | 512–16K | general | 45 | TO | — | — | 0.1 | 1 | — | 0.08 | 0.30 | §1.4 DGEN |
| `jailbreak` | Adversarial | 64–2K | 50–500 | chat | 45 | NR | 0.5s | 0.05 | 0.1 | 1 | jailbreak:0.9 | 0.06 | 0.30 | §3.4 |

> **[fix H4 價格說明]**：`reason`/`agent` 賣前緣 output 價（$18–20/Mtok，§5.8「output $15–25/Mtok」）；`embed`/`chat`/`batch` 賣便宜（~$0.06/Mtok）。`marketPriceMul` 全域調節（§6.6）。
> **[fix L2 / H3 latClass]**：型別新增 `'E2EL'` 值（§7），`agent` 用 `latClass:'TO'` + `e2elSloMs`（agentic 跨步累積、各步寬鬆只看 E2EL，§1.3）。**TO class 不設 TTFT/TPOT 硬 SLO**（[fix H3]——v1 誤把 405B 長 context 的 6s/175ms 塞進 TO；TO=batch/offline「不在意延遲只看 TPS/$」§1.3）。`embed`(OSL=0) 不套 TPOT。

**舊 `bot`/`ent` 降為 modifier**（§1.5）：`bot` = `volumeBurst` 抽樣模式（interval 0.2–0.3s、token 抽分布低端）；`ent` = `tier:'priority'`（更嚴 SLO + 更高 reward + 更高 slaPenalty）。

**LEGACY_ALIAS 對照表（v2 補齊，[fix M7]）**：8 舊 id → 新 archetype(+modifier)，作為 P3a 與 P5 balance oracle 的契約。現碼 8 glyph（`? {} Σ ≡ ! $ : ⌖`）對應：

| 舊 id (glyph) | 舊語意 | → 新 archetype | + modifier |
|---|---|---|---|
| `chat` (`?`) | 聊天 | `chat` | — |
| `code` (`{}`) | 寫程式 | `comp` | — |
| `rag` (`Σ`) | 檢索 | `rag` | — |
| `reason` (`≡`) | 推理 | `reason` | — |
| `jail` (`!`) | 越獄 | `jailbreak` | — |
| `pay` (`$`) | 高價值/企業 | `chat` | `tier:'priority'` (ex-`ent`) |
| `stream` (`:`) | 串流長生成 | `cgen` | — |
| `bot` (`⌖`) | bot 洪流 | `sfqa` | `volumeBurst` |

> 各 archetype 經此表映射後，waves 改由 **100 波真實歷史 campaign** 驅動（`campaign-data.ts` 的 `WaveTheme` 主題表 → `campaign.ts` 的 `buildWave/buildCampaign` 展開成 `WaveDef`；難度曲線集中在 `campaign.ts` 的 `tier*` 旋鈕）。是一條「持續升難・淘汰賽」：tier 1→12 單調遞增，多數玩家中途陣亡，wave 100（*The Age of Inference*）為頂點，之後接 endless。波間 incident 由 `applyIncident`（`sim.ts`）真正生效（mods + instant + `concentrate` 單一入口暴增）。平衡 gate 改為「深度 + 系統使用」（`tests/playthrough.test.ts` `GAUNTLET_FLOOR`），非通關。

### 2.5 六終局（R9，統一 movement + combat + safety）

| 終局 | 條件 | 經濟 |
|---|---|---|
| `served` | correct ∧ slo_ok ∧ safe | 全額 reward + dataYield + Trust/SLA + |
| `slo_miss` | correct ∧ ¬slo_ok（effLatencyMs 超 class 門檻，§0.4） | 折扣 reward、扣 slaPenalty（Goodput：做了工不算數，§1.3） |
| `bad` | ¬correct（capability < difficulty，§6.4） | 仍計費但 −Trust |
| `unservable` | contextLen > window 或走到 core 未完 | leak：扣 SLA + Trust |
| `unsafe` | ∃ hazard 未清就服務/leak（§3） | −−Trust（safety 子系統） |
| `over_refused` | 良性請求被 over-aligned 模型或 guardrail 誤拒（§3.6） | 營收 0 + 扣 SLA + **輕度扣 Trust（[fix H5]）** |

> **[fix H5]** v1 讓 `over_refused` 不扣 Trust，削弱了 §3.1 safe-completion 的教學張力（玩家無理由偏好低 over-refusal）。v2 改為**輕度扣 Trust**（過度拒答良性使用者真實傷害口碑），使 §3.5「CAI/safe-completion 得 Pareto 改善」的動機成立。OQ-G14 保留嚴重度權衡。

### 2.6 Spawn 分布（§1.4 production 統計形態）

`inputTokens ~ LogNormal/Pareto`（肥尾）；`outputTokens ~ Exponential`。spawn.ts 依 `spawnDist` 用 seeded `s.rng` 抽 ISL/OSL。endless「token 通膨」（§1.4：prompt ~4×、completion ~3×）改成 `inputScale`/`outputScale` 分別作用於 lo/hi（取代舊 `contextMul`/`workMul`）。

---

## 3. 安全（兩層）(Safety — Two Layers)

### 3.1 設計理念（§3、§2.4）

現況三處與現實牴觸：(1) `saf_rlhf`/`saf_redteam` 被放 serving 科技樹當全域 buff；(2) red-teaming 被建模成「請求路徑減傷」；(3) Safety Gate 是單一同質建築用「清除率/秒」bleed off，抹掉 §3.3 最重要的真實對比（輕量 encoder 只看輸入 vs 昂貴 generative 完整推論）。此外 `safetyRisk` 是單一純量、無 over-refusal。

**兩層信條**：第一層 model-intrinsic（RLHF/CAI/safety-SFT/safe-completion）烤進權重、推論時 0 額外延遲、不可逐請求調（§3.7/§2.4）；第二層 external guardrails 在 request path 上、可逐請求開關調閾值，代價是疊加延遲+算力（§3.2/§3.3）。

### 3.2 第一層：`AlignmentProfile`（R3，掛 `ModelDef`）

由 §1 的 finetune method 寫入、calibrate 時計算、serve 時讀但**永不翻轉**（型別見 §7）。承擔 **alignment tax**（§2.4/§2.8/§3.6，單調扣 `qualityBy`）：
```
alignmentTax(m) = TAX_K[m.alignment.refusalStyle] × max(0, alignment.safety − 40) / 100
  TAX_K = { none: 0, 'hard-refusal': 9, 'safe-completion': 4 }    // §3.1 safe-completion 稅更低
```
> **worked example**：`safety=80, hard-refusal` → tax `9×(80−40)/100=−3.6`、over-refusal 0.14；`safety=80, safe-completion` → tax `4×0.4=−1.6`、over-refusal 0.03。

**第一層自處理（serve 時、0 延遲，§3.7）**：對請求每個 hazard `h`（severity `sev_h`）：
```
pSelfHandle(m,h) = clamp01( alignment.safety/100 − sev_h × HAZARD_HARDNESS[h] )
  HAZARD_HARDNESS = { jailbreak:0.35, injection:0.55, harmful:0.20, pii:0.30 }  // §3.4 injection 最難擋
```
判定可機率（`s.rng`）或 deterministic 門檻（OQ-G15）。**第一層 over-refusal**：良性請求以 `P=alignment.overRefusal` 被誤拒 → `over_refused`（§2.5）。

### 3.3 第二層：guardrail 建築家族（取代單一 Safety Gate）

`TowerKind` 的 `'safety'`→`'guardrail'`；`TOWER_DEFS.safety`（1 棟）→ 3 棟（型別 `GuardrailSpec` 見 §7）。延遲依 §0.4 歸入對應 SLO 分量（input→TTFT、output→E2EL）：

| 建築 | archetype | checkLatencyMs | computeMode（[fix M8]） | side | catches | baseRecall | §ref |
|---|---|---|---|---|---|---|---|
| `guard_encoder` | encoder (Prompt Guard 86M) | **92** (固定，§3.3 量測值；BERT 單次前向毫秒級，非 §6 roofline) | ~0 算力（不佔 rack KV/watt） | input | jailbreak, injection | 0.975 | §3.3/§3.7 |
| `guard_llm` | generative (Llama Guard 4 12B) | **真實推論時間（[fix M8]）** | **走 §6 roofline**：用 12B paramsActive 算自己的 prefill+decode，**佔 rack 算力/KV/watt，與主模型爭 batch budget** | both | jailbreak, injection, harmful, pii | 0.92 | §3.3/§3.7 |
| `guard_mod` | moderation (OpenAI omni) | **~120** (固定，廠商託管) | 0（不吃你的 rack） | both | harmful, pii | 0.88 | §3.3/§3.7 |

> **[fix M8 — generative guardrail 接上 roofline]**：v1 給 `guard_llm` 固定 280ms 魔法數，與「the numbers are real」矛盾。v2：`guard_llm` 是一次完整（雖較短）的 12B LLM 推論（§3.3/§3.7「等同一次完整推論、成本高出一到兩個數量級」）——它跑 §6.2 的 roofline、佔 KV 與 watt、與主模型**爭用同一 rack 的 batch budget**（或佔獨立 tile，OQ-G16），延遲 = 真實推論時間（依其 hardware/負載動態），不是固定常數。這讓「encoder 毫秒 vs generative 完整推論」的兩個數量級差距在數值上真實成立——§3.3「模擬器中最重要的真實對比」。

**閾值 → recall vs over-refusal（§3.6 no-free-lunch，XSTest）**：
```
effRecall(g)  = clamp01( g.baseRecall × (0.6 + 0.8 × threshold) )    // threshold↑ 抓更多
overRefuse(g) = OVERREF_K[archetype] × threshold²                     // 但誤擋良性凸成長
  OVERREF_K = { encoder:0.06, generative:0.10, moderation:0.05 }
```
> **worked example（86M encoder, baseRecall 0.975）**：`threshold=0.5` → effRecall 0.975、over-refuse 1.5%；`threshold=1.0` → effRecall clamp 1.0、over-refuse 6%（§3.6）。

### 3.4 整體判決（§3.7 第 1 點：第一層 OR 第二層）

```
handled iff ∀ h ∈ request.hazards : (第一層 pSelfHandle) ∨ (第二層某 guardrail 清除)
unsafe breach ⇔ ∃ h 未清就抵達 core
over_refused ⇔ 良性被第一層或第二層誤拒（lost, not breach；輕扣 Trust §2.5）
```

**第一層 roster（手填，grounded §3.1，OQ-G12）**：

| model | refusalStyle | safety | overRefusal | instructFollow | 依據 |
|---|---|---|---|---|---|
| llama31_8b/llama33_70b | hard-refusal | 62 | 0.13 | 85 | Meta 安全 SFT |
| qwen3_* | hard-refusal | 58 | 0.12 | 84 | Qwen 對齊 |
| gptoss_20b/120b | **safe-completion** | 84 | 0.03 | 86 | §3.1 OpenAI 家族 |
| gemma3_27b | hard-refusal | 70 | 0.15 | 88 | Google 偏保守 |
| phi4_14b/mistral_*/devstral | hard-refusal | 55 | 0.10 | 80 | 一般 instruct |
| glm45_air/deepseek_v31/kimi_k2 | hard-refusal | 60 | 0.11 | 83 | frontier instruct |
| nemotron(見 §1.5) | hard-refusal | 64 | 0.12 | 84 | NVIDIA Llama-based |
| base 變體 | none | 15–30 | 0.02–0.05 | 25 | §3.1 安全是 post-train 才有 |

### 3.5 第一層取得：RLHF/CAI/safety-SFT 進 finetune（§1 method）

由 §1 的 method 寫入 `AlignmentProfile`：Safety-SFT → safety+20/hard-refusal/overRefusal+0.05；RLHF → safety+28/hard-refusal（最高稅）；CAI → safety+26/**safe-completion**/overRefusal−0.04（低稅）；Safe-completion 訓練 → refusalStyle→safe-completion。玩家做 RLHF 得高安全高誤拒高能力稅；做 CAI/safe-completion 得 Pareto 改善（教 §2.4+§3.1）。

### 3.6 dev-time red-teaming（一次性 eval，非 serving 旋鈕，§3.5/§3.7）

從 `spawnRiskMult`（讓敵人變弱，錯誤）改為 Lab 一次性 eval（`r_eval_redteam_v1/v2`）。**主效果（[fix M4]）= §3.6 的真實校準**：**降 over-refusal 凸度**（`OVERREF_K ×0.7`，XSTest 教系統靠意圖而非關鍵字判斷）+ **解鎖 `injection`/`pii` 類別偵測**。recall 提升若保留，明示為「校準閾值而非提升模型本身」（次要、小幅 `+0.02`），不再把全域 recall buff 當主效果。

---

## 4. 科技樹（基礎建設）(Tech Tree — Infrastructure / Serving ONLY)

### 4.1 設計理念（§4、§2.10）

範圍宣告：本樹**只放 serving/infra 層**（runtime/scheduler/memory/parallelism/routing；不改權重）。所有 post-training 移出歸 §1/§3。所有模型架構屬性（GQA/MQA/MLA/MoE 稀疏度/kv_heads）屬 model，不是樹節點（§4.6/§4.8）。

現況四個結構性錯誤：(1) RESEARCH 與 UPGRADES 混在 `s.upgrades` → R6 拆 `s.infra`；(2) tech 樹混入 model-capability 與 post-training → 移走；(3) GQA/MLA 被當 tech 節點（`r_tech_gqa` 全域 `×0.4` 反現實）→ 移到 model 屬性（R4）；(4) 真實 serving 鏈不完整且效果未量化對齊。

### 4.2 資料模型（`InfraState` + `InfraNodeDef`）

把所有 infra 開關集中到 typed `s.infra: InfraState`（R6，型別見 §7），與花現金買的 UPGRADES 分離。`completeResearch` 的 tech 分支改呼 `applyInfraEffects(s, def.effects)`。

### 4.3 公式（§4 真實 anchor，接 §6 的 effects getter）

所有公式改寫 §6 的 effects getter 資料源（`s.upgrades` → `s.infra` + model 屬性）：

- **Continuous batching（§4.1）**：`targets = batch===false ? 1 : min(hw.targets, KV-budget-bound batch)`；2–4× 由 batch 從 1 變多自然湧現，**不寫死乘數**。multi-step `+0.28 throughput`、async `−0.087 TPOT`（§4.1）。
- **PagedAttention → prefix → KV-quant → offload（§4.2）**：`kvUtilization 0.30→0.96`（paged）；`prefixHitCeil 0→0.85`；KV `quantBytes 2→1→0.5`（FP8/INT4）。
- **Chunked ⟂ Disagg（§4.3，互斥）**：`prefillShare = disagg&role ? (prefill?1:0) : chunked&decode>0 ? 0.35 : 1`；`disaggRoleMul = prefill?1.5 : decode?1.25 : 1`。
- **Speculative decoding（§4.4，batch 依賴）**：`specMul = batch≤1?2.0 : ≤4?1.7 : ≤16?1.66 : <32?lerp→1.0 : 1.0`（§4.4 EAGLE-3.1 實測；batch≥32 失效）；`+0.08 power`。賣點：低 batch 前哨 rack 2× 神器、滿載核心 rack 無用（教 §4.4「batch≥32 關掉」）。
- **PTQ weight quant（§4.5+§2.7，[fix C3 接上 roofline]）**：`s.infra.weightQuantBytes 2→1→0.5` **唯一作用於 §6.2 的 `bytesPerParam`**——影響 **VRAM** 與 **decode 頻寬項**（`2×activeB×bytesPerParam`），但 **W4A16 的 compute roof 不變**（§4.5「W4A16 只省記憶體、算時還原高精度」）。INT4 另扣 `qualityBy −2`。NVFP4 需 Blackwell rack。不再用懸空的 `flopsPerWork×1.0/bandwidthPerWork×0.8`。
- **Parallelism（§4.7）**：TP `+3× prefillRoof`（需 NVLink）、PP `×podSize effectiveMemory`、DP `×replica throughput`、EP `MoE 必需`。
- **Routing/multi-LoRA/engine（§4.10/§4.9）**：`kvAwareRouting 2×`；`loraSlots 2000`（S-LoRA）；`engineMul [1.0,1.10,1.25]`（vLLM/SGLang/TRT-LLM）。

### 4.4 內容（22 個節點，9 分類）

22 個 `InfraNodeDef`（id/category/requires/conflicts/effects/data/compute/optimizes 全表沿用子系統設計 §d，沿用現有 research 引擎尺度）。關鍵前置鏈：`inf_batching` 是一切之根；`inf_paged` 是 KV 一切之根；`inf_prefix` 需 paged；`inf_disagg` 需 parallelism、`conflicts:['inf_chunked']`（硬互斥，§4.3，OQ-G18 建議硬）；`inf_par_ep` 需 TP；`inf_wq_nvfp4` 需 Blackwell rack。

**UI 標記**：每節點顯示 `coupling`（pure-infra / infra×model）、`optimizes`（latency/throughput/memory/cost）、`sourceRef`（§ref tooltip）。修「research-node i18n missing」（新增 `i18nKey`）。

### 4.5 研究排程：多軌（v2 新增，[fix C7 — 地基阻塞]）

> **批評 C7 指出**：現碼 `s.research` 是**單槽**（`research.ts:33`「one training run at a time」）。v2 要 (a) infra 研究、(b) per-model post-training（UNLIMITED 衍生）、(c) red-team eval 全走 requisition；若共用單槽 → 「想微調就不能升 infra」嚴重排隊、UNLIMITED 衍生變序列化地獄。這是 dependency-correct 的前置，**上提到 P0.5/P1，不留 P3**。

**裁決**：`s.research` 由單槽改為**多軌 typed**：
```
s.research: { infra: ResearchSlot | null; posttrain: ResearchSlot | null; eval: ResearchSlot | null }
```
三軌**獨立佔槽**（infra 升級、post-training run、eval 各一槽，可同時進行）；三軌**共享同一個 requisition 算力池**（`RESEARCH_MAX_SHARE` 仍上限艦隊算力，避免 serving 全停），按各 slot 的 `compute` 需求**比例分配**算力。UNLIMITED 衍生：post-train 軌完成即釋放、可立刻排下一個（佇列，不阻塞 infra）。`effort` 滑桿（§1.4）是 post-train 軌的 runtime 參數。

---

## 5. UI / UX (Expert Mode)

### 5.1 設計理念（§0、§1.3、§5、§6）

三個致命缺陷：(1) 單字母 glyph 與縮寫無法閱讀；真實 SRE 用 TTFT/TPOT/Goodput/$/Mtoken/tok/s。(2) 面板太小塞不下 §5.2 真實 GPU 規格與 roofline 雙軸。(3) 沒有 model overview / lineage。

**原則**：每個數字配名稱配單位；**Goodput 才是主視覺**（§0#4/§1.3）；**roofline 雙軸恆並列**（§0#8/§5.7）；**MoE total/active 永遠雙寫**（§0#10/§6.1）；冷卻分界用真實閾值上色（§0#12/§5.5）。

### 5.2 九個表面（surface）

常駐層：S1 TopBar（強化 HUD）、S2 LiveOpsStrip（wave 中 Goodput gauge+RPS+p95+$/Mtoken+KV）、S3 RackInspect（W=360 四卡片：HARDWARE/DEPLOYED MODEL/ROOFLINE/LIVE）、S4 RequestInspector、S5 WaveReport、S6 BuildBar。模態層：S7 ModelOverview（全 checkpoint 表格 + 篩選/排序 + detail card）、S8 LineageGraph（`base→instruct→reasoning/distill→FT/merge→quantized` DAG）、S9 TechLab（Upgrades + Method R&D，按 9 個 InfraCategory + post-training studio，含 effort 五檔滑桿 §1.4）。

### 5.3 消滅單字母

Request 圖示：board 上雙層（外框 type 色 + 中央 vector primitive + 頭頂 micro-label），`textures.ts request()` 依新欄位 `icon` 畫 primitive。`glyph` 保留向後相容但不單獨顯示。統計縮寫 → 全名+單位+tooltip（共用 `metric.*` i18n 群組 + 新 `ui/tooltip.ts` 單例，hover 800ms 顯示含 §ref 與公式）。

### 5.4 圖表

Roofline 雙 bar（prefill compute vs decode bandwidth，標 binding，S3）；VRAM 佔用條（weights+KV+headroom，§5.6）；per-axis quality sparkbars（5 條，**agentic 軸醒目標示**因其最具鑑別力 §6.4）；Goodput gauge（S2/S5 頭條，§1.3）；$/Mtoken 折線（S5，§5.8，util<30% 標紅 ×10）；Power vs Cooling headroom（S1，紅閾線 §5.5）；utilization 折線（S2）。

### 5.5 UI 計算層（不改 sim）

新檔 `ui/metrics.ts` 純讀 GameState + effects，算 TTFT/TPOT/$/Mtoken/sparsity/bound，**用 §0.4 的 `effLatencyMs`**（並發攤平後等效延遲，與 sim 判定一致）。公式（worked example 全與 §6 一致）：
- decode tok/s(b=1) = `HBM_BW / (2×active_params×bytes)`（H100/70B FP16 → ~12 tok/s，§5.7）。
- `$/Mtoken = ($/GPU-hr×3600)/(aggTokS×1e6)`（$3/hr、500 tok/s、100% util → $1.67/Mtoken，§5.8）。
- Goodput = 同時滿足 `TTFT≤SLO ∧ E2EL≤SLO` 的請求率（升級 `ttftAttainPct`，telemetry 加 `e2elAttainPct`）。

新檔：`ui/metrics.ts`、`ui/tooltip.ts`、`ui/modelOverview.ts`(S7+S8)、`ui/requestInspector.ts`(S4)、`ui/liveOps.ts`(S2)、`ui/charts.ts`。所有新表面只在 `isExpert()` 顯示（Normal hook 全標）。

### 5.6 lineage 必填（[fix H6]）

Jacob 明確要「lineage you can actually see」。v1 把 `baseModelId/relation` 降為 optional + OQ，需求未保證滿足。**v2 裁決：填齊 16-roster 的 `real.baseModelId/real.relation` 是 P3b/content 的必做驗收項**（dossier §6.5 已提供具體關係：R1-Distill-Qwen/Llama 基於 Qwen2.5/Llama；Magistral 基於 Mistral-Small-3.1；Llama-Nemotron 基於 Llama）。derived 模型的 lineage 由機制自動產生（已 OK）；base roster 的真實血統手填齊全 → S8 必有實質內容，不退化為扁平清單。

---

## 6. 核心模擬與經濟 (Core Sim & Economics) — 脊椎

### 6.1 設計理念（§5、§1.1、§5.8）

現況「方向對、單位假」：prefill/decode 雙 roof 結構正確，但 `flops` 是抽象 120–3500、`flopsPerWork`/`bandwidthPerWork` 是無單位 work points、`kvCostGb=0.18×ctx` 編造、`TTFT_SLO=8` 硬編、`powerDraw 2–26` 非真實 watt、reward 是手調點數。

**策略「real layer + presentation rescale」（[fix C5/M10]，見 §0.4）**：所有數字以真實單位計算；SLO 在 **real-s 軸用 `effLatencyMs`** 判定（並發攤平）；`SIM_TIME_SCALE` 只壓**視覺步調**。只壓視覺時間軸、不改任何比例。

### 6.2 真實 roofline（§5.6/§5.7）— v2 物理修正 C1/C2/C3

每 rack 每 tick 算兩個真實 roof。**[fix C3] quant 作用點明確**：`bytesPerParam` 由 `s.infra.weightQuantBytes`（PTQ）或 model 的 qat（per-model）決定，**只影響 VRAM + decode 頻寬項**。

**decode（bandwidth-bound，b=1 上限，§5.7）**：
```
bytesPerParam = s.infra.weightQuantBytes (or model.weightBytes)          // 2 | 1 | 0.5, §5.6
decodeTokS_b1 = hbmBytesPerSec / (2 × paramsActiveB×1e9 × bytesPerParam) // §5.7
```

**[fix C1] prefill（compute-bound GEMM，超線性，§1.1#63）**：v1 用常數 `prefillTokS = aggTflops/(2×activeB)`，與 prompt 長度無關、且把 decode 式的 `2×active` 拿來當 prefill GEMM 速率。v2：prefill 是 compute-bound GEMM（利用率 90–95%，§0#1），per-token FLOPs 在長 context 下 **> 2×active**（O(n²) attention）：
```
superlinear(n) = 1 + n / 16000                                           // O(n²) attention, §1.1#63
prefillTokS(inputTokens) = aggTflops×1e12 / (2 × paramsActiveB×1e9 × superlinear(inputTokens))
prefillTimeSec = inputTokens × (1 − prefixShare) / prefillTokS(inputTokens)   // prefix cache 命中省 §1.2
```
> prefill per-token FLOPs 在長 prompt 下高於 `2×active`——明標引 §1.1#63。`superlinear` 與 KV 同源於 seq，由 §6 單一擁有（requests 只給 `inputTokens`，[fix C1]）。

**[fix C2] decode 聚合吞吐（batch 線性攤平至 compute roof，§5.7#841）**：v1 的 `min(decodeTokS_b1 × batchEfficiency, prefillTokS)` 方向錯（per-user vs aggregate 不明、用 prefillTokS 當上限無物理依據）。v2：**聚合吞吐隨 batch 線性上升，直到撞 compute roof**（§5.7「提高 batch 把瓶頸推向算力，總吞吐隨 batch 上升直到受 compute 或 KV 限制」）：
```
computeRoofTokS = aggTflops×1e12 / (2 × paramsActiveB×1e9)               // batch 大到 compute-bound 的天花板
aggDecodeTokS   = min(decodeTokS_b1 × batch, computeRoofTokS)            // 線性攤平 → compute roof 夾頂
perUserDecodeTokS = aggDecodeTokS / batch                                // §5.7 TPS per user, 餵 §0.4 tpotReal
```
`batch` 由 §6.2 後半的 KV budget 決定（不是抽象 `batchEfficiency`）；`prefillTokS` 不再夾擠 decode。

> **worked example（H100×1, Llama-3.3-70B dense FP16）**：`decodeTokS_b1 = 3.35e12/(2×70e9×2) ≈ 11.96 tok/s`（§5.7 ~12 ✓）；`computeRoofTokS = 989e12/(2×70e9) ≈ 7064 tok/s`；batch 64 → `aggDecodeTokS = min(11.96×64=765, 7064) = 765 tok/s`（量級對齊 §5.7 SGLang batch64 ~460 的同數量級，差距為利用率/開銷，方向正確）；perUser = 765/64 ≈ 12 tok/s。
> **worked example（H100×1, gpt-oss-120b MoE 5.1B active FP8）**：`decodeTokS_b1 = 3.35e12/(2×5.1e9×1) ≈ 328 tok/s`。權重 ~117GB FP8 裝不進 80GB（需 pod），但 decode 比 dense 70B 快 ~27×（§4.8/§6.1 解耦）。

**continuous batching + KV budget（§4.1/§5.6，[fix H1] seq 動態）**：
```
kvFreeGb   = (hbmGb − weightGb − FRAMEWORK_GB) × kvUtilization(s)        // §5.6
kvPerReqGb(contextLen) = (2×layers×kvHeads×headDim×contextLen×bytesElem)/1e9   // §5.6, MLA: ×0.067 (R4/M5)
maxBatch   = floor(kvFreeGb / mean(kvPerReqGb over in-flight))           // 每 tick 重算, [fix H1]
```
> **[fix H1] seq 動態**：`contextLen = inputTokens + 已生成 outputTokens`（R2 derived），逐 token 成長 → `maxBatch` **每 tick 重算**（沿用現碼 combat.ts KV admission loop 骨架）。長 OSL 的 `reason`（544–33K）在生成過程中 KV 漲爆 → batch 動態收縮到個位數（§5.6「長 context 把並發壓到個位數」真相）。
> **worked example（H100 80GB, 70B FP8, contextLen 8K）**：`kvPerReq=2×80×8×128×8192×1/1e9 ≈ 1.34GB`（每 token ≈0.16MB FP8，§5.6 FP16 0.32MB 的半 ✓）；FP8 權重 70GB → `kvFreeGb≈(80−70−1.5)×0.96≈8.2GB` → `maxBatch≈6`。context 增長到 16K → kvPerReq 翻倍 → maxBatch 掉到 ~3。

### 6.3 硬體 + 模型資料模型（R1/R4/R5，真實單位）

`ServerHardwareDef` 改真實 per-GPU 規格 ×rack GPU 數（`gpus/fp8TflopsPerGpu/bf16TflopsPerGpu/hbmGbPerGpu/hbmTbsPerGpu/tdpWattsPerGpu/cooling/capexUsd`，aggregate derived at load，§5.2–5.5；型別見 §7）。`ModelDef` 移除 `flopsPerWork/bandwidthPerWork/memoryGb`（改 derived），新增 `layers/kvHeads/headDim/attn/weightBytes`（餵 KV/quant 公式，§5.6）。

**rack→GPU 對映（OQ-G4，P0 確認）**：一個 board tile 代表的 GPU 數由 `ServerHardwareDef.gpus` 顯式定義（edge=1 卡、giga/NVL72=72 卡），aggregate 規格 = perGpu × gpus。

### 6.4 SLO + leak（§1.3，[fix C5/H3] 在 real-s 軸用 effLatencyMs 判定）

```
ttftReal/tpotReal/e2elReal 依 §0.4 (並發攤平 + guardrail 歸屬)
effLatencyMs = real-s × 1000  與真實 ms 門檻比較
LAT_CLASS_SLO = {
  IN: { ttftMs:400,  tpotMs:40  },     // §1.3 MLPerf Interactive
  NR: { ttftMs:2000, tpotMs:200 },     // §1.3 Conversational
  TO: { /* 無 TTFT/TPOT 硬 SLO */ },    // [fix H3] batch/offline 只看 TPS/$, §1.3
}
```
per-type override：`comp.ttftSloMs:200`（§1.3 最嚴）、`agent.e2elSloMs`（latClass TO + E2EL 門檻，[fix L2]）、`reason` 走 NR（§1.4 REAS latClass NR，非 v1 誤標 TO）。六終局（R9，§2.5）；`Goodput = 同時滿足 TTFT∧E2EL 門檻的服務率`（§1.3），驅動 SLA meter。movement.ts 在途中即 latch `sloViolated`（用 real-s 累積，不必等抵 core）。

> **[fix H3] 405B 長 context 的 6s/175ms** 不再塞進 TO；若日後加 405B 長 ctx archetype，用 NR + per-type override `ttftSloMs:6000`，與 §1.3 表一致。

### 6.5 電力/冷卻（真實 watt，§5.5）

`rackWatts = tdpWattsPerGpu × gpus × utilizationFactor`（H100 700W、B200 ~1000W、GB200 1200W、NVL72 ~120kW）。冷卻硬約束：`tdpWattsPerGpu > 1000 → require cooling==='liquid'`（液冷 rack gate 在已建液冷設施，否則不可放置——§5.5 物理硬約束，OQ-G8 硬 gate vs 軟 throttle）。throttle 真實化：prefill 全打擊、decode 幾乎不受（§Splitwise `decodeThrottle` 既有）。

### 6.6 經濟（真實 $/Mtoken，§5.8）— [fix H4] cache 經濟修正

**收入**：`revenue$ = (inputTokens×pricePerMtokIn + outputTokens×pricePerMtokOut)/1e6 × marketPriceMul`（§5.8；§2.4 已補齊 14×2 價格欄）。
**cache 經濟（[fix H4]）**：v1 混淆「成本降 5–12×」與「利潤 5–12×」。v2 對齊 §1.2：prefix cache 命中**省的是你的 prefill compute 成本**（少算 token → 少 gpu-hr/電）；收入端是否折讓由計價模型決定——v2 採 §1.2 的 Anthropic 慣例「**cache 讀取收 1/10 input 價**」：命中時 `pricePerMtokIn 的命中部分 ×0.1`。淨效果是真實利潤改善（省成本 > 降收入），但**不是**直接「利潤 ×5–12」。
**成本**：`(gpuHrCost + capexAmort + powerCost + coolingCost) × dt`，取代單一 powerBill（§5.8）。
**利用率經濟（§5.8 致命）**：`utilization = servedTokS / theoreticalMaxTokS`（rolling）；固定成本按 wall-clock、收入按服務 token → 閒置 rack 燒 capex/gpu-hr → 單位成本爆炸（10% 負載 ×10，OQ-G7 強度可軟化）。
**勝負**：lose = `cash<0`（破產，閾值依 §0.4 cash 單位）/ `trust≤0` / `sla≤0`；win = campaign boss wave / endless 無上限。

### 6.7 統一 step() 順序

```
1. updatePower(s)        // 真實 watt：cap、brownout、throttle、冷卻分界 (§6.5)
2. updateResearch(s,dt)  // 多軌 (infra/posttrain/eval) 共享算力池 (§4.5/[fix C7])
3. updateSpawns(s,dt)    // 真實 token 抽樣 (§2.6)
4. updateCombat(s,dt)    // roofline (超線性 prefill + batch 線性 decode) + KV budget(動態 seq) + SLO-aware sched + guardrail(含 guard_llm roofline) (§6.2/§3)
5. updateMovement(s,dt)  // 流動 + SLO-violation latch(real-s) + hard leak (§6.4)
6. updateSLO(s,dt)       // 結算 goodput(effLatencyMs)、SLA (§6.4)
7. updateEconomy(s,dt)   // 真實收入(cache 1/10 讀價) − capex/gpu-hr/電/冷卻；算 utilization (§6.6)
8. prune/peak/utilization rolling
9. lose-check (§6.6)
10. clearWave if done
```

---

## 7. 統一資料模型 (Unified Data Model — 所有 TS 型別集中於此)

> 以下是 v2 權威型別（已套用 R1–R10 裁決 + C/H/M/L 修正）。

```ts
// ====== core/types.ts ======

export type ServerSpec = 'general' | 'chat' | 'coding' | 'reasoning' | 'agentic'
export type CapabilityAxis = ServerSpec          // [fix H7/M1] 能力匹配軸的權威名稱 (值同 ServerSpec)
export type LatencyClass = 'IN' | 'NR' | 'TO' | 'E2EL'   // [fix L2] 補 E2EL (agentic)
export type AttnVariant = 'MHA' | 'MQA' | 'GQA' | 'MLA'   // §4.6
export type SafetyHazard = 'jailbreak' | 'injection' | 'harmful' | 'pii'   // §3.4
export type SafetyProfile = Partial<Record<SafetyHazard, number>>          // hazard→severity 0..1

// ---- 後訓練 (§1) ----
export type PostTrainMethod =
  | 'cpt' | 'sft' | 'lora' | 'qlora' | 'dora' | 'dpo'
  | 'rlhf' | 'cai' | 'grpo' | 'distill' | 'merge' | 'qat'
export type PostTrainTarget =
  | 'chat' | 'coding' | 'reasoning' | 'general' | 'agentic'
  | 'safety' | 'longctx' | 'domain'
export type LineageRelation = 'finetune' | 'quantized' | 'adapter' | 'merge'   // §2.9/§6.5

export interface MethodRecipe {
  id: PostTrainMethod; name: string; relation: LineageRelation
  allowedTargets: PostTrainTarget[]
  costData: number; costCompute: number          // §1.3 cost table (autoplay-calibratable)
  gainScale: number; gainCap: number; taxScale: number; forgetScale: number   // [fix C4] calibratable
  reshapesDeployment: boolean; requiresTech?: string; desc: string
}
export interface Lineage {
  baseModelIds: string[]; relation: LineageRelation
  method: PostTrainMethod; target: PostTrainTarget; effort: number
  spent: { data: number; compute: number; waves: number }
  depth: number; createdAtWave: number           // [fix C4] depth 進 deriveQuality 衰減
}

// ---- 第一層安全 (§3, R3) ----
export interface AlignmentProfile {
  safety: number                                  // 0..100 (was intrinsicSafety)
  refusalStyle: 'none' | 'hard-refusal' | 'safe-completion'   // §3.1
  overRefusal: number                             // 0..1  (唯一真相, [fix L1])
}

// ---- 模型 (R1/R4/R5) ----
export type ModelVariant = 'base' | 'instruct' | 'coding'
export interface ModelDef {
  id: string; name: string
  tier: 'small' | 'general' | 'coding' | 'frontier'
  variant: ModelVariant; spec: CapabilityAxis     // [fix M1] CapabilityAxis 命名
  origin: 'base' | 'derived'                      // §1.1
  paramsTotalB: number                            // VRAM basis, §5.6 (was paramsB)
  paramsActiveB: number                           // compute/decode basis, §4.8
  isMoE: boolean; isReasoning: boolean
  // --- 架構 (餵真實 KV 公式, §5.6/§4.6) ---
  layers: number; kvHeads: number; headDim: number; attn: AttnVariant
  weightBytes: 2 | 1 | 0.5                         // per-model bytes/param (qat 改; default 2/FP16→FP8) [fix C3]
  // kvShrink 為 derived (MLA ×0.067; GQA/MQA 由低 kvHeads 反映)
  // --- 能力 ---
  quality: number; qualityBy: Record<CapabilityAxis, number>   // calibrated, §1.4 + §6.3 映射
  context: number                                 // long-ctx 分數 0..100
  // --- 內生狀態 (§3) ---
  alignment: AlignmentProfile; instructFollow: number          // [fix L1] 無獨立 overRefusal
  desc: string
  lineage?: Lineage                               // origin==='derived' 必填
  real?: RealModelMeta
}
export interface RealModelMeta {                  // display-only, sim 不讀
  developer: string; license: string; openWeights: boolean; released: string
  contextWindowK: number; benchmarks: { mmluPro?: number; gpqaDiamond?: number
    liveCodeBench?: number; sweBench?: number; aime?: number; humanEval?: number; longContext?: number }
  confidence: 'high' | 'medium' | 'low'; source: string
  baseModelId?: string; relation?: LineageRelation   // §6.5 lineage 邊 (UI S8) — 16-roster 必填 [fix H6]
}

// ---- 硬體 (R5, 真實單位 §5.2–5.8) ----
export interface ServerHardwareDef {
  id: string; name: string
  gpus: number                                    // tile→GPU 對映 (OQ-G4)
  fp8TflopsPerGpu: number; bf16TflopsPerGpu: number
  hbmGbPerGpu: number; hbmTbsPerGpu: number; tdpWattsPerGpu: number
  cooling: 'air' | 'liquid'; capexUsd: number
  cost: number; range: number; color: number; accent: number; desc: string
  gpuModel?: string                               // "H100-class" (UI S3, §5.2)
  // derived at load: fp8Tflops/bf16Tflops/hbmGb/hbmTbs/tdpWatts = perGpu × gpus
}

// ---- 請求 (R2/R8, token-native §1.2/§1.4) ----
export type RequestIconKind =                      // [fix L5] union literal (型別安全)
  | 'embed' | 'rerank' | 'classify' | 'sfqa' | 'func' | 'chat' | 'comp'
  | 'rag' | 'summ' | 'cgen' | 'reason' | 'agent' | 'batch' | 'jailbreak'
export interface RequestTypeDef {
  id: string; name: string; glyph: string; icon: RequestIconKind; color: number
  inputTokens: number; outputTokens: number       // ISL/OSL, §1.4
  spawnDist?: { input: { kind:'lognormal'|'pareto'|'fixed'; lo:number; hi:number }
                output: { kind:'exponential'|'fixed'; lo:number; hi:number } }
  difficulty: Partial<Record<CapabilityAxis, number>>  // per-axis, §6.3 (R8) — 唯一難度真相
  primaryAxis: CapabilityAxis                      // (was affinity) [fix M1]
  // complexity 已移除 [fix M2]: runtime = difficulty[primaryAxis]
  latClass: LatencyClass
  ttftSloMs?: number; tpotSloMs?: number; e2elSloMs?: number    // §1.3 override (agent 用 e2elSloMs)
  steps: number; toolUse: boolean; structured: boolean
  prefixShare: number; cacheable: boolean         // §1.2#10
  hazards?: SafetyProfile                          // §3.4
  pricePerMtokIn: number; pricePerMtokOut: number // §5.8 收入 [fix H4]
  trustPenalty: number; slaPenalty: number; dataYield: number; desc: string
}

// ---- infra 狀態 (R6, §4) ----
export interface InfraState {
  scheduling: { batch: boolean; multiStep: number; chunked: boolean }
  kv: { utilization: number; prefixHitCeil: number; quantBytes: number; offloadGb: number }
  disagg: boolean
  spec: { enabled: boolean; level: number }
  weightQuantBytes: 2 | 1 | 0.5                    // PTQ; 作用於 §6.2 bytesPerParam [fix C3]
  par: { tp: boolean; pp: boolean; dp: boolean; ep: boolean }
  routing: { kvAware: boolean }; loraSlots: number; engineTier: 0 | 1 | 2
}
export type InfraCategory = 'scheduling'|'kv-memory'|'architecture'|'decoding'
  |'weight-quant'|'parallelism'|'routing'|'multi-lora'|'engine'
export interface InfraNodeDef {
  id: string; category: InfraCategory; name: string; i18nKey: string
  effects: Partial<Record<string, number>>; level: number
  requires: string[]; conflicts?: string[]
  dataCost: number; compute: number
  optimizes: ('latency'|'throughput'|'memory'|'cost')[]
  coupling: 'pure-infra' | 'infra-model'; sourceRef: string
}

// ---- guardrail (§3) ----
export type TowerKind = 'server'|'router'|'cache'|'guardrail'|'power'|'cooling'|'lab'
export type GuardrailArchetype = 'encoder' | 'generative' | 'moderation'
export interface GuardrailSpec {
  archetype: GuardrailArchetype; side: 'input'|'output'|'both'
  catches: SafetyHazard[]
  checkLatencyMs?: number                          // 固定 (encoder/moderation); generative 走 roofline [fix M8]
  runsOnRoofline: boolean                          // true → guard_llm: 佔 rack KV/watt/batch [fix M8]
  guardParamsActiveB?: number                      // generative 的推論成本基礎 (12B) [fix M8]
  baseRecall: number
}

// ---- 研究多軌 (§4.5, [fix C7]) ----
export interface ResearchSlot { id: string; kind: 'infra'|'posttrain'|'eval'; progress: number; compute: number; meta?: Record<string, unknown> }

// ---- GameState 增補 ----
export interface GameState {
  // ... phase/time/meters/data/towers/requests/rng/seed/waveIndex ... (脊椎保留)
  power: Capacity; cooling: Capacity               // 改 WATTS (§6.5)
  infra: InfraState                                // R6
  derivedModels: Record<string, ModelDef>; derivedSeq: number   // R7
  research: { infra: ResearchSlot|null; posttrain: ResearchSlot|null; eval: ResearchSlot|null }  // 多軌 [fix C7]
  fleetCapexUsd: number; utilization: number; marketPriceMul: number   // §6.6
  simTimeScale: number                             // §0.4 (P0 校準)
  upgrades: Record<string, number>                 // 只剩 buy-with-cash UPGRADES
  // ... models/endless/currentWave/events ...
}
```
> 註：`Request`/`Tower`/`WaveStats`/`WaveReport` 的 runtime 欄位增補（`tokensIn/tokensOut/contextLen/queueSec/ttftReal/tpotRealAccum/e2elReal/sloViolated`、`hazards/safetyCleared/overRefused`、`guardThreshold/guardCategories`、`e2elAttainPct`/`overRefused` 計數）依各子系統 §b，沿用既有結構。

---

## 8. 實作分期 (Implementation Phasing — 相依排序)

> 嚴格相依：P0 是地基（含 v2 上提的單位/研究多軌決策），其他全部坐在上面。

- **P0 — 單位系統 + serving 數學脊椎（§0.4 + §6，先行，含 [fix C5/C1/C2/C3/M10]）**：
  - **單位決策包（[fix M10]）**：`SIM_TIME_SCALE` 值 + cash 單位 一次定清（OQ-G2/G3）。
  - **雙時鐘 + effLatencyMs（[fix C5/C6]）**：board-s ↔ real-s ↔ real-ms SLO 轉換鏈；SLO 用並發攤平等效延遲，驗證「Goodput 不恆為 0」（autoplay 數值 gate）。
  - **真實 roofline（[fix C1/C2/C3]）**：prefill 超線性、decode batch 線性攤平至 compute roof、quant 作用於 bytesPerParam。
  - 真實 `ServerHardwareDef`/`ModelDef` 欄位（R1/R4/R5）+ KV/VRAM 真實公式（seq 動態 [fix H1]）+ tile→GPU 對映（OQ-G4）。
  - 移除 `COST_POINTS`/`flopsPerWork`/`bandwidthPerWork`/`kvCostGb` 編造常數。**這是地基。**
- **P0.5 — 架構拆分 + 研究多軌（[fix C7]，地基前置）**：`resolveModel` + `s.derivedModels`（非遞迴 snapshot [fix C4]）+ `s.infra`（R6/R7）+ **研究多軌 `s.research.{infra,posttrain,eval}` 共享算力池**（§4.5）。在改機制前先把解析層、typed bag、多軌排程立起來。
- **P1 — SLO + economy（§6.4/§6.6）**：per-class SLO/Goodput（effLatencyMs）、$/Mtoken 收入（cache 1/10 讀價 [fix H4]）、capex/gpu-hr/電/冷卻、utilization、勝負條件、六終局（R9，over_refused 輕扣 Trust [fix H5]）。
- **P2 — power/cooling 真實化（§6.5）**：真實 watt、§5.5 冷卻分界 gate、液冷設施建築。
- **P3 — 子系統 plug-in（消費 P0–P2 的真實欄位/公式）**：
  - **P3a Requests（§2）**：14 token-native archetype、`difficulty` 向量、價格欄、spawn 分布、LEGACY_ALIAS 對照表 [fix M7]。
  - **P3b Models/Finetune（§1）**：`deriveQuality`（depthDamp [fix C4]）、MethodRecipe + `calibrateRecipes()`、effort 五檔滑桿 [fix M9]、benchmark→axis 映射 [fix M6]、**16-roster 架構欄 + lineage 必填 [fix L3/H6]**、Post-Training Studio。**含 H2 balance 必解項**（qwen agentic gap）。
  - **P3c Tech tree（§4）**：22 InfraNodeDef、`applyInfraEffects`、`completeResearch` 改寫、GQA/MoE/reasoning 出樹。
  - **P3d Safety（§3）**：`AlignmentProfile` 消費（combat 第一層自處理）、3 棟 guardrail（guard_llm 走 roofline [fix M8]）、閾值 no-free-lunch、red-team eval（降 over-refusal 凸度為主 [fix M4]）。
    > **[fix H8] 相依標記**：P3d 的 **base-roster 部分可與 P3b 平行**；但「method→alignment 寫入」迴路**軟依賴 P3b 的 Post-Training Studio**（RLHF/CAI 改 alignment 的玩法），須在 P3b 之後接上。
- **P4 — UI（§5）**：消費全部真實欄位；S1–S9、tooltip、charts、消滅單字母、effort 滑桿、lineage graph。**最後做**（UI 唯讀）。
- **P5 — autoplay oracle 重校**：`playthrough.test.ts` 的 `planResearch`/`planBuild` 改懂 method/infra/token/多軌；`calibrateRecipes()` 跑迴歸；驗證 H2（qwen 在高 wave agentic 牆前不再純贏）+ 通關（balance gate）。

---

## 9. 整合後開放問題 (Consolidated OPEN QUESTIONS for the user)

> v2 已把 C5/C7/M9/M10/H2/H6 等地基決策**從 OQ 上提到 P0/P0.5/P1 並給出裁決**；以下僅保留**真正需要使用者拍板的 game-feel / 內容範圍**抉擇。

**單位與物理（已上提，僅留 game-feel 拍板）：**
- **OQ-G2（`SIM_TIME_SCALE` 值）**：雙時鐘已確立（§0.4）；只壓視覺步調的 scale 取 8–12 哪個值？或前哨/核心 rack 用不同視覺步調？（不影響 SLO 判定。）
- **OQ-G3（cash 單位）**：真實 USD（rack ~$25k–50k，meter 大）vs ÷1000 縮放（HUD 易讀）？無論選哪個比例一致（§0.4）。
- **OQ-G4（rack=GPU 對映）**：`ServerHardwareDef.gpus` 的 tile→GPU 對映表（edge=1、giga/NVL72=72）確認？

**經濟/物理：**
- **OQ-G5（`deepseek_v31` vs `qwen3_235b` 差異化軸）**：靠 serve cost + total 671 需 SuperPod 自然分層就好，還是再給 V3.1 獨有 `context`/agentic 優勢？
- **OQ-G6（市場價格動態）**：`marketPriceMul`/$/Mtoken 隨 wave 漂移（§5.8「2022 $20→2026 $0.40」）成壓力，還是固定價？（若漂移，型別需 wave→mul 曲線 [fix L4]。）
- **OQ-G7（利用率懲罰強度）**：§5.8 的 ×10 成本爆炸照單全收（真實但懲罰性），還是軟化曲線保留「多蓋幾台」爽感？
- **OQ-G8（液冷硬 gate vs 軟成本）**：B200/NVL72「沒建液冷完全不能放」（§5.5 硬約束）還是「可放但嚴重 throttle」？
- **OQ-G9（Goodput 驅動 SLA 權重）**：SLA 扣分對 `slo_miss` vs `unservable` 的相對嚴重度？enterprise 一次 timeout 維持 brutal？

**後訓練/能力（H2 已裁決為 P0 必解；以下留 playtest 微調）：**
- **OQ-G10（merge target 語意）**：merge 兩個不同 target 的 derived → 取軸均 + 任務干擾懲罰（§2.6）；干擾強度待 playtest。
- **OQ-G11（effort 校準斜率）**：effort 定義域已定 [0.25,2.0] 五檔（§1.4 [fix M9]）；「effort 1.0→2.0 換多少 quality / waves」的精確斜率交 autoplay `calibrateRecipes()` 定值，使用者僅確認手感方向（報酬遞減）。
- **OQ-G12（base `alignment`/`instructFollow` 初值來源）**：無公開安全基準（唯一手填例外）。接受 variant 推估（§3.4 表），或找代理基準（拒答率/red-team pass rate）？

**安全：**
- **OQ-G13（威脅多樣化範圍）**：§3.4 有 4 類。要新增多少新請求型承載 injection/harmful/pii（目前 `agent` 帶 inject:0.3、`jailbreak` 帶 jailbreak:0.9），還是新威脅留 endless？
- **OQ-G14（safe-completion 玩法強度 + over_refused Trust 權重）**：safe-completion 設成 Pareto 改善（忠於 §3.1）會讓 hard-refusal RLHF 變 trap card。保留 hard-refusal 當「早期便宜、後期被取代」進程，還是給補償優勢（harmful recall 更高）？over_refused 的 Trust 扣分（[fix H5]）取多重？
- **OQ-G15（第一層自處理 隨機 vs deterministic）**：`pSelfHandle` 用機率（同模型對不同越獄成功率不同，較真實）還是 deterministic 門檻（較可預測）？兩者皆可用 `s.rng`。
- **OQ-G16（generative guardrail 佔 tile vs 附掛模組）**：`guard_llm` 已確立走 roofline 佔算力（[fix M8]）；它**佔獨立 tile**（張力更真、與主模型爭 batch budget 更明顯）還是 server 附掛（UI 更簡）？

**科技樹（R6 已採 `s.infra`；以下留 game-feel）：**
- **OQ-G17（parallelism 顆粒度）**：TP/PP/DP/EP 全域研究開關（解鎖後 per-rack 選用）還是 per-rack-cluster 配置？建議前者。
- **OQ-G18（chunked vs disagg 互斥強度）**：硬互斥（§4.3 對立解法，教學最清楚）還是軟互斥？建議硬互斥。
- **OQ-G19（MoE deploy-gate 移除後防呆）**：`tech_moe` 拿掉後，MoE「VRAM 放得下就能部署」+ `inf_par_ep` 提供 serving 效率加成（非硬 gate）？建議是。
- **OQ-G20（engine choice 賣點化）**：vLLM→SGLang→TRT-LLM 排他高階節點（含 RadixAttention 副作用）還是純 throughput 倍率？

**內容/UI：**
- **OQ-G21（real GPU 對應顯示深度）**：S3 標「H100-class / B200-class」即可，還是顯 dense FP8 PFLOPS/TDP/冷卻型別全套？
- **OQ-G23（derived 數量 UI 上限）**：機制無上限；deploy grid / lineage graph 在數十個 derived 時是否需「歸檔/刪除舊 checkpoint」或只在 graph 摺疊？
- **OQ-G24（archetype 數量）**：14 archetype 會太多嗎？砍到 ~9 核心（embed/chat/comp/rag/summ/reason/agent/batch/jailbreak）更可讀，還是 14 全留最大化教學覆蓋？
- **OQ-G25（SLO miss 嚴厲度分模式）**：slo_miss 給部分 reward（Normal 溫和）vs 等同 leak 零 reward（Expert 硬核）——要這個 Normal/Expert 分叉嗎？
- **OQ-G26（nemotron 處置，[fix M3]）**：換成已驗證的 **Nemotron-3-Super-120B-A12B**（MoE，建議）還是保留 dense 253B 但給它 agentic-frontier 差異化？

---

## 10. 從現況的遷移地圖 (Migration Map from Current Code)

> **reuse 最大化**：requisition 訓練機制、roofline 雙 roof 結構（effects.ts:176–217）、KV admission loop（combat.ts，動態 seq 復用）、P/D role-pin、chunked share、`decodeThrottle`、cacheBuff、routing tag、calibrate.ts base 管線、`RealModelMeta` display、movement leak 骨架、telemetry 結構——全部沿用。

| 項目 | 動作 | 細節 / §ref |
|---|---|---|
| `MODEL_DEFS` 靜態 registry | **保留**(僅 base) + `s.derivedModels` + `resolveModel`(非遞迴 snapshot) | R7/[fix C4] |
| `ModelDef.paramsB` | **改名** `paramsTotalB` | R5 |
| `ModelDef.flopsPerWork/bandwidthPerWork/memoryGb` | **移除**（改 derived） | R1；`COST_POINTS`/`serveCost` 一併刪 |
| `ModelDef` 新增 | `origin/layers/kvHeads/headDim/attn/weightBytes/alignment/instructFollow/lineage` | R3/R4/[fix C3/L3]；§5.6 KV 公式輸入 |
| `CUSTOM_MODELS`(`ft_agent`/`pt_giga`) + `r_ft_agent`/`r_pt_giga` | **刪除** | 改玩家用 method 產 derived（§1）；endless 上限開放 |
| `calibrate.ts` | **保留**(base) + `deriveQuality()` + benchmark→axis 映射 + `calibrateRecipes()` | I2/[fix C4/M6] |
| `scale_pretrain`(全域 +8 buff) | **刪除** | 微調改產 derived（I1） |
| `saf_rlhf`/`saf_redteam`(UPGRADES) | **搬遷** | rlhf/cai 成 method（§1）；red-team 成 `r_eval_redteam_*`(降 over-refusal 凸度 [fix M4]) |
| `effects.ts` getter | **改資料源** `s.upgrades`→`s.infra`+model；roofline 改真實公式（超線性 prefill / batch 線性 decode / quant→bytesPerParam） | R1/R6/[fix C1/C2/C3]；刪 `safetyRate`/`unsafePenaltyMult`/`spawnRiskMult`；`serverQualityVs` 加 `alignmentTax` |
| `s.upgrades` | **拆**：infra→`s.infra`，只留 buy-with-cash | R6 |
| `r_tech_gqa`/`tech_gqa`(全域 ×0.4) | **移除** | GQA/MLA 移 model 屬性 `attn`/`kvHeads`（R4）；MLA ×0.067 近似 [fix M5] |
| `r_tech_moe`/`r_tech_reasoning`(deploy gate) | **移除/改** | MoE 由 VRAM 自然 gate + `inf_par_ep` 效率；reasoning baked 進 `qualityBy`（OQ-G19） |
| `eff_quant`/`eff_int4`/`eff_spec`/`eff_flash`/`prod_*` | **轉 infra 節點** | `inf_wq_*`/`inf_spec`(batch 依賴重寫)/`inf_prefix`/`inf_routing`（§4.4） |
| `RequestTypeDef.work/complexity/context/reward/data/affinity` | **改** token-native | R2/R8/[fix M2]；`work/context→inputTokens/outputTokens/contextLen`、`complexity` 刪、`reward→pricePerMtok`、`data→dataYield`、`affinity→primaryAxis(CapabilityAxis)` |
| spawn.ts `prefillFrac=context/(context+110)` | **移除** | 改真實 token 抽樣（§2.6） |
| `TowerKind 'safety'` + `TOWER_DEFS.safety` | **改** `'guardrail'` + 3 棟(guard_llm 走 roofline) | §3.3/[fix M8] |
| `TTFT_SLO=8`(telemetry) | **移除** | per-class 真實 ms SLO + Goodput(effLatencyMs, §6.4/§0.4)；加 `e2elAttainPct` |
| `ServerHardwareDef` 抽象 flops/memoryGb/powerDraw | **改** 真實 per-GPU ×gpus | R5；§5.2–5.8 |
| `POWER_PRICE` 單一電費 | **改** capex+gpu-hr+電+冷卻多項 | §6.6 |
| `research.ts`(單槽) | **改多軌** `s.research.{infra,posttrain,eval}` 共享算力池；`kind:'posttrain'`/`'infra'`/`'eval'`；`completeResearch` tech 分支改 `applyInfraEffects`；`rackFlops` 讀真實 aggregate TFLOPS | §4.5/[fix C7] |
| `state.ts` seed | **擴充** `derivedModels:{}, derivedSeq:0, infra:{...}, research:{infra:null,posttrain:null,eval:null}, fleetCapexUsd:0, utilization:0, marketPriceMul:1, simTimeScale:10` | — |
| i18n `research-node missing` | **修復** + 新增 `metric.*`/`icon.*`/`tooltip.*`/method/infra/guardrail/14 req keys | §4.4/§5.3 |
| UI（panels/hud/buildbar/codex/textures/world） | **重構** | InspectPanel→S3(W=360)、teleText→S2、glyph→icon primitive、新 S4/S7/S8/S9 + `ui/metrics.ts`(用 effLatencyMs)/`tooltip.ts`/`charts.ts`（§5） |
| `playthrough.test.ts`(balance oracle) | **必改** | `planResearch`/`planBuild` 改懂 method/infra/token/多軌；驗 H2 + 通關（P5 gate） |

**新增檔案**：`sim/models.ts`(`resolveModel`/`deriveQuality`/`deriveModel`)、`sim/infra.ts`(`InfraState`/`applyInfraEffects`/effect getter)、`ui/metrics.ts`/`tooltip.ts`/`modelOverview.ts`/`requestInspector.ts`/`liveOps.ts`/`charts.ts`。
**真正的新核心代碼**：雙時鐘 + effLatencyMs（§0.4）+ 真實 roofline（超線性 prefill / batch 線性 decode / quant→bytesPerParam）+ `deriveQuality()`（depthDamp）+ `resolveModel()`(snapshot) + `applyInfraEffects()` + 研究多軌 + 兩層安全判決（guard_llm roofline）+ Post-Training Studio UI；其餘最大化 reuse。
