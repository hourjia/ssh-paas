import { useState } from 'react'
import { useApp } from '../state'
import { Field, Segmented, Spinner } from './ui'
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
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState(false)

  if (!app.bindOpen) return null

  const portNum = Number(port)
  const valid = name.trim() !== '' && host.trim() !== '' && username.trim() !== '' && Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535

  const test = () => {
    setTesting(true)
    setTested(false)
    window.setTimeout(() => {
      setTesting(false)
      setTested(true)
    }, 1200)
  }

  const submit = () => {
    if (!valid) return
    app.bindServer({
      name: name.trim(),
      host: host.trim(),
      port: portNum,
      username: username.trim(),
      authType,
    })
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) app.closeBind()
      }}
    >
      <div className="modal glass-shell" role="dialog" aria-label="绑定服务器">
        <div className="modal-head">
          <div className="grow">
            <h3>绑定服务器</h3>
            <p className="caption">通过 SSH 连接你的主机 · 凭证仅保存在本机，不会明文上传</p>
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
            <Field label="私钥" hint="支持 OpenSSH 格式，留空则使用 ~/.ssh/id_rsa">
              <textarea
                className="input mono"
                placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…'}
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
              />
            </Field>
          )}
          <div className="conn-result">
            {testing ? (
              <span className="conn-testing">
                <Spinner /> 正在建立 SSH 连接…
              </span>
            ) : tested ? (
              <span className="conn-ok">
                <Icon name="check" size={14} /> 连接成功 · Ubuntu 22.04 LTS · 延迟 23ms
              </span>
            ) : null}
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-glass" onClick={app.closeBind}>
            取消
          </button>
          <span className="flex-spacer" />
          <button type="button" className="btn btn-glass" disabled={!host.trim() || testing} onClick={test}>
            测试连接
          </button>
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={submit}>
            <Icon name="plug" size={15} />
            确认绑定
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
