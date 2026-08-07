/**
 * Model catalog for the Task editor: provider→model groups plus a
 * model-id → connection-slug map, built from the workspace's LLM
 * connections. Shared by the Kanban board and the schedule views so the
 * editor overlay behaves identically everywhere.
 */

import { getModelShortName } from '@config/models'
import { getDefaultModelsForConnection, type LlmConnectionWithStatus } from '@config/llm-connections'
import type { KanbanModelProviderGroup } from './types'

export interface ModelCatalog {
  groups: KanbanModelProviderGroup[]
  modelToConnection: Map<string, string>
}

export function buildModelCatalog(connections: LlmConnectionWithStatus[]): ModelCatalog {
  const groups: KanbanModelProviderGroup[] = []
  const modelToConnection = new Map<string, string>()

  for (const conn of connections) {
    if (!conn.isAuthenticated) continue
    const rawModels = conn.models?.length
      ? conn.models
      : getDefaultModelsForConnection(conn.providerType, conn.piAuthProvider)
    const models = rawModels.map(m => {
      const id = typeof m === 'string' ? m : m.id
      const name = typeof m === 'string' ? getModelShortName(m) : m.name || getModelShortName(m.id)
      return { id, name }
    })
    if (models.length === 0) continue
    for (const m of models) modelToConnection.set(m.id, conn.slug)
    // Provider key drives the brand icon: resolved via piAuthProvider first,
    // falling back to providerType (see resolveProviderIcon in TaskTile).
    const provider = conn.piAuthProvider || conn.providerType
    groups.push({ provider, label: conn.name, models })
  }

  return { groups, modelToConnection }
}
