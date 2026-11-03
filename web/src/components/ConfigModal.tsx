import { useEffect, useState } from 'react'
import type { ServerConfig } from '../types'
import { Modal } from './Modal'

interface ConfigModalProps {
  open: boolean
  serverName: string
  config: ServerConfig | null
  onClose: () => void
  onSave: (config: ServerConfig) => Promise<string | null>
}

const FALLBACK: ServerConfig = {
  dockerHubMirrors: [],
  aptMirror: null,
  dockerInstallSource: 'auto',
  swapMb: 'auto',
  swappiness: 10,
  traefikVersion: 'v3.6',
  acme: { email: '', ca: 'letsencrypt' },
  advanced: { containerDns: null, dockerAddressPool: null },
}

export function ConfigModal({ open, serverName, config, onClose, onSave }: ConfigModalProps) {
  const base = config ?? FALLBACK
  const [mirrorsText, setMirrorsText] = useState('')
  const [aptMirror, setAptMirror] = useState('')
  const [installSource, setInstallSource] = useState(base.dockerInstallSource)
  const [swapMode, setSwapMode] = useState<'auto' | 'custom'>(base.swapMb === 'auto' ? 'auto' : 'custom')
  const [swapMb, setSwapMb] = useState(base.swapMb === 'auto' ? 2048 : base.swapMb)
  const [swappiness, setSwappiness] = useState(base.swappiness)
  const [traefikVersion, setTraefikVersion] = useState(base.traefikVersion)
  const [acmeEmail, setAcmeEmail] = useState(base.acme.email)
  const [acmeCa, setAcmeCa] = useState<ServerConfig['acme']['ca']>(base.acme.ca)
  const [dnsText, setDnsText] = useState((base.advanced.containerDns ?? []).join(', '))
  const [pool, setPool] = useState(base.advanced.dockerAddressPool ?? '')
  const [showAdvanced, setShowAdvanced] = useState(Boolean(base.advanced.dockerAddressPool || base.advanced.containerDns))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const c = config ?? FALLBACK
    setMirrorsText(c.dockerHubMirrors.join('\n'))
    setAptMirror(c.aptMirror ?? '')
    setInstallSource(c.dockerInstallSource)
    setSwapMode(c.swapMb === 'auto' ? 'auto' : 'custom')
    setSwapMb(c.swapMb === 'auto' ? 2048 : c.swapMb)
    setSwappiness(c.swappiness)
    setTraefikVersion(c.traefikVersion)
    setAcmeEmail(c.acme.email)
    setAcmeCa(c.acme.ca)
    setDnsText((c.advanced.containerDns ?? []).join(', '))
    setPool(c.advanced.dockerAddressPool ?? '')
    setError(null)
    setBusy(false)
  }, [open, config])

  const submit = async () => {
    if (busy) return
    const mirrors = mirrorsText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const dns = dnsText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const next: ServerConfig = {
      dockerHubMirrors: mirrors,
      aptMirror: aptMirror.trim() || null,
      dockerInstallSource: installSource,
      swapMb: swapMode === 'auto' ? 'auto' : Number(swapMb),
      swappiness: Number(swappiness),
      traefikVersion: traefikVersion.trim(),
      acme: { email: acmeEmail.trim(), ca: acmeCa },
      advanced: {
        containerDns: dns.length ? dns : null,
        dockerAddressPool: pool.trim() || null,
      },
    }
    setBusy(true)
    setError(null)
    const err = await onSave(next)
    if (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`配置 · ${serverName}`}>
      <div className="form-grid">
        <div className="field">
          <label>Docker 镜像加速地址</label>
          <textarea
            rows={3}
            value={mirrorsText}
            onChange={(e) => setMirrorsText(e.target.value)}
            placeholder={'每行一个，留空则直连官方\n例如 docker.m.daocloud.io'}
          />
          <p className="form-hint">
            每行一个地址，无需写 https://。Docker 会按顺序尝试，全部失败才回源官方。初始化前会实测每个地址能否拉到 Traefik 镜像。
          </p>
        </div>

        <div className="field">
          <label>apt 镜像（可选）</label>
          <input
            value={aptMirror}
            onChange={(e) => setAptMirror(e.target.value)}
            placeholder="留空则保持系统现有源，例如 https://mirrors.aliyun.com/ubuntu"
          />
          <p className="form-hint">仅影响安装 Docker 时的软件包下载。大陆服务器通常已配置内网源，建议留空。</p>
        </div>

        <div className="field">
          <label>Docker 安装源</label>
          <select value={installSource} onChange={(e) => setInstallSource(e.target.value as ServerConfig['dockerInstallSource'])}>
            <option value="auto">自动（系统源优先，失败回退官方）</option>
            <option value="system">仅系统源（docker.io + compose-v2）</option>
            <option value="official">仅 Docker 官方源</option>
          </select>
        </div>

        <div className="field">
          <label>Swap</label>
          <div className="segmented">
            <button type="button" className={swapMode === 'auto' ? 'active' : ''} onClick={() => setSwapMode('auto')}>
              自动
            </button>
            <button type="button" className={swapMode === 'custom' ? 'active' : ''} onClick={() => setSwapMode('custom')}>
              指定大小
            </button>
          </div>
          {swapMode === 'auto' ? (
            <p className="form-hint">内存小于 4 GB 时创建 2 GB swap，否则不创建。</p>
          ) : (
            <div className="field-row-split">
              <input
                type="number"
                min={0}
                max={8192}
                step={256}
                value={swapMb}
                onChange={(e) => setSwapMb(Number(e.target.value))}
              />
              <div className="unit-input">MB</div>
            </div>
          )}
          <p className="form-hint">0 表示不创建 swap。</p>
        </div>

        <div className="field">
          <label>vm.swappiness</label>
          <div className="slider-row">
            <input type="range" min={0} max={100} value={swappiness} onChange={(e) => setSwappiness(Number(e.target.value))} />
            <span className="mono">{swappiness}</span>
          </div>
          <p className="form-hint">无 swap 时该值不生效；有 swap 时建议 10。</p>
        </div>

        <div className="field">
          <label>Traefik 版本</label>
          <input value={traefikVersion} onChange={(e) => setTraefikVersion(e.target.value)} placeholder="v3.6" />
        </div>

        <div className="field-row-split">
          <div className="field">
            <label>ACME 邮箱</label>
            <input value={acmeEmail} onChange={(e) => setAcmeEmail(e.target.value)} placeholder="可留空，首个应用上线前填写" />
          </div>
          <div className="field">
            <label>证书 CA</label>
            <select value={acmeCa} onChange={(e) => setAcmeCa(e.target.value as ServerConfig['acme']['ca'])}>
              <option value="letsencrypt">Let's Encrypt</option>
              <option value="letsencrypt-staging">LE 测试（证书不受信）</option>
              <option value="none">不启用 ACME</option>
            </select>
          </div>
        </div>

        <button type="button" className="link-btn" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? '收起高级设置' : '展开高级设置'}
        </button>

        {showAdvanced && (
          <>
            <div className="field">
              <label>容器 DNS（可选）</label>
              <input
                value={dnsText}
                onChange={(e) => setDnsText(e.target.value)}
                placeholder="留空则自动探测 systemd-resolved 上游"
              />
              <p className="form-hint">多个地址用逗号分隔，最多 3 个。留空时从服务器 DNS 上游自动提取。</p>
            </div>
            <div className="field">
              <label>Docker 地址池（可选）</label>
              <input value={pool} onChange={(e) => setPool(e.target.value)} placeholder="留空则自动避开 VPC 网段" />
              <p className="form-hint">CIDR 格式，如 10.201.0.0/16。用于避免容器网段与 VPC 内网冲突。</p>
            </div>
          </>
        )}

        {error && <div className="form-error">{error}</div>}

        <p className="form-hint">
          配置只在执行初始化时生效。修改后服务器不会自动变更，需重新执行初始化。
        </p>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" /> 保存中…
              </>
            ) : (
              '保存配置'
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
