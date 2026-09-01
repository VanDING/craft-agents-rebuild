import { parseArtifactEvent, type ArtifactEventSnapshot } from '@craft-agent/shared/artifacts/browser'
import type { ActivityItem } from '@craft-agent/ui'

/** Extract structured Artifact events from canonical tool results, never Bash prose. */
export function artifactEventsForTurn(activities: readonly ActivityItem[]): ArtifactEventSnapshot[] {
  const byArtifact = new Map<string, ArtifactEventSnapshot>()
  for (const activity of activities) {
    const canonicalToolName = activity.toolName?.split('__').at(-1)
    if (!(canonicalToolName?.startsWith('artifact_') || canonicalToolName === 'image_generate')) continue
    const event = parseArtifactEvent(activity.content)
    if (!event) continue
    // Preserve last-event ordering when one turn creates, applies and submits.
    byArtifact.delete(event.artifactId)
    byArtifact.set(event.artifactId, event)
  }
  return [...byArtifact.values()]
}
