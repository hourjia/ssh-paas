/* ============ 后端 API 类型与请求封装 ============ */

export interface ApiServer {
  id: number
  name: string
  host: string
  port: number
  username: string
  auth_type: 'password' | 'key'
  auto_prepare: boolean
  status: 'unknown' | 'online' | 'offline' | 'error'
  os_info: string
  env_status: 'unchecked' | 'ready' | 'needs_manual' | 'failed'
  password_set: boolean
  key_set: boolean
  last_checked_at: string | null
  created_at: string
}

export interface ApiCheckItem {
  key: string
  label: string
  required: boolean
  status: 'ok' | 'missing' | 'broken' | 'no_permission'
  detail: string
}

export interface ApiAction {
  step: string
  status: 'ok' | 'failed'
  message: string
}

export interface ApiLogLine {
  t: string
  s: string
}

export interface ApiTaskReport {
  items: ApiCheckItem[]
  actions: ApiAction[]
  needs_manual: string[]
  logs: ApiLogLine[]
  os?: string
}

export interface ApiTask {
  id: number
  server_id: number
  server_name: string
  status: 'running' | 'success' | 'needs_manual' | 'failed'
  report: ApiTaskReport
  duration_ms: number | null
  created_at: string
  finished_at: string | null
}

export interface ApiServerInput {
  name: string
  host: string
  port: number
  username: string
  auth_type: 'password' | 'key'
  password?: string
  private_key?: string
  auto_prepare?: boolean
}

export class ApiError extends Error {
  fields: Record<string, string[]>
  constructor(message: string, fields: Record<string, string[]> = {}) {
    super(message)
    this.fields = fields
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch {
    throw new ApiError('无法连接后端服务，请确认 Django 已在 8000 端口启动')
  }
  if (!res.ok) {
    let fields: Record<string, string[]> = {}
    try {
      const body = await res.json()
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        fields = Object.fromEntries(
          Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : [String(v)]]),
        )
      }
    } catch {
      /* 非 JSON 错误体 */
    }
    const first = Object.values(fields)[0]?.[0]
    throw new ApiError(first ?? `请求失败（${res.status}）`, fields)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  listServers: () => request<ApiServer[]>('/servers/'),

  createServer: (input: ApiServerInput) =>
    request<ApiServer>('/servers/', { method: 'POST', body: JSON.stringify(input) }),

  updateServer: (id: number, input: Partial<ApiServerInput>) =>
    request<ApiServer>(`/servers/${id}/`, { method: 'PATCH', body: JSON.stringify(input) }),

  deleteServer: (id: number) => request<void>(`/servers/${id}/`, { method: 'DELETE' }),

  connectServer: (id: number) =>
    request<{ task_id: number; reused?: boolean }>(`/servers/${id}/connect/`, { method: 'POST' }),

  getTask: (id: number) => request<ApiTask>(`/env-tasks/${id}/`),

  listTasks: (serverId: number) => request<ApiTask[]>(`/env-tasks/?server=${serverId}`),
}
