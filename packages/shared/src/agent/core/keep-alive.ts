/**
 * Background task keep-alive flag resolver.
 *
 * `CRAFT_KEEP_BG_AGENTS_ALIVE`:
 *   - `'1'` / `'true'`  → ON  (persistent streaming-input query)
 *   - `'0'` / `'false'` → OFF (per-turn query — kill-switch)
 *   - unset             → true (default)
 */
const DEFAULT_KEEP_ALIVE = true;

export function resolveKeepBackgroundTasksAlive(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.CRAFT_KEEP_BG_AGENTS_ALIVE;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return DEFAULT_KEEP_ALIVE;
}
