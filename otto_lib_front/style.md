# Otto — Style Guide for Claude Code

A compact, reproducible guide to the Otto visual language. Hand this to Claude Code (or any developer) along with `colors_and_type.css` and they should be able to build new pages, apps, or screens that feel like part of the same product.

---

## 1. Brand voice (in 30 seconds)

Otto is a **mono-first**, paper-warm, technically literate brand. The vibe is:

- **Engineering field manual** — confident, declarative, unfussy
- **Honest materials** — flat colors, hard ink lines, no fake depth
- **Code as ornament** — JetBrains Mono is *the* typeface, not a fallback
- **Signal orange** as the only chromatic accent — used surgically

Avoid: drop shadows with blur, gradients, glassmorphism, soft pastel UI, emoji-as-icon (we tolerate them as draggable component glyphs and nothing else), corporate roundedness, generic SaaS purple.

Tone in copy:
- Lowercase headlines, sentence-case body, technical precision in details
- Single-line ledes that read like commit messages
- Eyebrow labels in the format `// 04 · workflows` (slash-slash, number, dot, lowercase noun)

---

## 2. Core CSS to import

Every page starts with:

```html
<link rel="stylesheet" href="colors_and_type.css">
```

That file declares all design tokens as CSS custom properties on `:root`. **Always reference tokens by var name** — never hardcode hex/px values in component CSS unless you're defining a new token.

To switch palettes, set `data-palette="ink"` or `data-palette="paper"` on `<html>` or `<body>`. Default is `cream`.

---

## 3. Tokens (cheat sheet)

### Type

| Token | Value | Use |
|---|---|---|
| `--font-mono` | JetBrains Mono | Default for everything |
| `--font-sans` | Inter | Reserved; use sparingly |
| `--text-2xs` … `--text-7xl` | 11px → 168px | Step scale |
| `--lh-tight / snug / normal / loose` | 1.0 / 1.15 / 1.45 / 1.7 | |
| `--tracking-tightest` | -0.04em | Display headlines |
| `--tracking-widest` | 0.16em | Eyebrows, all-caps labels |
| `--weight-regular … --weight-black` | 400 → 800 | |

### Color (Cream palette — default)

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#F2EDE4` | Page background |
| `--bg-2` | `#EAE3D6` | Recessed surface (sidebars, toolbar bg) |
| `--bg-3` | `#DED5C3` | Hover, dividers |
| `--surface` | `#FBF8F2` | Cards, elevated panels |
| `--fg-1` | `#14120E` | Primary text (ink) |
| `--fg-2` | `#4A453B` | Body / secondary |
| `--fg-3` | `#837C6E` | Captions, meta |
| `--fg-4` | `#B5AC9B` | Placeholders, disabled text |
| `--fg-inv` | `#FBF8F2` | Text on dark/accent |
| `--border-1` | `#14120E` | **Default border — the hard ink line** |
| `--border-2` | `#C9BFAC` | Soft border |
| `--border-3` | `#DED5C3` | Subtle, table rows |
| `--accent` | `#FF5B1F` | Signal orange |
| `--accent-hover` / `--accent-press` | | Use on interactions |
| `--accent-soft` | `#FFE4D6` | Highlight bg, selection chips |
| `--accent-fg` | `#FBF8F2` | Text on accent |
| `--success / warning / danger / info` | | Semantic, used sparingly |

### Spacing

`--space-0` through `--space-10`: `0, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128px`. Treat these as the only legal spacing values. `gap`, `padding`, `margin` should always reach for one of these.

### Radii

| Token | Value | Use |
|---|---|---|
| `--radius-0` | `0` | Inputs, code blocks, the workflow shell |
| `--radius-1` | `4px` | Inline code, small chips |
| `--radius-2` | `8px` | Default button/card |
| `--radius-3` | `12px` | Large cards |
| `--radius-4` | `18px` | Hero modules |
| `--radius-pill` | `999px` | Tags |

**Rule of thumb:** content surfaces (cards, panels, the workflow shell) use radius-0 and a 2px ink border. Buttons and inline chips use radius-2. Default to harder edges than you'd think.

### Borders

- `--bw-1`, `--bw-2`, `--bw-3` (1/2/3px). **2px is the default.** A 2px `var(--border-1)` border on a card is the most-used surface style in the system.

### Shadows

Otto uses **hard offset shadows**, never blurred:

| Token | Value |
|---|---|
| `--shadow-md` | `0 2px 0 0 #14120E` |
| `--shadow-lg` | `0 4px 0 0 #14120E` |
| `--shadow-xl` | `0 8px 0 0 #14120E` |

For a hover state, use a *colored* hard shadow: `box-shadow: 4px 4px 0 0 var(--accent);`. This is the signature interaction.

`--shadow-sm` is the only soft shadow allowed (1px, 8% black) and only for table-row separators.

### Focus ring

`box-shadow: var(--ring);` — a 3px transparent-accent ring. Use on `:focus-visible`.

---

## 4. Layout primitives

### Page shell

```css
html, body, #root {
  margin: 0;
  background: var(--bg);
  color: var(--fg-1);
  font-family: var(--font-mono);
}

body { font-feature-settings: "tnum" 1, "ss01" 1; }
```

The OpenType `tnum` (tabular numerals) and `ss01` features are critical — turning them on globally is what gives the brand its tabular, machine-precise feel.

### Section pattern

Every major content section follows the same anatomy:

```html
<section class="otto-section">
  <div class="otto-section-inner">
    <header class="otto-section-head">
      <span class="otto-section-eyebrow">// 04 · workflows</span>
      <h2 class="otto-section-title">draw the system.<br>otto runs it.</h2>
      <p class="otto-section-lede">single-line technical paragraph...</p>
    </header>
    <!-- content -->
  </div>
</section>
```

Styles:

```css
.otto-section {
  padding: 96px 32px 72px;
  display: flex; align-items: center; justify-content: center;
}
.otto-section-inner {
  max-width: 1280px; width: 100%; margin: 0 auto;
  display: flex; flex-direction: column; gap: 40px;
}
.otto-section-head {
  display: flex; flex-direction: column; gap: 18px; max-width: 720px;
}
.otto-section-eyebrow {
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 600;
}
.otto-section-title {
  font-family: var(--font-mono);
  font-weight: 800;
  font-size: clamp(40px, 6vw, 72px);
  line-height: 0.95;
  letter-spacing: -0.04em;
  margin: 0;
  color: var(--fg-1);
}
.otto-section-lede {
  font-family: var(--font-mono);
  font-size: 16px;
  line-height: 1.55;
  color: var(--fg-2);
  margin: 0;
  max-width: 64ch;
}
```

For multi-section pages, use vertical scroll-snap to make each section a full-viewport stop:

```css
html { scroll-snap-type: y mandatory; scroll-behavior: smooth; }
body { overflow-y: auto; scroll-snap-type: y mandatory; }
.otto-section {
  scroll-snap-align: start;
  scroll-snap-stop: always;
  min-height: 100vh;
}
```

### Top bar

```css
.otto-topbar {
  position: sticky; top: 0; z-index: 50;
  height: 64px;
  background: color-mix(in oklab, var(--bg) 82%, transparent);
  border-bottom: 2px solid var(--border-1);
  backdrop-filter: blur(12px);
}
.otto-topbar-inner {
  height: 100%; max-width: 1200px; margin: 0 auto;
  padding: 0 32px;
  display: flex; align-items: center; justify-content: space-between; gap: 32px;
}
```

The translucent-bg + 2px ink border + backdrop blur is the only place we use a soft effect — it lets content scroll behind the bar without losing the hard-line aesthetic.

---

## 5. Components

### Button

```css
.otto-btn {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 8px 14px;
  background: var(--surface);
  border: 1.5px solid var(--border-1);
  border-radius: var(--radius-2);
  color: var(--fg-1);
  cursor: pointer;
  transition: background 120ms, color 120ms, transform 120ms;
}
.otto-btn:hover {
  background: var(--fg-1);
  color: var(--fg-inv);
}
.otto-btn:active { transform: translateY(1px); }
.otto-btn:focus-visible { outline: none; box-shadow: var(--ring); }

.otto-btn--primary {
  background: var(--accent);
  color: var(--accent-fg);
  border-color: var(--accent);
}
.otto-btn--primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

.otto-btn--danger:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-fg);
}

.otto-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  background: var(--surface);
  color: var(--fg-1);
}
```

Use lowercase labels with a leading glyph: `↓ export`, `× clear`, `+ new node`.

### Input

```css
.otto-input {
  font-family: var(--font-mono);
  font-size: 13px;
  padding: 8px 12px;
  background: var(--surface);
  border: 1.5px solid var(--border-1);
  border-radius: var(--radius-0);
  color: var(--fg-1);
}
.otto-input:focus { outline: none; box-shadow: var(--ring); }
.otto-input::placeholder { color: var(--fg-4); }
```

Inputs are radius-0. Always.

### Card

```css
.otto-card {
  background: var(--surface);
  border: 2px solid var(--border-1);
  border-radius: var(--radius-3);
  padding: 24px;
  transition: box-shadow 150ms, transform 150ms;
}
.otto-card:hover {
  box-shadow: 4px 4px 0 0 var(--accent);
  transform: translate(-2px, -2px);
}
```

The hover translate matches the shadow offset so the card slides "off" its accent shadow — Otto's signature interaction.

### Badge / chip

```css
.otto-badge {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 3px 8px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--fg-1);
}
.otto-badge--accent {
  background: var(--accent-soft);
  border-color: var(--accent);
}
```

### Eyebrow label

```css
.otto-eyebrow {
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 600;
}
```

Format: `// 0X · noun`. The slashes are intentional — they read as both a code-comment marker and a section delimiter.

### Toolbar

A horizontal strip with a meta count on the left and action buttons on the right:

```css
.otto-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px;
  background: var(--surface);
  border-bottom: 2px solid var(--border-1);
}
.otto-toolbar-meta {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--fg-3);
  font-weight: 600;
}
.otto-toolbar-actions { display: flex; gap: 8px; align-items: center; }
```

### Segmented control (e.g. zoom −/100%/+)

```css
.otto-segmented {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--border-1);
}
.otto-segmented .otto-btn {
  border: none;
  border-radius: 0;
}
.otto-segmented .otto-btn + .otto-btn {
  border-left: 1px solid var(--border-1);
}
```

### Sidebar palette / navigation

```css
.otto-sidebar {
  background: var(--bg-2);
  border-right: 2px solid var(--border-1);
  display: flex; flex-direction: column; overflow: hidden;
}
.otto-sidebar-head {
  font-family: var(--font-mono);
  font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
  font-weight: 700; color: var(--fg-3);
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-2);
}
.otto-sidebar-cat-title {
  font-family: var(--font-mono);
  font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
  font-weight: 700; color: var(--fg-3);
  padding: 0 6px 8px;
  border-bottom: 1px dashed var(--border-2);
  margin-bottom: 8px;
}
```

### Code block

```css
.otto-code {
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.7;
  background: var(--bg-2);
  border: 1.5px solid var(--border-1);
  border-radius: var(--radius-0);
  padding: 18px 20px;
  overflow-x: auto;
  white-space: pre;
}
```

### Snippet header (file path / lang label)

A common pattern: a small mono header above a code block showing `path/to/file.ts`:

```css
.otto-snippet-header {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--fg-3);
  padding: 8px 12px;
  background: var(--bg-3);
  border: 1.5px solid var(--border-1);
  border-bottom: none;
  border-radius: var(--radius-0);
}
```

### Empty state

Always centered in its container, always quiet:

```css
.otto-empty {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px;
  pointer-events: none;
  font-family: var(--font-mono);
  color: var(--fg-3);
  font-size: 13px;
  letter-spacing: 0.04em;
}
.otto-empty-glyph {
  font-size: 24px;
  letter-spacing: 0.2em;
  color: var(--fg-4);
}
```

Use ASCII / mono glyphs for the icon: `▸▸▸`, `///`, `░░░`, `[ ]`, `>_`. Never an emoji here.

### Dot grid background (canvases)

```css
.otto-grid-bg {
  position: absolute; inset: 0;
  background-image: radial-gradient(
    circle,
    color-mix(in oklab, var(--fg-1) 15%, transparent) 1px,
    transparent 1px
  );
  background-size: 20px 20px;
  pointer-events: none;
}
```

Animate `background-position` to pan, or change `background-size` proportionally to zoom.

---

## 6. Iconography

- **Default:** ASCII / Unicode mono glyphs — `→`, `↓`, `×`, `+`, `−`, `▸`, `//`, `>_`, `[ ]`, `※`. They render in the same JetBrains Mono and need no asset pipeline.
- **Acceptable:** SVG line icons at 1.5px stroke weight matching `--border-1`, no fill, square viewBox, 18–24px sizes.
- **Forbidden:** filled icon sets, multi-color icons, emoji-as-functional-icon. Emoji are only OK as content (e.g. component-palette glyphs in the workflow builder, where they represent user content rather than UI affordance).

---

## 7. Motion

- Hover transitions: `120ms` linear or `transition: background 120ms, color 120ms`
- Card lift: `150ms` for `transform` + `box-shadow`
- Page transitions: scroll-snap handles it; don't add custom routing animations
- Easing: default linear or `cubic-bezier(0.2, 0.8, 0.2, 1)` for any "hop" feel
- **Never** animate opacity-fade alone for component entrance — use translate + opacity together, ~6px travel

---

## 8. Patterns

### Numbered sections

The whole site is implicitly numbered. Always use:
```
// 01 · any model
// 02 · memory
// 03 · authorization
// 04 · workflows
```

These eyebrow labels are the section's name. The headline below them is allowed to be looser.

### Two-column body

When pairing prose with a code or visual artifact: prose left (40%), artifact right (60%), 48px gap, both top-aligned. Code and visuals get a 2px ink border; prose has no container.

### Empty + populated states

Every interactive surface needs a defined empty state. Use the `.otto-empty` pattern with a glyph and a single instructional sentence. Don't add CTAs to empty states — the affordance should be elsewhere on the page.

### Tabular data

```css
.otto-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 13px;
}
.otto-table th {
  text-align: left;
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--fg-3);
  padding: 8px 12px;
  border-bottom: 2px solid var(--border-1);
}
.otto-table td {
  padding: 12px;
  border-bottom: 1px solid var(--border-3);
  font-variant-numeric: tabular-nums;
}
.otto-table tr:hover td { background: var(--bg-2); }
```

Numbers in any data context: always `font-variant-numeric: tabular-nums`.

### Forms

Vertical stacks. Label above input, 6px gap. Group with 16px gap. `:focus-visible` always shows the orange ring. Validation errors use `--danger` for the message and a 1.5px `--danger` left-border on the input.

---

## 9. Accessibility minimums

- All interactive elements have a `:focus-visible` state using `--ring`.
- Color contrast: `--fg-1` on `--bg` is 14:1; `--fg-2` on `--bg` is 7.4:1; `--fg-3` is 4.6:1 — keep small body text at fg-2 minimum.
- The accent (`#FF5B1F`) on `--bg` is 3.8:1 — do not use accent for body text. Use it for headlines (large enough to pass), eyebrows, and as a fill behind `--accent-fg` text.
- Keyboard-reachable everything; no hover-only affordances without a keyboard equivalent.

---

## 10. Quick-start for Claude Code

When asked to build a new page or app in this style:

1. Import `colors_and_type.css` — never redefine tokens
2. Set `font-family: var(--font-mono)` on `body` and let it cascade
3. Wrap each page-level concept in an `.otto-section` with the eyebrow/title/lede header pattern
4. Use 2px `var(--border-1)` borders on all major surfaces; radius-0 or radius-3 only
5. Reach for hard offset shadows (`var(--shadow-md)` family) — never blurred
6. Use `--accent` exactly once per visual region as the chromatic anchor
7. Keep all UI text lowercase; reserve title-case for proper nouns and code identifiers
8. Add `font-feature-settings: "tnum" 1, "ss01" 1;` to body for tabular numerals
9. Empty states: ASCII glyph + one mono caption, never an illustration
10. When in doubt, *flatter, harder, more typographic*. Otto over-indexes on the page-as-document feel.

---

## File reference

- `colors_and_type.css` — all tokens. Always imported first.
- `fonts/fonts.css` — JetBrains Mono + Inter @font-face declarations.
- `ui_kits/marketing/marketing.css` — full component implementations for reference.
- `ui_kits/marketing/index.html` — live example assembling every pattern in this guide.
