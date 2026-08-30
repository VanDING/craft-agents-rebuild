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

export type TrajectoryMapNode =
  | {
      id: string
      type: 'turn'
      x: number
      y: number
      width: number
      height: number
      turn: number
      question: string
      answer: string
      toolCount: number
      errorCount: number
      recordIndex?: number
      messageId?: string
    }
  | {
      id: string
      type: 'session'
      x: number
      y: number
      width: number
      height: number
      session: TrajectoryMapSession
      relation: 'current' | 'branch' | 'subtask' | 'related'
      childCount: number
    }

export interface TrajectoryMapEdge {
  id: string
  from: string
  to: string
  kind: 'continuation' | 'branch' | 'subtask'
}

export interface TrajectoryMapLayout {
  nodes: readonly TrajectoryMapNode[]
  edges: readonly TrajectoryMapEdge[]
  width: number
  height: number
}

const NODE_WIDTH = 260
const TURN_HEIGHT = 132
const SESSION_HEIGHT = 112
const X_GAP = 40
const Y_GAP = 76

function compactText(value: string | undefined, fallback = ''): string {
  const compact = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (compact.length <= 150) return compact || fallback
  return `${compact.slice(0, 149)}…`
}

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

function turnNode(turn: TrajectoryTurnModel, ordinal: number): TrajectoryMapNode {
  const cells = turn.groups.flatMap(group => group.cells)
  const user = cells.find(cell => cell.kind === 'user')
  const assistant = [...cells].reverse().find(cell => cell.kind === 'message')
  const tools = cells.filter(cell => cell.kind === 'tool' || cell.kind === 'subtool')
  return {
    id: `turn:${turn.turn ?? ordinal + 1}`,
    type: 'turn',
    x: NODE_WIDTH + X_GAP + ordinal * (NODE_WIDTH + X_GAP),
    y: 36,
    width: NODE_WIDTH,
    height: TURN_HEIGHT,
    turn: turn.turn ?? ordinal + 1,
    question: compactText(user?.text, 'Continuation'),
    answer: compactText(assistant?.text, tools.length > 0 ? 'Tool work' : 'No assistant response'),
    toolCount: tools.length,
    errorCount: tools.filter(cell => cell.isError).length,
    recordIndex: user?.index ?? assistant?.index,
    messageId: user?.sourceSeq ?? assistant?.sourceSeq,
  }
}

/** Deterministic, read-only projection of turns and related sessions onto a canvas. */
export function buildTrajectorySessionMapLayout(
  turns: readonly TrajectoryTurnModel[],
  input: TrajectorySessionMap,
  collapsedSessionIds: ReadonlySet<string> = new Set(),
): TrajectoryMapLayout {
  const sessions = selectTrajectorySessionFamily(input.currentSessionId, input.sessions)
  const byId = new Map(sessions.map(session => [session.id, session]))
  const current = byId.get(input.currentSessionId)
  if (!current) return { nodes: [], edges: [], width: 720, height: 420 }

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

  const visible = new Set<string>()
  const addVisible = (id: string) => {
    if (visible.has(id)) return
    visible.add(id)
    if (collapsedSessionIds.has(id)) return
    for (const child of children.get(id) ?? []) addVisible(child.id)
  }
  let familyRoot = current
  let rootParent = sessionParentId(familyRoot)
  const rootPath = new Set<string>([current.id])
  while (rootParent && byId.has(rootParent) && !rootPath.has(rootParent)) {
    rootPath.add(rootParent)
    familyRoot = byId.get(rootParent)!
    rootParent = sessionParentId(familyRoot)
  }
  addVisible(familyRoot.id)

  const nodes: TrajectoryMapNode[] = []
  const edges: TrajectoryMapEdge[] = []
  const currentNode: TrajectoryMapNode = {
    id: `session:${current.id}`,
    type: 'session',
    x: 0,
    y: 46,
    width: NODE_WIDTH,
    height: SESSION_HEIGHT,
    session: current,
    relation: 'current',
    childCount: children.get(current.id)?.length ?? 0,
  }
  nodes.push(currentNode)

  const visibleTurns = turns.filter(turn => turn.turn !== null)
  const turnNodes = visibleTurns.map(turnNode)
  nodes.push(...turnNodes)
  const firstTurn = turnNodes[0]
  if (firstTurn) {
    edges.push({ id: `session:${current.id}->${firstTurn.id}`, from: currentNode.id, to: firstTurn.id, kind: 'continuation' })
    for (let index = 1; index < turnNodes.length; index += 1) {
      const previous = turnNodes[index - 1]
      const next = turnNodes[index]
      if (previous && next) edges.push({ id: `${previous.id}->${next.id}`, from: previous.id, to: next.id, kind: 'continuation' })
    }
  }

  const messageTurn = new Map<string, TrajectoryMapNode>()
  for (let index = 0; index < visibleTurns.length; index += 1) {
    const node = turnNodes[index]
    const turn = visibleTurns[index]
    if (!node || !turn) continue
    for (const cell of turn.groups.flatMap(group => group.cells)) {
      if (cell.sourceSeq) messageTurn.set(cell.sourceSeq, node)
      if (cell.sourceMessage?.id) messageTurn.set(cell.sourceMessage.id, node)
    }
  }

  let ancestorDepth = 0
  let parentId = sessionParentId(current)
  let childId = current.id
  const lineageIds = new Set<string>([current.id])
  while (parentId && byId.has(parentId) && !lineageIds.has(parentId)) {
    const session = byId.get(parentId)!
    lineageIds.add(session.id)
    ancestorDepth += 1
    const node: TrajectoryMapNode = {
      id: `session:${session.id}`,
      type: 'session',
      x: -ancestorDepth * (NODE_WIDTH + X_GAP),
      y: 46,
      width: NODE_WIDTH,
      height: SESSION_HEIGHT,
      session,
      relation: session.branchFromSessionId ? 'branch' : 'subtask',
      childCount: 0,
    }
    nodes.push(node)
    const child = byId.get(childId)!
    edges.push({
      id: `${node.id}->session:${childId}`,
      from: node.id,
      to: `session:${childId}`,
      kind: child.branchFromSessionId ? 'branch' : 'subtask',
    })
    childId = session.id
    parentId = sessionParentId(session)
  }

  const sideSessions = sessions
    .filter(session => visible.has(session.id) && !lineageIds.has(session.id))
    .map(session => {
      let depth = 1
      let sourceId = sessionParentId(session)
      const path = new Set<string>([session.id])
      while (sourceId && !lineageIds.has(sourceId) && byId.has(sourceId) && !path.has(sourceId)) {
        path.add(sourceId)
        depth += 1
        sourceId = sessionParentId(byId.get(sourceId)!)
      }
      return { session, depth }
    })
    .sort((a, b) => a.depth - b.depth || (a.session.createdAt ?? 0) - (b.session.createdAt ?? 0) || a.session.id.localeCompare(b.session.id))
  const depthCounts = new Map<number, number>()
  for (const { session, depth } of sideSessions) {
    const sibling = depthCounts.get(depth) ?? 0
    depthCounts.set(depth, sibling + 1)
    const branchAnchor = session.branchFromSessionId === current.id && session.branchFromMessageId
      ? messageTurn.get(session.branchFromMessageId)
      : undefined
    const x = branchAnchor
      ? branchAnchor.x
      : (NODE_WIDTH + X_GAP) + sibling * (NODE_WIDTH + X_GAP)
    const y = TURN_HEIGHT + Y_GAP + (depth - 1) * (SESSION_HEIGHT + Y_GAP)
    const node: TrajectoryMapNode = {
      id: `session:${session.id}`,
      type: 'session',
      x,
      y,
      width: NODE_WIDTH,
      height: SESSION_HEIGHT,
      session,
      relation: session.branchFromSessionId ? 'branch' : session.parentSessionId ? 'subtask' : 'related',
      childCount: children.get(session.id)?.length ?? 0,
    }
    nodes.push(node)
    const source = branchAnchor?.id ?? `session:${sessionParentId(session) ?? current.id}`
    edges.push({
      id: `${source}->${node.id}`,
      from: source,
      to: node.id,
      kind: session.branchFromSessionId ? 'branch' : 'subtask',
    })
  }

  const minX = Math.min(...nodes.map(node => node.x))
  const minY = Math.min(...nodes.map(node => node.y))
  const shiftX = 36 - minX
  const shiftY = 36 - minY
  const shifted = nodes.map(node => ({ ...node, x: node.x + shiftX, y: node.y + shiftY }))
  const width = Math.max(720, ...shifted.map(node => node.x + node.width + 36))
  const height = Math.max(420, ...shifted.map(node => node.y + node.height + 36))
  return { nodes: shifted, edges, width, height }
}
