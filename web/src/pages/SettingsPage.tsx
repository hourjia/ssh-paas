import { useApp } from '../state'
import { Switch } from '../components/ui'

export function SettingsPage() {
  const app = useApp()
  const { prefs } = app
  return (
    <div className="page">
      <header className="page-head fade-up">
        <div>
          <h1 className="t1">设置</h1>
          <p className="caption">外观偏好即时生效，仅保存在本机</p>
        </div>
      </header>

      <div className="settings-grid">
        <section className="settings-card glass-card fade-up">
          <h3 className="t2">外观与性能</h3>
          <p className="caption">玻璃材质的渲染偏好 —— 深色玻璃为默认配方</p>
          <div className="settings-row">
            <div className="sr-text">
              <h4>降低透明度</h4>
              <p>提高玻璃填充不透明度并关闭模糊，增强正文对比度（≥ 4.5:1）</p>
            </div>
            <Switch checked={prefs.lessGlass} onChange={(v) => app.setPref('lessGlass', v)} />
          </div>
          <div className="settings-row">
            <div className="sr-text">
              <h4>低性能模式</h4>
              <p>禁用背景模糊与循环动效，适合远程桌面或低端 GPU</p>
            </div>
            <Switch checked={prefs.lowPerf} onChange={(v) => app.setPref('lowPerf', v)} />
          </div>
        </section>

        <section className="settings-card glass-card fade-up" style={{ animationDelay: '60ms' }}>
          <h3 className="t2">安全</h3>
          <p className="caption">危险操作的确认策略</p>
          <div className="settings-row">
            <div className="sr-text">
              <h4>危险操作二次确认</h4>
              <p>解绑服务器、删除服务前弹出红色实底确认框</p>
            </div>
            <Switch checked={prefs.confirmDanger} onChange={(v) => app.setPref('confirmDanger', v)} />
          </div>
        </section>

        <section className="settings-card glass-card fade-up" style={{ animationDelay: '120ms' }}>
          <h3 className="t2">关于</h3>
          <p className="caption">Ourjia PaaS · 服务器服务管理</p>
          <div className="settings-row">
            <div className="sr-text">
              <h4>版本</h4>
              <p>界面设计原型（Mock 数据，无真实 SSH 连接）</p>
            </div>
            <span className="mono">v0.1.0</span>
          </div>
          <div className="settings-row">
            <div className="sr-text">
              <h4>设计规范</h4>
              <p>玻璃分层 PaaS · 详见 design/design.md</p>
            </div>
            <span className="caption mono">glass-paas</span>
          </div>
          <div className="settings-row">
            <div className="sr-text">
              <h4>技术栈</h4>
              <p>TypeScript · Vite · React</p>
            </div>
            <span className="caption mono">ts / vite / react</span>
          </div>
        </section>
      </div>
    </div>
  )
}
