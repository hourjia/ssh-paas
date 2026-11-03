import { useState, type FormEvent } from 'react'
import type { AddServerPayload } from '../types'
import { Modal } from './Modal'

interface AddServerModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (payload: AddServerPayload) => Promise<string | null>
}

export function AddServerModal({ open, onClose, onSubmit }: AddServerModalProps) {
  const [address, setAddress] = useState('')
  const [port, setPort] = useState('22')
  const [name, setName] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [keyAuth, setKeyAuth] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const portNum = Number(port)
  const portInvalid = port.trim() !== '' && (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (portInvalid) {
      setError('端口不合法（1-65535）')
      return
    }
    setBusy(true)
    setError(null)
    const err = await onSubmit({
      address,
      port: port.trim() === '' ? 22 : portNum,
      name: name.trim() || undefined,
      user,
      password,
      keyAuth,
    })
    if (err) {
      setError(err)
      setBusy(false)
      return
    }
    setAddress('')
    setPort('22')
    setName('')
    setUser('')
    setPassword('')
    setKeyAuth(false)
    setBusy(false)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="添加服务器">
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="field-row-split">
            <div className="field">
              <label>服务器地址 *</label>
              <input
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="例如 192.168.1.12"
              />
            </div>
            <div className="field field-port">
              <label>SSH 端口</label>
              <input
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="22"
                aria-invalid={portInvalid}
              />
            </div>
          </div>
          <div className="field">
            <label>服务器名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="可选，默认显示服务器地址"
            />
          </div>
          <div className="field">
            <label>SSH 用户 *</label>
            <input
              required
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="root"
            />
          </div>
          <div className="field">
            <label>SSH 密码 *</label>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="用于验证连接"
            />
          </div>

          <div className="field-row">
            <div className="txt">
              <strong>密钥连接</strong>
              <span>推荐：首次连接安装公钥，之后免密登录</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={keyAuth} onChange={(e) => setKeyAuth(e.target.checked)} />
              <span className="track" />
            </label>
          </div>
          <p className="form-hint">
            {keyAuth
              ? '勾选后：首次连接时生成本机密钥对，并把公钥安装到服务器；之后仅使用密钥连接，密码只用于这一次安装，不会保存。'
              : '不勾选：每次连接均使用密码，密码将加密保存在本机。'}
          </p>

          {error && <div className="form-error">{error}</div>}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" />
                正在连接…
              </>
            ) : (
              '确认添加'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}
