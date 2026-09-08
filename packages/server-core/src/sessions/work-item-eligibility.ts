/** Empty chat placeholders must not become durable board tasks. */
export function isSessionWorkItemEligible(session: {
  name?: string
  preview?: string
  messageCount?: number
  messages?: readonly unknown[]
  parentSessionId?: string
  isArchived?: boolean
  hidden?: boolean
  taskDraft?: unknown
}): boolean {
  if (session.parentSessionId || session.isArchived || session.hidden || session.taskDraft) return false
  return Boolean(
    session.name?.trim()
    || session.preview?.trim()
    || (session.messageCount ?? 0) > 0
    || (session.messages?.length ?? 0) > 0,
  )
}
