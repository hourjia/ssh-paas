import type {
  AddServerPayload,
  AppRecord,
  AppTemplate,
  CheckReport,
  CreateAppPayload,
  JobSnapshot,
  ServerConfig,
  ServerRecord,
  ServerResources,
  UpdateAppPayload,
} from './types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `请求失败（HTTP ${res.status}）`)
  }
  return data as T
}

export function listServers() {
  return request<{ servers: ServerRecord[] }>('/api/servers')
}

export function addServer(payload: AddServerPayload) {
  return request<{ server: ServerRecord }>('/api/servers', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function testServer(id: string) {
  return request<{ server: ServerRecord }>(`/api/servers/${id}/test`, { method: 'POST' })
}

export function deleteServer(id: string) {
  return request<{ ok: boolean }>(`/api/servers/${id}`, { method: 'DELETE' })
}

export function getConfig(id: string) {
  return request<{ config: ServerConfig }>(`/api/servers/${id}/config`)
}

export function saveConfig(id: string, config: ServerConfig) {
  return request<{ config: ServerConfig }>(`/api/servers/${id}/config`, {
    method: 'PUT',
    body: JSON.stringify({ config }),
  })
}

export function runCheck(id: string, refreshMirrors = false) {
  return request<CheckReport>(`/api/servers/${id}/check`, {
    method: 'POST',
    body: JSON.stringify({ refreshMirrors }),
  })
}

export function startInit(id: string, config: ServerConfig) {
  return request<{ job: JobSnapshot }>(`/api/servers/${id}/init`, {
    method: 'POST',
    body: JSON.stringify({ config }),
  })
}

export function getJob(id: string) {
  return request<{ job: JobSnapshot }>(`/api/jobs/${id}`)
}

export function listApps() {
  return request<{ apps: AppRecord[] }>('/api/apps')
}

export function listTemplates() {
  return request<{ templates: AppTemplate[] }>('/api/templates')
}

export function createApp(payload: CreateAppPayload) {
  return request<{ app: AppRecord }>('/api/apps', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteApp(id: string, opts: { cleanup?: boolean; data?: boolean } = {}) {
  const q = new URLSearchParams()
  if (opts.cleanup) q.set('cleanup', '1')
  if (opts.data) q.set('data', '1')
  const suffix = q.toString() ? `?${q.toString()}` : ''
  return request<{ ok: boolean; detail?: string }>(`/api/apps/${id}${suffix}`, { method: 'DELETE' })
}

export function deployApp(id: string) {
  return request<{ job: JobSnapshot; app: AppRecord }>(`/api/apps/${id}/deploy`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function updateApp(id: string, payload: UpdateAppPayload) {
  return request<{ app: AppRecord }>(`/api/apps/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function getServerResources(id: string) {
  return request<ServerResources>(`/api/servers/${id}/resources`)
}

export function cleanupServerResources(id: string, payload: { containers: string[]; paths: string[] }) {
  return request<{ ok: boolean; removed: { containers: string[]; paths: string[] }; detail: string }>(
    `/api/servers/${id}/resources/cleanup`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
}

const TERMINAL = new Set(['done', 'failed', 'interrupted'])

// 订阅任务 SSE；返回取消函数。事件与后端保持一致：state / step / log
export function streamJob(
  id: string,
  handlers: {
    onState?: (job: JobSnapshot) => void
    onStep?: (step: JobSnapshot['steps'][number]) => void
    onLog?: (log: { stream: string; text: string; at?: string }) => void
    onEnd?: () => void
  },
) {
  const es = new EventSource(`/api/jobs/${id}/stream`)
  const parse = <T,>(raw: string): T | null => {
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }
  es.addEventListener('state', (e) => {
    const data = parse<JobSnapshot>((e as MessageEvent).data)
    if (!data) return
    handlers.onState?.(data)
    if (TERMINAL.has(data.status)) {
      es.close()
      handlers.onEnd?.()
    }
  })
  es.addEventListener('step', (e) => {
    const data = parse<JobSnapshot['steps'][number]>((e as MessageEvent).data)
    if (data) handlers.onStep?.(data)
  })
  es.addEventListener('log', (e) => {
    const data = parse<{ stream: string; text: string }>((e as MessageEvent).data)
    if (data) handlers.onLog?.(data)
  })
  es.onerror = () => {
    es.close()
    handlers.onEnd?.()
  }
  return () => es.close()
}
