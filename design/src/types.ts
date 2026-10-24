export type ServerStatus = 'online' | 'offline' | 'error'
export type ServiceStatus = 'running' | 'stopped' | 'error'
export type SourceType = 'git' | 'local'
export type AuthType = 'password' | 'key'

export interface EnvVar {
  id: string
  key: string
  value: string
  secret: boolean
}

export interface PortMap {
  id: string
  host: string
  container: string
  protocol: 'TCP' | 'UDP'
}

export interface Service {
  id: string
  name: string
  version: string
  sourceType: SourceType
  gitUrl: string
  branch: string
  localPath: string
  dockerfile: string
  envVars: EnvVar[]
  ports: PortMap[]
  cpuLimit: number
  memLimit: number
  status: ServiceStatus
  cpu: number
  mem: number
  cpuHistory: number[]
}

export interface Server {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: AuthType
  os: string
  status: ServerStatus
  cpu: number
  mem: number
  disk: number
  services: Service[]
}

export type ExecAction = 'deploy' | 'start' | 'stop'
export type ExecStatus = 'success' | 'failed' | 'running' | 'cancelled'

export interface Execution {
  id: string
  action: ExecAction
  status: ExecStatus
  serviceName: string
  version: string
  serverName: string
  serverId?: string
  serviceId?: string
  duration: string
  time: string
}

export type LogTone = 'cmd' | 'git' | 'docker' | 'ssh' | 'health' | 'ok' | 'err' | 'dim' | 'info'
export interface LogLine {
  id: number
  text: string
  tone: LogTone
}

export type Route =
  | { page: 'servers' }
  | { page: 'server'; serverId: string }
  | { page: 'config'; serverId: string; serviceId: string }
  | { page: 'services' }
  | { page: 'executions' }
  | { page: 'settings' }

export interface ConsoleTask {
  mode: 'run' | 'logs'
  serverId: string
  serviceId: string
  action?: ExecAction
}
