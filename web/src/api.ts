import type {
  AddServerPayload,
  AppBackupFile,
  AppImportPreview,
  AppRecord,
  AppTemplate,
  CheckReport,
  CreateAppPayload,
  EnvEntry,
  JobSnapshot,
  ServerConfig,
  ServerRecord,
  ServerResources,
  ScriptDetail,
  ScriptPayload,
  ScriptRecord,
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

export type InitMode = 'init' | 'apply' | 'status' | 'auto'

export function startInit(id: string, config: ServerConfig, mode: InitMode = 'auto') {
  return request<{ job: JobSnapshot }>(`/api/servers/${id}/init`, {
    method: 'POST',
    body: JSON.stringify({ config, mode }),
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

export function exportAppsBackup() {
  return request<AppBackupFile>('/api/apps/export')
}

export function importAppsBackup(data: unknown, dryRun: boolean) {
  return request<{
    preview?: AppImportPreview
    imported?: AppRecord[]
    skipped?: number
    failed?: string[]
  }>('/api/apps/import', {
    method: 'POST',
    body: JSON.stringify({ data, dryRun }),
  })
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

export function stopApp(id: string) {
  return request<{ app: AppRecord; detail?: string }>(`/api/apps/${id}/stop`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function startApp(id: string) {
  return request<{ app: AppRecord; detail?: string }>(`/api/apps/${id}/start`, {
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

export function getAppEnv(id: string) {
  return request<{ env: EnvEntry[] }>(`/api/apps/${id}/env`)
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

export function listScripts() {
  return request<{ scripts: ScriptRecord[] }>('/api/scripts')
}

export function getScript(id: string) {
  return request<{ script: ScriptDetail }>(`/api/scripts/${id}`)
}

export function createScript(payload: ScriptPayload) {
  return request<{ script: ScriptRecord }>('/api/scripts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateScript(id: string, payload: ScriptPayload) {
  return request<{ script: ScriptRecord }>(`/api/scripts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteScript(id: string) {
  return request<{ ok: boolean }>(`/api/scripts/${id}`, { method: 'DELETE' })
}

export function runScript(
  id: string,
  serverId: string,
  values: Record<string, string> = {},
  uploads: Record<string, string> = {},
) {
  return request<{ job: JobSnapshot; script: ScriptRecord }>(`/api/scripts/${id}/run`, {
    method: 'POST',
    body: JSON.stringify({ serverId, values, uploads }),
  })
}

export interface UploadTicket {
  token: string
  name: string
  size: number
}

// 把脚本要用的文件传到平台暂存区，拿到 token 后再运行脚本（运行时平台再 SFTP 到目标服务器）
export function uploadFile(
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<UploadTicket> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/uploads?name=${encodeURIComponent(file.name)}`)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    }
    xhr.onload = () => {
      let data: { upload?: UploadTicket; error?: string } = {}
      try {
        data = JSON.parse(xhr.responseText) as { upload?: UploadTicket; error?: string }
      } catch {
        data = {}
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.upload) resolve(data.upload)
      else reject(new Error(data.error || `上传失败（HTTP ${xhr.status}）`))
    }
    xhr.onerror = () => reject(new Error('上传失败：网络中断'))
    xhr.onabort = () => reject(new Error('上传已取消'))
    xhr.send(file)
  })
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
