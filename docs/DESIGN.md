# Design — Home Cloud Dashboard

This document defines the visual language, material system, component specifications, and
design tokens used across the Home Cloud dashboard UI. It is the single source of truth for
how the interface should look and behave.

---

## Design Philosophy

The dashboard emulates **Windows 11 Dark Mode** — specifically its **Mica** material system.
Surfaces are near-opaque dark panels that subtly sample the wallpaper's color temperature
without ever revealing distinct shapes behind them. The result feels solid, grounded, and
professional — not transparent or flashy.

### Core Tenets

1. **Mica, not glass.** Surfaces are dark, dense, and near-opaque (≥ 0.98 alpha). The
   wallpaper tints the surface color imperceptibly — you never see shapes through a panel.
2. **Restraint over spectacle.** No neon glows, no gradient buttons, no animated blur orbs,
   no AI badges. Every visual element earns its presence by serving a task.
3. **Data is the decoration.** Numbers, status indicators, paths, and log output are
   first-class content. Color and type exist to make data legible.
4. **Neutral chrome, semantic color.** The UI itself is white/gray — no accent color on
   chrome. The only color comes from status indicators (green/yellow/red) and the danger
   action (red). This means when you see color, it always means something.
5. **Consistency is an affordance.** Same material, same borders, same shadows, same spacing
   everywhere. Predictability accelerates task completion.

---

## Material System

### Mica Dark (Primary Surface)

Used for: login card, dock, system tray, window frames, modal dialogs, dropdown menus.

```css
background: rgba(32, 32, 36, 0.98);
backdrop-filter: blur(80px) saturate(120%);
-webkit-backdrop-filter: blur(80px) saturate(120%);
border: 1px solid rgba(255, 255, 255, 0.08);
border-top: 1px solid rgba(255, 255, 255, 0.14);
```

**Key properties:**
- **Base color:** `rgb(32, 32, 36)` — neutral charcoal with no blue or purple tint
- **Opacity:** `0.98` — near-opaque, wallpaper only shifts the hue imperceptibly
- **Blur:** `80px` — heavy enough to obliterate any background detail
- **Saturation:** `120%` — slight color boost from wallpaper without going vivid
- **Top border highlight:** brighter than side borders — mimics light falling from above

### Why not lower opacity?

With the current light fluid-wave wallpaper, anything below ~0.96 lets wave contours bleed
through as visible dark shapes inside panels. Real Windows 11 Mica on dark mode is
functionally opaque against high-contrast wallpapers.

---

## Color Tokens

### Surfaces

| Token               | Value                          | Usage                        |
|----------------------|--------------------------------|------------------------------|
| `--bg-base`          | `oklch(10% 0.015 250)`        | Page/body background         |
| `--bg-surface`       | `rgba(18, 22, 34, 0.72)`      | Legacy — avoid in new code   |
| `--bg-surface-solid` | `oklch(14% 0.015 250)`        | Solid fallback surfaces      |
| `--bg-raised`        | `rgba(30, 36, 52, 0.65)`      | Elevated cards within panels |
| `--bg-card`          | `rgba(22, 27, 40, 0.60)`      | Legacy — avoid in new code   |
| Mica Dark            | `rgba(32, 32, 36, 0.98)`      | **Primary panel material**   |

### Borders

| Token               | Value                          | Usage                     |
|----------------------|--------------------------------|---------------------------|
| `--border-subtle`    | `rgba(255, 255, 255, 0.08)`   | Panel edges, dividers     |
| `--border-default`   | `rgba(255, 255, 255, 0.13)`   | Default interactive edges |
| `--border-strong`    | `rgba(255, 255, 255, 0.22)`   | Focused / emphasized      |
| `--border-highlight` | `rgba(255, 255, 255, 0.35)`   | Specular / glow edges     |
| Top highlight        | `rgba(255, 255, 255, 0.14)`   | Mica panel top border     |

### Text

| Token              | Value                      | Usage              |
|--------------------|----------------------------|--------------------|
| `--text-primary`   | `oklch(96% 0.005 240)`    | Headings, values   |
| `--text-secondary` | `oklch(75% 0.012 240)`    | Body, labels       |
| `--text-muted`     | `oklch(52% 0.015 240)`    | Hints, placeholders|
| `--text-on-accent` | `#09090b`                  | Text on white buttons|

### Accent (Neutral White)

The UI uses **no chromatic accent**. Interactive highlights are white/gray. The only hue in
the interface comes from status colors (green, yellow, red) and the danger/sign-out action.

| Token             | Value                         | Usage                    |
|-------------------|-------------------------------|--------------------------|
| `--accent`        | `#ffffff`                     | Primary interactive      |
| `--accent-dim`    | `rgba(255, 255, 255, 0.08)`  | Hover / tint bg          |
| `--accent-text`   | `#f4f4f5`                     | Highlighted text         |
| `--accent-hover`  | `#e4e4e7`                     | Pressed state            |
| Active indicator  | `#ffffff`                     | Dock active pill         |
| Focus ring        | `rgba(255, 255, 255, 0.60)`  | `:focus-visible` outline |

### Status

| State   | Foreground | Dim Background                    |
|---------|-----------|-----------------------------------|
| OK      | `#34d399` | `rgba(52, 211, 153, 0.12)`       |
| Warning | `#fbbf24` | `rgba(251, 191, 36, 0.12)`       |
| Error   | `#f87171` | `rgba(248, 113, 113, 0.12)`      |

### Danger / Sign-out

| State   | Value                            |
|---------|----------------------------------|
| Default | `color: #dc2626` on `rgba(185, 28, 28, 0.14)` bg |
| Hover   | `color: #ef4444` on `rgba(185, 28, 28, 0.25)` bg |
| Active  | `color: #fca5a5` on `rgba(185, 28, 28, 0.35)` bg |

---

## Typography

| Element    | Family         | Size   | Weight | Tracking   |
|------------|----------------|--------|--------|------------|
| Body       | Inter (sans)   | 13px   | 400    | -0.012em   |
| H1         | Inter          | 24px   | 600    | -0.6px     |
| H2         | Inter          | 16px   | 600    | -0.2px     |
| Card title | Inter          | 22px   | 600    | -0.5px     |
| Label      | Inter          | 12.5px | 500    | -0.01em    |
| Code/Mono  | JetBrains Mono | 12px   | 400    | —          |
| Tray time  | JetBrains Mono | 12px   | 500    | -0.01em    |
| Tooltip    | Inter          | 11.5px | 500    | -0.01em    |

---

## Elevation (Shadows)

| Level     | Value                                                     | Usage           |
|-----------|-----------------------------------------------------------|-----------------|
| Small     | `0 2px 8px rgba(0, 0, 0, 0.35)`                          | Buttons, badges |
| Medium    | `0 8px 24px -4px rgba(0, 0, 0, 0.55)`                    | Cards, menus    |
| Large     | `0 16px 48px -8px rgba(0, 0, 0, 0.65)`                   | Modals          |
| Dock      | `0 10px 30px -2px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.35)` | Dock & tray |
| Card      | `0 24px 64px -12px rgba(0, 0, 0, 0.65), 0 4px 16px rgba(0, 0, 0, 0.40)` | Login card  |

---

## Motion

| Token              | Value                            | Usage                 |
|--------------------|----------------------------------|-----------------------|
| `--ease-out-quart` | `cubic-bezier(0.25, 1, 0.5, 1)` | General transitions   |
| `--ease-out-expo`  | `cubic-bezier(0.16, 1, 0.3, 1)` | Enter animations      |
| `--ease-spring`    | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Bounce / pop      |
| `--duration-fast`  | `140ms`                          | Hover, focus          |
| `--duration-base`  | `220ms`                          | State changes         |
| `--duration-slow`  | `320ms`                          | Page transitions      |

---

## Component Specifications

### Dock (`.taskbar-center`)

- Material: Mica Dark
- Border radius: `10px`
- Padding: `4px 6px`
- Icon tiles: `40×40px`, icon size `18px`
- Hover: `rgba(255, 255, 255, 0.08)` bg
- Active: `rgba(255, 255, 255, 0.11)` bg
- Running indicator: `6×3px` dot, color `#88888e`, radius `1.5px`
- Active indicator: `16px` wide pill, color `#ffffff`, subtle glow `0 0 6px rgba(255, 255, 255, 0.35)`

### System Tray (`.taskbar-right`)

- Material: Mica Dark
- Border radius: `10px`
- Padding: `4px 8px`
- Sign-out button: always crimson red (`#dc2626`), `30×30px`, radius `6px`
- Clock: JetBrains Mono `12px/500`, color `#f3f4f6`
- Tunnel badge: mono `11px`, border `rgba(255, 255, 255, 0.08)`, bg `rgba(255, 255, 255, 0.06)`

### Login Card (`.card`)

- Material: Mica Dark
- Max width: `420px`
- Padding: `36px 32px`
- Border radius: `14px`
- Title: `22px/600`, color `--text-primary`
- Subtitle: `13.5px/400`, color `--text-secondary`

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

### Tooltip

```css
background: rgba(32, 32, 36, 0.96);
backdrop-filter: blur(24px);
border: 1px solid rgba(255, 255, 255, 0.10);
border-radius: 6px;
padding: 5px 9px;
font-size: 11.5px;
```

---

## Spacing

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

---

## Wallpaper

Default wallpaper: light-edition 3D layered fluid wave topography.  
File: `dashboard/src/assets/desktop_wallpaper.jpg`

Additional presets live next to it (`wallpaper_night.jpg`, `wallpaper_sand.jpg`,
`wallpaper_mist.jpg`) and can be changed from the Settings app. Choice is stored in
`localStorage` (`home-cloud.wallpaper`); a custom photo is stored in IndexedDB.

The default wallpaper is deliberately high-contrast and light-toned. This makes the dark Mica
panels stand out with strong figure-ground separation. The high contrast is also why Mica
opacity must stay at ≥ 0.98 — any lower and wave contours bleed through.

---

## Anti-patterns (Do Not)

These are patterns explicitly rejected for this project:

| Anti-pattern                      | Why                                            |
|-----------------------------------|------------------------------------------------|
| Glassmorphism (< 0.85 opacity)    | Wallpaper bleeds through, looks muddy          |
| Neon glow `box-shadow` on buttons | Screams "AI dashboard template"                |
| Gradient buttons                  | Overdesigned for a tool UI                     |
| Animated floating blur orbs       | Pure decoration, zero utility                  |
| "AI-powered" / "Secure Node" badges | Marketing copy, not product UI               |
| macOS traffic-light window controls | Wrong OS reference                           |
| Dock icon magnification on hover  | macOS behavior, not Windows 11                 |
| Purple/indigo accent palette      | Generic "dark dashboard" trope                 |
| Blue/cyan accent color            | "dark dashboard = blue" — the most predictable combo |
| SVG noise texture overlays        | Over-engineered, negligible visual impact      |
| `contrast()` / `brightness()` in backdrop-filter | Unpredictable cross-browser results |

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
- Respect `prefers-reduced-motion`

---

## File Reference

| File                       | Contains                                |
|----------------------------|-----------------------------------------|
| `dashboard/src/index.css`  | Global design tokens (CSS custom props) |
| `dashboard/src/App.css`    | Dock, tray, window frame, layout        |
| `dashboard/src/pages/login.module.css` | Login card, button, input    |
| `dashboard/src/assets/desktop_wallpaper.jpg` | Desktop wallpaper        |
