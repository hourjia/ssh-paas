import type { Settings } from '../types'
import { Modal } from './Modal'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  settings: Settings
  onChange: (settings: Settings) => void
}

export function SettingsModal({ open, onClose, settings, onChange }: SettingsModalProps) {
  const patch = (p: Partial<Settings>) => onChange({ ...settings, ...p })

  return (
    <Modal open={open} onClose={onClose} title="设置">
      <div className="settings-list">
        <div className="setting-row">
          <div className="txt">
            <strong>外观</strong>
            <span>在浅色与深色材质之间切换</span>
          </div>
          <div className="segmented">
            <button
              className={settings.theme === 'light' ? 'active' : ''}
              onClick={() => patch({ theme: 'light' })}
            >
              浅色
            </button>
            <button
              className={settings.theme === 'dark' ? 'active' : ''}
              onClick={() => patch({ theme: 'dark' })}
            >
              深色
            </button>
          </div>
        </div>

        <div className="setting-row">
          <div className="txt">
            <strong>玻璃质感</strong>
            <span>调整材质的模糊与通透程度</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={settings.glass}
            onChange={(e) => patch({ glass: Number(e.target.value) })}
          />
        </div>

        <div className="setting-row">
          <div className="txt">
            <strong>降低透明度</strong>
            <span>提升文字对比度与可读性</span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.reduceTrans}
              onChange={(e) => patch({ reduceTrans: e.target.checked })}
            />
            <span className="track" />
          </label>
        </div>

        <div className="setting-row">
          <div className="txt">
            <strong>自动刷新</strong>
            <span>定期重新检测服务器连接状态</span>
          </div>
          <select
            value={settings.autoRefresh}
            onChange={(e) => patch({ autoRefresh: e.target.value as Settings['autoRefresh'] })}
          >
            <option value="off">关闭</option>
            <option value="30">30 秒</option>
            <option value="60">60 秒</option>
            <option value="300">5 分钟</option>
          </select>
        </div>
      </div>

      <div className="modal-foot">
        <button className="btn primary" onClick={onClose}>
          完成
        </button>
      </div>
    </Modal>
  )
}
