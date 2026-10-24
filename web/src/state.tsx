import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import type { ApiServer } from './api'
import type { ConsoleTask, ExecAction, Execution, ExecStatus, Route, Server, Service, ServiceStatus } from './types'
import { initialExecutions } from './data/mock'
import { nowLabel, uid } from './util'

export type ToastKind = 'success' | 'error' | 'info'
export interface Toast {
  id: string
  kind: ToastKind
  text: string
}

export interface ConfirmRequest {
  title: string
  desc: ReactNode
  confirmText: string
  onConfirm: () => void
}

export interface Prefs {
  lowPerf: boolean
  lessGlass: boolean
  confirmDanger: boolean
}

export interface BindInput {
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'key'
  password?: string
  privateKey?: string
  autoConnect: boolean
}

export interface EnvTaskView {
  taskId: number
  serverId: string
  serverName: string
}

export const actionLabel: Record<ExecAction, string> = { deploy: '部署', start: '启动', stop: '停止' }
export const execStatusLabel: Record<ExecStatus, string> = {
  success: '成功',
  failed: '失败',
  running: '进行中',
  cancelled: '已取消',
}

interface AppApi {
  servers: Server[]
  serversLoading: boolean
  executions: Execution[]
  route: Route
  collapsed: boolean
  prefs: Prefs
  toasts: Toast[]
  bindOpen: boolean
  confirmReq: ConfirmRequest | null
  consoleTask: ConsoleTask | null
  envTask: EnvTaskView | null
  runningCount: number
  navigate(r: Route): void
  toggleCollapsed(): void
  setPref<K extends keyof Prefs>(k: K, v: Prefs[K]): void
  openBind(): void
  closeBind(): void
  bindServer(input: BindInput): Promise<void>
  connectServer(serverId: string): Promise<void>
  refreshServers(): Promise<void>
  closeEnvTask(): void
  addService(serverId: string): void
  saveService(serverId: string, serviceId: string, draft: Service): void
  deleteService(serverId: string, serviceId: string): void
  unbindServer(serverId: string): Promise<void>
  restartServer(serverId: string): void
  setServiceStatus(serverId: string, serviceId: string, status: ServiceStatus): void
  requestConfirm(req: ConfirmRequest): void
  closeConfirm(): void
  openConsole(task: ConsoleTask): void
  closeConsole(): void
  recordExecution(e: Omit<Execution, 'id' | 'time'> & { time?: string }): void
  toast(kind: ToastKind, text: string): void
}

const Ctx = createContext<AppApi | null>(null)

export function useApp(): AppApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp 必须在 AppStateProvider 内使用')
  return v
}

function fromApi(s: ApiServer): Server {
  return {
    id: String(s.id),
    name: s.name,
    host: s.host,
    port: s.port,
    username: s.username,
    authType: s.auth_type,
    os: s.os_info || '未知系统',
    status: s.status === 'unknown' ? 'offline' : s.status,
    envStatus: s.env_status,
    cpu: 0,
    mem: 0,
    disk: 0,
    services: [],
  }
}

function newServiceDraft(): Service {
  return {
    id: uid('svc'),
    name: 'new-service',
    version: '0.1.0',
    sourceType: 'git',
    gitUrl: '',
    branch: 'main',
    localPath: '',
    dockerfile: './Dockerfile',
    envVars: [],
    ports: [],
    cpuLimit: 1,
    memLimit: 256,
    status: 'stopped',
    cpu: 0,
    mem: 0,
    cpuHistory: [],
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<Server[]>([])
  const [serversLoading, setServersLoading] = useState(true)
  const [executions, setExecutions] = useState<Execution[]>(initialExecutions)
  const [route, setRoute] = useState<Route>({ page: 'servers' })
  const [collapsed, setCollapsed] = useState(false)
  const [prefs, setPrefs] = useState<Prefs>({ lowPerf: false, lessGlass: false, confirmDanger: true })
  const [toasts, setToasts] = useState<Toast[]>([])
  const [bindOpen, setBindOpen] = useState(false)
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)
  const [consoleTask, setConsoleTask] = useState<ConsoleTask | null>(null)
  const [envTask, setEnvTask] = useState<EnvTaskView | null>(null)

  useEffect(() => {
    const el = document.documentElement
    el.classList.toggle('low-perf', prefs.lowPerf)
    el.classList.toggle('less-glass', prefs.lessGlass)
  }, [prefs])

  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = uid('toast')
    setToasts((ts) => [...ts, { id, kind, text }])
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 3600)
  }, [])

  const navigate = useCallback((r: Route) => setRoute(r), [])
  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), [])
  const setPref = useCallback(<K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v })), [])

  const refreshServers = useCallback(async () => {
    const list = await api.listServers()
    setServers(list.map(fromApi))
  }, [])

  useEffect(() => {
    refreshServers()
      .catch((e: unknown) => toast('error', e instanceof Error ? e.message : '加载服务器列表失败'))
      .finally(() => setServersLoading(false))
  }, [refreshServers, toast])

  const mutateServer = useCallback((serverId: string, fn: (s: Server) => Server) => {
    setServers((list) => list.map((s) => (s.id === serverId ? fn(s) : s)))
  }, [])

  const bindServer = useCallback(
    async (input: BindInput) => {
      const created = await api.createServer({
        name: input.name.trim(),
        host: input.host.trim(),
        port: input.port,
        username: input.username.trim(),
        auth_type: input.authType,
        password: input.password,
        private_key: input.privateKey,
      })
      setBindOpen(false)
      if (input.autoConnect) {
        const { task_id } = await api.connectServer(created.id)
        setEnvTask({ taskId: task_id, serverId: String(created.id), serverName: created.name })
      } else {
        toast('success', `服务器 ${created.name} 绑定成功`)
      }
      await refreshServers().catch(() => {})
    },
    [refreshServers, toast],
  )

  const connectServer = useCallback(
    async (serverId: string) => {
      const { task_id } = await api.connectServer(Number(serverId))
      const server = servers.find((s) => s.id === serverId)
      setEnvTask({ taskId: task_id, serverId, serverName: server?.name ?? '' })
    },
    [servers],
  )

  const closeEnvTask = useCallback(() => setEnvTask(null), [])

  const addService = useCallback(
    (serverId: string) => {
      const draft = newServiceDraft()
      mutateServer(serverId, (s) => ({ ...s, services: [...s.services, draft] }))
      toast('info', '服务已创建，请完善配置后保存')
      setRoute({ page: 'config', serverId, serviceId: draft.id })
    },
    [mutateServer, toast],
  )

  const saveService = useCallback(
    (serverId: string, serviceId: string, draft: Service) => {
      mutateServer(serverId, (s) => ({
        ...s,
        services: s.services.map((v) => (v.id === serviceId ? { ...draft } : v)),
      }))
    },
    [mutateServer],
  )

  const deleteService = useCallback(
    (serverId: string, serviceId: string) => {
      mutateServer(serverId, (s) => ({
        ...s,
        services: s.services.filter((v) => v.id !== serviceId),
      }))
      toast('success', '服务已删除')
      setRoute({ page: 'server', serverId })
    },
    [mutateServer, toast],
  )

  const unbindServer = useCallback(
    async (serverId: string) => {
      await api.deleteServer(Number(serverId))
      setServers((list) => list.filter((s) => s.id !== serverId))
      setRoute({ page: 'servers' })
      toast('success', '服务器已解绑')
    },
    [toast],
  )

  const restartServer = useCallback(
    (_serverId: string) => {
      toast('info', '暂不支持远程重启服务器')
    },
    [toast],
  )

  const setServiceStatus = useCallback(
    (serverId: string, serviceId: string, status: ServiceStatus) => {
      mutateServer(serverId, (s) => ({
        ...s,
        services: s.services.map((v) =>
          v.id === serviceId
            ? {
                ...v,
                status,
                cpu: status === 'running' ? Math.max(6, v.cpu || 12) : 0,
                mem: status === 'running' ? Math.max(15, v.mem || 32) : 0,
              }
            : v,
        ),
      }))
    },
    [mutateServer],
  )

  const requestConfirm = useCallback(
    (req: ConfirmRequest) => {
      if (!prefs.confirmDanger) {
        req.onConfirm()
        return
      }
      setConfirmReq(req)
    },
    [prefs.confirmDanger],
  )
  const closeConfirm = useCallback(() => setConfirmReq(null), [])

  const openConsole = useCallback((task: ConsoleTask) => setConsoleTask(task), [])
  const closeConsole = useCallback(() => setConsoleTask(null), [])

  const recordExecution = useCallback((e: Omit<Execution, 'id' | 'time'> & { time?: string }) => {
    setExecutions((list) => [{ id: uid('exec'), time: e.time ?? nowLabel(), ...e }, ...list])
  }, [])

  const runningCount = executions.filter((e) => e.status === 'running').length

  const apiValue = useMemo<AppApi>(
    () => ({
      servers,
      serversLoading,
      executions,
      route,
      collapsed,
      prefs,
      toasts,
      bindOpen,
      confirmReq,
      consoleTask,
      envTask,
      runningCount,
      navigate,
      toggleCollapsed,
      setPref,
      openBind: () => setBindOpen(true),
      closeBind: () => setBindOpen(false),
      bindServer,
      connectServer,
      refreshServers,
      closeEnvTask,
      addService,
      saveService,
      deleteService,
      unbindServer,
      restartServer,
      setServiceStatus,
      requestConfirm,
      closeConfirm,
      openConsole,
      closeConsole,
      recordExecution,
      toast,
    }),
    [
      servers,
      serversLoading,
      executions,
      route,
      collapsed,
      prefs,
      toasts,
      bindOpen,
      confirmReq,
      consoleTask,
      envTask,
      runningCount,
      navigate,
      toggleCollapsed,
      setPref,
      bindServer,
      connectServer,
      refreshServers,
      closeEnvTask,
      addService,
      saveService,
      deleteService,
      unbindServer,
      restartServer,
      setServiceStatus,
      requestConfirm,
      closeConfirm,
      openConsole,
      closeConsole,
      recordExecution,
      toast,
    ],
  )

  return <Ctx.Provider value={apiValue}>{children}</Ctx.Provider>
}
