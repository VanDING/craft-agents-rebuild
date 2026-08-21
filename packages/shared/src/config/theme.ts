/**
 * Theme Configuration
 *
 * App-level theme system with preset themes.
 * Light mode is default, with optional dark mode overrides.
 *
 * Storage locations:
 * - App override:   ~/.craft-agent/theme.json
 * - Preset themes:  ~/.craft-agent/themes/*.json
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
 * Surface colors for specific UI regions
 * All optional - fall back to `background` if not set
 */
export interface SurfaceColors {
  paper?: CSSColor; // AI messages, cards, elevated content
  navigator?: CSSColor; // Left sidebar background
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

  // Deep merge dark overrides
  if (override.dark) {
    result.dark = { ...base.dark };
    for (const key of ALL_THEME_KEYS) {
      if (override.dark[key] !== undefined) {
        Object.assign(result.dark, { [key]: override.dark[key] });
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
  return mergeThemes(undefined, app) || {};
}

/**
 * Convert hex color to RGB values string (e.g., "255, 128, 0")
 * Optionally darkens the color by a factor (0-1, where 0.7 = 70% brightness)
 * Returns null if not a valid hex color
 */
function hexToRgbValues(hex: string, darkenFactor: number = 1): string | null {
  let r: number, g: number, b: number;

  // Match 6 digit hex colors
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (match) {
    r = parseInt(match[1]!, 16);
    g = parseInt(match[2]!, 16);
    b = parseInt(match[3]!, 16);
  } else {
    // Try 3-digit hex
    const shortMatch = hex.match(/^#?([a-f\d])([a-f\d])([a-f\d])$/i);
    if (!shortMatch) return null;
    r = parseInt(shortMatch[1]! + shortMatch[1]!, 16);
    g = parseInt(shortMatch[2]! + shortMatch[2]!, 16);
    b = parseInt(shortMatch[3]! + shortMatch[3]!, 16);
  }

  // Apply darkening factor
  r = Math.round(r * darkenFactor);
  g = Math.round(g * darkenFactor);
  b = Math.round(b * darkenFactor);

  return `${r}, ${g}, ${b}`;
}

const DENSITY_SPACING: Record<ThemeDensity, string> = {
  compact: '0.21875rem',
  comfortable: '0.25rem',
  cozy: '0.28125rem',
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
      vars.push(
        `--shadow-minimal: 2px 2px 0 ${color};`,
        `--shadow-middle: 4px 4px 0 ${color};`,
        `--shadow-strong: 6px 6px 0 ${color};`,
        `--shadow-modal-small: 8px 8px 0 ${color};`
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
    // Also output RGB version for shadow borders (only works with hex colors)
    const rgbValues = hexToRgbValues(colors.foreground);
    if (rgbValues) {
      vars.push(`--foreground-rgb: ${rgbValues};`);
    }
  }
  if (colors.accent) {
    vars.push(`--accent: ${colors.accent};`);
    // Also output darkened RGB version for shadow-tinted (only works with hex colors)
    // Use 70% brightness for a proper shadow effect
    const rgbValues = hexToRgbValues(colors.accent, 0.7);
    if (rgbValues) {
      vars.push(`--accent-rgb: ${rgbValues};`);
    }
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

  // Surface color variables (fall back to background if not set)
  // These enable fine-grained control over specific UI regions
  const bg = colors.background || 'var(--background)';
  vars.push(`--paper: ${colors.paper || bg};`);
  vars.push(`--navigator: ${colors.navigator || bg};`);
  vars.push(`--input: ${colors.input || bg};`);
  vars.push(`--popover: ${colors.popover || bg};`);
  // popoverSolid: guaranteed 100% opaque for scenic mode popovers
  // Falls back to popover, then background (should always be solid in scenic themes)
  vars.push(`--popover-solid: ${colors.popoverSolid || colors.popover || bg};`);

  // L2/L4/L5/L6 direct tokens
  if (colors.radius) vars.push(`--theme-radius: ${colors.radius};`);
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
  if (colors.density) vars.push(`--spacing: ${DENSITY_SPACING[colors.density]};`);

  // L3 high-level depth expansion. Defaults match the existing restrained UI.
  const depth = colors.depth || 'elevated';
  const shadowColor = colors.shadowColor || 'black';
  const shadowStrength = colors.shadowStrength ?? (isDark ? 0.18 : 0.1);
  const glassBlur = colors.glassBlur || '20px';
  vars.push(...depthToCSS(depth, shadowColor, shadowStrength, glassBlur));

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
  light: '#faf9fb', // matches oklch(0.98 0.003 265)
  dark: '#302f33', // matches oklch(0.2 0.005 270)
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
  accent: 'oklch(0.58 0.22 293)',
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
  name?: string;
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
  path: string; // full path to theme.json
  theme: ThemeFile; // parsed theme data
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
