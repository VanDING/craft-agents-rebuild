# Theme Configuration Guide

This guide explains how to customize the visual theme of Craft Agent.

## Overview

Craft Agent uses a semantic-token theme engine with app-level preferences and per-workspace theme selection. The application contains one immutable built-in theme, `default`. Every other theme is a user-owned JSON file.

### Built-in Theme

| ID | Modes | Character |
|----|-------|-----------|
| `default` | Light + dark | Restrained neutral baseline |

### Theme Hierarchy

1. **App selection**: Selected in Settings → Appearance → Default Theme
2. **Workspace selection**: Optional per-workspace theme ID in Settings → Appearance → Workspace Themes
3. **Built-in source**: The reserved `default` theme
4. **User source**: `~/.craft-agent/themes/{id}.json`

Workspaces without a selection override inherit the app selection. User theme files may be partial; omitted visual tokens inherit from `default`.

The themes directory is never seeded, overwritten, reset, or cleaned by the application. Files copied there by older versions remain ordinary user themes. The deprecated `~/.craft-agent/theme.json` file is migrated once to `themes/migrated-custom.json` (or a non-conflicting suffixed name), while the original file is retained and no longer participates in rendering.

App-level selection preferences are stored together in `~/.craft-agent/config.json` as `themeMode`, `colorTheme`, and `themeFont`. A versioned renderer cache is used only to avoid a startup flash; `config.json` remains authoritative.

## Workspace Themes

Each workspace can have its own color theme that overrides the app default. Configure in Settings → Appearance:

- **Default Theme**: Sets the app-wide default (used by all workspaces without an override)
- **Workspace Themes**: Per-workspace overrides, choose "Use Default" or select a specific theme

### Storage Location

Workspace theme preferences are stored in the workspace config:

```
~/.craft-agent/workspaces/{id}/config.json
```

```json
{
  "id": "ws_abc123",
  "name": "My Project",
  "defaults": {
    "colorTheme": "cyberpunk-neon"
  }
}
```

When `colorTheme` is omitted or undefined, the workspace inherits the app default.

## Core Color System

| Color | Purpose | Usage |
|-------|---------|-------|
| `background` | Surface/page background | Light/dark surface color |
| `foreground` | Text and icons | Primary text color |
| `accent` | Brand color, Execute mode | Highlights, active states, purple UI elements |
| `info` | Warnings, Ask mode | Amber indicators, attention states |
| `success` | Connected status | Green checkmarks, success states |
| `destructive` | Errors, delete actions | Red alerts, failed states |

## Color Formats

Any valid CSS color format is supported:
- **Hex**: `#8b5cf6`, `#8b5cf6cc` (with alpha)
- **RGB**: `rgb(139, 92, 246)`, `rgba(139, 92, 246, 0.8)`
- **HSL**: `hsl(262, 83%, 58%)`
- **OKLCH**: `oklch(0.58 0.22 293)` (recommended)
- **Named**: `purple`, `rebeccapurple`

**Recommendation**: Use OKLCH for perceptually uniform colors that look consistent across light/dark modes.

## Dark Mode

The `dark` object provides optional overrides for dark mode. When the user's system is in dark mode:
1. Base colors (top-level) are used as defaults
2. Any colors defined in `dark` override the base colors

This allows partial dark mode customization - only override what needs to differ.

## Preset Themes

Preset themes are complete theme packages stored at `~/.craft-agent/themes/`. Each preset is a JSON file with theme colors and metadata.

Craft Agent does not include a visual theme editor. Create or edit these JSON files directly, then select the theme in Settings → Appearance.

### Preset Theme Schema

```json
{
  "name": "Custom Theme",
  "description": "A complete semantic-token theme",
  "author": "Your Name",
  "license": "MIT",
  "supportedModes": ["dark"],

  "background": "oklch(0.22 0.02 280)",
  "foreground": "oklch(0.95 0.01 270)",
  "accent": "oklch(0.70 0.20 320)",
  "info": "oklch(0.78 0.14 70)",
  "success": "oklch(0.72 0.18 145)",
  "destructive": "oklch(0.65 0.22 28)",

  "depth": "elevated",
  "shadowColor": "#000000",
  "shadowStrength": 0.12,
  "radius": "8px",
  "borderWidth": "1px",
  "borderStyle": "solid",
  "fontSize": "15px",
  "lineHeight": 1.5,
  "letterSpacing": "0em",
  "iconStrokeWidth": 2,
  "iconStrokeLinecap": "round",
  "density": "comfortable",

  "shikiTheme": {
    "dark": "tokyo-night"
  }
}
```

### Preset Metadata Fields

| Field | Description |
|-------|-------------|
| `name` | Display name for the theme |
| `description` | Short description |
| `author` | Theme creator |
| `license` | License type (MIT, etc.) |
| `source` | URL to original theme |
| `supportedModes` | Array of `"light"`, `"dark"`, or both |
| `shikiTheme` | Syntax highlighting theme (light/dark variants) |

### Visual Style Fields

| Field | Purpose | Values / examples |
|-------|---------|-------------------|
| `depth` | High-level material preset | `flat`, `elevated`, `neon`, `glass`, `raised` |
| `shadowColor` | Shadow or glow color | Any safe CSS color |
| `shadowStrength` | Shadow intensity | Number from `0` to `1` |
| `glassBlur` | Blur used by `depth: glass` | `20px` |
| `radius` | Base semantic corner radius | `8px`, `0px` |
| `borderWidth` | Default semantic border width | `1px`, `2px` |
| `borderStyle` | Default border style | `solid`, `dashed`, `dotted`, `double` |
| `fontSans` / `fontSerif` / `fontMono` | CSS font stacks | `Inter, sans-serif` |
| `fontSize` | Root UI font size | `15px` |
| `letterSpacing` | Global UI tracking | `0.01em` |
| `lineHeight` | Global base line height | `1.5` |
| `iconStrokeWidth` | Lucide icon line weight | `0.5`–`4` |
| `iconStrokeLinecap` | Lucide line cap | `butt`, `round`, `square` |
| `density` | Semantic row, menu, settings, and activity spacing; structural panel insets remain fixed | `compact`, `comfortable`, `cozy` |

Semantic colors such as `secondary`, `muted`, `card`, `border`, `ring`, and `userMessageBubble` may also be set explicitly. When omitted, the default CSS derivation remains active.

The Appearance font control has explicit precedence: **Theme** uses `fontSans` from the active theme (falling back to the system stack), while **Inter** and **System** override the theme-authored UI font.

### Installing Preset Themes

1. Download or create a theme JSON file
2. Save it to `~/.craft-agent/themes/{id}.json` using an ASCII letter/number ID with dots, underscores, or hyphens
3. Select the theme in Settings → Appearance

The ID `default` is reserved. A user file named `default.json` is ignored so the built-in fallback cannot be shadowed.

## Scenic Mode

Scenic mode displays a full-window background image with glass-style panels. This creates a visually immersive experience.

### Enabling Scenic Mode

```json
{
  "name": "Mountain Glass",
  "mode": "scenic",
  "backgroundImage": "mountains.jpg",

  "background": "oklch(0.15 0.02 270 / 0.8)",
  "paper": "oklch(0.18 0.02 270 / 0.6)",
  "navigator": "oklch(0.12 0.02 270 / 0.7)",
  "popoverSolid": "oklch(0.18 0.02 270)"
}
```

### Scenic Mode Properties

| Property | Description |
|----------|-------------|
| `mode` | Set to `"scenic"` (default is `"solid"`) |
| `backgroundImage` | Image filename relative to the theme file, or an explicit HTTP(S) URL |

### Surface Colors for Glass Panels

Scenic mode benefits from semi-transparent surface colors:

| Color | Purpose |
|-------|---------|
| `paper` | AI messages, cards, elevated content |
| `navigator` | Optional left sidebar background; when omitted, the native transparent sidebar is preserved |
| `input` | Input field background |
| `popover` | Dropdowns, modals, context menus |
| `popoverSolid` | Guaranteed 100% opaque popover background |

**Note:** Scenic themes automatically force dark mode for better contrast with background images.

## Default Theme

The built-in default theme uses OKLCH colors optimized for accessibility:

**Light Mode:**
- Background: `oklch(0.98 0.003 265)` - Very light gray with slight purple tint
- Foreground: `oklch(0.185 0.01 270)` - Near-black for high contrast
- Accent: `oklch(0.62 0.13 293)` - Restrained purple
- Info: `oklch(0.75 0.16 70)` - Warm amber
- Success: `oklch(0.55 0.17 145)` - Clear green
- Destructive: `oklch(0.58 0.24 28)` - Alert red

**Dark Mode:**
- Background: `oklch(0.145 0.015 270)` - Deep dark with purple tint
- Foreground: `oklch(0.95 0.01 270)` - Near-white
- Accent/Info/Success/Destructive: Slightly brighter versions for visibility

## Examples

### Minimal: Just change accent color
```json
{
  "name": "Blue Accent",
  "accent": "#3b82f6"
}
```

### Custom brand colors
```json
{
  "name": "Brand",
  "accent": "oklch(0.55 0.25 250)",
  "info": "oklch(0.70 0.15 200)",
  "dark": {
    "accent": "oklch(0.65 0.25 250)",
    "info": "oklch(0.75 0.12 200)"
  }
}
```

### High contrast theme
```json
{
  "name": "High Contrast",
  "background": "#ffffff",
  "foreground": "#000000",
  "dark": {
    "background": "#000000",
    "foreground": "#ffffff"
  }
}
```

## Live Updates

Theme changes are applied immediately without restarting. Adding, editing, renaming, or deleting a valid JSON file under `~/.craft-agent/themes/` updates the list. If the active file becomes missing or invalid, the UI atomically falls back to `default`; it does not retain stale colors.

## Creating a Theme

1. Create `~/.craft-agent/themes/{id}.json`
2. Add a non-empty `name` and the colors or visual tokens you want to customize
3. Optionally add `dark` overrides for dark mode

**Tips:**
- Start with just `accent` to quickly personalize
- Use OKLCH for predictable color behavior
- Test in both light and dark modes
- Keep contrast ratios accessible (foreground vs background)
- Keep the JSON file under 256 KiB; use a separate local image instead of embedding image data

## Troubleshooting

**Theme not applying:**
- Verify JSON syntax is valid
- Check that the file is directly under `~/.craft-agent/themes/` and its filename is a valid theme ID
- Ensure color values are valid CSS colors

**Colors look wrong in dark mode:**
- Add explicit `dark` overrides
- OKLCH colors may need higher lightness values for dark mode
- Check if preset has `supportedModes` that excludes your current mode

**Background image not showing:**
- Ensure `mode` is set to `"scenic"`
- Check image path is relative to the theme file or a valid HTTP(S) URL
- Verify a local image stays inside `~/.craft-agent/themes/`, is PNG/JPEG/GIF/WebP, is readable, and is at most 20 MiB

## OKLCH Color Reference

OKLCH format: `oklch(lightness chroma hue)`
- **Lightness**: 0-1 (0 = black, 1 = white)
- **Chroma**: 0-0.4 (0 = gray, higher = more saturated)
- **Hue**: 0-360 (color wheel angle)

Common hues:
- Red: ~25
- Orange: ~70
- Yellow: ~100
- Green: ~145
- Cyan: ~195
- Blue: ~250
- Purple: ~293
- Pink: ~330
