/** Session permission mode and remembered approvals used by pre-tool-use.ts. */
import { getPermissionMode, setPermissionMode, cyclePermissionMode } from '../mode-manager.ts';
import type { PermissionMode } from '../mode-types.ts';
import type { PermissionManagerConfig } from './types.ts';

export type { PermissionMode };

/**
 * Dangerous commands that should always require permission in 'ask' mode.
 * These are never auto-allowed regardless of user configuration.
 */
const DANGEROUS_COMMANDS = new Set([
  'rm', 'rmdir', 'sudo', 'su', 'chmod', 'chown', 'chgrp',
  'mv', 'cp', 'dd', 'mkfs', 'fdisk', 'parted',
  'kill', 'killall', 'pkill',
  'reboot', 'shutdown', 'halt', 'poweroff',
  'curl', 'wget', 'ssh', 'scp', 'rsync',
  'git push', 'git reset', 'git rebase', 'git checkout',
]);

export class PermissionManager {
  private config: PermissionManagerConfig;

  // Session-scoped whitelists for "always allow" feature
  private alwaysAllowedCommands: Set<string> = new Set();
  private alwaysAllowedDomains: Set<string> = new Set();

  constructor(config: PermissionManagerConfig) {
    this.config = config;
  }

  // ============================================================
  // Permission Mode Management
  // ============================================================

  /**
   * Get the current permission mode for this session.
   */
  getPermissionMode(): PermissionMode {
    return getPermissionMode(this.config.sessionId);
  }

  /**
   * Set the permission mode for this session.
   */
  setPermissionMode(mode: PermissionMode): void {
    setPermissionMode(this.config.sessionId, mode);
  }

  /**
   * Cycle to the next permission mode (explore → ask → execute → explore).
   * Returns the new mode.
   */
  cyclePermissionMode(enabledModes?: PermissionMode[]): PermissionMode {
    return cyclePermissionMode(this.config.sessionId, enabledModes);
  }

  // ============================================================
  // Command Analysis Utilities
  // ============================================================

  /**
   * Extract the base command (first word) from a bash command string.
   * Handles pipes, redirects, and other shell constructs.
   *
   * @param command - Full bash command
   * @returns Base command name
   */
  getBaseCommand(command: string): string {
    const trimmed = command.trim();
    // Extract first word, handling common prefixes
    const match = trimmed.match(/^(?:sudo\s+)?(\S+)/);
    return match?.[1] ?? trimmed.split(/\s+/)[0] ?? '';
  }

  /**
   * Check if a command is in the dangerous commands list.
   *
   * @param baseCommand - Base command name (from getBaseCommand)
   * @returns true if command is dangerous
   */
  isDangerousCommand(baseCommand: string): boolean {
    return DANGEROUS_COMMANDS.has(baseCommand.toLowerCase());
  }

  /**
   * Extract domain from network commands (curl, wget, ssh, etc.)
   * Used for domain whitelisting checks.
   *
   * @param command - Full bash command
   * @returns Domain if found, null otherwise
   */
  extractDomainFromNetworkCommand(command: string): string | null {
    // Match common patterns for URLs and hostnames
    const urlMatch = command.match(/https?:\/\/([^\/\s:]+)/);
    if (urlMatch?.[1]) {
      return urlMatch[1];
    }

    // Match ssh-style user@host patterns
    const sshMatch = command.match(/@([^\s:]+)/);
    if (sshMatch?.[1]) {
      return sshMatch[1];
    }

    return null;
  }

  // ============================================================
  // Session-Scoped Whitelisting
  // ============================================================

  /**
   * Check if a base command has been whitelisted for this session.
   */
  isCommandWhitelisted(baseCommand: string): boolean {
    return this.alwaysAllowedCommands.has(baseCommand.toLowerCase());
  }

  /**
   * Whitelist a command for the remainder of the session.
   * Called when user clicks "Always Allow" for a command.
   */
  whitelistCommand(baseCommand: string): void {
    this.alwaysAllowedCommands.add(baseCommand.toLowerCase());
  }

  /**
   * Check if a domain has been whitelisted for network commands.
   */
  isDomainWhitelisted(domain: string): boolean {
    return this.alwaysAllowedDomains.has(domain.toLowerCase());
  }

  /**
   * Whitelist a domain for network commands.
   * Called when user clicks "Always Allow" for curl/wget to a domain.
   */
  whitelistDomain(domain: string): void {
    this.alwaysAllowedDomains.add(domain.toLowerCase());
  }

  /**
   * Clear all session-scoped whitelists.
   * Called on session clear or dispose.
   */
  clearWhitelists(): void {
    this.alwaysAllowedCommands.clear();
    this.alwaysAllowedDomains.clear();
  }

}
