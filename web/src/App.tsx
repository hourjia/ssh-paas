import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from './api'
import type { AddServerPayload, ServerRecord, Settings } from './types'
import { DEFAULT_SETTINGS } from './types'
import { Sidebar, type PageKey } from './components/Sidebar'
import { ActionDock } from './components/ActionDock'
import { ServersPage } from './pages/ServersPage'
import { AppsPage } from './pages/AppsPage'
import { ServerDetailPage } from './pages/ServerDetailPage'
import { AddServerModal } from './components/AddServerModal'
import { SettingsModal } from './components/SettingsModal'
import { Toasts, type ToastItem } from './components/Toasts'

const SETTINGS_KEY = 'ourjia-paas-settings-v1'

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function applyMaterial(s: Settings) {
  const root = document.documentElement
  root.dataset.theme = s.theme
  const blur = s.reduceTrans ? 12 : 12 + s.glass * 0.2
  const alpha = s.reduceTrans ? 0.92 : 0.28 + s.glass * 0.005
  const cardAlpha = s.reduceTrans ? 0.95 : 0.52 + s.glass * 0.0042
  root.style.setProperty('--glass-blur', `${blur.toFixed(1)}px`)
  root.style.setProperty('--glass-a', alpha.toFixed(3))
  root.style.setProperty('--glass-a-dark', (alpha * 0.16).toFixed(3))
  root.style.setProperty('--card-a', cardAlpha.toFixed(3))
  root.style.setProperty('--card-a-dark', (cardAlpha * 0.13).toFixed(3))
}

const AUTO_REFRESH_MS: Record<Exclude<Settings['autoRefresh'], 'off'>, number> = {
  '30': 30_000,
  '60': 60_000,
  '300': 300_000,
}

export default function App() {
  const [page, setPage] = useState<PageKey>('servers')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [servers, setServers] = useState<ServerRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set())
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [addOpen, setAddOpen] = useState(false)
  const [appCreateOpen, setAppCreateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toastSeq = useRef(0)
  const serversRef = useRef(servers)
  serversRef.current = servers

  const toast = useCallback((msg: string) => {
    const id = ++toastSeq.current
    setToasts((ts) => [...ts, { id, msg, leaving: false }])
    setTimeout(() => {
      setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    }, 2600)
    setTimeout(() => {
      setToasts((ts) => ts.filter((t) => t.id !== id))
    }, 3050)
  }, [])

  const fetchServers = useCallback(async () => {
    try {
      const { servers: list } = await api.listServers()
      setServers(list)
    } catch (e) {
      toast(e instanceof Error ? e.message : '加载服务器列表失败')
    } finally {
      setLoaded(true)
    }
  }, [toast])

  useEffect(() => {
    fetchServers()
  }, [fetchServers])

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    applyMaterial(settings)
  }, [settings])

  const testOne = useCallback(
    async (id: string) => {
      setTestingIds((prev) => new Set(prev).add(id))
      try {
        const { server } = await api.testServer(id)
        setServers((prev) => prev.map((s) => (s.id === id ? server : s)))
      } catch (e) {
        toast(e instanceof Error ? e.message : '连接测试失败')
      } finally {
        setTestingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [toast],
  )

  const testAll = useCallback(
    async (silent: boolean) => {
      const ids = serversRef.current.map((s) => s.id)
      if (!ids.length) {
        if (!silent) toast('没有需要刷新的服务器')
        return
      }
      await Promise.all(ids.map((id) => testOne(id)))
      if (!silent) toast('状态已刷新')
    },
    [testOne, toast],
  )

  useEffect(() => {
    if (settings.autoRefresh === 'off' || page !== 'servers') return
    const ms = AUTO_REFRESH_MS[settings.autoRefresh]
    const timer = setInterval(() => testAll(true), ms)
    return () => clearInterval(timer)
  }, [settings.autoRefresh, page, testAll])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAddOpen(false)
        setAppCreateOpen(false)
        setSettingsOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const handleAdd = useCallback(
    async (payload: AddServerPayload): Promise<string | null> => {
      try {
        const { server } = await api.addServer(payload)
        setServers((prev) => [server, ...prev])
        toast(`服务器「${server.name}」已添加`)
        return null
      } catch (e) {
        return e instanceof Error ? e.message : '添加服务器失败'
      }
    },
    [toast],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await api.deleteServer(id)
        setServers((prev) => prev.filter((s) => s.id !== id))
        setDetailId((cur) => (cur === id ? null : cur))
        toast('服务器已删除')
      } catch (e) {
        toast(e instanceof Error ? e.message : '删除失败')
      }
    },
    [toast],
  )

  const handleServerUpdate = useCallback((server: ServerRecord) => {
    setServers((prev) => prev.map((s) => (s.id === server.id ? server : s)))
  }, [])

  const detailServer = detailId ? servers.find((s) => s.id === detailId) ?? null : null

  // 详情页期间不轮询，避免打断任务日志
  useEffect(() => {
    if (detailId) return
    if (settings.autoRefresh === 'off' || page !== 'servers') return
    const ms = AUTO_REFRESH_MS[settings.autoRefresh]
    const timer = setInterval(() => testAll(true), ms)
    return () => clearInterval(timer)
  }, [settings.autoRefresh, page, testAll, detailId])

  return (
    <>
      <div className="bg-mesh" aria-hidden="true">
        <div className="blob b1" />
        <div className="blob b2" />
        <div className="blob b3" />
      </div>
      <div className="grain" aria-hidden="true" />

      <div className="shell">
        <Sidebar page={page} onPage={setPage} onSettings={() => setSettingsOpen(true)} />

        <main className="main">
          {detailServer ? (
            <ServerDetailPage
              server={detailServer}
              onBack={() => setDetailId(null)}
              onServerUpdate={handleServerUpdate}
              onToast={toast}
            />
          ) : (
            <>
              <ActionDock
                showRefresh={page === 'servers'}
                title={page === 'apps' ? '应用' : '服务器'}
                addLabel={page === 'apps' ? '新建' : '添加'}
                onAdd={() => (page === 'servers' ? setAddOpen(true) : setAppCreateOpen(true))}
                onRefresh={() => testAll(false)}
              />
              {page === 'servers' ? (
                loaded ? (
                  <ServersPage
                    servers={servers}
                    testingIds={testingIds}
                    onTest={(id) => testOne(id)}
                    onDelete={handleDelete}
                    onManage={(id) => setDetailId(id)}
                    onAdd={() => setAddOpen(true)}
                  />
                ) : null
              ) : (
                <AppsPage
                  servers={servers}
                  createOpen={appCreateOpen}
                  onOpenCreate={() => setAppCreateOpen(true)}
                  onCloseCreate={() => setAppCreateOpen(false)}
                  onGoServers={() => setPage('servers')}
                  onToast={toast}
                />
              )}

              <p className="foot-note">Ourjia PaaS v0.1 · SSH 运维平台</p>
            </>
          )}
        </main>
      </div>

      <AddServerModal open={addOpen} onClose={() => setAddOpen(false)} onSubmit={handleAdd} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onChange={setSettings} />
      <Toasts items={toasts} />
    </>
  )
}
