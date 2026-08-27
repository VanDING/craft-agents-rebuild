import type { ActivityItem } from './TurnCard'

/**
 * A turn containing an unresolved external effect cannot expose replay-like
 * actions. Reconciliation must replace `unknown` with a durable decision first.
 */
export function canBranchFromTurn(activities: ActivityItem[]): boolean {
  return !activities.some(activity => activity.status === 'unknown')
}
