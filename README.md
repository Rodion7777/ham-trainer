# Na Paśmie / On Air — gra do nauki Q-kodów

A small, polished **browser game for learning the 28 amateur-radio Q-codes** used on the
Polish ham-radio exam (source: [egzaminkf.pl/qkody/baza.php](https://egzaminkf.pl/qkody/baza.php)).

**100% frontend, no backend, no build step, no install.** Just open `index.html`
in any modern browser (works straight from `file://` — double-click it). All progress
is saved in `localStorage`. Bilingual **PL / EN** (toggle in the top bar).

The **home screen is styled as a real HF transceiver faceplate** ("RIG-01"): a brushed-metal
panel with corner screws, an analog **S-meter** whose needle reads your mastery %, an amber
**LCD** stats readout (mastered / seen / due), a big illuminated **PTT** button that starts a
session, a tuning knob, and a bank of backlit **mode keys**. Pure CSS + inline SVG (no images),
accessible (10 real controls; everything decorative is `aria-hidden`), and it flips the LCD to a
readable positive display in light theme.

Behind the faceplate, the **lobby comes alive as a ham bench**, in two flavours with automatic
fallback:

- **3D (`js/lab3d.js`, raw WebGL — preferred):** a real perspective lab — shaded instrument
  enclosures on a foreshortened wood bench against a parts-drawer wall under a warm lamp, with a
  gentle eye-sway giving genuine near/far parallax. Each instrument's recessed **screen is a live
  texture** (a small 2D canvas repainted every frame and uploaded to GL): glowing-green
  **oscilloscopes** (sine + Lissajous), an **SDR spectrum + scrolling waterfall**, a ticking amber
  transceiver readout, red **7-seg frequency counters**, twitching **needle meters**, blinking
  **LEDs**. A **procedural photoreal post pipeline** lifts it from flat to cinematic: a
  PBR-ish relight (warm point lamp with wrap diffuse + Blinn-Phong specular + Schlick Fresnel +
  colored screen point-lights tinting the bench/metal), then render-to-FBO → guarded bright-pass →
  separable Gaussian **bloom** → **ACES filmic tonemap + warm grade + vignette + depth fog + film
  grain + a touch of chromatic aberration**. All RGBA8 framebuffers (no HDR-float dependency); a
  reused screen-space **guard field** keeps bloom/CA/grain off the faceplate so its text stays AA.
  If any framebuffer is incomplete it falls back to a direct (non-post) render, then to 2D, then
  plain — so the lobby never blanks. ~90 triangles, ~6 live textures + ~6 fullscreen post passes
  (bloom at half-res), one rAF ~30 fps; GL buffers/textures/FBOs disposed on every rebuild.
- **2D (`js/lab.js`):** the same instruments drawn as a flat procedural canvas scene — used when
  WebGL is unavailable.

The lobby tries **3D → 2D → plain background**. Either scene runs **only on the lobby**, keeps the
faceplate readable (baked lamp falloff + center dim-well, gear confined to the periphery),
**freezes to one static frame under `prefers-reduced-motion`**, pauses when the tab is hidden, and
is fully decorative (`aria-hidden`, behind all content). All pure procedural — **no images** — so
it still runs offline from `file://`.

## How to run

- **Double-click `index.html`**, or
- serve the folder statically, e.g. `python3 -m http.server` then open the printed URL.

## Deploy to GitHub Pages

The app is 100% static (relative paths, no build, no backend, no client-side routing),
so it hosts on GitHub Pages as-is. A `.nojekyll` file is included so Pages serves the
files verbatim.

**Option A — automatic via GitHub Actions (recommended).** A workflow at
`.github/workflows/deploy.yml` publishes the repo root on every push.

```bash
git init && git add -A && git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Build and deployment → Source = "GitHub Actions"**.
The site goes live at `https://<you>.github.io/<repo>/`.
(If your default branch is `master`, change the `branches:` line in the workflow.)

**Option B — deploy from a branch (no workflow).** Push the repo, then
**Settings → Pages → Source = "Deploy from a branch" → `main` / `/ (root)`**. You can
delete the Actions workflow if you use this method.

Works from any subpath (`/<repo>/`) because every asset/script reference is relative.

**Optional cleanup** (not needed for hosting, just slims the deploy): the following are
unused at runtime and can be removed — `assets/lab-bench.jpg`, `assets/lab-holes.png`,
`assets/lab-bench-holes_bkp.webp`, `js/mode-arcade.js`, `qcodes.json`. The only assets
loaded by the live app are `assets/lab-bench-holes.webp`, `assets/lobby-music.mp3`, and
`assets/hamsaber-music.mp3`.

## Game modes

**Two learning targets:** (1) the **meaning** of each code, and (2) the **format of the
value that follows it** — e.g. *QSA → a number 1–5*, *QRG → a frequency in kHz*,
*QTH → a location*, *QRO → nothing*, *QRL? → a question*. The literal example value
(`3710 kHz`, `5`, `WARSAW`) is just an illustration — it is **not** something to memorize.

One shared **5-box Leitner spaced-repetition engine** schedules every code across all modes,
so the same per-code mastery record updates no matter what you play. A code only counts as
**mastered** once you've produced it from memory by typing (Send It) — recognition alone is
capped, to defeat false fluency.

| Mode | What it trains |
|------|----------------|
| **Flow** | Calm, self-graded recall (the spine). Code → meaning, meaning → code, and example → situation; the reveal also shows the value format. You grade yourself *Again / Hard / Good*. |
| **Send It** | Read a described situation, **type** the 3-letter code from memory. The only mode that can mark a code *mastered*. |
| **Twin Trap** | 2-alternative forced choice between confusable pairs (QRO/QRP, QRQ/QRS, QRM/QRN, …) with contrast mnemonics. |
| **What follows?** | Drill the **value format**: given a code, pick what kind of value follows it (a 1–5 rating, a frequency, a time, a location, a count, nothing…). |
| **On the Band** | Fill realistic on-air QSO exchanges in context, interpret what a payload *kind* means (`QRM` + 1–5, `QSX` + offset), and master the question-vs-statement **“?”** trap (QRL vs QRL?). |
| **Fading Signals** | A real arcade catcher: labelled code chips fade & fall down lanes; slide the **tuner** (arrows / mouse / touch, or keys 1–5 to grab instantly) to catch the one matching the prompt and dodge the decoys. Waves, lives, combo, high scores. Reduced-motion users get a static, self-paced calm version of the same round. |
| **Sweep** | A **3D radar** (raw-WebGL perspective dome with a rotating sweep arm): contacts ride in from the rim toward the centre; intercept the one matching the prompt (click / keys 1–5) before it reaches the middle. Genuinely 3D (depth-scaled labels) with waves, lives, combo, high scores — and a static reduced-motion / no-WebGL fallback. |
| **Pile-Up** | 60-second timed MCQ sprint — combo, score, local high-scores. Weak codes are surfaced more, so the high-score chase *is* targeted study. |
| **Exam** | All 28 codes once each, no timer, bidirectional MCQ. Pass mark 75%, saved report card. |

The value format is also shown in the **Flow reveal** and the **Reference** table for every code.

### Grounded in real on-air practice

Beyond the exam meanings (kept verbatim from egzaminkf.pl), each code is enriched with how it's
*actually* used today, from ITU / ARRL / Wikipedia sources:
- **Scale direction** for the 1–5 rating codes — QRK/QSA go *higher = better*, QRM/QRN go *higher = worse* (shown colour-coded, never quizzed as a literal value).
- **RST reality note**: modern signal reports use RST (`59`/`599`), not QSA/QRK — and **QSA is 1–5, not 1–9** (a common Polish-source error; the "What follows?" drill even baits it as a distractor).
- **Honest labels**: codes rarely heard on air (QSV, QSD, QTR, QRK, QSA…) are tagged *rarely used*, and QUB/QWX as *maritime/aero*; **QWX is flagged as non-standard** (it isn't a real ITU code — weather is formally QUB).
- **Companion abbreviations** (CQ, DE, K, RST, 73, 88, PSE, TNX, FB, OM, HW?…) in the Reference, and a realistic **CW ragchew** exchange in On the Band, so learners can parse real traffic and see that `73`/`RST` are *not* Q-code values.

**Progress** (the `Progress` button / mastery ring) shows a per-code map, accuracy, a
confusion matrix, high scores, and an exam countdown. **Reference** (`Baza`) is the full
PL/EN code table with search.

## Visuals (WebGL)

A hand-rolled **WebGL** layer (raw shaders + a tiny mat4 module, no libraries — still runs from
`file://`) powers: an animated "radio shack at night" **background** (oscilloscope trace, drifting
tuning glows, scanlines); **GPU particle bursts** on correct answers, combos, and mastery; and a
full **3D scene** in the *Sweep* mode (a perspective radar dome with a rotating sweep arm, with
answer labels projected onto their 3D anchors and scaled by depth). It is theme-aware, **fully
disabled under `prefers-reduced-motion`/the motion toggle**, paused when the tab is hidden, and
**degrades gracefully** — if WebGL is unavailable the background falls back to plain CSS and the
3D radar falls back to a static, fully-playable layout.

## Accessibility

Keyboard-first (number keys / arrows / Enter, `Esc` to exit), explicit focus management,
`aria-live` announcements, correctness shown by icon **and** text (never colour alone),
true dark/light themes, and full `prefers-reduced-motion` support (which also disables the
WebGL effects). Sound (WebAudio CW beeps) is opt-in.

## Structure

```
index.html        app shell + classic <script> load order (no ES modules → runs from file://)
css/styles.css    theme + all components (dark/light, reduced-motion, mobile)
js/data.js        the 28 codes (PL/EN/examples) + value-format per code + families, situations, mnemonics, QSO exchanges
js/storage.js     localStorage persistence (+ export/import, migration)
js/srs.js         shared 5-box Leitner engine + scheduler + distractor picking
js/i18n.js        UI strings (t / tt helpers)
js/audio.js       WebAudio beeps + Morse (opt-in)
js/ui.js          shared rendering + a11y toolkit
js/fx.js          WebGL effects layer (animated background shader + GPU particle bursts)
js/app.js         routing, home hub, settings, reference table
js/mode-*.js       the game modes (flow, sendit, twintrap, format, onband, arcade, sweep[3D], pileup/exam)
js/dashboard.js    progress dashboard
qcodes.json       scraped source data (provenance; not used at runtime)
```

Data © their respective owners; meanings/examples sourced from egzaminkf.pl.
