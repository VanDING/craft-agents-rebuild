import type { Message } from '@craft-agent/core/types'
import type { TrajectorySnapshot } from './trajectory-contract'

export type TrajectoryContextCategory = 'system' | 'user' | 'assistant' | 'tools' | 'attachments' | 'injected'

export interface TrajectoryContextItem {
  id: string
  category: TrajectoryContextCategory
  label: string
  content: string
  chars: number
  estimatedTokens: number
  messageId?: string
  callId?: string
  filePath?: string
}

export interface TrajectoryContextGroup {
  category: TrajectoryContextCategory
  items: readonly TrajectoryContextItem[]
  chars: number
  estimatedTokens: number
}

export interface TrajectoryRequestContext {
  requestSeq: number
  promptVersion: number
  /** Exact provider input tokens when recorded; category values remain estimates. */
  inputTokens?: number
  groups: readonly TrajectoryContextGroup[]
  totalChars: number
  estimatedTokens: number
  captured: boolean
  provider?: string
  model?: string
}

const CATEGORY_ORDER: readonly TrajectoryContextCategory[] = [
  'system', 'user', 'assistant', 'tools', 'attachments', 'injected',
]

function tokenEstimate(content: string): number {
  return content.length === 0 ? 0 : Math.max(1, Math.ceil(content.length / 4))
}

function safeJson(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function item(category: TrajectoryContextCategory, message: Message, label: string, content: string): TrajectoryContextItem {
  const filePath = message.badges?.find(badge => badge.filePath)?.filePath
    ?? message.attachments?.[0]?.storedPath
  return {
    id: `${category}:${message.id}`,
    category,
    label,
    content,
    chars: content.length,
    estimatedTokens: tokenEstimate(content),
    messageId: message.id,
    callId: message.toolUseId,
    filePath,
  }
}

function messageItems(message: Message): TrajectoryContextItem[] {
  switch (message.role) {
    case 'user': {
      const result = [item('user', message, 'User message', message.content)]
      for (const [index, attachment] of (message.attachments ?? []).entries()) {
        const content = [attachment.storedPath, attachment.mimeType, `${attachment.size} bytes`].filter(Boolean).join('\n')
        result.push({
          id: `attachment:${message.id}:${index}`,
          category: 'attachments',
          label: attachment.name,
          content,
          chars: content.length,
          estimatedTokens: tokenEstimate(content),
          messageId: message.id,
          filePath: attachment.storedPath,
        })
      }
      return result
    }
    case 'assistant':
      return [item('assistant', message, message.isIntermediate ? 'Assistant commentary' : 'Assistant message', message.content)]
    case 'tool': {
      const input = safeJson(message.toolInput)
      const result = message.toolResult ?? message.content
      return [item('tools', message, message.toolDisplayName ?? message.toolName ?? 'Tool', [input, result].filter(Boolean).join('\n\n'))]
    }
    case 'info':
    case 'status':
    case 'warning':
    case 'plan':
      return [item('injected', message, message.statusType ?? message.role, message.content)]
    default:
      return []
  }
}

/**
 * Reconstruct the observable request context from persisted session evidence.
 * The system prompt is exact. Conversation categories are intentionally marked
 * estimated in the UI because provider adapters may compact or transform them.
 */
export function deriveRequestContexts(snapshot: TrajectorySnapshot): readonly TrajectoryRequestContext[] {
  const contexts: TrajectoryRequestContext[] = []
  const accumulated: TrajectoryContextItem[] = []
  const promptVersions = new Map<string, number>()

  for (const message of snapshot.messages) {
    if (message.role === 'assistant' && message.requestSeq !== undefined) {
      const prompt = snapshot.prompts.get(message.requestSeq) ?? message.promptSnapshot ?? ''
      let promptVersion = promptVersions.get(prompt)
      if (promptVersion === undefined) {
        promptVersion = promptVersions.size + 1
        promptVersions.set(prompt, promptVersion)
      }
      const systemItem: TrajectoryContextItem = {
        id: `system:${message.requestSeq}`,
        category: 'system',
        label: `System prompt v${promptVersion}`,
        content: prompt,
        chars: prompt.length,
        estimatedTokens: tokenEstimate(prompt),
      }
      const manifest = message.contextSnapshot
      const registeredTools: TrajectoryContextItem[] = (manifest?.tools ?? []).map((tool, index) => {
        const content = tool.description ?? ''
        const chars = tool.schemaChars + content.length
        return {
          id: `tool-definition:${message.requestSeq}:${index}`,
          category: 'tools',
          label: `${tool.name} · registered tool`,
          content,
          chars,
          estimatedTokens: tokenEstimate(' '.repeat(chars)),
        }
      })
      const allItems = [systemItem, ...registeredTools, ...accumulated]
      const groups = CATEGORY_ORDER.map(category => {
        const items = allItems.filter(entry => entry.category === category)
        const manifestMessageChars = manifest?.messages.reduce((sum, entry) => {
          const manifestCategory: TrajectoryContextCategory = entry.role === 'user'
            ? 'user'
            : entry.role === 'assistant'
              ? 'assistant'
              : entry.role === 'tool'
                ? 'tools'
                : 'injected'
          return manifestCategory === category ? sum + entry.chars : sum
        }, 0)
        const manifestChars = !manifest || category === 'attachments'
          ? undefined
          : category === 'system'
            ? manifest.system.chars
            : category === 'tools'
              ? (manifestMessageChars ?? 0) + manifest.tools.reduce((sum, tool) => sum + tool.schemaChars + (tool.description?.length ?? 0), 0)
              : manifestMessageChars
        const chars = manifestChars ?? items.reduce((sum, entry) => sum + entry.chars, 0)
        return {
          category,
          items,
          chars,
          estimatedTokens: tokenEstimate(' '.repeat(chars)),
        }
      }).filter(group => group.items.length > 0 || group.chars > 0)
      contexts.push({
        requestSeq: message.requestSeq,
        promptVersion,
        inputTokens: message.usage ? message.usage.input + message.usage.cacheRead : undefined,
        groups,
        totalChars: groups.reduce((sum, group) => sum + group.chars, 0),
        estimatedTokens: groups.reduce((sum, group) => sum + group.estimatedTokens, 0),
        captured: manifest !== undefined,
        provider: manifest?.provider,
        model: manifest?.model,
      })
    }
    accumulated.push(...messageItems(message))
  }
  return contexts
}

export function requestContextDelta(
  current: TrajectoryRequestContext,
  previous: TrajectoryRequestContext | undefined,
): number | undefined {
  if (!previous) return undefined
  const currentValue = current.inputTokens ?? current.estimatedTokens
  const previousValue = previous.inputTokens ?? previous.estimatedTokens
  return currentValue - previousValue
}
