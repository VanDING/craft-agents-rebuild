/**
 * BoundSessionBadge - header chip showing which session a bound panel follows.
 * Shared by all bound content panels (Review / Files / Context / Preview).
 */

import { Link2 } from 'lucide-react'

export function BoundSessionBadge({ name, sessionId }: { name?: string; sessionId: string }) {
  return (
    <span
      className="inline-flex max-w-[24ch] items-center gap-1 truncate rounded-full border border-border/60 bg-foreground/[0.03] px-2 py-0.5 text-[11px] text-muted-foreground"
      title={name ?? sessionId}
    >
      <Link2 className="h-3 w-3 shrink-0" />
      <span className="truncate">{name ?? sessionId}</span>
    </span>
  )
}
