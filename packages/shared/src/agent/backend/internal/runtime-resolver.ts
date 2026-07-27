import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { BackendHostRuntimeContext } from '../types.ts';
import type { ResolvedBackendRuntimePaths } from './driver-types.ts';

/**
 * Resolve backend runtime paths from host runtime context.
 *
 * Maps provider-agnostic host metadata to concrete file paths used by
 * provider drivers (e.g. pi driver) when building runtime payloads.
 *
 * - **piServerPath**: path to pi-agent-server entry point
 *   - Packaged: appRootPath/resources/pi-agent-server/index.js
 *   - Dev:      appRootPath/packages/pi-agent-server/dist/index.js
 * - **interceptorBundlePath**: optional network interceptor override
 * - **nodeRuntimePath**: optional Node/Bun executable override
 */
export function resolveBackendRuntimePaths(
  hostRuntime: BackendHostRuntimeContext,
): ResolvedBackendRuntimePaths {
  const { appRootPath, isPackaged, nodeRuntimePath, interceptorBundlePath, resourcesPath } = hostRuntime;
  // Packaged: loose files in resources/; Dev: workspace packages/
  const piServerPath = isPackaged
    ? join(resourcesPath ?? appRootPath, 'pi-agent-server', 'index.js')
    : join(appRootPath, 'packages', 'pi-agent-server', 'dist', 'index.js');

  // In packaged builds, the pi-agent-server subprocess (built with --target=bun)
  // must be run with the bundled bun.exe, not with Electron's process.execPath.
  const resolvedNode = nodeRuntimePath
    || (isPackaged && resourcesPath
      ? join(resourcesPath, 'app', 'vendor', 'bun', process.platform === 'win32' ? 'bun.exe' : 'bun')
      : undefined)
    || '';

  return {
    piServerPath,
    interceptorBundlePath: interceptorBundlePath ?? '',
    nodeRuntimePath: resolvedNode,
  };
}

/**
 * Resolve backend-managed host tooling paths (e.g. ripgrep) from generic host runtime metadata.
 *
 * Tries to locate the ripgrep binary via:
 *  1. Dynamic resolution of @vscode/ripgrep from appRootPath (dev / module hoisted to workspace root)
 *  2. Packaged app path via resourcesPath/app/node_modules/@vscode/ripgrep
 */
export function resolveBackendHostTooling(
  hostRuntime: BackendHostRuntimeContext,
): { ripgrepPath?: string } {
  // Try resolving from appRootPath first (dev mode, module hoisted to workspace root)
  let rgPath = tryResolveRipgrep(hostRuntime.appRootPath);
  if (!rgPath && hostRuntime.resourcesPath) {
    rgPath = tryResolveRipgrep(hostRuntime.resourcesPath);
  }
  if (rgPath) {
    return { ripgrepPath: rgPath };
  }

  // In packaged builds, @vscode/ripgrep is at:
  //   {resourcesPath}/app/node_modules/@vscode/ripgrep
  if (hostRuntime.isPackaged && hostRuntime.resourcesPath) {
    rgPath = tryResolveRipgrep(join(hostRuntime.resourcesPath, 'app'));
    if (rgPath) {
      return { ripgrepPath: rgPath };
    }
  }

  return {};
}

/**
 * Try to resolve @vscode/ripgrep's rgPath from a base directory.
 * Uses createRequire for ESM compatibility (no hard import dependency).
 */
function tryResolveRipgrep(basePath: string): string | undefined {
  try {
    const req = createRequire(join(basePath, 'noop.js'));
    const mod = req('@vscode/ripgrep');
    return mod?.rgPath;
  } catch {
    return undefined;
  }
}
