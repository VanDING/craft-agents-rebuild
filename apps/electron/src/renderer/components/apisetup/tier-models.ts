export interface PiModelInfo {
  id: string
  name: string
  costInput: number
  costOutput: number
  contextWindow: number
  reasoning: boolean
}

/** Resolve a saved default against the current provider-owned catalog. */
export function resolveDefaultCatalogModel(models: PiModelInfo[], savedDefault?: string): string {
  if (savedDefault && models.some(model => model.id === savedDefault)) return savedDefault
  return models[0]?.id ?? ''
}
