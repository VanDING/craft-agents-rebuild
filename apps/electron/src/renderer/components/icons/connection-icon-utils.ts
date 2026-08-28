export function connectionFallbackInitial(name: string): string | null {
  return name.trim().match(/[\p{L}\p{N}]/u)?.[0]?.toLocaleUpperCase() ?? null
}
