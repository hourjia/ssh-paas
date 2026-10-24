import { useState } from 'react'
import { AppStateProvider, useApp } from './state'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { BindServerModal, ConfirmModal } from './components/Modals'
import { EnvReportModal } from './components/EnvReportModal'
import { ExecConsole } from './components/ExecConsole'
import { Toasts } from './components/ui'
import { ServersPage } from './pages/ServersPage'
import { ServerDetailPage } from './pages/ServerDetailPage'
import { ServiceConfigPage } from './pages/ServiceConfigPage'
import { ServicesPage } from './pages/ServicesPage'
import { ExecutionsPage } from './pages/ExecutionsPage'
import { SettingsPage } from './pages/SettingsPage'

function Shell() {
  const app = useApp()
  const [scrolled, setScrolled] = useState(false)

  return (
    <div className="app">
      <div className="bg-aurora" />
      <div className="bg-grid" />
      <Sidebar />
      <div className="main">
        <TopBar scrolled={scrolled} />
        <div className="content" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 6)}>
          {app.route.page === 'servers' && <ServersPage />}
          {app.route.page === 'server' && <ServerDetailPage id={app.route.serverId} />}
          {app.route.page === 'config' && <ServiceConfigPage serverId={app.route.serverId} serviceId={app.route.serviceId} />}
          {app.route.page === 'services' && <ServicesPage />}
          {app.route.page === 'executions' && <ExecutionsPage />}
          {app.route.page === 'settings' && <SettingsPage />}
        </div>
      </div>
      <BindServerModal />
      <ConfirmModal />
      {app.envTask && <EnvReportModal key={app.envTask.taskId} />}
      {app.consoleTask && (
        <ExecConsole
          key={`${app.consoleTask.serverId}/${app.consoleTask.serviceId}/${app.consoleTask.mode}/${app.consoleTask.action ?? ''}`}
        />
      )}
      <Toasts />
    </div>
  )
}

export default function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  )
}
