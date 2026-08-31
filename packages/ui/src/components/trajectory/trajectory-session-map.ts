import type { TrajectoryTurnModel } from './trajectory-layout'

export interface TrajectoryMapSession {
  id: string
  title: string
  preview?: string
  status?: string
  isProcessing?: boolean
  parentSessionId?: string
  branchFromSessionId?: string
  branchFromMessageId?: string
  messageCount?: number
  createdAt?: number
}

export interface TrajectorySessionMap {
  currentSessionId: string
  sessions: readonly TrajectoryMapSession[]
}

export interface TrajectoryMapNode {
  id: string
  type: 'session'
  x: number
  y: number
  width: number
  height: number
  session: TrajectoryMapSession
  relation: 'current' | 'branch' | 'subtask' | 'related'
  childCount: number
  /** Loaded turn count is available for the active session only. */
  turnCount?: number
  /** Exact turn that produced this branch, when the source session is active. */
  branchFromTurn?: number
}

export interface TrajectoryMapEdge {
  id: string
  from: string
  to: string
  kind: 'branch' | 'subtask'
  sourceTurn?: number
}

export interface TrajectoryMapLayout {
  nodes: readonly TrajectoryMapNode[]
  edges: readonly TrajectoryMapEdge[]
  width: number
  height: number
}

const NODE_WIDTH = 264
const NODE_HEIGHT = 116
const X_GAP = 84
const Y_GAP = 30
const CANVAS_PAD = 48

function sessionParentId(session: TrajectoryMapSession): string | undefined {
  return session.branchFromSessionId ?? session.parentSessionId
}

/** Return only the connected branch/subtask family around the active session. */
export function selectTrajectorySessionFamily(
  currentSessionId: string,
  sessions: readonly TrajectoryMapSession[],
): readonly TrajectoryMapSession[] {
  const byId = new Map(sessions.map(session => [session.id, session]))
  if (!byId.has(currentSessionId)) return []

  const adjacent = new Map<string, Set<string>>()
  const connect = (a: string, b: string) => {
    if (!adjacent.has(a)) adjacent.set(a, new Set())
    if (!adjacent.has(b)) adjacent.set(b, new Set())
    adjacent.get(a)!.add(b)
    adjacent.get(b)!.add(a)
  }
  for (const session of sessions) {
    const parentId = sessionParentId(session)
    if (parentId && byId.has(parentId)) connect(session.id, parentId)
  }

  const selected = new Set<string>([currentSessionId])
  const queue = [currentSessionId]
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const related of adjacent.get(id) ?? []) {
      if (selected.has(related)) continue
      selected.add(related)
      queue.push(related)
    }
  }
  return sessions.filter(session => selected.has(session.id))
}

function relationOf(session: TrajectoryMapSession, currentSessionId: string): TrajectoryMapNode['relation'] {
  if (session.id === currentSessionId) return 'current'
  if (session.branchFromSessionId) return 'branch'
  if (session.parentSessionId) return 'subtask'
  return 'related'
}

function turnByMessageId(turns: readonly TrajectoryTurnModel[]): ReadonlyMap<string, number> {
  const result = new Map<string, number>()
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index]
    if (!turn || turn.turn === null) continue
    const ordinal = turn.turn ?? index + 1
    for (const cell of turn.groups.flatMap(group => group.cells)) {
      if (cell.sourceSeq) result.set(cell.sourceSeq, ordinal)
      if (cell.sourceMessage?.id) result.set(cell.sourceMessage.id, ordinal)
    }
  }
  return result
}

/**
 * Deterministic, read-only projection of the active session family.
 *
 * Turns remain internal to their session. Only real sessions become canvas
 * nodes; a turn appears solely as metadata on the branch it produced.
 */
export function buildTrajectorySessionMapLayout(
  turns: readonly TrajectoryTurnModel[],
  input: TrajectorySessionMap,
  collapsedSessionIds: ReadonlySet<string> = new Set(),
): TrajectoryMapLayout {
  const sessions = selectTrajectorySessionFamily(input.currentSessionId, input.sessions)
  const byId = new Map(sessions.map(session => [session.id, session]))
  const current = byId.get(input.currentSessionId)
  if (!current) return { nodes: [], edges: [], width: 360, height: 240 }

  const children = new Map<string, TrajectoryMapSession[]>()
  for (const session of sessions) {
    const parentId = sessionParentId(session)
    if (!parentId || !byId.has(parentId)) continue
    const list = children.get(parentId) ?? []
    list.push(session)
    children.set(parentId, list)
  }
  for (const list of children.values()) {
    list.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id))
  }

  let root = current
  const lineage = new Set<string>([root.id])
  let parentId = sessionParentId(root)
  while (parentId && byId.has(parentId) && !lineage.has(parentId)) {
    root = byId.get(parentId)!
    lineage.add(root.id)
    parentId = sessionParentId(root)
  }

  const visible = new Set<string>()
  const visit = (id: string, path: ReadonlySet<string>) => {
    if (visible.has(id) || path.has(id)) return
    visible.add(id)
    if (collapsedSessionIds.has(id)) return
    const nextPath = new Set(path)
    nextPath.add(id)
    for (const child of children.get(id) ?? []) visit(child.id, nextPath)
  }
  visit(root.id, new Set())

  const subtreeHeight = new Map<string, number>()
  const measure = (id: string, path: ReadonlySet<string>): number => {
    const cached = subtreeHeight.get(id)
    if (cached !== undefined) return cached
    if (path.has(id)) return NODE_HEIGHT
    const nextPath = new Set(path)
    nextPath.add(id)
    const visibleChildren = (children.get(id) ?? []).filter(child => visible.has(child.id))
    const childrenHeight = visibleChildren.reduce(
      (total, child, index) => total + measure(child.id, nextPath) + (index > 0 ? Y_GAP : 0),
      0,
    )
    const height = Math.max(NODE_HEIGHT, childrenHeight)
    subtreeHeight.set(id, height)
    return height
  }
  measure(root.id, new Set())

  const messageTurns = turnByMessageId(turns)
  const currentTurnCount = turns.filter(turn => turn.turn !== null).length
  const nodes: TrajectoryMapNode[] = []
  const edges: TrajectoryMapEdge[] = []

  const place = (session: TrajectoryMapSession, depth: number, top: number, path: ReadonlySet<string>) => {
    if (path.has(session.id)) return
    const nextPath = new Set(path)
    nextPath.add(session.id)
    const blockHeight = subtreeHeight.get(session.id) ?? NODE_HEIGHT
    const branchFromTurn = session.branchFromSessionId === input.currentSessionId && session.branchFromMessageId
      ? messageTurns.get(session.branchFromMessageId)
      : undefined
    nodes.push({
      id: `session:${session.id}`,
      type: 'session',
      x: CANVAS_PAD + depth * (NODE_WIDTH + X_GAP),
      y: CANVAS_PAD + top + (blockHeight - NODE_HEIGHT) / 2,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      session,
      relation: relationOf(session, input.currentSessionId),
      childCount: children.get(session.id)?.length ?? 0,
      turnCount: session.id === input.currentSessionId ? currentTurnCount : undefined,
      branchFromTurn,
    })

    const visibleChildren = (children.get(session.id) ?? []).filter(child => visible.has(child.id))
    let childTop = top
    for (const child of visibleChildren) {
      const sourceTurn = child.branchFromSessionId === input.currentSessionId && child.branchFromMessageId
        ? messageTurns.get(child.branchFromMessageId)
        : undefined
      edges.push({
        id: `session:${session.id}->session:${child.id}`,
        from: `session:${session.id}`,
        to: `session:${child.id}`,
        kind: child.branchFromSessionId ? 'branch' : 'subtask',
        sourceTurn,
      })
      place(child, depth + 1, childTop, nextPath)
      childTop += (subtreeHeight.get(child.id) ?? NODE_HEIGHT) + Y_GAP
    }
  }
  place(root, 0, 0, new Set())

  const width = Math.max(360, ...nodes.map(node => node.x + node.width + CANVAS_PAD))
  const height = Math.max(240, ...nodes.map(node => node.y + node.height + CANVAS_PAD))
  return { nodes, edges, width, height }
}
