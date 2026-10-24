import { useState } from 'react'
import { useApp } from '../state'
import { Field, Segmented, Switch } from './ui'
import { Icon } from './Icons'

/* ============ 绑定服务器弹窗 ============ */
export function BindServerModal() {
  const app = useApp()
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('root')
  const [authType, setAuthType] = useState<'password' | 'key'>('password')
  const [password, setPassword] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [autoConnect, setAutoConnect] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [errMsg, setErrMsg] = useState('')

  if (!app.bindOpen) return null

  const portNum = Number(port)
  const valid = name.trim() !== '' && host.trim() !== '' && username.trim() !== '' && Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535

  const submit = async () => {
    if (!valid || submitting) return
    setSubmitting(true)
    setErrMsg('')
    try {
      await app.bindServer({
        name: name.trim(),
        host: host.trim(),
        port: portNum,
        username: username.trim(),
        authType,
        password: authType === 'password' ? password : undefined,
        privateKey: authType === 'key' ? privateKey : undefined,
        autoConnect,
      })
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : '绑定失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) app.closeBind()
      }}
    >
      <div className="modal glass-shell" role="dialog" aria-label="绑定服务器">
        <div className="modal-head">
          <div className="grow">
            <h3>绑定服务器</h3>
            <p className="caption">通过 SSH 连接你的主机 · 凭据加密存储，接口不会回显</p>
          </div>
          <button type="button" className="icon-btn-sm" onClick={app.closeBind} aria-label="关闭">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="group-body" style={{ padding: 0, borderTop: 0, gap: 14 }}>
          <Field label="自定义名称" required hint="用于列表与面包屑展示">
            <input className="input" placeholder="如：prod-web-03" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <div className="field-row">
            <Field label="主机地址" required className="grow">
              <input className="input mono" placeholder="10.0.0.12 或 ssh.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
            </Field>
            <Field label="SSH 端口" className="w-120">
              <input className="input mono" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="用户名" required className="grow">
              <input className="input mono" placeholder="root" value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Field label="认证方式">
              <Segmented
                value={authType}
                onChange={setAuthType}
                options={[
                  { value: 'password', label: '密码', icon: 'lock' },
                  { value: 'key', label: '私钥', icon: 'key' },
                ]}
              />
            </Field>
          </div>
          {authType === 'password' ? (
            <Field label="密码" required>
              <input className="input mono" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          ) : (
            <Field label="私钥" hint="支持 OpenSSH 格式（暂不支持带口令的私钥）">
              <textarea
                className="input mono"
                placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…'}
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
              />
            </Field>
          )}
          <Field label="绑定后立即连接" hint="连接后自动检查环境并尝试准备（安装 Docker 等）">
            <Switch checked={autoConnect} onChange={setAutoConnect} />
          </Field>
          {errMsg && (
            <div className="conn-result">
              <span className="conn-fail">
                <Icon name="alert" size={14} /> {errMsg}
              </span>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-glass" onClick={app.closeBind} disabled={submitting}>
            取消
          </button>
          <span className="flex-spacer" />
          <button type="button" className="btn btn-primary" disabled={!valid || submitting} onClick={submit}>
            <Icon name="plug" size={15} />
            {submitting ? '绑定中…' : '确认绑定'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============ 危险操作二次确认弹窗 ============ */
export function ConfirmModal() {
  const app = useApp()
  if (!app.confirmReq) return null
  const req = app.confirmReq
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) app.closeConfirm()
      }}
    >
      <div className="modal modal-danger glass-shell" role="alertdialog">
        <div className="modal-head">
          <span className="danger-icon">
            <Icon name="alert" size={20} />
          </span>
          <div className="grow">
            <h3>{req.title}</h3>
            <p className="caption">此为危险操作，请确认后再继续</p>
          </div>
        </div>
        <p className="text-2" style={{ fontSize: 13.5 }}>
          {req.desc}
        </p>
        <div className="modal-foot">
          <button type="button" className="btn btn-glass" onClick={app.closeConfirm}>
            取消
          </button>
          <span className="flex-spacer" />
          <button
            type="button"
            className="btn btn-danger-solid"
            onClick={() => {
              app.closeConfirm()
              req.onConfirm()
            }}
          >
            {req.confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
