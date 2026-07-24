// In dev mode with Vite proxy: /api → localhost:8000
// In production or when proxy isn't available: hit the backend directly
const BASE = import.meta.env.DEV ? '/api' : (import.meta.env.VITE_API_URL || 'http://localhost:8000')

export interface StepResult {
  name: string
  agent: string
  status: string
  output: string
  tokens: number
  latency_ms: number
}

export interface FixEntry {
  attempt: number
  strategy: string
  action: string
  result: string
  timestamp: string
}

export interface TaskResult {
  task_id: string
  status: string  // running | success | manual_mode | error
  prompt: string
  steps: StepResult[]
  final_output: string
  total_tokens: number
  retry_count: number
  fix_history: FixEntry[]
  mode: string
  error: string
}

export async function submitTask(prompt: string) {
  const res = await fetch(`${BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Server error ${res.status}: ${text}`)
  }
  return res.json() as Promise<{ task_id: string; status: string; message: string }>
}

export async function getTask(taskId: string): Promise<TaskResult> {
  const res = await fetch(`${BASE}/tasks/${taskId}`)
  if (!res.ok) throw new Error(`Not found: ${res.status}`)
  return res.json()
}

export function subscribeToTask(taskId: string, onEvent: (ev: string, data: any) => void): () => void {
  const es = new EventSource(`${BASE}/tasks/${taskId}/stream`)
  es.addEventListener('status', (e) => onEvent('status', JSON.parse(e.data)))
  es.addEventListener('complete', (e) => { onEvent('complete', JSON.parse(e.data)); es.close() })
  es.addEventListener('error', (e) => {
    try { onEvent('error', JSON.parse((e as MessageEvent).data)) } catch { onEvent('error', {}) }
    es.close()
  })
  es.onerror = () => es.close()
  return () => es.close()
}

export async function getActiveContexts() {
  const res = await fetch(`${BASE}/context`)
  if (!res.ok) return { active_tasks: [], count: 0 }
  return res.json() as Promise<{ active_tasks: string[]; count: number }>
}

export async function getContext(taskId: string) {
  const res = await fetch(`${BASE}/context/${taskId}`)
  if (!res.ok) return null
  return res.json()
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`)
    return res.ok
  } catch {
    return false
  }
}

export async function cancelTask(taskId: string) {
  const res = await fetch(`${BASE}/tasks/${taskId}/cancel`, { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to cancel: ${res.status}`)
  return res.json()
}
