import { useEffect, useMemo, useState } from 'react'
import { actionLabel, useApp } from '../state'
import { Capsule, EmptyState, Field, Segmented, rangeFill, svcLabel, svcTone } from '../components/ui'
import { Icon } from '../components/Icons'
import type { ReactNode } from 'react'
import type { PortMap, Service } from '../types'
import { srcCaption, uid } from '../util'

/* ---------- YAML 生成与着色 ---------- */
function toYaml(s: Service): string {
  const L: string[] = []
  L.push('# ourjia-paas · 配置预览（随左侧表单实时生成）')
  L.push(`service: ${s.name || '(未命名)'}`)
  L.push(`version: ${s.version || '(未填写)'}`)
  L.push('source:')
  if (s.sourceType === 'git') {
    L.push('  type: git')
    L.push(`  repository: ${s.gitUrl || '(未填写)'}`)
    L.push(`  branch: ${s.branch || '(未填写)'}`)
  } else {
    L.push('  type: local')
    L.push(`  path: ${s.localPath || '(未填写)'}`)
  }
  L.push(`dockerfile: ${s.dockerfile || '(未填写)'}`)
  L.push('env:')
  if (s.envVars.length === 0) L.push('  {}')
  for (const v of s.envVars) L.push(`  ${v.key || '(key)'}: ${v.secret ? '******' : v.value || '""'}`)
  L.push('ports:')
  if (s.ports.length === 0) L.push('  []')
  for (const p of s.ports) L.push(`  - "${p.host || '?'}:${p.container || '?'}/${p.protocol.toLowerCase()}"`)
  L.push('resources:')
  L.push(`  cpu_limit: ${s.cpuLimit}`)
  L.push(`  memory_limit: ${s.memLimit}Mi`)
  return L.join('\n')
}

function renderYamlLine(text: string): ReactNode {
  if (text.trimStart().startsWith('#')) return <span className="yaml-comment">{text}</span>
  const m = text.match(/^(\s*)([\w.]+)(:)(.*)$/)
  if (m) {
    return (
      <>
        <span>{m[1]}</span>
        <span className="yaml-key">{m[2]}</span>
        <span className="yaml-punc">{m[3]}</span>
        <span className="yaml-val">{m[4]}</span>
      </>
    )
  }
  const li = text.match(/^(\s*-)(.*)$/)
  if (li) {
    return (
      <>
        <span className="yaml-punc">{li[1]}</span>
        <span className="yaml-val">{li[2]}</span>
      </>
    )
  }
  return <span className="yaml-val">{text}</span>
}

/* ---------- 字段分组工具 ---------- */
type GroupKey = 'basic' | 'env' | 'ports' | 'res'
const pickBasic = (s: Service) => [s.name, s.version, s.sourceType, s.gitUrl, s.branch, s.localPath, s.dockerfile].join('|')
const pickEnv = (s: Service) => s.envVars.map((v) => `${v.key}=${v.value}=${v.secret}`).join('|')
const pickPorts = (s: Service) => s.ports.map((p) => `${p.host}:${p.container}:${p.protocol}`).join('|')
const pickRes = (s: Service) => `${s.cpuLimit}/${s.memLimit}`

const GROUP_META: Record<GroupKey, { title: string; icon: 'cube' | 'braces' | 'swap' | 'cpu' }> = {
  basic: { title: '基础配置', icon: 'cube' },
  env: { title: '环境变量', icon: 'braces' },
  ports: { title: '端口映射', icon: 'swap' },
  res: { title: '资源限制', icon: 'cpu' },
}

function GroupCard({
  gk,
  dirty,
  children,
}: {
  gk: GroupKey
  dirty: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  const meta = GROUP_META[gk]
  return (
    <section className={`group glass-card${open ? '' : ' is-collapsed'}`}>
      <header className="group-head" onClick={() => setOpen((o) => !o)}>
        <span className="group-icon">
          <Icon name={meta.icon} size={15} />
        </span>
        <h3>{meta.title}</h3>
        {dirty && <span className="dirty-dot" title="有未保存的修改" />}
        <Icon name="chevronDown" size={16} className="group-chev" />
      </header>
      <div className="group-body">{children}</div>
    </section>
  )
}

/* ============ 服务配置页 ============ */
export function ServiceConfigPage({ serverId, serviceId }: { serverId: string; serviceId: string }) {
  const app = useApp()
  const server = app.servers.find((s) => s.id === serverId)
  const service = server?.services.find((v) => v.id === serviceId)

  const [draft, setDraft] = useState<Service | null>(() => (service ? structuredClone(service) : null))
  const [reveal, setReveal] = useState<Set<string>>(new Set())
  const [flashN, setFlashN] = useState(0)

  useEffect(() => {
    if (draft) setFlashN((n) => n + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  if (!server || !service || !draft) {
    return (
      <div className="page">
        <EmptyState title="服务不存在" desc="它可能已被删除" />
      </div>
    )
  }

  const patch = (p: Partial<Service>) => setDraft((d) => (d ? { ...d, ...p } : d))
  const dirtyMap: Record<GroupKey, boolean> = {
    basic: pickBasic(draft) !== pickBasic(service),
    env: pickEnv(draft) !== pickEnv(service),
    ports: pickPorts(draft) !== pickPorts(service),
    res: pickRes(draft) !== pickRes(service),
  }
  const dirtyAny = Object.values(dirtyMap).some(Boolean)

  /* ---- 环境变量操作 ---- */
  const setEnv = (id: string, p: Partial<{ key: string; value: string; secret: boolean }>) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            envVars: d.envVars.map((v) => {
              if (v.id !== id) return v
              const nv = { ...v, ...p }
              // 键名含 SECRET/TOKEN/PASSWORD 时自动标记为敏感值
              if (p.key !== undefined) nv.secret = /secret|token|password|passwd|pwd|key/i.test(nv.key)
              return nv
            }),
          }
        : d,
    )
  const addEnv = () => setDraft((d) => (d ? { ...d, envVars: [...d.envVars, { id: uid('env'), key: '', value: '', secret: false }] } : d))
  const delEnv = (id: string) => setDraft((d) => (d ? { ...d, envVars: d.envVars.filter((v) => v.id !== id) } : d))
  const toggleReveal = (id: string) =>
    setReveal((r) => {
      const n = new Set(r)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  /* ---- 端口映射操作 ---- */
  const setPort = (id: string, p: Partial<PortMap>) =>
    setDraft((d) => (d ? { ...d, ports: d.ports.map((v) => (v.id === id ? { ...v, ...p } : v)) } : d))
  const addPort = () => setDraft((d) => (d ? { ...d, ports: [...d.ports, { id: uid('pt'), host: '', container: '', protocol: 'TCP' }] } : d))
  const delPort = (id: string) => setDraft((d) => (d ? { ...d, ports: d.ports.filter((v) => v.id !== id) } : d))

  /* ---- 校验 ---- */
  const validate = (): string[] => {
    const errs: string[] = []
    if (!draft.name.trim()) errs.push('服务名称不能为空')
    if (!draft.version.trim()) errs.push('版本号不能为空')
    if (draft.sourceType === 'git') {
      if (!draft.gitUrl.trim()) errs.push('Git 仓库地址不能为空')
      if (!draft.branch.trim()) errs.push('分支不能为空')
    } else if (!draft.localPath.trim()) {
      errs.push('本地路径不能为空')
    }
    if (!draft.dockerfile.trim()) errs.push('Dockerfile 路径不能为空')
    if (draft.envVars.some((v) => !v.key.trim())) errs.push('存在未填写键名的环境变量')
    const keys = draft.envVars.map((v) => v.key.trim())
    if (new Set(keys).size !== keys.length) errs.push('环境变量键名重复')
    return errs
  }

  const doValidate = () => {
    const errs = validate()
    if (errs.length) app.toast('error', `校验失败：${errs[0]}${errs.length > 1 ? `（共 ${errs.length} 项）` : ''}`)
    else app.toast('success', '校验通过 · 配置有效')
  }

  const doSave = () => app.saveService(serverId, serviceId, draft)

  const doDeploy = () => {
    if (dirtyAny) {
      const errs = validate()
      if (errs.length) {
        app.toast('error', `配置有误，无法执行：${errs[0]}`)
        return
      }
      app.saveService(serverId, serviceId, draft)
      app.toast('info', '未保存的修改已自动保存')
    }
    app.openConsole({ mode: 'run', action: 'deploy', serverId, serviceId })
  }

  const yaml = useMemo(() => toYaml(draft), [draft])

  return (
    <div className="page">
      <header className="page-head fade-up">
        <div className="cfg-id">
          <span className="disc disc-service disc-lg">
            <Icon name="cube" size={22} />
          </span>
          <div>
            <h1 className="t2">
              {service.name}
              <span className="chip brand">v{service.version}</span>
              <Capsule tone={svcTone(service.status)} breathe={service.status === 'running'}>
                {svcLabel(service.status)}
              </Capsule>
            </h1>
            <span className="caption mono">
              {server.name} · {server.host} · {srcCaption(service)}
            </span>
          </div>
        </div>
        <div className="page-actions">
          {service.status === 'running' ? (
            <button
              type="button"
              className="btn btn-danger-ghost"
              onClick={() => app.openConsole({ mode: 'run', action: 'stop', serverId, serviceId })}
            >
              <Icon name="pause" size={14} />
              停止服务
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-run"
              onClick={() => app.openConsole({ mode: 'run', action: 'start', serverId, serviceId })}
            >
              <Icon name="play" size={14} />
              启动服务
            </button>
          )}
        </div>
      </header>

      <div className="cfg-cols">
        {/* ---------- 左：配置表单 ---------- */}
        <div className="cfg-form">
          <GroupCard gk="basic" dirty={dirtyMap.basic}>
            <div className="field-row">
              <Field label="服务名称" required className="grow">
                <input className="input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
              </Field>
              <Field label="版本号" className="w-160" hint="Mono 展示">
                <input className="input mono" value={draft.version} onChange={(e) => patch({ version: e.target.value })} placeholder="1.0.0" />
              </Field>
            </div>
            <Field label="源码来源" required>
              <Segmented
                value={draft.sourceType}
                onChange={(v) => patch({ sourceType: v })}
                options={[
                  { value: 'git', label: 'Git 仓库', icon: 'branch' },
                  { value: 'local', label: '本地目录', icon: 'folder' },
                ]}
              />
            </Field>
            {draft.sourceType === 'git' ? (
              <div className="field-row">
                <Field label="Git 仓库地址" required className="grow">
                  <input
                    className="input mono"
                    placeholder="https://git.example.com/ourjia/app.git"
                    value={draft.gitUrl}
                    onChange={(e) => patch({ gitUrl: e.target.value })}
                  />
                </Field>
                <Field label="分支" className="w-160" required>
                  <input className="input mono" placeholder="main" value={draft.branch} onChange={(e) => patch({ branch: e.target.value })} />
                </Field>
              </div>
            ) : (
              <Field label="本地路径" required hint="服务器上的绝对路径">
                <input
                  className="input mono"
                  placeholder="/srv/src/my-app"
                  value={draft.localPath}
                  onChange={(e) => patch({ localPath: e.target.value })}
                />
              </Field>
            )}
            <Field label="Dockerfile 路径" required hint="相对源码根目录">
              <input
                className="input mono"
                placeholder="./deploy/Dockerfile"
                value={draft.dockerfile}
                onChange={(e) => patch({ dockerfile: e.target.value })}
              />
            </Field>
          </GroupCard>

          <GroupCard gk="env" dirty={dirtyMap.env}>
            {draft.envVars.length === 0 && <p className="caption">暂无环境变量 · 注入到容器 process env</p>}
            {draft.envVars.map((v) => (
              <div className="env-row" key={v.id}>
                <input
                  className="input mono key"
                  placeholder="KEY_NAME"
                  value={v.key}
                  onChange={(e) => setEnv(v.id, { key: e.target.value.toUpperCase() })}
                />
                <input
                  className="input mono grow"
                  type={v.secret && !reveal.has(v.id) ? 'password' : 'text'}
                  placeholder="value"
                  value={v.value}
                  onChange={(e) => setEnv(v.id, { value: e.target.value })}
                />
                {v.secret && (
                  <button type="button" className="icon-btn-sm" title={reveal.has(v.id) ? '隐藏' : '显示'} onClick={() => toggleReveal(v.id)}>
                    <Icon name={reveal.has(v.id) ? 'eyeOff' : 'eye'} size={14} />
                  </button>
                )}
                <button type="button" className="icon-btn-sm danger" title="删除变量" onClick={() => delEnv(v.id)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="add-row-btn" onClick={addEnv}>
              <Icon name="plus" size={14} />
              添加环境变量
            </button>
          </GroupCard>

          <GroupCard gk="ports" dirty={dirtyMap.ports}>
            {draft.ports.length === 0 && <p className="caption">暂无端口映射 · 宿主机端口 → 容器端口</p>}
            {draft.ports.map((p) => (
              <div className="port-row" key={p.id}>
                <input className="input mono grow" placeholder="8080" value={p.host} onChange={(e) => setPort(p.id, { host: e.target.value })} />
                <Icon name="chevronRight" size={14} className="port-arrow" />
                <input className="input mono grow" placeholder="80" value={p.container} onChange={(e) => setPort(p.id, { container: e.target.value })} />
                <select className="input w-120" value={p.protocol} onChange={(e) => setPort(p.id, { protocol: e.target.value as 'TCP' | 'UDP' })}>
                  <option value="TCP">TCP</option>
                  <option value="UDP">UDP</option>
                </select>
                <button type="button" className="icon-btn-sm danger" title="删除映射" onClick={() => delPort(p.id)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="add-row-btn" onClick={addPort}>
              <Icon name="plus" size={14} />
              添加端口映射
            </button>
          </GroupCard>

          <GroupCard gk="res" dirty={dirtyMap.res}>
            <Field label="CPU 限制">
              <div className="slider-row">
                <input
                  type="range"
                  className="range"
                  min={0.5}
                  max={8}
                  step={0.5}
                  value={draft.cpuLimit}
                  style={rangeFill(0.5, 8, draft.cpuLimit)}
                  onChange={(e) => patch({ cpuLimit: Number(e.target.value) })}
                />
                <span className="chip mono">{draft.cpuLimit} 核</span>
              </div>
            </Field>
            <Field label="内存限制">
              <div className="slider-row">
                <input
                  type="range"
                  className="range"
                  min={128}
                  max={4096}
                  step={128}
                  value={draft.memLimit}
                  style={rangeFill(128, 4096, draft.memLimit)}
                  onChange={(e) => patch({ memLimit: Number(e.target.value) })}
                />
                <span className="chip mono">{draft.memLimit} MiB</span>
              </div>
            </Field>
          </GroupCard>

          <div className="cfg-form-pad" />
        </div>

        {/* ---------- 右：实时预览（实底屏幕 + 玻璃相框） ---------- */}
        <aside className="cfg-preview">
          <div className="preview-head">
            <span className="preview-dots">
              <i />
              <i />
              <i />
            </span>
            <span className="preview-title">preview.yaml</span>
            <span className="badge">
              <span className="sync-dot" />
              实时同步
            </span>
          </div>
          <div className="preview-body">
            {yaml.split('\n').map((ln, i) => (
              <div className="yaml-line" key={i}>
                <span className="yaml-ln">{i + 1}</span>
                <span>{renderYamlLine(ln)}</span>
              </div>
            ))}
            <div key={flashN} className="preview-flash" />
          </div>
          <div className="preview-foot">
            <span>{yaml.split('\n').length} 行 · YAML</span>
            <span>随左侧表单联动</span>
          </div>
        </aside>
      </div>

      {/* ---------- 底部粘性操作栏 ---------- */}
      <footer className="cfg-bar glass-floating">
        <span className="cfg-dirty">
          {dirtyAny ? (
            <>
              <span className="dirty-dot" />
              有未保存的修改
            </>
          ) : (
            <>
              <span style={{ color: 'var(--st-running)', display: 'inline-grid', placeItems: 'center' }}>
                <Icon name="check" size={13} />
              </span>
              与上次保存一致
            </>
          )}
        </span>
        <div className="cfg-actions">
          <button type="button" className="btn btn-glass" onClick={() => setDraft(structuredClone(service))}>
            重置
          </button>
          <button type="button" className="btn btn-glass" onClick={doValidate}>
            校验
          </button>
          <button type="button" className="btn btn-primary" disabled={!dirtyAny} onClick={doSave}>
            保存配置
          </button>
          <button type="button" className="btn btn-execute" onClick={doDeploy}>
            <Icon name="rocket" size={15} />
            {actionLabel.deploy}
          </button>
        </div>
      </footer>
    </div>
  )
}
