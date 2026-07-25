/**
 * Client-side task lineage ("conversation thread").
 *
 * The backend is stateless per task by design (RAM context, no cross-session
 * memory). To give the developer a chat-like experience we keep the lineage in
 * the browser only: each follow-up task records which task it came from and
 * what was asked. No backend or workflow change.
 */

const KEY = 'signozforge.threads.v1'

export interface ThreadNode {
  taskId: string
  prompt: string
  parentId: string | null
  /** The raw follow-up instruction the developer typed, if this was a refinement. */
  followUp?: string
  createdAt: number
}

type ThreadMap = Record<string, ThreadNode>

function readAll(): ThreadMap {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as ThreadMap) : {}
  } catch {
    return {}
  }
}

function writeAll(map: ThreadMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    // Storage full or blocked — lineage is a nice-to-have, never fatal.
  }
}

export function recordTask(node: Omit<ThreadNode, 'createdAt'>): void {
  const map = readAll()
  map[node.taskId] = { ...node, createdAt: Date.now() }
  writeAll(map)
}

export function getNode(taskId: string): ThreadNode | null {
  return readAll()[taskId] ?? null
}

/** Walk up the parent chain, oldest first, including the given task. */
export function getAncestry(taskId: string): ThreadNode[] {
  const map = readAll()
  const chain: ThreadNode[] = []
  const seen = new Set<string>()
  let cursor: string | null = taskId

  while (cursor && map[cursor] && !seen.has(cursor)) {
    seen.add(cursor)
    chain.unshift(map[cursor])
    cursor = map[cursor].parentId
  }
  return chain
}

/** Most recent tasks first — used for the Dashboard history list. */
export function getRecentTasks(limit = 12): ThreadNode[] {
  return Object.values(readAll())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}

/** Remove a single task from local history. */
export function removeTask(taskId: string): void {
  const map = readAll()
  delete map[taskId]
  writeAll(map)
}

/** Clear all task history. */
export function clearAllTasks(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // non-fatal
  }
}

/**
 * Build the prompt for a follow-up run. The agents get the original task plus
 * the previous result and the new instruction, so the refinement has context.
 */
export function buildFollowUpPrompt(
  originalPrompt: string,
  previousOutput: string,
  followUp: string,
): string {
  const trimmed =
    previousOutput.length > 4000 ? `${previousOutput.slice(0, 4000)}\n...[truncated]` : previousOutput

  return [
    `## Original task`,
    originalPrompt,
    ``,
    `## Previous result`,
    trimmed,
    ``,
    `## Requested revision`,
    followUp,
    ``,
    `Produce a complete, revised deliverable that applies the requested revision.`,
    `Do not describe the change — output the full improved result.`,
  ].join('\n')
}
