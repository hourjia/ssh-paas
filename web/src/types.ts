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
  // 初始化时使用的配置，用于和当前配置做差异对比
  config?: ServerConfig
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
  // init 任务的模式：init 完整初始化 / apply 只跑变更步骤 / status 只读状态
  mode?: 'init' | 'apply' | 'status' | null
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

export interface AppTemplateEnv {
  key: string
  value?: string
  template?: string
}

export interface AppTemplate {
  id: string
  label: string
  kind: 'image' | 'service'
  description: string
  defaults: {
    image?: string
    port?: number
    healthPath?: string
    alias?: string
    containerPath?: string
    healthCmd?: string
    volumes?: AppVolumeInput[]
  }
  env: AppTemplateEnv[]
}

export interface AppVolume {
  name: string
  hostPath?: string
  mountPath: string
  serveUrl: string | null
  owner: string | null
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
  volumes: AppVolume[]
  service: AppServiceConfig | null
  runtime: { baseImage?: string; port: number; healthPath: string | null }
  status: 'idle' | 'deploying' | 'running' | 'stopped' | 'failed'
  warning: string | null
  lastError: string | null
  delivery: AppDelivery
  createdAt: string
  updatedAt: string
}

export interface EnvEntry {
  key: string
  values: string[]
  note: string
}

export interface CreateAppPayload {
  serverId: string
  kind: 'image' | 'service'
  name: string
  image: string
  domain?: string
  port: number
  env?: EnvEntry[]
  notes: string
  healthPath?: string
  volumes?: AppVolumeInput[]
  alias?: string
  dataDir?: string
  containerPath?: string
  dataOwner?: string
  healthCmd?: string
}

export interface AppVolumeInput {
  name: string
  mountPath: string
  serveUrl?: string | null
  owner?: string | null
}

// 应用配置备份文件：环境变量以明文存放，导入时再加密落库
export interface AppBackupEnv {
  key: string
  values: string[]
  note?: string
}

export interface AppBackupApp {
  id: string
  server: { host: string; port: number; user: string } | null
  name: string
  kind: 'image' | 'service'
  domain: string | null
  image: string | null
  notes?: string
  env: AppBackupEnv[]
  runtime: { port: number; healthPath: string | null }
  volumes: AppVolume[]
  service: AppServiceConfig | null
  delivery: AppDelivery | null
  status: AppRecord['status']
  createdAt?: string
  updatedAt?: string
}

export interface AppBackupFile {
  format: string
  version: number
  exportedAt: string
  warning?: string
  servers: { name: string; host: string; port: number; user: string }[]
  apps: AppBackupApp[]
}

export interface AppImportItem {
  id: string
  name: string
  action: 'create' | 'skip' | 'error'
  reason?: string
}

export interface AppImportPreview {
  items: AppImportItem[]
  unmatchedServers: string[]
  summary: { create: number; skip: number; error: number }
}

export interface UpdateAppPayload {
  name?: string
  image?: string
  domain?: string
  port?: number
  env?: EnvEntry[]
  notes?: string
  healthPath?: string
  volumes?: AppVolumeInput[]
  alias?: string
  dataDir?: string
  containerPath?: string
  dataOwner?: string
  healthCmd?: string
}

export interface ScriptEnvEntry {
  key: string
  value: string
}

export interface ScriptParam {
  key: string
  label: string
  defaultValue: string
  required: boolean
  // text：普通文本输入；bool：运行弹窗里的开关；file：运行弹窗里选文件上传
  type?: 'text' | 'bool' | 'file'
}

export interface ScriptLastRun {
  at: string | null
  status: 'ok' | 'failed' | null
  error: string | null
  jobId: string | null
  // 最近一次实际执行所用的服务器，可能不同于脚本的默认服务器
  serverId?: string | null
}

export interface ScriptRecord {
  id: string
  serverId: string
  name: string
  filename: string
  notes: string
  envKeys: string[]
  params: ScriptParam[]
  // 绑定的应用（容器名自动推导 ourjia_<appId>）；未绑定时为 null
  appId: string | null
  appName: string | null
  // 实际使用的容器名：绑定应用时由平台推导，否则是手填值；都没有时为 null
  container: string | null
  // 文件参数的上传目录（服务器上的绝对路径）；没有文件参数时为 null
  uploadDir: string | null
  runAs: string | null
  useSudo: boolean
  timeoutSec: number
  lastRun: ScriptLastRun
  createdAt: string
  updatedAt: string
}

export interface ScriptDetail extends ScriptRecord {
  content: string
  env: ScriptEnvEntry[]
}

export interface ScriptPayload {
  serverId: string
  name: string
  filename: string
  content: string
  env: ScriptEnvEntry[]
  params: ScriptParam[]
  appId?: string
  container?: string
  uploadDir?: string
  runAs?: string
  useSudo: boolean
  notes?: string
  timeoutSec?: number
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
