import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read the compatibility plugin name from .claude-plugin/plugin.json.
 *
 * Existing workspaces use the `name` field as their stable skill namespace;
 * do not derive it from path.basename(), which can change when a folder moves.
 *
 * @returns The plugin name, or null if the manifest doesn't exist or is unreadable
 */
export function readPluginName(workspaceRootPath: string): string | null {
  try {
    const manifestPath = join(workspaceRootPath, '.claude-plugin', 'plugin.json');
    if (!existsSync(manifestPath)) return null;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    return manifest.name || null;
  } catch {
    return null;
  }
}

// Re-export browser-safe slug extraction for convenience
export { extractWorkspaceSlugFromPath } from './workspace-slug.ts';

/**
 * Extract workspace slug for skill qualification.
 *
 * Reads the stable plugin name from .claude-plugin/plugin.json,
 * falling back to the last path component of the root path.
 *
 * NOTE: Requires Node.js (fs/path). For browser contexts, use extractWorkspaceSlugFromPath
 * from './workspace-slug.ts' instead.
 */
export function extractWorkspaceSlug(rootPath: string, fallbackId: string): string {
  // Read the actual SDK plugin name — this is what the SDK uses to resolve skills
  const pluginName = readPluginName(rootPath);
  if (pluginName) return pluginName;

  // Fallback to last path component (legacy behavior)
  const pathParts = rootPath.split(/[\\/]/).filter(Boolean);
  return pathParts[pathParts.length - 1] || fallbackId;
}
