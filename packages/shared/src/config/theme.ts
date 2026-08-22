/**
 * Theme Configuration
 *
 * App-level theme system with preset themes.
 * Light mode is default, with optional dark mode overrides.
 *
 * Theme sources:
 * - Built in:       `default` only
 * - User themes:    ~/.craft-agent/themes/*.json
 */

/**
 * CSS color string - any valid CSS color format:
 * - Hex: #8b5cf6, #8b5cf6cc
 * - RGB: rgb(139, 92, 246), rgba(139, 92, 246, 0.8)
 * - HSL: hsl(262, 83%, 58%)
 * - OKLCH: oklch(0.58 0.22 293) (recommended)
 * - Named: purple, rebeccapurple
 */
export type CSSColor = string;

/** CSS length/value strings are passed through to CSS custom properties. */
export type CSSValue = string;

export type ThemeDepth = 'flat' | 'elevated' | 'neon' | 'glass' | 'raised';
export type ThemeDensity = 'compact' | 'comfortable' | 'cozy';
export type ThemeBorderStyle = 'solid' | 'dashed' | 'dotted' | 'double';
export type ThemeIconStrokeLinecap = 'butt' | 'round' | 'square';
export type ThemePreferenceMode = 'light' | 'dark' | 'system';
export type ThemeFontPreference = 'theme' | 'inter' | 'system';

/** Durable app-level theme preferences stored in config.json. */
export interface ThemePreferences {
  mode: ThemePreferenceMode;
  colorTheme: string;
  font: ThemeFontPreference;
}

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  mode: 'system',
  colorTheme: 'default',
  font: 'theme',
};

const USER_THEME_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

/** Whether a filename stem is a safe, non-reserved user theme ID. */
export function isValidUserThemeId(id: string): boolean {
  return id.toLowerCase() !== 'default' && USER_THEME_ID_PATTERN.test(id);
}

/**
 * Core theme colors (6-color semantic system)
 */
export interface ThemeColors {
  background?: CSSColor;
  foreground?: CSSColor;
  accent?: CSSColor; // Brand purple (Execute mode)
  info?: CSSColor; // Amber (Ask mode, warnings)
  success?: CSSColor; // Green
  destructive?: CSSColor; // Red

  // Optional semantic layer overrides. When omitted, index.css derives them
  // from background + foreground exactly as it does today.
  backgroundElevated?: CSSColor;
  foregroundDimmed?: CSSColor;
  secondary?: CSSColor;
  secondaryForeground?: CSSColor;
  muted?: CSSColor;
  mutedForeground?: CSSColor;
  card?: CSSColor;
  cardForeground?: CSSColor;
  popoverForeground?: CSSColor;
  border?: CSSColor;
  ring?: CSSColor;
  userMessageBubble?: CSSColor;
}

/**
 * Surface colors for specific UI regions.
 * All are optional. The native sidebar stays transparent unless `navigator`
 * is explicitly authored; other surfaces retain their CSS-level fallbacks.
 */
export interface SurfaceColors {
  paper?: CSSColor; // AI messages, cards, elevated content
  navigator?: CSSColor; // Opt-in left sidebar background
  input?: CSSColor; // Input field background
  popover?: CSSColor; // Dropdowns, modals, context menus (always solid, no transparency)
  popoverSolid?: CSSColor; // Guaranteed 100% opaque popover bg (required for scenic mode)
}

/**
 * Visual tokens beyond color. These are deliberately file-driven: the app
 * selects a theme, but does not expose a theme editor.
 */
export interface ThemeStyleTokens {
  // High-level material preset. themeToCSS expands this into low-level tokens.
  depth?: ThemeDepth;
  shadowColor?: CSSColor;
  shadowStrength?: number;
  glassBlur?: CSSValue;

  // Shape
  radius?: CSSValue;
  borderWidth?: CSSValue;
  borderStyle?: ThemeBorderStyle;

  // Typography
  fontSans?: CSSValue;
  fontSerif?: CSSValue;
  fontMono?: CSSValue;
  fontSize?: CSSValue;
  letterSpacing?: CSSValue;
  lineHeight?: CSSValue | number;

  // Icon style (same icon set; no asset replacement)
  iconStrokeWidth?: number;
  iconStrokeLinecap?: ThemeIconStrokeLinecap;

  // Global spacing scale
  density?: ThemeDensity;
}

/**
 * Theme mode - solid (default) or scenic (background image with glass panels)
 */
export type ThemeMode = 'solid' | 'scenic';

/**
 * Theme overrides - light mode default, optional dark overrides
 * App-level only (no workspace cascading)
 */
export interface ThemeOverrides extends ThemeColors, SurfaceColors, ThemeStyleTokens {
  // Optional dark mode overrides (includes both semantic and surface colors)
  dark?: ThemeColors & SurfaceColors & ThemeStyleTokens;

  /**
   * Theme mode: 'solid' (default) or 'scenic'
   * - solid: Traditional solid color backgrounds
   * - scenic: Full-window background image with glass panels
   */
  mode?: ThemeMode;

  /**
   * Background image URL for scenic mode
   * Remote URL to background image (JPEG, PNG, WebP recommended)
   * Required when mode='scenic', ignored otherwise
   */
  backgroundImage?: string;
}

/**
 * Deep merge two theme objects (source wins for defined values)
 */
const COLOR_KEYS: (keyof ThemeColors)[] = [
  'background',
  'foreground',
  'accent',
  'info',
  'success',
  'destructive',
  'backgroundElevated',
  'foregroundDimmed',
  'secondary',
  'secondaryForeground',
  'muted',
  'mutedForeground',
  'card',
  'cardForeground',
  'popoverForeground',
  'border',
  'ring',
  'userMessageBubble',
];

const SURFACE_KEYS: (keyof SurfaceColors)[] = [
  'paper',
  'navigator',
  'input',
  'popover',
  'popoverSolid',
];

const STYLE_KEYS: (keyof ThemeStyleTokens)[] = [
  'depth',
  'shadowColor',
  'shadowStrength',
  'glassBlur',
  'radius',
  'borderWidth',
  'borderStyle',
  'fontSans',
  'fontSerif',
  'fontMono',
  'fontSize',
  'letterSpacing',
  'lineHeight',
  'iconStrokeWidth',
  'iconStrokeLinecap',
  'density',
];

// Combined keys for merging (all themeable visual properties)
const ALL_THEME_KEYS = [...COLOR_KEYS, ...SURFACE_KEYS, ...STYLE_KEYS] as const;

function mergeThemes(
  base: ThemeOverrides | undefined,
  override: ThemeOverrides | undefined
): ThemeOverrides {
  if (!base) return override || {};
  if (!override) return base;

  const result: ThemeOverrides = { ...base };

  // Merge top-level visual properties.
  for (const key of ALL_THEME_KEYS) {
    if (override[key] !== undefined) {
      Object.assign(result, { [key]: override[key] });
    }
  }

  // Merge scenic mode properties
  if (override.mode !== undefined) result.mode = override.mode;
  if (override.backgroundImage !== undefined)
    result.backgroundImage = override.backgroundImage;

  // Build the dark variant from four layers. Top-level user tokens are the
  // shared base for both modes; `dark` only contains differences. This also
  // makes dark-only themes that put their palette at the top level work as
  // authored instead of inheriting Default's dark colors over it.
  if (base.dark || override.dark) {
    result.dark = {};
    for (const source of [base, base.dark, override, override.dark]) {
      if (!source) continue;
      for (const key of ALL_THEME_KEYS) {
        if (source[key] !== undefined) {
          Object.assign(result.dark, { [key]: source[key] });
        }
      }
    }
  }

  return result;
}

/**
 * Resolve theme from app-level source
 * (Workspace cascading has been removed for simplicity)
 */
export function resolveTheme(
  app?: ThemeOverrides
): ThemeOverrides {
  return mergeThemes(DEFAULT_THEME, app);
}

const DENSITY_SCALE: Record<ThemeDensity, number> = {
  compact: 0.875,
  comfortable: 1,
  cozy: 1.125,
};

const DENSITY_TOKENS: Record<ThemeDensity, {
  rowPaddingY: CSSValue;
  menuItemPaddingY: CSSValue;
  settingsRowPaddingY: CSSValue;
  activityRowPaddingY: CSSValue;
}> = {
  compact: {
    rowPaddingY: '0.625rem',
    menuItemPaddingY: '0.25rem',
    settingsRowPaddingY: '0.75rem',
    activityRowPaddingY: '0.0625rem',
  },
  comfortable: {
    rowPaddingY: '0.75rem',
    menuItemPaddingY: '0.375rem',
    settingsRowPaddingY: '0.875rem',
    activityRowPaddingY: '0.125rem',
  },
  cozy: {
    rowPaddingY: '0.875rem',
    menuItemPaddingY: '0.5rem',
    settingsRowPaddingY: '1rem',
    activityRowPaddingY: '0.1875rem',
  },
};

function depthToCSS(
  depth: ThemeDepth,
  shadowColor: CSSColor,
  shadowStrength: number,
  glassBlur: CSSValue
): string[] {
  const strength = Math.max(0, Math.min(1, shadowStrength));
  const soft = Math.round(strength * 100);
  const faint = Math.round(strength * 55);
  const color = 'var(--theme-shadow-color)';
  const border = 'var(--border)';

  const vars = [
    `--theme-depth: ${depth};`,
    `--theme-shadow-color: ${shadowColor};`,
    `--theme-shadow-strength: ${strength};`,
    `--theme-backdrop-blur: ${depth === 'glass' ? glassBlur : '0px'};`,
  ];

  switch (depth) {
    case 'flat':
      vars.push(
        `--shadow-minimal: 0 0 0 var(--theme-border-width) ${border};`,
        `--shadow-middle: 0 0 0 var(--theme-border-width) ${border};`,
        `--shadow-strong: 0 0 0 var(--theme-border-width) ${border};`,
        `--shadow-modal-small: 0 0 0 var(--theme-border-width) ${border};`
      );
      break;
    case 'neon':
      vars.push(
        `--shadow-minimal: 0 0 0 var(--theme-border-width) ${border}, 0 0 10px color-mix(in srgb, ${color} ${faint}%, transparent);`,
        `--shadow-middle: 0 0 0 var(--theme-border-width) ${border}, 0 0 18px color-mix(in srgb, ${color} ${soft}%, transparent);`,
        `--shadow-strong: 0 0 0 var(--theme-border-width) ${border}, 0 0 30px color-mix(in srgb, ${color} ${soft}%, transparent);`,
        `--shadow-modal-small: 0 0 0 var(--theme-border-width) ${border}, 0 0 36px color-mix(in srgb, ${color} ${soft}%, transparent);`
      );
      break;
    case 'glass':
      vars.push(
        `--shadow-minimal: 0 0 0 var(--theme-border-width) color-mix(in srgb, white 20%, ${border}), 0 8px 24px color-mix(in srgb, ${color} ${faint}%, transparent);`,
        `--shadow-middle: 0 0 0 var(--theme-border-width) color-mix(in srgb, white 24%, ${border}), 0 12px 32px color-mix(in srgb, ${color} ${soft}%, transparent);`,
        `--shadow-strong: 0 0 0 var(--theme-border-width) color-mix(in srgb, white 28%, ${border}), 0 20px 48px color-mix(in srgb, ${color} ${soft}%, transparent);`,
        `--shadow-modal-small: 0 0 0 var(--theme-border-width) color-mix(in srgb, white 28%, ${border}), 0 24px 64px color-mix(in srgb, ${color} ${soft}%, transparent);`
      );
      break;
    case 'raised':
      // Raised themes use a hard-edged shadow, but still honor the declared
      // strength instead of turning the shadow color fully opaque.
      vars.push(
        `--shadow-minimal: 0 0 0 var(--theme-border-width) ${border}, 3px 3px 0 color-mix(in srgb, ${color} ${soft}%, transparent);`,
        `--shadow-middle: 0 0 0 var(--theme-border-width) ${border}, 4px 4px 0 color-mix(in srgb, ${color} ${soft}%, transparent);`,
        `--shadow-strong: 0 0 0 var(--theme-border-width) ${border}, 6px 6px 0 color-mix(in srgb, ${color} ${soft}%, transparent);`,
        `--shadow-modal-small: 0 0 0 var(--theme-border-width) ${border}, 8px 8px 0 color-mix(in srgb, ${color} ${soft}%, transparent);`
      );
      break;
    case 'elevated':
    default:
      vars.push(
        `--shadow-minimal: 0 0 0 var(--theme-border-width) ${border}, 0 1px 2px color-mix(in srgb, ${color} ${faint}%, transparent), 0 3px 6px color-mix(in srgb, ${color} ${faint}%, transparent);`,
        `--shadow-middle: 0 0 0 var(--theme-border-width) ${border}, 0 4px 12px color-mix(in srgb, ${color} ${soft}%, transparent);`,
        `--shadow-strong: 0 0 0 var(--theme-border-width) ${border}, 0 12px 32px color-mix(in srgb, ${color} ${soft}%, transparent);`,
        `--shadow-modal-small: 0 0 0 var(--theme-border-width) ${border}, 0 18px 48px color-mix(in srgb, ${color} ${soft}%, transparent);`
      );
      break;
  }

  return vars;
}

/**
 * Generate CSS variable declarations from theme
 * @param theme - Resolved theme object
 * @param isDark - Whether to apply dark mode overrides
 * @returns CSS string with variable declarations
 */
export function themeToCSS(theme: ThemeOverrides, isDark: boolean = false): string {
  const vars: string[] = [];

  // Get effective colors (merge dark overrides if in dark mode)
  const colors: ThemeColors & SurfaceColors & ThemeStyleTokens =
    isDark && theme.dark ? { ...theme, ...theme.dark } : theme;

  // Semantic color variables
  if (colors.background) vars.push(`--background: ${colors.background};`);
  if (colors.foreground) {
    vars.push(`--foreground: ${colors.foreground};`);
  }
  if (colors.accent) {
    vars.push(`--accent: ${colors.accent};`);
  }
  if (colors.info) vars.push(`--info: ${colors.info};`);
  if (colors.success) vars.push(`--success: ${colors.success};`);
  if (colors.destructive) vars.push(`--destructive: ${colors.destructive};`);

  const semanticColorVars: [keyof ThemeColors, string][] = [
    ['backgroundElevated', '--background-elevated'],
    ['foregroundDimmed', '--foreground-dimmed'],
    ['secondary', '--secondary'],
    ['secondaryForeground', '--secondary-foreground'],
    ['muted', '--muted'],
    ['mutedForeground', '--muted-foreground'],
    ['card', '--card'],
    ['cardForeground', '--card-foreground'],
    ['popoverForeground', '--popover-foreground'],
    ['border', '--border'],
    ['ring', '--ring'],
    ['userMessageBubble', '--user-message-bubble'],
  ];
  for (const [key, cssVar] of semanticColorVars) {
    if (colors[key]) vars.push(`${cssVar}: ${colors[key]};`);
  }

  // Emit only authored surface overrides. The static Default declarations are
  // expressions based on --background/--foreground, so omitted surfaces keep
  // deriving from the active palette instead of being flattened to background.
  if (colors.paper) vars.push(`--paper: ${colors.paper};`);
  if (colors.navigator) vars.push(`--navigator: ${colors.navigator};`);
  if (colors.input) vars.push(`--input: ${colors.input};`);
  if (colors.popover) vars.push(`--popover: ${colors.popover};`);
  if (colors.popoverSolid) vars.push(`--popover-solid: ${colors.popoverSolid};`);

  // L2/L4/L5/L6 direct tokens
  if (colors.radius) {
    vars.push(`--theme-radius: ${colors.radius};`);
    // App shell panels historically use platform-specific fixed radii. This
    // custom-only variable lets preset themes own those corners while the
    // default theme keeps its existing platform fallback.
    vars.push(`--theme-panel-radius: ${colors.radius};`);
  }
  if (colors.borderWidth) vars.push(`--theme-border-width: ${colors.borderWidth};`);
  if (colors.borderStyle) vars.push(`--theme-border-style: ${colors.borderStyle};`);
  if (colors.fontSans) vars.push(`--font-sans: ${colors.fontSans};`);
  if (colors.fontSerif) vars.push(`--font-serif: ${colors.fontSerif};`);
  if (colors.fontMono) vars.push(`--font-mono: ${colors.fontMono};`);
  if (colors.fontSize) vars.push(`--font-size-base: ${colors.fontSize};`);
  if (colors.letterSpacing) vars.push(`--tracking-normal: ${colors.letterSpacing};`);
  if (colors.lineHeight !== undefined) vars.push(`--line-height-base: ${colors.lineHeight};`);
  if (colors.iconStrokeWidth !== undefined) vars.push(`--icon-stroke-width: ${colors.iconStrokeWidth};`);
  if (colors.iconStrokeLinecap) vars.push(`--icon-stroke-linecap: ${colors.iconStrokeLinecap};`);
  if (colors.density) {
    // Do not mutate Tailwind's global --spacing foundation: doing so also
    // resizes icons, hit targets, widths and transforms. Components that opt
    // into semantic density can consume these dedicated theme variables.
    const density = DENSITY_TOKENS[colors.density];
    vars.push(`--theme-density: ${colors.density};`);
    vars.push(`--theme-density-scale: ${DENSITY_SCALE[colors.density]};`);
    vars.push(`--theme-row-padding-y: ${density.rowPaddingY};`);
    vars.push(`--theme-menu-item-padding-y: ${density.menuItemPaddingY};`);
    vars.push(`--theme-settings-row-padding-y: ${density.settingsRowPaddingY};`);
    vars.push(`--theme-activity-row-padding-y: ${density.activityRowPaddingY};`);
  }

  // Expand the high-level depth model only when the file authors at least one
  // depth/material token. A color-only partial theme should inherit the exact
  // built-in shadow baseline rather than silently replacing it.
  const ownsDepth = colors.depth !== undefined
    || colors.shadowColor !== undefined
    || colors.shadowStrength !== undefined
    || colors.glassBlur !== undefined;
  if (ownsDepth) {
    const depth = colors.depth || 'elevated';
    const shadowColor = colors.shadowColor || 'black';
    const shadowStrength = colors.shadowStrength ?? (isDark ? 0.18 : 0.1);
    const glassBlur = colors.glassBlur || '20px';
    vars.push(...depthToCSS(depth, shadowColor, shadowStrength, glassBlur));
  }

  // Theme mode (background image is set directly on document.documentElement.style
  // to avoid style sheet size limits with large data URLs)
  const mode = theme.mode || 'solid';
  vars.push(`--theme-mode: ${mode};`);

  return vars.join('\n  ');
}

/**
 * Hex equivalents of background colors for Electron BrowserWindow.
 * The main process cannot use CSS/oklch colors, so we provide hex values
 * that visually match the DEFAULT_THEME oklch colors.
 */
export const BACKGROUND_HEX = {
  light: '#f7f8fa', // sRGB rendering of oklch(0.98 0.003 265)
  dark: '#080a10', // sRGB rendering of oklch(0.145 0.015 270)
} as const;

/**
 * Get background color hex value for BrowserWindow backgroundColor.
 * Use this in the main process where CSS variables aren't available.
 */
export function getBackgroundColor(isDark: boolean): string {
  return isDark ? BACKGROUND_HEX.dark : BACKGROUND_HEX.light;
}

/**
 * Default theme values (matches current index.css)
 */
export const DEFAULT_THEME: ThemeOverrides = {
  background: 'oklch(0.98 0.003 265)',
  foreground: 'oklch(0.185 0.01 270)',
  accent: 'oklch(0.62 0.13 293)',
  info: 'oklch(0.75 0.16 70)',
  success: 'oklch(0.55 0.17 145)',
  destructive: 'oklch(0.58 0.24 28)',
  depth: 'elevated',
  shadowColor: '#17131f',
  shadowStrength: 0.1,
  radius: '8px',
  borderWidth: '1px',
  borderStyle: 'solid',
  fontSize: '15px',
  lineHeight: 1.5,
  letterSpacing: '0em',
  iconStrokeWidth: 2,
  iconStrokeLinecap: 'round',
  density: 'comfortable',
  dark: {
    background: 'oklch(0.145 0.015 270)',
    foreground: 'oklch(0.95 0.01 270)',
    accent: 'oklch(0.65 0.22 293)',
    info: 'oklch(0.78 0.14 70)',
    success: 'oklch(0.60 0.17 145)',
    destructive: 'oklch(0.65 0.22 28)',
    shadowColor: '#000000',
    shadowStrength: 0.18,
  },
};

// ============================================
// Preset Themes
// ============================================

/**
 * Shiki theme configuration for syntax highlighting
 */
export interface ShikiThemeConfig {
  light?: string;
  dark?: string;
}

/**
 * Extended theme file format with metadata
 * Used for preset themes stored as JSON files
 */
export interface ThemeFile extends ThemeOverrides {
  name: string;
  description?: string;
  author?: string;
  license?: string;
  source?: string;
  supportedModes?: ('light' | 'dark')[];
  shikiTheme?: ShikiThemeConfig;
}

/**
 * Preset theme with ID and path
 */
export interface PresetTheme {
  id: string; // filename without .json (e.g., 'dracula')
  path: string; // full path to the user theme file, or builtin:default
  theme: ThemeFile; // parsed theme data
}

/** Lightweight metadata returned when listing user themes. */
export interface ThemeSummary {
  id: string;
  name: string;
  description?: string;
  author?: string;
  supportedModes?: ('light' | 'dark')[];
}

/** The immutable built-in theme. All other themes come from the user directory. */
export const DEFAULT_THEME_FILE: ThemeFile = {
  name: 'Default',
  description: 'Clean purple-tinted neutral theme',
  author: 'Craft Agent',
  license: 'MIT',
  supportedModes: ['light', 'dark'],
  shikiTheme: {
    light: 'github-light',
    dark: 'github-dark',
  },
  ...DEFAULT_THEME,
};

/** Resolve the actual visual mode supported by a theme. */
export function resolveThemeMode(
  theme: Pick<ThemeFile, 'mode' | 'supportedModes'> | undefined,
  requestedMode: 'light' | 'dark'
): 'light' | 'dark' {
  if (theme?.mode === 'scenic') return 'dark';
  const supportedModes = theme?.supportedModes;
  if (supportedModes?.length === 1) return supportedModes[0]!;
  return requestedMode;
}

/**
 * Default Shiki themes (used when no preset is selected)
 */
export const DEFAULT_SHIKI_THEME: ShikiThemeConfig = {
  light: 'github-light',
  dark: 'github-dark',
};

/**
 * Get Shiki theme name for current mode
 */
export function getShikiTheme(
  shikiConfig: ShikiThemeConfig | undefined,
  isDark: boolean
): string {
  const config = shikiConfig || DEFAULT_SHIKI_THEME;
  return isDark ? config.dark || 'github-dark' : config.light || 'github-light';
}
