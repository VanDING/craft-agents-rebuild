/**
 * useSessionActivities - Shared session → activities derivation.
 *
 * Extracted from the logic ChatDisplay uses to feed its overlays: turns from
 * groupMessagesByTurn, flattened to a single ActivityItem list (each turn in
 * ChatDisplay iterates `turn.activities`). Used by the Review panel and the
 * Preview panel so they present the exact same activity stream as the chat.
 */

import { useMemo } from 'react'
import { groupMessagesByTurn, type ActivityItem, type AssistantTurn } from '@craft-agent/ui'
import type { Session } from '../../shared/types'

function isAssistantTurn(turn: { type: string }): turn is AssistantTurn {
  return turn.type === 'assistant'
}

export function useSessionActivities(session: Session | null | undefined): ActivityItem[] {
  return useMemo(() => {
    if (!session?.messages?.length) return []
    const turns = groupMessagesByTurn(session.messages, {
      isSessionProcessing: session.isProcessing,
    })
    return turns.filter(isAssistantTurn).flatMap((turn) => turn.activities ?? [])
  }, [session?.messages, session?.isProcessing])
}
