# Design — Home Cloud Dashboard

This document defines the visual language, design tokens, and component specifications used
across the Home Cloud dashboard UI (`dashboard/`). The tokens live in
`dashboard/src/index.css`; if this file and the CSS disagree, the CSS wins and this file needs
a fix.

The marketing site in `landing/` has its own design tokens (`landing/src/styles/tokens.css`).
This document covers the dashboard only.

---

## Design Philosophy

The dashboard is a desktop-style workspace in the browser: a wallpaper, floating windows, a
dock, and a system tray. Chrome is **flat, near-black, and precise** (in the spirit of
Vercel's dark UI), with Windows-style layout conventions (centered dock, running-app
indicators, caption-style window controls).

Windows and bars are fully opaque. The wallpaper is only visible on the desktop itself,
never through a panel. The one remaining translucent surface is the login card (a dense
"Mica" panel, see below) and the dock tooltip.

### Core Tenets

1. **Opaque surfaces.** Windows, dock, and tray are solid `#000000` with a hairline border.
   No wallpaper bleed-through, no stacked transparency.
2. **Restraint over spectacle.** No neon glows, no gradient buttons, no animated blur orbs,
   no AI badges. Every visual element earns its presence by serving a task.
3. **Data is the decoration.** Numbers, status indicators, paths, and log output are
   first-class content. Color and type exist to make data legible.
4. **Neutral chrome, semantic color.** The UI itself is white/gray. The only color comes
   from status indicators (green/amber/red), the update notification dot, and the danger
   action (sign out). When you see color, it means something.
5. **Consistency is an affordance.** Same surfaces, same borders, same shadows, same spacing
   everywhere. Predictability speeds up task completion.

---

## Color Tokens

### Surfaces

| Token                | Value      | Usage                                  |
|----------------------|------------|----------------------------------------|
| `--bg-base`          | `#000000`  | Page background, window body           |
| `--bg-surface`       | `#0a0a0a`  | Window title bar, cards                |
| `--bg-surface-solid` | `#111111`  | Active title bar, inputs, chips        |
| `--bg-raised`        | `#171717`  | Elevated rows and hover states         |
| `--bg-overlay`       | `#000000`  | Modal and menu backdrops               |
| `--bg-glass-input`   | `#111111`  | Input backgrounds                      |

`--bg-card` is a legacy alias of `--bg-surface`. Do not use it in new code.

### Borders

| Token                | Value      | Usage                                  |
|----------------------|------------|----------------------------------------|
| `--border-subtle`    | `#262626`  | Window, dock, and tray edges; dividers |
| `--border-default`   | `#333333`  | Default interactive edges, top border  |
| `--border-strong`    | `#404040`  | Focused or emphasized edges            |
| `--border-highlight` | `#525252`  | Specular edges                         |

Frames use `--border-subtle` on three sides and `--border-default` on top, which reads as
light falling from above. An active window brightens to `#383838` / `#4a4a4a`.

### Text

| Token              | Value      | Usage                    |
|--------------------|------------|--------------------------|
| `--text-primary`   | `#ededed`  | Headings, values         |
| `--text-secondary` | `#a1a1a1`  | Body, labels             |
| `--text-muted`     | `#737373`  | Hints, placeholders      |
| `--text-on-accent` | `#000000`  | Text on white buttons    |

### Accent (Neutral White)

There is no chromatic accent. Interactive highlights are white or gray.

| Token            | Value                        | Usage                      |
|------------------|------------------------------|----------------------------|
| `--accent`       | `#ffffff`                    | Primary interactive        |
| `--accent-dim`   | `rgba(255, 255, 255, 0.08)`  | Hover and tint backgrounds |
| `--accent-hover` | `#eaeaea`                    | Pressed state              |
| Focus ring       | `rgba(255, 255, 255, 0.60)`  | `:focus-visible` outline   |

### Status

| State   | Token     | Foreground | Dim background (`--*-dim`)  |
|---------|-----------|------------|-----------------------------|
| OK      | `--ok`    | `#34d399`  | `rgba(52, 211, 153, 0.12)`  |
| Warning | `--warn`  | `#fbbf24`  | `rgba(251, 191, 36, 0.12)`  |
| Error   | `--error` | `#f87171`  | `rgba(248, 113, 113, 0.12)` |

Status colors are always paired with a non-color signal (icon, label, or shape).

### Danger / Sign-out

| State   | Value                                            |
|---------|--------------------------------------------------|
| Default | `color: #dc2626` on `rgba(185, 28, 28, 0.14)` bg |
| Hover   | `color: #ef4444` on `rgba(185, 28, 28, 0.25)` bg |
| Active  | `color: #fca5a5` on `rgba(185, 28, 28, 0.35)` bg |

### Update notification

A small amber dot (`#f59e0b`, 7.5px) on the Settings dock icon and the mobile nav marks an
available update.

---

## Typography

Fonts are bundled through `@fontsource/inter` and `@fontsource/jetbrains-mono`.

| Token       | Value                                   |
|-------------|-----------------------------------------|
| `--sans`    | Inter, then the system UI stack         |
| `--heading` | Inter, then the system UI stack         |
| `--mono`    | JetBrains Mono, then system monospace   |

| Element    | Family         | Size   | Weight | Tracking  |
|------------|----------------|--------|--------|-----------|
| H1         | Inter          | 24px   | 600    | -0.6px    |
| H2         | Inter          | 16px   | 600    | -0.2px    |
| Login card title | Inter    | 22px   | 600    | -0.5px    |
| Tooltip    | Inter          | 11.5px | 500    | -0.01em   |
| Code/Mono  | JetBrains Mono | 12px   | 400    | n/a       |
| Tray clock | JetBrains Mono | 12px   | 500    | -0.01em   |
| Tray tunnel badge | JetBrains Mono | 11px | 400 | n/a     |

---

## Elevation (Shadows)

| Token            | Value                                                                  | Usage              |
|------------------|------------------------------------------------------------------------|--------------------|
| `--shadow-sm`    | `0 2px 8px rgba(0, 0, 0, 0.35)`                                        | Buttons, badges    |
| `--shadow-md`    | `0 8px 24px -4px rgba(0, 0, 0, 0.55)`                                  | Cards, menus       |
| `--shadow-lg`    | `0 16px 48px -8px rgba(0, 0, 0, 0.65)`                                 | Modals             |
| Window (idle)    | `0 24px 64px -12px rgba(0, 0, 0, 0.85), 0 4px 16px rgba(0, 0, 0, 0.60)` | `.os-window`      |
| Window (active)  | `0 32px 80px -16px rgba(0, 0, 0, 0.95), 0 4px 20px rgba(0, 0, 0, 0.70), inset 0 1px 0 rgba(255, 255, 255, 0.10)` | `.os-window.active` |
| Dock and tray    | `0 4px 16px rgba(0, 0, 0, 0.70)`                                       | `.taskbar-center`, `.taskbar-right` |

---

## Motion

| Token              | Value                                | Usage               |
|--------------------|--------------------------------------|---------------------|
| `--ease-out-quart` | `cubic-bezier(0.25, 1, 0.5, 1)`      | General transitions |
| `--ease-out-expo`  | `cubic-bezier(0.16, 1, 0.3, 1)`      | Enter animations    |
| `--ease-spring`    | `cubic-bezier(0.34, 1.56, 0.64, 1)`  | Bounce / pop        |
| `--duration-fast`  | `140ms`                              | Hover, focus        |
| `--duration-base`  | `220ms`                              | State changes       |
| `--duration-slow`  | `320ms`                              | Page transitions    |

Dock items use a faster `100ms` transition for background and color. `prefers-reduced-motion`
is honored in the Docker, Settings, and window-skeleton styles; the dock and window transitions
do not respond to it yet.

---

## Spacing and Layout

4px base grid. All spacing uses multiples of 4.

| Token        | Value |
|--------------|-------|
| `--space-1`  | 4px   |
| `--space-2`  | 8px   |
| `--space-3`  | 12px  |
| `--space-4`  | 16px  |
| `--space-5`  | 20px  |
| `--space-6`  | 24px  |
| `--space-8`  | 32px  |
| `--space-12` | 48px  |

| Token                  | Value  | Usage                          |
|------------------------|--------|--------------------------------|
| `--taskbar-height`     | `56px` | Desktop dock and tray row      |
| `--mobile-nav-height`  | `58px` | Bottom navigation on phones    |

Safe-area insets (`--safe-top` and friends), `--app-height` (`100dvh`) and `--keyboard-height`
are defined for mobile layouts.

---

## Component Specifications

### Window (`.os-window`)

- Background `#000000`, border `1px solid #262626`, top border `#333333`
- Border radius: `8px`; `0` when maximized
- Title bar (`.window-titlebar`): `36px` tall, background `#0a0a0a` (`#111111` when the window
  is active), bottom border `#222222`, `cursor: grab` while draggable
- Minimized: fades to `opacity: 0` and scales to `0.85`, translating down `24px`

### Dock (`.taskbar-center`)

- Background `#000000`, border `#262626` (top `#333333`), radius `8px`, padding `4px 6px`
- Icon tiles (`.dock-item`): `40×40px`, radius `5px`, icon colour `#c4c4cc`
- Hover: `rgba(255, 255, 255, 0.08)` background, white icon
- Active: `rgba(255, 255, 255, 0.11)` background
- Running indicator: `6×3px` dot, colour `#88888e`, radius `1.5px`
- Active indicator: `16px` wide pill, colour `#ffffff`, glow `0 0 6px rgba(255, 255, 255, 0.35)`
- Focus: `2px solid rgba(255, 255, 255, 0.60)`, offset `1px`

### System Tray (`.taskbar-right`)

- Same background, border, and radius as the dock; padding `4px 8px`
- Sign-out button: always crimson (`#dc2626`), `30×30px`, radius `6px`
- Clock: JetBrains Mono `12px/500`, colour `#f3f4f6`
- Tunnel badge: mono `11px`, border `#262626`, background `#111111`, with a `6px` status dot
  (`#34d399` online, `--error` offline)

### Tooltip (`.dock-tooltip`)

```css
background: rgba(32, 32, 36, 0.96);
backdrop-filter: blur(24px);
border: 1px solid rgba(255, 255, 255, 0.10);
border-radius: 6px;
padding: 5px 9px;
font-size: 11.5px;
```

### Login Card (`.card`)

The one dense "Mica" surface: a near-opaque charcoal panel over the wallpaper.

```css
background: rgba(32, 32, 36, 0.98);
backdrop-filter: blur(80px) saturate(120%);
border: 1px solid rgba(255, 255, 255, 0.08);
border-top: 1px solid rgba(255, 255, 255, 0.14);
border-radius: 14px;
```

- Max width `420px`, padding `36px 32px`
- Opacity must stay at `0.98` or higher. Lower values let the wallpaper's wave contours show
  through as dark shapes inside the card.

### Primary Button (Solid White)

```css
background: #ffffff;
color: #09090b;
font-weight: 550;
border-radius: 8px;
padding: 11px 18px;
font-size: 14px;
box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
```

- Hover: `background: #f4f4f5`
- Active: `background: #e4e4e7; transform: scale(0.99)`
- Disabled: `opacity: 0.5`

### Input Fields

```css
background: rgba(255, 255, 255, 0.05);
border: 1px solid rgba(255, 255, 255, 0.10);
border-radius: 8px;
padding: 11px 14px;
font-size: 14px;
color: #ffffff;
```

- Focus: `border-color: rgba(255, 255, 255, 0.30); box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18)`
- Placeholder: `#64748b`

---

## Wallpaper

The desktop shows a wallpaper behind the windows. The default is a light, high-contrast 3D
layered fluid-wave topography (`dashboard/src/assets/desktop_wallpaper.jpg`). Additional presets
live next to it (`wallpaper_night.jpg`, `wallpaper_sand.jpg`, `wallpaper_mist.jpg`) and can be
changed from the Settings app. The choice is stored in `localStorage`
(`home-cloud.wallpaper`); a custom photo is stored in IndexedDB.

The default is deliberately light so the black windows and dock stand out with strong
figure-ground separation. `--desktop-wallpaper-color` (`#0d1522`) is the fallback colour while
the image loads.

---

## Anti-patterns (Do Not)

| Anti-pattern                        | Why                                            |
|-------------------------------------|------------------------------------------------|
| Glassmorphism (< 0.85 opacity)      | Wallpaper bleeds through, looks muddy          |
| Neon glow `box-shadow` on buttons   | Screams "AI dashboard template"                |
| Gradient buttons                    | Overdesigned for a tool UI                     |
| Animated floating blur orbs         | Pure decoration, zero utility                  |
| "AI-powered" / "Secure Node" badges | Marketing copy, not product UI                 |
| macOS traffic-light window controls | Wrong OS reference                             |
| Dock icon magnification on hover    | macOS behavior, not the model we follow        |
| Purple/indigo or blue/cyan accents  | The generic "dark dashboard" palette           |
| SVG noise texture overlays          | Over-engineered, negligible visual impact      |
| `contrast()` / `brightness()` in `backdrop-filter` | Unpredictable cross-browser results |

---

## Branding

- **Name:** Home Cloud (not "Home Cloud OS", not "HomeCloud")
- **Voice:** Precise, minimal, direct. The tool disappears into the task.

---

## Accessibility

- WCAG AA minimum contrast ratios
- `:focus-visible` ring (`2px solid rgba(255, 255, 255, 0.60)`) on all interactive elements
- Keyboard-navigable dock and window controls
- Status colors always paired with a non-color signal (icon, label, or shape)
- Respect `prefers-reduced-motion` (partial, see Motion)

---

## File Reference

| File                                          | Contains                                  |
|-----------------------------------------------|-------------------------------------------|
| `dashboard/src/index.css`                     | Global design tokens (CSS custom props)   |
| `dashboard/src/App.css`                       | Dock, tray, window frame, layout          |
| `dashboard/src/pages/login.module.css`        | Login card, button, input                 |
| `dashboard/src/assets/desktop_wallpaper.jpg`  | Default desktop wallpaper                 |
