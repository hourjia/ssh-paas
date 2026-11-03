export interface CheckItem {
  id: string
  group: string
  label: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
  blocking?: boolean
}

export interface CheckSummary {
  total: number
  ok: number
  warn: number
  fail: number
}

export interface InitRecord {
  version?: number
  serverId?: string
  configHash?: string
  finishedAt?: string
  image?: string
  swapMb?: number
  addressPool?: string
  unparsable?: boolean
  [key: string]: unknown
}

export interface CheckReport {
  checks: CheckItem[]
  groups: string[]
  summary: CheckSummary
  canProceed: boolean
  initialized: boolean
  upToDate: boolean
  record: InitRecord | null
  facts: Record<string, string | number | undefined>
  server?: ServerRecord
  latencyMs?: number
}

export type InitState = 'unknown' | 'uninitialized' | 'ready' | 'drifted'

export interface ServerInitInfo {
  state: InitState
  lastCheckAt: string | null
  lastInitAt: string | null
  summary: CheckSummary | null
  error: string | null
}

export interface ServerConfig {
  dockerHubMirrors: string[]
  aptMirror: string | null
  dockerInstallSource: 'auto' | 'system' | 'official'
  swapMb: 'auto' | number
  swappiness: number
  traefikVersion: string
  acme: { email: string; ca: 'letsencrypt' | 'letsencrypt-staging' | 'none' }
  advanced: { containerDns: string[] | null; dockerAddressPool: string | null }
}

export interface JobStep {
  id: string
  title: string
  status: 'pending' | 'running' | 'done' | 'failed'
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

export interface JobLog {
  seq: number
  at: string
  stream: 'out' | 'err' | 'note' | 'cmd'
  text: string
}

export interface JobSnapshot {
  id: string
  serverId: string
  type: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'interrupted'
  currentStep: string | null
  steps: JobStep[]
  error: string | null
  createdAt: string
  finishedAt: string | null
  logs?: JobLog[]
}

export interface ServerRecord {
  id: string
  name: string
  host: string
  port: number
  user: string
  authType: 'password' | 'key'
  keyInstalled: boolean
  publicKey: string | null
  status: 'online' | 'offline' | 'unknown'
  lastError: string | null
  latencyMs: number | null
  os: string | null
  config?: ServerConfig
  init?: ServerInitInfo
  createdAt: string
  lastCheckAt: string | null
}

export interface ResourceContainer {
  name: string
  appId: string
  state: string
  status: string
  orphan: boolean
}

export interface ResourceDir {
  group: 'apps' | 'git' | 'data'
  name: string
  path: string
  appId: string
  orphan: boolean
}

export interface ServerResources {
  apps: { id: string; name: string; kind: string; status: string }[]
  containers: ResourceContainer[]
  dirs: ResourceDir[]
  orphans: { containers: ResourceContainer[]; dirs: ResourceDir[] }
  scannedAt: string
}

export interface AddServerPayload {
  address: string
  port?: number
  name?: string
  user: string
  password: string
  keyAuth: boolean
}

export interface AppDelivery {
  version: string | null
  tag: string | null
  commit: string | null
  deployedAt: string | null
}

export interface AppServiceConfig {
  alias: string | null
  dataDir: string
  containerPath: string
  dataOwner: string | null
  healthCmd: string | null
}

export interface AppRecord {
  id: string
  serverId: string
  name: string
  domain: string | null
  image: string | null
  notes: string | null
  kind: 'image' | 'service'
  envKeys: string[]
  service: AppServiceConfig | null
  runtime: { baseImage?: string; port: number; healthPath: string | null }
  status: 'idle' | 'deploying' | 'running' | 'failed'
  warning: string | null
  lastError: string | null
  delivery: AppDelivery
  createdAt: string
  updatedAt: string
}

export interface CreateAppPayload {
  serverId: string
  kind: 'image' | 'service'
  name: string
  image: string
  domain?: string
  port: number
  env: string
  notes: string
  alias?: string
  dataDir?: string
  containerPath?: string
  dataOwner?: string
  healthCmd?: string
}

export interface Settings {
  theme: 'light' | 'dark'
  glass: number
  reduceTrans: boolean
  autoRefresh: 'off' | '30' | '60' | '300'
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  glass: 62,
  reduceTrans: false,
  autoRefresh: 'off',
}
