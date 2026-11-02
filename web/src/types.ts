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
  createdAt: string
  lastCheckAt: string | null
}

export interface AddServerPayload {
  address: string
  name?: string
  user: string
  password: string
  keyAuth: boolean
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
