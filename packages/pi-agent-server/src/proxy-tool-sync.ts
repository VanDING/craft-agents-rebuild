export interface ProxyToolDefinitionLike {
  name: string;
  description: string;
  inputSchema: unknown;
}

/**
 * Tool definitions are generated deterministically by the session registry and
 * MCP pool. A structural comparison lets the subprocess ignore identical
 * per-message syncs while still detecting schema/description changes.
 */
export function proxyToolDefinitionsChanged(
  current: readonly ProxyToolDefinitionLike[],
  next: readonly ProxyToolDefinitionLike[],
): boolean {
  return JSON.stringify(current) !== JSON.stringify(next);
}
