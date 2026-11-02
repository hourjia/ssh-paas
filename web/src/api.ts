import type { AddServerPayload, ServerRecord } from './types'

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
