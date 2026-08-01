import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export interface FilesystemIsolationPlan {
  status: 'enforced' | 'unavailable';
  backend: 'sandbox-exec' | 'bwrap' | 'firejail' | 'none';
  command: string;
  args: string[];
}

export interface FilesystemIsolationOptions {
  includeNetworkDeny?: boolean;
}

function existsOnPath(binary: string): boolean {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [binary], { stdio: 'ignore' });
  return result.status === 0;
}

let sandboxExecUsableCache: boolean | null = null;

function canUseSandboxExec(): boolean {
  if (sandboxExecUsableCache !== null) return sandboxExecUsableCache;
  if (!existsOnPath('sandbox-exec')) {
    sandboxExecUsableCache = false;
    return false;
  }

  const probe = spawnSync('sandbox-exec', ['-p', '(version 1) (allow default)', '/usr/bin/true'], { stdio: 'ignore' });
  sandboxExecUsableCache = probe.status === 0;
  return sandboxExecUsableCache;
}

function escapeSandboxPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildDarwinSandboxProfile(
  sessionDir: string,
  options?: FilesystemIsolationOptions,
): string {
  const escapedRoot = escapeSandboxPath(resolve(sessionDir));
  const profileParts = [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow sysctl-read)',
    '(allow file-read*)',
    // Reads of the app's plaintext credential cache are never allowed,
    // even within the session tree (audit C-2). Must come AFTER the
    // blanket read allow — the last matching rule wins in sandbox-exec.
    '(deny file-read* (regex "^.*/\\.credential-cache\\.json$"))',
    '(deny file-write*)',
    `(allow file-write* (subpath "${escapedRoot}"))`,
  ];

  if (options?.includeNetworkDeny) {
    profileParts.push('(deny network*)');
  }

  return profileParts.join(' ');
}

/**
 * Wrap command execution to deny writes outside the current session directory.
 *
 * Current support:
 * - macOS: sandbox-exec profile
 * - Linux: bubblewrap (preferred) or firejail private/whitelist profile
 * - others: unavailable (fail-safe for script_sandbox)
 */
export function applyFilesystemIsolation(
  command: string,
  args: string[],
  sessionDir: string,
  options?: FilesystemIsolationOptions,
): FilesystemIsolationPlan {
  const sessionRoot = resolve(sessionDir);

  if (process.platform === 'darwin' && canUseSandboxExec()) {
    const profile = buildDarwinSandboxProfile(sessionRoot, options);

    return {
      status: 'enforced',
      backend: 'sandbox-exec',
      command: 'sandbox-exec',
      args: ['-p', profile, command, ...args],
    };
  }

  if (process.platform === 'linux') {
    if (existsOnPath('bwrap')) {
      // Whitelist mounts instead of `--ro-bind / /` (which made the whole
      // root readable, exposing ~/.ssh, ~/.aws, and ~/.craft-agent to
      // sandboxed scripts — audit C-2). Only the session tree and essential
      // system dirs are bound; everything else is absent from the sandbox.
      return {
        status: 'enforced',
        backend: 'bwrap',
        command: 'bwrap',
        args: [
          '--die-with-parent',
          '--ro-bind', sessionRoot, sessionRoot,
          // Essential runtime dirs (interpreters, shared libs, certs/locale).
          // --ro-bind-try tolerates dirs absent on some distros (e.g. /opt).
          '--ro-bind-try', '/usr', '/usr',
          '--ro-bind-try', '/lib', '/lib',
          '--ro-bind-try', '/lib64', '/lib64',
          '--ro-bind-try', '/bin', '/bin',
          '--ro-bind-try', '/sbin', '/sbin',
          '--ro-bind-try', '/etc', '/etc',
          '--ro-bind-try', '/opt', '/opt',
          // Empty writable tmp for interpreter scratch space.
          '--tmpfs', '/tmp',
          '--proc', '/proc',
          '--dev', '/dev',
          '--',
          command,
          ...args,
        ],
      };
    }

    if (existsOnPath('firejail')) {
      return {
        status: 'enforced',
        backend: 'firejail',
        command: 'firejail',
        args: ['--quiet', `--private=${sessionRoot}`, `--whitelist=${sessionRoot}`, '--', command, ...args],
      };
    }
  }

  return {
    status: 'unavailable',
    backend: 'none',
    command,
    args,
  };
}
