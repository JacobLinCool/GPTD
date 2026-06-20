# GPTD — System Menu, Settings & Options (Design Spec)

> **What this is.** A design spec for GPTD's *system surface*: the pause/system
> menu, the settings/options panel, the content browsers (How to Play, Codex,
> Achievements), and the persistence layer underneath them. It defines the
> information architecture, the open/close + pause behavior, every setting and
> its mapping to an existing engine knob, the storage schema, the new UI widgets
> required, and a P0→P2 build order with acceptance criteria.
>
> **Status:** **P0 + P1 content browsers shipped (2026-06-21).** P0 — SettingsStore,
> the Slider/SegmentedControl/Toggle widgets, the SystemMenu hub, the four-tab
> SettingsPanel, the ⚙/ESC entry + pause gate, the three-bus audio engine, and
> reduced-motion. P1 content browsers — How to Play, Codex (Models/Hardware/
> Requests/Research), and About/Data-source (`src/ui/browsers.ts`). P2 — ~48
> achievements with hand-drawn icons (`src/achievements.ts`, `src/ui/achievements.ts`).
> Remaining: P1 view-layer a11y (colorblind, UI font scale) + confirm-before-sell.
> Decisions in §15 are settled.
>
> **Code is the source of truth.** Every API this spec leans on is named against
> the real code: `src/audio/audio.ts`, `src/i18n/index.ts`, `src/mode.ts`,
> `src/game.ts`, `src/ui/{theme,panels,hud,codex}.ts`. Where this spec proposes a
> new module or signature, it is marked **(new)**.

> Related: **[DESIGN.md §13 UI Surfaces](./DESIGN.md)** (the existing Normal/Expert
> HUD), **[AGENT-BRIDGE.md](./AGENT-BRIDGE.md)** (the agent action vocabulary that
> should stay in sync with any new menu actions).

---

## Table of Contents

1. [Motivation & current surfaces](#1-motivation--current-surfaces)
2. [Architecture: three layers, one entry](#2-architecture-three-layers-one-entry)
3. [Open / close & state model](#3-open--close--state-model)
4. [Information-architecture map](#4-information-architecture-map)
5. [Settings spec (the four tabs)](#5-settings-spec-the-four-tabs)
6. [Audio engine changes](#6-audio-engine-changes)
7. [SettingsStore: persistence](#7-settingsstore-persistence)
8. [New UI components](#8-new-ui-components)
9. [Accessibility specifics](#9-accessibility-specifics)
10. [Content browsers](#10-content-browsers)
11. [Achievements: forward design](#11-achievements-forward-design)
12. [GPTD identity tie-in](#12-gptd-identity-tie-in)
13. [Phasing & acceptance criteria](#13-phasing--acceptance-criteria)
14. [File-touch map](#14-file-touch-map)
15. [Open decisions](#15-open-decisions)

---

## 1. Motivation & current surfaces

GPTD's settings exist but are **scattered and shallow**:

| Surface | Where | What it offers |
| --- | --- | --- |
| HUD top-row icon buttons | `src/ui/hud.ts` — `btnPause`, `btnSpeed`, `btnMute`, `btnMusic`, `btnLang` | Each is a binary **toggle**; five separate buttons competing for top-bar space. |
| Title `Overlay` | `src/ui/panels.ts` `class Overlay` | Display Mode (Normal/Expert), Language, plus Start/Demo/Agent. Only reachable **before a run** or on win/lose. |
| `AudioEngine` | `src/audio/audio.ts` | `master.gain = 0.5` and `musicGain.gain = 0.16` are **hard-coded constants**. `toggleMute` / `toggleMusic` are on/off only — **no volume control exists at all**. |
| `Codex` | `src/ui/codex.ts` | A drip-fed tutorial bubble (CODEX persona). There is **no always-available "how to play" reference**. |
| Persistence | `gptd_mode` (`mode.ts`), `gptd_lang` (`i18n`), `gptd_tut_done` (`tutorial.ts`) | Per-feature `localStorage` keys under a `gptd_` prefix. No unified store. |

Gaps this spec closes: volume is uncontrollable; settings can't be changed
cleanly mid-run; there is no reference help page; there is no home for
achievements or "about / data source" content.

---

## 2. Architecture: three layers, one entry

The cardinal rule: **do not build "one settings screen."** Preference toggles,
content browsers, and menu navigation are three different things; fusing them
produces bad IA (a 200-row model encyclopedia next to a volume slider). Build
three layers sharing **one entry pattern**.

```
        ⚙ button  /  ESC  ──►  ① SYSTEM MENU (Hub)      [dims + pauses the sim]
                                  │
        ┌─────────────────────────┼───────────────────────────────┐
        ▼                         ▼                ▼                ▼
   ② SETTINGS               ③ CONTENT BROWSERS   Restart        Quit → Title
   tabs:                    full-page:
     • Audio                  • How to Play
     • Display & Language     • Codex / Encyclopedia
     • Accessibility          • Achievements
     • Gameplay               • About / Data source
```

- **① System Menu (Hub)** — the navigation hub. Opening it **pauses the
  simulation** and dims the board (reuse `Overlay`'s dim + `drawPanel` visual
  language). Rows: Resume, Settings, How to Play, Codex, Achievements, Restart,
  Quit to Title.
- **② Settings** — *only* preference controls, organized into tabs. This is the
  home for "audio volume, language, and the fiddly details."
- **③ Content browsers** — How to Play, Codex, Achievements, About. These are
  *content*, not toggles; each is its own full-page view reached from the Hub.

**Key reuse insight:** Settings is a *component* with **two entry points** — the
title `Overlay` and the in-run Hub both open the same panel. Build it once. The
title screen's existing Mode/Language controls fold into it.

---

## 3. Open / close & state model

### Entry points
- **Gear button (⚙):** collapse the five scattered HUD toggles (`btnMute`,
  `btnMusic`, `btnLang`, and arguably `btnPause`/`btnSpeed` stay) into a single
  ⚙ that opens the Hub. Keep a one-tap **mute** affordance in the HUD for the
  high-frequency case; everything else moves into Settings.
- **ESC key:** today `installKeys` (`src/game.ts:368`) uses ESC to close the
  models/training panels, else clear selection. ESC becomes a **priority stack**:

  ```
  ESC pressed →
    1. a modal sub-view open (Settings / a content browser)?  → back to Hub
    2. Hub open?                                               → close Hub (resume)
    3. models/training/inspect panel open?                    → close it
    4. an active selection (build tool / tower / request)?    → clear it
    5. otherwise (phase === 'wave' | 'build')                 → open Hub (pause)
  ```

### Pause integration
`simRunning` (`src/game.ts:566`) is currently
`phase === 'wave' && !paused && !trainingOpen && !modelsOpen`. Add a
`systemMenuOpen` gate so the sim freezes whenever the Hub or any sub-view is up:

```
simRunning = phase === 'wave' && !paused && !trainingOpen && !modelsOpen && !systemMenuOpen
```

The Hub is openable in both `build` and `wave` phases (in `build` the sim isn't
ticking anyway, but the menu must still be reachable).

### Apply model
- **Instant-apply, no Apply/Cancel.** Changes take effect immediately; provide a
  single **Reset to defaults** per tab (or one global). This matches modern
  convention and removes commit friction.
- **Live preview.** Dragging a volume slider plays a short sample tick at the new
  level (call `audio.click()` on release/step). Language change re-renders
  immediately via the existing `onLangChange` subscription (`i18n`).
- **Run-safe.** Opening/closing the menu mid-run must never reset game state.
  (Contrast: Restart deliberately rebuilds state — see `onOverlayAction`.)

---

## 4. Information-architecture map

Where every item the brief mentioned (and the obvious additions) lives:

| Item | Layer / tab | Status today |
| --- | --- | --- |
| Master / Music / SFX volume | Settings ▸ Audio | **Missing** — needs sliders + engine changes (§6) |
| Mute (quick) | HUD + Settings ▸ Audio | Exists (`toggleMute`) |
| Language | Settings ▸ Display & Language | Exists (`setLang`); re-present as selector |
| Display Mode (Normal/Expert) | Settings ▸ Display & Language | Exists (`mode.ts`); editable on title + **live-switchable mid-run after tutorial** |
| Reduced motion / font scale | Settings ▸ Accessibility | **Missing** — P0 (§9) |
| Colorblind palette | Settings ▸ Accessibility | **Missing** — deferred to **P1** (done with shape/icon redundancy) |
| Confirm-before-sell, default speed, tooltips, reset tutorial | Settings ▸ Gameplay | **Missing** (low cost) |
| How to Play / controls & hotkeys | Content browser | **Shipped** (`HelpPanel`) |
| Codex / model & hardware encyclopedia | Content browser | **Shipped** (`CodexBrowser`, 4 tabs) |
| About / version / data source | Content browser | **Shipped** (`AboutPanel`) |
| Achievements | Content browser | **Missing** — P2 (§11) |

---

## 5. Settings spec (the four tabs)

Each control lists: **type**, **range/options**, **default**, **persisted key**,
**engine it drives**, **live behavior**.

### Tab A — Audio
| Control | Type | Range | Default | Drives | Live |
| --- | --- | --- | --- | --- | --- |
| Master volume | slider | 0–100% | 50% | `master.gain` 0..1 | sample tick on change |
| Music volume | slider | 0–100% | 50% (→ `musicGain` 0.16) | `musicGain.gain` 0..0.32 | audible immediately |
| SFX volume | slider | 0–100% | 100% | **new** `sfxGain.gain` 0..1 | sample tick on change |
| Mute all | toggle | on/off | off | `muted` flag | immediate |

> Mapping note: defaults reproduce today's behavior exactly (master 0.5,
> musicGain 0.16, SFX unattenuated). The 0–100% UI scale is decoupled from the
> raw gain via the multipliers above.

### Tab B — Display & Language
| Control | Type | Options | Default | Drives |
| --- | --- | --- | --- | --- |
| Language | segmented / dropdown | `LANGS` (`en`, `zh-TW`), label from `LANG_LABEL` | `getLang()` | `setLang()` → `onLangChange` re-render |
| Display Mode | segmented | Normal / Expert | `getMode()` | `setMode()`; **live-switchable mid-run once the tutorial is complete** (the title still sets the starting frame) |

### Tab C — Accessibility
| Control | Type | Default | Drives |
| --- | --- | --- | --- |
| Reduced motion | toggle | off | suppress pulsing/flashing FX (§9) — **P0, live** |
| UI font scale **(P1)** | segmented (S / M / L) | M | `label()` size multiplier — deferred to P1 (live re-scale across width-fitted layouts is an invasive view-layer pass) |
| Colorblind palette **(P1)** | dropdown (Off / Deuteranopia / Protanopia / Tritanopia) | Off | remap status colors in `COLORS` consumers — deferred to P1, done with shape/icon redundancy |

### Tab D — Gameplay
| Control | Type | Default | Drives |
| --- | --- | --- | --- |
| Default game speed | segmented (1×/2×/3×) | 1× | initial `speed` for new runs — **P0** |
| Tooltips | toggle | on | `setTooltipsEnabled` — **P0** |
| Replay tutorial | button | — | `tutorial.replay()` (clears `gptd_tut_done`) — **P0** |
| Confirm before sell **(P1)** | toggle | on | gate `doSell` with a confirm — deferred to P1 (needs a confirm dialog) |

---

## 6. Audio engine changes

`AudioEngine` (`src/audio/audio.ts`) today has two buses — `master` and
`musicGain` — and routes **all SFX directly into `master`** (`tone`/`noise`
`g.connect(this.master)`). To support three independent sliders:

1. **Add an `sfxGain` bus** between SFX and master:
   `sfxGain = ctx.createGain(); sfxGain.connect(master)`; change `tone`/`noise`
   to `g.connect(this.sfxGain)`.
2. **Expose setters** that the Settings panel calls:
   `setMasterVolume(v)`, `setMusicVolume(v)`, `setSfxVolume(v)` (each `v ∈ [0,1]`
   in UI terms, multiplied to the bus range in §5).
3. **Initialize from SettingsStore** in `resume()` instead of the hard-coded
   `0.5` / `0.16`. Keep `muted` overriding master to 0.
4. Keep `toggleMute` / `toggleMusic` for the HUD quick-actions; have them write
   through to the store so HUD and Settings stay in sync.

No change to the procedural synthesis — only the gain graph and its initial
values move under the store's control.

---

## 7. SettingsStore: persistence

A single **(new) `src/settings.ts`** module owns preferences and decouples UI
from engine.

- **Storage:** one namespaced key `gptd_settings` holding a versioned JSON blob:
  ```jsonc
  {
    "v": 1,
    "audio":   { "master": 0.5, "music": 0.5, "sfx": 1.0, "muted": false },
    "a11y":    { "reducedMotion": false, "colorblind": "off", "fontScale": "m" },
    "gameplay":{ "confirmSell": true, "defaultSpeed": 1, "tooltips": true }
  }
  ```
- **Coexistence with existing keys:** `gptd_mode`, `gptd_lang`, and
  `gptd_tut_done` already work and are owned by `mode.ts` / `i18n` / `tutorial`.
  The store acts as a **façade** — it reads/writes its own blob *and* delegates
  mode/lang to those modules — rather than rewriting working persistence.
- **Versioning:** the `v` field gates a migration step on load (forward-compatible;
  unknown future keys are preserved on write).
- **API (new):** `getSettings()`, `update(path, value)` (deep-merges + persists +
  notifies), `subscribe(fn)`, `resetToDefaults(section?)`.
- **Consumers read the store, not the UI:** `AudioEngine.resume()` (initial gains),
  render flags (reduced motion / colorblind / font scale), `Game` (confirmSell,
  defaultSpeed, tooltips). This keeps a single source of truth and makes the
  settings scriptable later (e.g. via the agent bridge).

---

## 8. New UI components

Reuse the existing kit where possible; build only what's missing.

**Reuse:** `drawPanel`, `label`, `UIButton`, `addTooltip`, `COLORS`, `FONT`
(`src/ui/theme.ts`); the `Overlay` dim + panel pattern (`src/ui/panels.ts`).

**New widgets (in `src/ui/theme.ts` or a new `src/ui/widgets.ts`):**
| Widget | Purpose | Notes |
| --- | --- | --- |
| `Slider` | volume + font-scale-as-continuous | pointer drag (`pointerdown`/`move`/`up`), keyboard ←/→, a value label; emits `onChange(v)` |
| `SegmentedControl` | language, mode, speed, font scale | row of `UIButton`s with one active; cheap to build atop `UIButton` |
| `Toggle` | the boolean settings | a 2-state `SegmentedControl` or a styled `UIButton` |
| `TabBar` | the four Settings tabs | header row + swap content container |

**New panels (in `src/ui/panels.ts` or `src/ui/system.ts`):**
| Panel | Role |
| --- | --- |
| `SystemMenu` | the Hub (§2); list of navigation `UIButton`s + dim |
| `SettingsPanel` | the tabbed preferences view (§5) |
| content browsers | `HelpPanel`, `CodexBrowser`, `AchievementsPanel`, `AboutPanel` (P1/P2) |

All wired into `Game` alongside the existing `this.overlay` / `this.models` /
`this.training` members and added to `root` in the same `addChild` block
(`src/game.ts:133`), above the world but below `tooltip()`.

---

## 9. Accessibility specifics

"Reduced motion" must enumerate concrete targets — the board has real pulsing and
flashing that matters for photosensitivity:

| Effect | Source | Reduced-motion behavior |
| --- | --- | --- |
| Core glow pulse | `world.ts` `updateCore` (`Math.sin(s.time*4)`) | hold steady (`pulse = 1`) |
| Server rack blink | `textures.ts drawTower` server units | static LEDs |
| Particle / flash FX | `FxManager` (`src/render/...`) | reduce or skip transient flashes |
| Brownout flash | brownout cue path | dim, non-strobing indicator |

**Colorblind palette (P1):** GPTD encodes critical state (trust good/warn/danger)
in color (`COLORS.core/warn/danger`). The palette option remaps these to
colorblind-safe hues *and* pairs color with shape/icon so meaning never relies on
hue alone. Deferred to P1 because doing it right is a redundant-encoding pass, not
a toggle.

**Font scale:** a multiplier applied in `label()` for HUD/menu text (the pixel
board art is unaffected).

---

## 10. Content browsers — **shipped (`src/ui/browsers.ts`)**

Read-only views over a shared `ContentPanel` base (dim + panel + title + Back +
masked wheel-scroll). Reached from the Hub; ESC backs out to the Hub.

- **How to Play / Controls.** A static, always-available reference: the core loop
  (lanes → Trust Core, build serving platform), the request archetypes, the tower
  types, and a **hotkey list** (Space, 1/2/3/6/0, M, `` ` ``/Tab, ESC). This is
  the reference the drip `Codex` tutorial can't be.
- **Codex / Encyclopedia.** A browser over data the game already holds —
  `MODEL_DEFS`, hardware tiers, request types, research. Links naturally to
  `docs/MODEL-CATALOG.md` content. This is where GPTD's real-model grounding
  shines (§12).
- **About / Data source.** Version, credits, and the realism credential: "model
  capabilities calibrated from Artificial Analysis benchmarks (snapshot
  `data/aa-snapshot.json`)", plus links to `docs/`.

---

## 11. Achievements — **shipped (2026-06-21)**

~48 achievements across 10 categories, each with a hand-drawn vector glyph in the
house pixel-neon style (`drawAchIcon`, `src/ui/achievements.ts`).

- **Definitions** (`src/achievements.ts`, `AchievementDef`): `id`, `category`,
  `name`, `desc`, `hidden?`, `goals?` (tiered bronze/silver/gold). Metadata only —
  the unlock LOGIC lives in `AchievementTracker`, driven from `game.ts` so
  `src/sim/**` stays pure (it never imports achievements).
- **Tracker hooks:** `onEvent` (GameEvent stream), `onWaveCleared(s, lastReport)`,
  `tick(s)` (live state scan), `onRunEnd(s, won)`, `resetRun()`, `markAgentMode()`.
  Demo runs are excluded (`!demoActive`). New unlocks drain into an `AchievementToast`.
- **Lifetime vs per-run:** the tracker keeps a small persisted lifetime blob
  (served, cashEarned, distinct base models deployed, post-training methods used)
  plus transient per-run state (bosses cleared, comeback armed, brownout-this-wave).
  Tiered live progress = lifetime + current run.
- **Persistence:** `gptd_achievements` localStorage (`{ v, unlocked: {id→level}, lifetime }`).
- **UI:** `AchievementsPanel` (a 2-column grid over the `ContentPanel` scroll base)
  reached from the Hub's Achievements row; locked cells dimmed, hidden cells "???",
  tiered cells show a level + progress bar; header "Unlocked X / Y". An unlock
  `AchievementToast` banner appears mid-game.
- **No early flood (design rule):** tutorial-step "first X" milestones are
  deliberately omitted — the earliest unlock requires real progress (≈ wave 10);
  tiered lowest thresholds are set above what a first wave yields.
- **Categories:** progress · economy · serving · safety · models · studio ·
  research · hardware · history (real 2023–26 bosses/crises, mapped via
  `CAMPAIGN_THEMES[idx].boss/.special`) · hidden.
- **i18n:** chrome + per-achievement `ach.<id>.name/desc` (English source in the
  defs as fallback; zh-TW in the dict).

---

## 12. GPTD identity tie-in

The system surface is a stage for GPTD's slogan — *"the board is the metaphor,
the numbers are real."* The Codex/Encyclopedia exposes real open-weight models +
their Artificial Analysis calibration; the About page cites the snapshot and
links the realism docs. No other tower defense can credibly do this; the menu is
where that credibility becomes visible to the player.

---

## 13. Phasing & acceptance criteria

### P0 — Settings core (solves the real pain) — **shipped 2026-06-21**
**Scope:** `SettingsStore` (`src/settings.ts`) + `Slider`/`SegmentedControl`/
`Toggle` (`src/ui/widgets.ts`) + `SettingsPanel` & `SystemMenu` (`src/ui/system.ts`,
tabs Audio / Display / Accessibility / Gameplay) + ⚙/ESC entry + pause gate + the
three-bus audio engine (§6) + reduced-motion. UI font scale and confirm-before-sell
moved to P1 (see §15.4). **Done — all criteria met:**
- Master/Music/SFX sliders audibly change levels and **persist across reload**.
- Language and Display Mode are settable from the in-run Hub (Mode read-only
  mid-run), reflecting `i18n`/`mode.ts`.
- ESC follows the priority stack (§3); opening the Hub freezes the sim; closing
  resumes with state intact.
- Reduced-motion holds the core pulse steady.
- `npm run build` + `npm run lint` + `npm test` green; the autoplay balance test
  is unaffected (no sim changes).

### P1 — Content browsers **(shipped 2026-06-21)** + view-layer a11y (remaining)
**Shipped:** How to Play (with hotkeys), Codex/Encyclopedia over `MODEL_LIST` /
`HARDWARE_DEFS` / `REQUEST_LIST` / `RESEARCH_LIST`, and About/Data-source — all in
`src/ui/browsers.ts`, reachable from the Hub, scroll on the wheel, ESC-back to the
hub, fully localized. **Remaining:** the colorblind palette done properly (remap +
shape/icon redundancy), **UI font scale** (live re-scale of the built UI), and
**confirm-before-sell** (a small confirm dialog) — the invasive view-layer pass.

### P2 — Achievements
The `Achievement` model wired to the event stream + a grid panel with
locked/unlocked/progress. **Done when** at least the seed set unlocks correctly
and persists.

---

## 14. File-touch map

| File | Change |
| --- | --- |
| `src/settings.ts` **(new)** | SettingsStore: schema, load/migrate, API, subscribe |
| `src/audio/audio.ts` | add `sfxGain` bus; `setMaster/Music/SfxVolume`; init from store |
| `src/ui/widgets.ts` **(new)** or `theme.ts` | `Slider`, `SegmentedControl`, `Toggle`, `TabBar` |
| `src/ui/system.ts` **(new)** or `panels.ts` | `SystemMenu` (Hub), `SettingsPanel` |
| `src/ui/hud.ts` | collapse toggles into a ⚙ button; keep quick-mute |
| `src/game.ts` | `systemMenuOpen` flag + `simRunning` gate; ESC priority stack; wire panels into `root`; read gameplay prefs |
| `src/render/world.ts` | honor reduced-motion (core pulse); colorblind/palette hook |
| `src/i18n/{en,zh-TW}.ts` | strings for all new menu labels |
| `docs/DESIGN.md` §13 | cross-reference this shipped spec |

---

## 15. Decisions (settled)

All five are decided; the spec above reflects them.

1. **HUD vs ⚙ — settled: keep + collapse.** Keep **Pause, Speed, and a quick
   Mute** in the HUD; move **Music volume and Language** into Settings; add a
   single **⚙** that opens the Hub. (Pause/Speed are high-frequency wave controls;
   Mute is an interruption affordance — these stay one-tap.)
2. **Mode mid-run — settled: live-switchable (after tutorial).** Display Mode is
   a pure view over one identical deterministic sim, so locking it is artificial
   friction. The title screen still sets the **starting frame**; mid-run the
   player may switch freely **once the tutorial is complete** (gated only to keep
   tutorial bubbles coherent). Implementation is cheap because mode is read at
   render time via `getMode()`.
3. **Store shape — settled: façade.** New prefs live in one `gptd_settings` blob;
   `gptd_mode` / `gptd_lang` stay owned by `mode.ts` / `i18n` (they already have
   consumers + change subscriptions). SettingsStore is the single API surface;
   callers never touch raw keys.
4. **Colorblind scope — settled: defer to P1 (and font scale with it).** P0 ships
   **reduced-motion** (cheap, safety-relevant, fully live). Colorblind *and* UI
   font scale land in **P1**: both are invasive view-layer passes — colorblind
   needs palette remap *plus* shape/icon redundancy; a live font scale must
   re-flow GPTD's width-fitted layouts. A reload-only scale would violate the
   instant-apply principle, so both wait for the dedicated P1 pass rather than
   shipping half-baked.
5. **Codex vs How to Play — settled: separate.** Two Hub entries. How to Play is
   a 30-second mid-run reference (hotkeys, what each tower does); Codex is a
   lean-back encyclopedia (the realism showcase). Different size and cadence.
