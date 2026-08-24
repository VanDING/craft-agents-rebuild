/**
 * Thinking Level Configuration
 *
 * Seven-tier thinking system for extended reasoning:
 * - OFF: No extended thinking (disabled)
 * - Low: Light reasoning, faster responses
 * - Medium: Balanced speed and reasoning (default)
 * - High: Deep reasoning for complex tasks
 * - XHigh: Extra-high reasoning for the most demanding tasks
 * - Max: Maximum effort reasoning
 *
 * Session-level setting with workspace defaults.
 *
 * Provider mappings:
 * - Pi/OpenAI: reasoning_effort via Pi SDK levels, passed through 1:1 up to `max`.
 *   Pi clamps per model internally, so models without native `max` support
 *   (everything except GPT-5.6 and adaptive Claude) degrade to their own ceiling.
 */

/**
 * Ordered list of valid thinking level IDs. Single source of truth — the
 * `ThinkingLevel` type, `THINKING_LEVELS` metadata, the Zod schema in
 * `validators.ts`, and runtime validation/error messages all derive from this.
 *
 * Order is significant: it determines UI ordering (low → max).
 */
export const THINKING_LEVEL_IDS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ThinkingLevel = (typeof THINKING_LEVEL_IDS)[number];

export interface ThinkingLevelDefinition {
  id: ThinkingLevel;
  /** Translation key for the display name (resolve with t() at render site) */
  nameKey: string;
  /** Translation key for the description (resolve with t() at render site) */
  descriptionKey: string;
}

/**
 * Available thinking levels with display metadata.
 * Used in UI dropdowns and for validation.
 *
 * Labels use translation keys — resolve with t(level.nameKey) in components.
 */
export const THINKING_LEVELS: readonly ThinkingLevelDefinition[] = [
  { id: 'off', nameKey: 'thinking.off', descriptionKey: 'thinking.offDesc' },
  { id: 'minimal', nameKey: 'thinking.minimal', descriptionKey: 'thinking.minimalDesc' },
  { id: 'low', nameKey: 'thinking.low', descriptionKey: 'thinking.lowDesc' },
  { id: 'medium', nameKey: 'thinking.medium', descriptionKey: 'thinking.mediumDesc' },
  { id: 'high', nameKey: 'thinking.high', descriptionKey: 'thinking.highDesc' },
  { id: 'xhigh', nameKey: 'thinking.xhigh', descriptionKey: 'thinking.xhighDesc' },
  { id: 'max', nameKey: 'thinking.max', descriptionKey: 'thinking.maxDesc' },
] as const;

/** Resolve the selector options for one concrete model capability record. */
export function getThinkingLevelsForModel(model?: {
  supportsThinking?: boolean;
  supportedThinkingLevels?: readonly ThinkingLevel[];
}): readonly ThinkingLevelDefinition[] {
  if (!model) return THINKING_LEVELS;
  if (model.supportsThinking === false) {
    return THINKING_LEVELS.filter(level => level.id === 'off');
  }
  if (!model.supportedThinkingLevels?.length) return THINKING_LEVELS;
  const supported = new Set(model.supportedThinkingLevels);
  return THINKING_LEVELS.filter(level => supported.has(level.id));
}

/** Default thinking level for new sessions when workspace has no default */
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';

/**
 * Get the translation key for a thinking level's display name.
 * Resolve with t() or i18n.t() at the call site.
 */
export function getThinkingLevelNameKey(level: ThinkingLevel): string {
  const def = THINKING_LEVELS.find((l) => l.id === level);
  return def?.nameKey ?? `thinking.${level}`;
}

/**
 * Validate that a value is a valid ThinkingLevel.
 */
export function isValidThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && (THINKING_LEVEL_IDS as readonly string[]).includes(value);
}

/**
 * Normalize a persisted thinking level value, handling legacy values.
 * Maps the old 'think' value to 'medium' for backward compatibility.
 *
 * TODO: Remove the legacy 'think' compatibility path after old persisted session
 * and workspace data has realistically aged out across upgrades.
 *
 * @returns The normalized ThinkingLevel, or undefined if the value is invalid
 */
export function normalizeThinkingLevel(value: unknown): ThinkingLevel | undefined {
  if (value === 'think') return 'medium';
  if (isValidThinkingLevel(value)) return value;
  return undefined;
}
