# GPTD — System Menu, Settings & Options (Design Spec)

> **What this is.** The design spec for GPTD's *system surface*: the title screen,
> the pause/system menu, the settings panel, the content browsers (How to Play,
> Codex, About, Achievements), the hotkey sheet, the shell feedback layers
> (notifications, denial reasons, the PAUSED pill) and the persistence underneath
> them. It defines the information architecture, the open/close and pause rules,
> every setting with its default and what it drives, the storage schema, the shared
> widgets, and the acceptance criteria the surface must keep meeting.
>
> **Code is the source of truth.** Every API named here is real:
> `src/settings.ts`, `src/ui/{system,widgets,theme,help,browsers,achievements,notifications,denied,prefs,uiSound,hud,boardOverlay,chat}.ts`,
> `src/audio/{engine,mixer}.ts`, `src/tutorial.ts`, `src/achievements.ts`,
> `src/game.ts`. When this spec and the code disagree, the code wins and this spec
> is updated.

> Related: **[DESIGN.md](./DESIGN.md)** (the HUD and panel surfaces of a run),
> **[manual/en.md](./manual/en.md)** and **[manual/zh-TW.md](./manual/zh-TW.md)**
> (the player-facing controls and settings tables), **[AGENT-BRIDGE.md](./AGENT-BRIDGE.md)**
> (the agent action vocabulary; agent runs never open the system menu).

---

## Table of Contents

1. [Surfaces at a glance](#1-surfaces-at-a-glance)
2. [Architecture: three layers, one entry](#2-architecture-three-layers-one-entry)
3. [Open / close & state model](#3-open--close--state-model)
4. [Information-architecture map](#4-information-architecture-map)
5. [Settings spec (the four tabs)](#5-settings-spec-the-four-tabs)
6. [Audio engine and mix](#6-audio-engine-and-mix)
7. [Persistence](#7-persistence)
8. [UI components](#8-ui-components)
9. [Accessibility specifics](#9-accessibility-specifics)
10. [Content browsers](#10-content-browsers)
11. [Achievements](#11-achievements)
12. [GPTD identity tie-in](#12-gptd-identity-tie-in)
13. [Acceptance criteria](#13-acceptance-criteria)
14. [File map](#14-file-map)
15. [Decisions](#15-decisions)

---

## 1. Surfaces at a glance

| Surface | Where | What it offers |
| --- | --- | --- |
| HUD quick controls | `src/ui/hud.ts` (top right) | **Pause** (enabled only during a wave), **Speed** (click steps up and wraps; right-click steps down), **Mute**, and the **⚙ gear** that opens the system menu. Expert Mode adds **METRICS** and **MODELS** on a second row. Every button's tooltip names its key. |
| Title overlay | `src/ui/panels.ts` `Overlay` (menu) | Display Mode (NORMAL / EXPERT with a one-line description), the language button (cycles EN / 中), **START**, **AGENT** (hand the run to a terminal agent) and **Demo**. Space or Enter presses START. |
| End screen | `src/ui/panels.ts` `Overlay` (won / lost) | the wave reached, the seven-outcome bar and legend, the biggest Trust and SLA drains, run Goodput and total earned; Play again / Try again, and **∞ CONTINUE — ENDLESS MODE** on a win. It appears after a short hold so the board's last beat reads (no hold under reduced motion). |
| System menu (hub) | `src/ui/system.ts` `SystemMenu` | Resume, Settings, How to Play, Codex, About, Achievements, Restart Run, Quit to Title. |
| Settings | `src/ui/system.ts` `SettingsPanel` | four tabs covering every SettingsStore field (§5). |
| Content browsers | `src/ui/browsers.ts`, `src/ui/achievements.ts` | How to Play, the Codex encyclopedia (with the Chat tab), About, Achievements (§10–11). |
| Hotkey sheet | `src/ui/help.ts` `HotkeyOverlay` | the full key map in four groups (H or ?). |
| Notification stack | `src/ui/notifications.ts` | research complete, new checkpoint (with a one-click rollout between waves), achievement, first brownout / throttle of a wave. |
| Denial reasons | `src/ui/denied.ts` `DeniedToast` | a localized reason at the cursor for every rejected player action, and the two-step prompts (sell, START with low cash, blueprint pickup). |
| Board overlay | `src/ui/boardOverlay.ts` | the PAUSED pill (and why it paused), the cursor label for a held tool or blueprint (its cost, the running total while painting), the hover mini card, and the rotate-to-landscape hint on narrow portrait screens. |

---

## 2. Architecture: three layers, one entry

The cardinal rule: **do not build "one settings screen."** Preference toggles,
content browsers and menu navigation are three different things; fusing them
produces bad IA (a model encyclopedia next to a volume slider). There are three
layers sharing **one entry pattern**.

```
        ⚙ button  /  Esc  ──►  ① SYSTEM MENU (Hub)      [dims the board, freezes the sim]
                                  │
        ┌─────────────────────────┼───────────────────────────────┐
        ▼                         ▼                ▼                ▼
   ② SETTINGS               ③ CONTENT BROWSERS   Restart Run    Quit to Title
   tabs:                    full-page:          (two-step)     (two-step)
     • Audio                  • How to Play
     • Display                • Codex (+ Chat)
     • Accessibility          • About
     • Gameplay               • Achievements
```

- **① System Menu (Hub)** — the navigation hub, a 360-px column of eight rows over
  a dim backdrop. Opening it freezes the simulation.
- **② Settings** — preference controls only, organized into four tabs. It is
  reached from the hub; the title screen carries its own Display Mode and language
  controls, which write through the same modules (`mode.ts`, `i18n`).
- **③ Content browsers** — read-only content, each a full-page view over a shared
  `ContentPanel` base, reached from the hub.

Restart Run and Quit to Title are **two-step**: the first tap arms the row ("Tap
again — this run will be lost") for 2.5 s and disarms every other row; a second tap
within that window acts. Restart rebuilds the run straight into the build phase;
Quit returns to the title, where the display mode can be chosen again.

---

## 3. Open / close & state model

### Entry points

- **Gear button (⚙)** in the HUD, and **Esc** when there is nothing to cancel.
- The hub opens only in the **build** and **wave** phases, and never during a demo
  or an agent run (both are spectated, not played). Opening it resumes the audio
  context, cancels a pending auto-start countdown, and closes Settings if it was up.

### The Esc priority stack (`Game.escape`)

```
Esc pressed →
  1. the hotkey sheet is open?            → close it
  2. a content browser is open?           → back to the hub
  3. Settings is open?                    → back to the hub
  4. the hub is open?                     → close it (resume)
  5. the Model Overview is open?          → close it   (a typed name filter clears first)
  6. the Training Lab is open?            → close it
  7. a build tool or blueprint is held?   → drop it
  8. a rack / building / request is selected? → deselect
  9. otherwise                            → open the hub
```

Right-click on the board performs steps 7–8 without falling through to the hub.

### Keyboard routing while a surface is open (`Game.onKey`)

- Keys bind on `KeyboardEvent.code` (the physical key); held keys never repeat an
  action; Ctrl / Cmd / Alt chords pass through to the browser; typing in a DOM input
  (the Codex chat) reaches the game only as Esc.
- **Title:** Space, Enter or NumpadEnter press START; nothing else acts.
- **Hotkey sheet:** H or ? closes it; every other key is swallowed.
- **Content browser / Settings / hub:** only that surface's own keys act
  (§8 FocusList, §10); game keys are ignored, so Space can never start a wave behind
  the menu.
- **Training Lab / Model Overview:** their own keys first; L closes the Training Lab.
  Letters typed while the Model Overview is open go to its name filter.

### Pause integration

The sim advances only when

```
simRunning = phase === 'wave' && !paused && !trainingOpen && !modelsOpen && !systemMenuOpen
```

`systemMenuOpen` stays true while Settings or a content browser is shown over the
hub, so every hub sub-view freezes the run. The floating telemetry panel and the
hotkey sheet do not freeze it. While frozen, the music is muffled (§6). A wave never
starts paused (`wave-start` clears the pause), and the HUD pause button is disabled
between waves, with a tooltip saying why.

**Pause When Unfocused** (Settings ▸ Gameplay) pauses a running wave on window blur
or when the tab is hidden — never in demo or agent mode — and the PAUSED pill reads
"window lost focus".

### Apply model

- **Instant apply, no Apply/Cancel.** Every control writes to the SettingsStore on
  change; one global **Reset to Defaults** restores the audio, accessibility and
  gameplay sections (language and display mode are left as they are).
- **Live preview.** Releasing a volume slider previews its bus (`AudioEngine.preview`):
  SFX and Master play a clean-serve chime, Interface a click, and Music is its own
  preview. Each Outcome Sounds button plays that outcome's cue. Language changes
  re-render every open surface through `onLangChange`.
- **Run-safe.** Opening and closing any system surface never changes game state.
  Restart and Quit are the only destructive rows, and both are two-step.

---

## 4. Information-architecture map

| Item | Layer / tab | Module |
| --- | --- | --- |
| Master / Music / SFX / Interface volume | Settings ▸ Audio | `SettingsPanel.buildAudio`, `audio/mixer.ts` |
| Mute (quick) | HUD speaker button, M, Settings ▸ Audio | `setMuted` |
| Mute in background, serve-chime density | Settings ▸ Audio | `audio/engine.ts` |
| Outcome sound preview | Settings ▸ Audio | `AudioEngine.preview(outcome)` |
| Language | Settings ▸ Display, title button | `i18n` `setLang` / `cycleLang` |
| Display Mode | Settings ▸ Display (once the tutorial is done), title buttons | `mode.ts` `setMode` |
| Reduced motion, screen shake, reduce flashing, colorblind palette, FX level | Settings ▸ Accessibility | read by `src/render/**`, `src/ui/**`, `outcomes.ts` |
| Default speed, auto-start, confirm sell, pause on blur, tooltips, hotkey badges, replay tutorial | Settings ▸ Gameplay | `Game`, `buildbar.ts`, `tooltip.ts`, `tutorial.ts` |
| Controls and hotkeys | How to Play (list), hotkey sheet (H / ?) | `ui/help.ts` `HOTKEY_GROUPS` |
| Model / hardware / request / research encyclopedia | Codex | `CodexBrowser` |
| AI assistant chat | Codex ▸ Chat tab | `ui/chat.ts` |
| Version, data source, links | About | `AboutPanel` |
| Achievements | Achievements browser, notification stack | `achievements.ts`, `ui/achievements.ts` |

---

## 5. Settings spec (the four tabs)

The panel is 620 × 610 design px with a tab row, one page per tab, and a footer
(**Reset to Defaults**, **Back**). Each row is a bold label with an optional dim
explanation of at most two lines (a long translation steps the font down rather than
overflow). The open tab is remembered (§7). `[` / `]` or ← / → cycle the tabs.

### Tab A — Audio

| Control | Type | Range / options | Default | Store field | Drives | Live |
| --- | --- | --- | --- | --- | --- | --- |
| Master | slider | 0–100% | 50% | `audio.master` | master bus (tapered, §6) | preview on release |
| Music | slider | 0–100% | 50% | `audio.music` | music bus | the music itself |
| SFX | slider | 0–100% | 100% | `audio.sfx` | sfx, alerts and ambience buses | preview on release |
| Interface | slider | 0–100% | 60% | `audio.ui` | ui bus (hover, click, toggle, tick, denied, open/close) | preview on release |
| Mute | toggle | on / off | off | `audio.muted` | master to 0 | immediate |
| Mute in Background | toggle | on / off | on | `audio.muteInBackground` | fade out while hidden or unfocused; suspend a hidden tab | immediate |
| Serve Chimes | segmented | Full / Reduced | Full | `audio.sfxDensity` | voice-policy density: Reduced thins routine serve and cache chimes so failures stand out | immediate |
| Outcome Sounds | seven glyph buttons | — | — | — | plays each outcome's cue; glyph and accent follow the colorblind setting; tooltip = label + plain cause | on tap |

Slider drags tick the interface bus every 5% of travel.

### Tab B — Display

| Control | Type | Options | Default | Drives | Live |
| --- | --- | --- | --- | --- | --- |
| Language | segmented | `LANGS` (`en`, `zh-TW`), labels from `LANG_LABEL` (EN / 中) | `getLang()` | `setLang()` → `onLangChange` re-render | immediate |
| Display Mode | segmented | Normal / Expert | `getMode()` | `setMode()` | immediate; **disabled until the guided tutorial is finished or skipped** (`isModeUnlocked`), with the note "Unlocks after the tutorial" |

### Tab C — Accessibility

| Control | Type | Options | Default | Store field | Effect (§9) |
| --- | --- | --- | --- | --- | --- |
| Reduced Motion | toggle | on / off | the OS `prefers-reduced-motion` value | `a11y.reducedMotion` | holds idle and looping animation steady, removes particle bursts, shortens tweens, skips the end-screen hold |
| Screen Shake | toggle | on / off | on | `a11y.screenShake` | board shake on Trust Core hits and severe failures; off → a border flash instead |
| Reduce Flashing | toggle | on / off | off | `a11y.reduceFlashing` | no full-screen flashes; dimmer, rate-limited blinking |
| Colorblind-Safe Colors | toggle | on / off | off | `a11y.colorblind` | swaps every outcome color for the Okabe–Ito-derived palette in `OUTCOME_STYLE` |
| Effects | segmented | Full / Reduced / Minimal | Full | `a11y.fxLevel` | particle and popup density (§9) |

### Tab D — Gameplay

| Control | Type | Options | Default | Store field | Drives |
| --- | --- | --- | --- | --- | --- |
| Default Speed | segmented | 1× 2× 3× 6× 12× | 1× | `gameplay.defaultSpeed` | the speed a new run starts at |
| Auto-Start Next Wave | segmented | Off / 5 s / 10 s | Off | `gameplay.autoStartWave` + `autoStartDelay` | a countdown on START ("START WAVE ▶ n") that then presses it; eligible from wave 4, never during the guided tutorial, a demo, an agent run or an open modal; any build, inspect or modal action cancels it for that build phase; one attempt per build phase, and the low-cash START warning stops it |
| Confirm Before Selling | toggle | on / off | on | `gameplay.confirmSell` | the inspect panel's SELL and the X key need a second press within 2.5 s; the armed prompt shows the refund and the loss |
| Pause When Unfocused | toggle | on / off | off | `gameplay.pauseOnBlur` | §3 Pause integration |
| Tooltips | toggle | on / off | on | `gameplay.tooltips` | `setTooltipsEnabled` |
| Hotkey Badges | toggle | on / off | on | `gameplay.showHotkeys` | key-cap badges on the build-bar cards and controls |
| Tutorial | button | Replay Tutorial | — | — | `tutorial.replay()`: re-enables the Codex, restarts the guided steps and clears the seen-tips list (§7) |

---

## 6. Audio engine and mix

The audio is procedural (no asset files). `AudioEngine` (`src/audio/engine.ts`)
subscribes to the SettingsStore itself; the game never pushes volumes into it.

**Bus graph** (`src/audio/mixer.ts`):

```
destination ← ceiling ← limiter ← master ← ┬ music → tape → musicLP → musicPause → musicDuck
                                           ├ sfx     (routine world cues)
                                           ├ alerts  (failures, state cues, stingers)
                                           ├ ui      (interface sounds)
                                           └ amb     (data-center ambience)
```

- **Perceptual taper.** A slider value `v` maps to a bus gain `MIX_SCALE[bus] × v²`
  (half travel ≈ −12 dB). `MIX_SCALE` is calibrated so the default slider positions
  land on the reference mix that `pnpm audio:check` measures. The SFX slider drives
  the sfx, alerts and ambience buses together.
- **Safety net.** A fast limiter plus a soft-knee waveshaper ceiling below 0 dBFS:
  no slider combination can clip. Every level change is smoothed (no zipper noise).
- **Mute** takes the master to 0; **Mute in Background** fades the master while the
  tab is hidden or unfocused and suspends a hidden tab's context after a moment; the
  music clock resyncs on return so nothing piles up.
- **Serve Chimes** sets the voice manager's density: Reduced thins routine serve and
  cache chimes; failures are never dropped.
- **Ducking and muffle.** Severe cues (an unsafe answer above all) duck the music;
  while the wave is frozen or a hub surface is open the music plays behind a low-pass
  "glass"; a loss tape-stops it.
- **Interface sounds** come from one sink (`src/ui/uiSound.ts` → `audio.ui`): hover,
  click and denied on `UIButton`, toggle on `Toggle`, click on `SegmentedControl`,
  ticks on `Slider`, and arm / countdown / open / close / speed / pause edges.

---

## 7. Persistence

All persistence is per browser, in `localStorage`, under a `gptd_` prefix. Every read
and write is wrapped so a private window or blocked storage falls back to defaults.

**SettingsStore** (`src/settings.ts`) owns one versioned blob and is the single API
surface for preferences; it re-exports the language and mode modules so callers never
touch raw keys:

```jsonc
// gptd_settings
{
  "v": 2,
  "audio":    { "master": 0.5, "music": 0.5, "sfx": 1.0, "ui": 0.6,
                "muted": false, "muteInBackground": true, "sfxDensity": "full" },
  "a11y":     { "reducedMotion": /* OS default */ false, "screenShake": true,
                "reduceFlashing": false, "colorblind": false, "fxLevel": "full" },
  "gameplay": { "defaultSpeed": 1, "tooltips": true, "autoStartWave": false,
                "autoStartDelay": 5, "confirmSell": true, "showHotkeys": true,
                "pauseOnBlur": false }
}
```

- **Load** merges the stored blob over the defaults section by section, so an older
  or partial blob gains new fields at their defaults.
- **API:** `getSettings()`, `subscribe(fn)`, typed setters (`setMasterVolume`,
  `setMusicVolume`, `setSfxVolume`, `setMuted`, `setReducedMotion`, `setDefaultSpeed`,
  `setTooltips`), the generic `updateSettings(section, patch)`, and `resetToDefaults()`.
  Every write persists and notifies subscribers.
- **Consumers read the store, not the UI:** the AudioEngine, the renderer and shell
  (accessibility flags), `outcomes.ts` (palette), `Game` (speed, auto-start, sell
  confirm, pause on blur, tooltips) and the build bar (badges).

**Other per-player keys:**

| Key | Owner | Holds |
| --- | --- | --- |
| `gptd_lang` | `src/i18n` | the interface language |
| `gptd_mode` | `src/mode.ts` | the display mode |
| `gptd_tut_done` | `src/tutorial.ts` | the tutorial was **skipped** (all Codex teaching off) |
| `gptd_tut_main` | `src/tutorial.ts` | the guided steps are finished (they do not replay every run) |
| `gptd_tut_tips` | `src/tutorial.ts` | the contextual tips already shown (each fires once per player) |
| `gptd_ui` | `src/ui/prefs.ts` | panel memory: `settings.tab`, `codex.tab`, `nextWave.collapsed`, `inspect.tab`, `inspect.sort`, `report.collapsed`, `train.tab`, `train.filter`, `studio.filter`, `models.filter`, `models.sort` |
| `gptd_achievements` | `src/achievements.ts` | unlocked levels and lifetime stats (§11) |
| `gptd_openai_key`, `gptd_openai_model`, `gptd_openai_effort` | `src/ui/chat.ts` | the player's own key and choices for the Codex chat; the key is sent only to `api.openai.com` |

The simulation never reads any of these keys.

---

## 8. UI components

**Theme kit** (`src/ui/theme.ts`): `drawPanel`, `label`, `COLORS`, `FONT`, and:

| Component | Purpose | Notes |
| --- | --- | --- |
| `UIButton` | every button | hover / focus share one look; `setHotkey(code)` draws a key-cap badge; `arm(prompt, ms)` / `disarm()` for two-step actions (re-lays out the title); `disabledReason` explains a disabled button in its tooltip; `onDenied` fires on a tap while disabled; interface sounds built in |
| `FocusList` | keyboard focus over a set of buttons | ↑ ↓ (or spatial navigation with `cols = 0`), Enter activates; used by the hub, the Training Lab research cards and the Studio lists |

**Settings widgets** (`src/ui/widgets.ts`):

| Widget | Purpose | Notes |
| --- | --- | --- |
| `Slider` | volumes | pointer drag; `onChange` while dragging, `onCommit` on release (the preview); a tick sound every 5% |
| `SegmentedControl` | language, mode, density, FX level, speed, auto-start | a row of `UIButton`s with one active; `relabel` for live language changes |
| `Toggle` | the boolean settings | a two-state switch with its own toggle cue |

**Panels and layers:**

| Component | Module | Role |
| --- | --- | --- |
| `SystemMenu`, `SettingsPanel` | `ui/system.ts` | §2, §5 |
| `ContentPanel` and its browsers | `ui/browsers.ts`, `ui/achievements.ts` | §10, §11 |
| `HotkeyOverlay` | `ui/help.ts` | the key sheet, built from the same `HOTKEY_GROUPS` table that drives key dispatch, badges and How to Play |
| `NotificationStack` | `ui/notifications.ts` | up to three cards above the build bar, left of the inspect column; hover holds a card, a click runs its action, an optional right-edge action button (DEPLOY ×N); 3.5 s on screen, 7 s with an action; hidden, with timers paused, while a modal is up |
| `DeniedToast` | `ui/denied.ts` | the reason for a rejected action at the cursor (or at the rack), in a warning or info tone; `explainDenied` mirrors the agent bridge's rejection reasons |
| `BoardOverlay` | `ui/boardOverlay.ts` | PAUSED pill, cursor label, hover card, rotate hint |

All of these are added to the root container above the board and below the tooltip
layer, which is always top-most.

---

## 9. Accessibility specifics

Every accessibility setting is honored by the board renderer **and** by the shell
surfaces (HUD tally blinks, notification slides, chips, banners).

| Setting | Board behavior | Shell behavior |
| --- | --- | --- |
| Reduced Motion | the core pulse, rack breathing and packet bob hold steady; a spawn fades instead of popping; resolve animations crossfade; particle bursts are removed; tweens shorten | HUD meter pops and tally blinks are skipped; the end screen appears without its hold |
| Screen Shake | Trust Core hits and severe failures shake the board view (never the HUD); off → a border flash | — |
| Reduce Flashing | additive flashes (core hit, brownout dip, guard flash) are dimmed and routed through the flash limiter, which otherwise allows at most three full-brightness flashes per second across the board | meter-edge flashes are skipped |
| Colorblind-Safe Colors | every outcome uses its `colorCb` color; each outcome keeps its distinct glyph, so meaning never rests on hue alone | the HUD tally, wave report, end screen and Settings ▸ Audio glyphs follow the palette |
| Effects: Full / Reduced / Minimal | particle density 1 / 0.5 / 0 within the FX budget; Minimal keeps the outcome glyph stamps, the meaning-carrying guard beams and dotted token-stream links, and drops flow chevrons and confetti | — |

**Font scale** is not offered (see §15).

---

## 10. Content browsers

Read-only views over a shared `ContentPanel` base (dim + panel + title + Back + a
masked body that scrolls on the wheel, a touch drag, ↑ ↓ and PgUp / PgDn). Reached
from the hub; Esc returns to the hub. Layout is height-driven, so wrapped paragraphs
never overlap the next row, and zh-TW text uses the CJK line breaker.

- **How to Play.** A 30-second reference: the loop (lanes → Trust Core, build a
  serving platform), the meters, every request archetype with its base token counts,
  every building on the build bar, and the hotkey list generated from `ui/help.ts`.
- **Codex.** An encyclopedia over the live game data with four tabs — **Models**,
  **Hardware**, **Requests** (base token counts, with the end-of-campaign range in
  parentheses) and **Research** (plain-language explanations of every technique) —
  plus a right-aligned **Chat** tab: a DOM chat overlay that tracks the Pixi panel,
  where the player can ask an AI assistant about the game with their own OpenAI key
  (default model `gpt-5.4-mini`). `[` / `]` cycle all five tabs; the last data tab is
  remembered.
- **About.** The slogan, where the numbers come from (Artificial Analysis benchmarks,
  real GPU specs), the benchmark list, links (the benchmark source, the repository,
  the online build) and the build version.
- **Achievements.** §11.

The **Codex bubble** (the drip-fed tutorial persona, `src/ui/codex.ts`) is separate:
it walks a new player through placing racks, starting a wave, reading the meters and
opening the Lab, then speaks up the first time something new happens (a brownout or
throttle, an injection with no Red-Team Eval, an open jailbreak, the first late,
wrong or wrongly refused answer, a wave whose bill beat its income, low Trust). Enter
presses its Next. It yields its corner to the modals, the wave report, a left-docked
inspect panel and the request inspector, and stays silent in demo runs.

---

## 11. Achievements

48 achievements across 10 categories — progress, economy, serving, safety, models,
studio, research, hardware, history (the real 2023–26 bosses and crises, mapped
through `CAMPAIGN_THEMES[idx].boss / .special`) and hidden — each with a hand-drawn
vector glyph in the house pixel-neon style (`drawAchIcon`, `src/ui/achievements.ts`).

- **Definitions** (`src/achievements.ts`, `AchievementDef`): `id`, `category`, `name`,
  `desc`, `hidden?`, `goals?` (tiered bronze / silver / gold). Metadata only — the
  unlock logic lives in `AchievementTracker`, driven from `game.ts`, so `src/sim/**`
  never imports achievements.
- **Tracker hooks:** `onEvent` (the GameEvent stream), `onWaveCleared(s, lastReport)`,
  `tick(s)` (a live state scan), `onRunEnd(s, won)`, `resetRun()`, `markAgentMode()`.
  Demo runs feed nothing to the tracker.
- **Lifetime and per-run state:** a persisted lifetime blob (served, cash earned,
  distinct base models deployed, post-training methods used) plus transient per-run
  state (bosses cleared, a comeback armed, a brownout this wave). Tiered progress is
  lifetime plus the current run.
- **Surfacing:** a new unlock plays the achievement stinger and posts a card to the
  **notification stack** (§8); clicking the card opens the Achievements browser over
  the hub. The browser is a two-column grid with locked cells dimmed, hidden cells as
  "???", tiered cells with their level and a progress bar, and an "Unlocked X / Y"
  header.
- **No early flood:** tutorial-step "first X" milestones are deliberately absent — the
  earliest unlock needs real progress, and the lowest tier thresholds sit above what a
  first wave yields.
- **i18n:** chrome plus per-achievement `ach.<id>.name / desc` (English in the defs as
  the fallback; zh-TW in the dictionary).

---

## 12. GPTD identity tie-in

The system surface is a stage for GPTD's slogan — *"the board is the metaphor, the
numbers are real."* The Codex exposes the real open-weight roster, the real GPU
ladder and the real serving techniques; About names the benchmark source and links
the repository where the realism docs live; the Outcome Sounds row lets a player
learn, before the first wave, that a late answer and a wrong one sound different. No
other tower defense can credibly do this; the menu is where that credibility becomes
visible to the player.

---

## 13. Acceptance criteria

The surface must keep meeting these. `pnpm e2e` (`scripts/screenshot.mjs`) opens the hub
with Esc, walks into Settings with ↓ ↓ Enter, cycles every tab with `]`, and captures them
along with the title, the hotkey sheet and the end screen.

- **Persistence.** Every Settings control changes its effect immediately and survives
  a reload; Reset to Defaults restores the three store sections and leaves language
  and mode alone.
- **Freeze and resume.** Opening the hub, Settings or a browser during a wave freezes
  the sim and muffles the music; closing returns to the identical state.
- **Esc.** Esc follows the §3 stack from any surface, and with nothing to cancel opens
  the hub (never during a demo or agent run, never on the title).
- **No keys behind a menu.** While the hub, Settings, a browser or the hotkey sheet is
  open, Space cannot start a wave and no build or rack key acts.
- **One key table.** The hotkey sheet, How to Play and the button badges are generated
  from `HOTKEY_GROUPS`, so they always match the bound keys.
- **Accessibility.** Reduced Motion holds the core steady; Reduce Flashing removes
  full-screen flashes; the colorblind palette reaches the board, the HUD, the report,
  the end screen and Settings; Minimal effects keep every outcome's glyph.
- **Mode lock.** Display Mode in Settings stays disabled until the guided tutorial is
  finished or skipped, then switches live.
- **Two-step safety.** Restart, Quit and (with Confirm Before Selling on) Sell never
  act on a single tap.
- **Localization.** Every label exists in both `en.ts` and `zh-TW.ts`; a two-line
  explanation never overflows its row in either language.
- **Gate.** `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` stay green;
  `pnpm audio:check` passes after any change to the mix.

---

## 14. File map

| File | Role |
| --- | --- |
| `src/settings.ts` | SettingsStore: schema v2, load/merge, setters, `updateSettings`, `subscribe`, reset; re-exports `i18n` and `mode` |
| `src/ui/system.ts` | `SystemMenu` (hub, two-step Restart/Quit, ↑ ↓ Enter) and `SettingsPanel` (four tabs, footer) |
| `src/ui/widgets.ts` | `Slider`, `SegmentedControl`, `Toggle` |
| `src/ui/theme.ts` | `UIButton` (badges, arm/disarm, disabled reasons), `FocusList`, `drawPanel`, `label` |
| `src/ui/help.ts` | `BUILD_CODES`, `KEY`, `SPEED_CODES`, `HOTKEY_GROUPS`, `keyCap`, `HotkeyOverlay` |
| `src/ui/browsers.ts` | `ContentPanel`, `HelpPanel`, `CodexBrowser` (+ chat host), `AboutPanel` |
| `src/ui/achievements.ts` / `src/achievements.ts` | the Achievements browser, glyphs and notice; definitions and tracker |
| `src/ui/chat.ts` | the Codex chat overlay (bring-your-own key) |
| `src/ui/notifications.ts` | `NotificationStack` |
| `src/ui/denied.ts` | `denyReason`, `explainDenied`, `DeniedToast` |
| `src/ui/boardOverlay.ts` | PAUSED pill, cursor label, hover card, rotate hint |
| `src/ui/prefs.ts` | `getPref` / `setPref` over `gptd_ui` |
| `src/ui/uiSound.ts` | the interface-sound sink |
| `src/ui/hud.ts` | the quick controls and the gear entry |
| `src/audio/engine.ts`, `src/audio/mixer.ts` | settings-driven levels, background mute, previews, the bus graph |
| `src/tutorial.ts` | the Codex steps and tips, their per-player memory, `replay()` |
| `src/game.ts` | `openSystemMenu` / `openSettings` / `openContent`, `escape`, `onKey`, the `simRunning` gate, auto-start, pause on blur, `applySettings` |
| `src/i18n/{en,zh-TW}.ts` | every label (`sys.*`, `set.*`, `key.*`, `help.*`, `codex.*`, `about.*`, `ach.*`) |

---

## 15. Decisions

Settled; the spec above reflects them.

1. **HUD keeps the high-frequency controls.** Pause, Speed and Mute stay one tap in the
   HUD (pause and speed are wave controls; mute is an interruption affordance); the
   single ⚙ opens the hub; music volume and language live in Settings.
2. **Display Mode is switchable mid-run once the tutorial is done.** Mode is a pure view
   over one deterministic sim, so a lock would be artificial friction; the title sets
   the starting frame, and the mid-run switch waits only so the guided tutorial's
   bubbles stay coherent.
3. **The store is a façade.** New preferences live in one `gptd_settings` blob;
   `gptd_mode` and `gptd_lang` stay owned by `mode.ts` and `i18n`, which already carry
   consumers and change subscriptions. Callers use the SettingsStore API, never raw keys.
4. **Colorblind support is palette plus glyph.** Every outcome carries a distinct glyph
   as well as a color in `OUTCOME_STYLE`, so the palette switch is a single toggle and
   never the only cue.
5. **Codex and How to Play stay separate.** How to Play is a 30-second mid-run reference
   (keys, what each building does); the Codex is a lean-back encyclopedia and the realism
   showcase. Different size, different cadence.
6. **Interface sound is one bus.** Every widget sounds through `uiSound` on the ui bus,
   with its own slider, so menu sounds can be turned down without touching the game.

Open:

- **UI font scale** is not offered. A live font scale has to re-flow GPTD's
  width-fitted layouts (panels, cards, the HUD title band) in both languages; a
  reload-only scale would break the instant-apply rule. It needs a dedicated view-layer
  pass before it can ship.
