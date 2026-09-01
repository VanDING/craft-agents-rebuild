import type { ActivityItem } from '@craft-agent/ui'
import type { ResolvedArtifact } from '@craft-agent/shared/artifacts/browser'
import type { ArtifactEventSnapshot } from '@craft-agent/shared/artifacts/browser'
import { ArtifactCard } from './ArtifactCard'
import { artifactEventsForTurn } from './artifact-events'

interface ArtifactTurnCardsProps {
  activities: readonly ActivityItem[]
  events?: readonly ArtifactEventSnapshot[]
  artifacts: readonly ResolvedArtifact[]
  onOpen: (artifactId: string) => void
  onAccept: (artifactId: string) => Promise<void>
  onDiscard: (artifactId: string) => Promise<void>
  onRevise: (artifactId: string) => Promise<void>
}

export function ArtifactTurnCards({
  activities,
  events: providedEvents,
  artifacts,
  onOpen,
  onAccept,
  onDiscard,
  onRevise,
}: ArtifactTurnCardsProps) {
  const events = providedEvents ?? artifactEventsForTurn(activities)
  if (events.length === 0) return null
  const byId = new Map(artifacts.map((artifact) => [artifact.artifact.id, artifact]))
  return (
    <div data-artifact-turn-content="true">
      {events.map((event) => (
        <ArtifactCard
          key={`${event.artifactId}:${event.revision ?? event.timestamp}`}
          event={event}
          live={byId.get(event.artifactId)}
          onOpen={() => onOpen(event.artifactId)}
          onAccept={() => onAccept(event.artifactId)}
          onDiscard={() => onDiscard(event.artifactId)}
          onRevise={() => onRevise(event.artifactId)}
        />
      ))}
    </div>
  )
}
