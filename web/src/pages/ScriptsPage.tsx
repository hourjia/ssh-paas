import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import * as api from '../api'
import type { ScriptDetail, ScriptEnvEntry, ScriptParam, ScriptPayload, ScriptRecord, ServerRecord } from '../types'
import { Modal } from '../components/Modal'
import { TerminalLog, type TerminalLine } from '../components/TerminalLog'
import { PageHeader } from '../components/PageHeader'
import { DeployIcon, PlusIcon, ScriptIcon } from '../icons'

interface ScriptsPageProps {
  servers: ServerRecord[]
  createOpen: boolean
  onOpenCreate: () => void
  onCloseCreate: () => void
  onGoServers: () => void
  onToast: (msg: string) => void
}

const EMPTY_FORM = {
  name: '',
  filename: 'script.sh',
  content: '',
  runAs: '',
  useSudo: false,
  notes: '',
  timeoutSec: '600',
}

const DEFAULT_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

# 可在这里使用环境变量，例如 $DB_NAME
echo "hello from ourjia-paas"
`

const LAST_RUN: Record<'ok' | 'failed' | 'idle', { cls: string; label: string }> = {
  ok: { cls: 'st-run', label: '上次成功' },
  failed: { cls: 'st-err', label: '上次失败' },
  idle: { cls: 'st-stop', label: '未运行' },
}

export function ScriptsPage({ servers, createOpen, onOpenCreate, onCloseCreate, onGoServers, onToast }: ScriptsPageProps) {
  const [scripts, setScripts] = useState<ScriptRecord[]>([])
  const [loaded, setLoaded] = useState(false)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [logs, setLogs] = useState<TerminalLine[]>([])
  const [logTitle, setLogTitle] = useState('执行 · 终端输出')
  const unsubRef = useRef<(() => void) | null>(null)

  const [serverId, setServerId] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [envRows, setEnvRows] = useState<ScriptEnvEntry[]>([])
  const [paramRows, setParamRows] = useState<ScriptParam[]>([])
  const [editing, setEditing] = useState<ScriptDetail | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [runTarget, setRunTarget] = useState<ScriptRecord | null>(null)
  const [runServerId, setRunServerId] = useState('')
  const [runValues, setRunValues] = useState<Record<string, string>>({})
  const [runError, setRunError] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<ScriptRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      const { scripts: list } = await api.listScripts()
      setScripts(list)
    } catch (e) {
      onToast(e instanceof Error ? e.message : '加载脚本失败')
    } finally {
      setLoaded(true)
    }
  }, [onToast])

  useEffect(() => {
    load()
    return () => unsubRef.current?.()
  }, [load])

  useEffect(() => {
    if (!createOpen) return
    setEditing(null)
    setForm({ ...EMPTY_FORM, content: DEFAULT_SCRIPT })
    setEnvRows([])
    setParamRows([])
    setFormError(null)
    setServerId((cur) => (servers.some((s) => s.id === cur) ? cur : servers[0]?.id || ''))
    // 只在打开新建面板时初始化，避免服务器列表刷新冲掉正在填写的内容
  }, [createOpen])

  // 服务器列表是异步加载的：打开面板时列表还没到，就等它到了再补上默认服务器
  useEffect(() => {
    if (!createOpen || editing) return
    if (servers.some((s) => s.id === serverId)) return
    if (servers[0]) setServerId(servers[0].id)
  }, [createOpen, editing, serverId, servers])

  const serverName = useMemo(() => {
    const map = new Map(servers.map((s) => [s.id, s.name]))
    return (id: string) => map.get(id) || '未知服务器'
  }, [servers])

  const serverUser = useMemo(() => {
    const map = new Map(servers.map((s) => [s.id, s.user]))
    return (id: string) => map.get(id) || ''
  }, [servers])

  const sshUser = useMemo(
    () => servers.find((s) => s.id === serverId)?.user || '',
    [serverId, servers],
  )

  const attachStream = useCallback(
    (jobId: string) => {
      unsubRef.current?.()
      unsubRef.current = api.streamJob(jobId, {
        onState: (snap) => {
          if (snap.status === 'done') {
            onToast('脚本执行完成')
            setBusyId(null)
            load()
          }
          if (snap.status === 'failed') {
            onToast(`脚本执行失败：${snap.error || '未知错误'}`)
            setBusyId(null)
            load()
          }
          if (snap.status === 'interrupted') {
            onToast('脚本执行被中断')
            setBusyId(null)
            load()
          }
        },
        onLog: (log) => setLogs((prev) => [...prev.slice(-3000), log]),
        onEnd: () => setBusyId(null),
      })
    },
    [load, onToast],
  )

  const startRun = useCallback(
    async (script: ScriptRecord, targetServerId: string, values: Record<string, string>) => {
      if (busyId) return
      if (!targetServerId) {
        setRunError('请选择要执行的服务器')
        return
      }
      setRunTarget(null)
      setBusyId(script.id)
      setLogs([])
      setLogTitle(`执行 ${script.name} · 终端输出`)
      try {
        const { job } = await api.runScript(script.id, targetServerId, values)
        attachStream(job.id)
      } catch (e) {
        setBusyId(null)
        onToast(e instanceof Error ? e.message : '启动执行失败')
        load()
      }
    },
    [attachStream, busyId, load, onToast],
  )

  // 运行时先选择服务器（默认为脚本配置的默认服务器），有运行参数再一起填写
  const askRun = useCallback(
    (script: ScriptRecord) => {
      if (busyId) return
      const defaults: Record<string, string> = {}
      for (const param of script.params) {
        defaults[param.key] =
          param.type === 'bool'
            ? param.defaultValue === 'true'
              ? 'true'
              : 'false'
            : param.defaultValue || ''
      }
      const fallback = servers.some((s) => s.id === script.serverId) ? script.serverId : servers[0]?.id || ''
      setRunValues(defaults)
      setRunServerId(fallback)
      setRunError(null)
      setRunTarget(script)
    },
    [busyId, servers],
  )

  const confirmRun = useCallback(() => {
    if (!runTarget || busyId) return
    if (!runServerId || !servers.some((server) => server.id === runServerId)) {
      setRunError('请选择要执行的服务器')
      return
    }
    const missing = runTarget.params.find(
      (param) => param.required && !String(runValues[param.key] ?? '').trim(),
    )
    if (missing) {
      setRunError(`参数「${missing.label || missing.key}」不能为空`)
      return
    }
    void startRun(runTarget, runServerId, runValues)
  }, [busyId, runServerId, runTarget, runValues, servers, startRun])

  const openEdit = useCallback(
    async (script: ScriptRecord) => {
      try {
        const { script: detail } = await api.getScript(script.id)
        setEditing(detail)
        setServerId(detail.serverId)
        setForm({
          name: detail.name,
          filename: detail.filename,
          content: detail.content,
          runAs: detail.useSudo ? detail.runAs || '' : '',
          useSudo: detail.useSudo,
          notes: detail.notes || '',
          timeoutSec: String(detail.timeoutSec),
        })
        setEnvRows(detail.env)
        setParamRows(detail.params)
        setFormError(null)
      } catch (e) {
        onToast(e instanceof Error ? e.message : '读取脚本失败')
      }
    },
    [onToast],
  )

  const closeForm = useCallback(() => {
    setEditing(null)
    setEnvRows([])
    setParamRows([])
    setFormError(null)
    onCloseCreate()
  }, [onCloseCreate])

  const patchForm = (patch: Partial<typeof EMPTY_FORM>) => {
    setForm((cur) => ({ ...cur, ...patch }))
  }

  const toggleSudo = (checked: boolean) => {
    setForm((cur) => ({
      ...cur,
      useSudo: checked,
      runAs: checked ? (cur.runAs.trim() && cur.runAs.trim() !== sshUser ? cur.runAs : 'root') : '',
    }))
  }

  const onPickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 256 * 1024) {
      setFormError('脚本文件不能超过 256 KB')
      return
    }
    const text = await file.text()
    setForm((cur) => ({
      ...cur,
      content: text,
      filename: cur.filename && cur.filename !== EMPTY_FORM.filename ? cur.filename : file.name,
    }))
    setFormError(null)
  }

  const addEnvRow = () => setEnvRows((rows) => [...rows, { key: '', value: '' }])
  const removeEnvRow = (index: number) => setEnvRows((rows) => rows.filter((_, i) => i !== index))
  const updateEnvRow = (index: number, patch: Partial<ScriptEnvEntry>) =>
    setEnvRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const addParamRow = () =>
    setParamRows((rows) => [...rows, { key: '', label: '', defaultValue: '', required: false, type: 'text' }])
  const removeParamRow = (index: number) => setParamRows((rows) => rows.filter((_, i) => i !== index))
  const updateParamRow = (index: number, patch: Partial<ScriptParam>) =>
    setParamRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const submit = useCallback(async () => {
    if (saving) return
    if (!serverId) {
      setFormError('请先添加服务器')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const payload: ScriptPayload = {
        serverId,
        name: form.name.trim(),
        filename: form.filename.trim(),
        content: form.content,
        env: envRows.filter((row) => row.key.trim()).map((row) => ({ key: row.key.trim(), value: row.value })),
        params: paramRows
          .filter((row) => row.key.trim())
          .map((row) => ({
            key: row.key.trim(),
            label: row.label.trim(),
            defaultValue: row.type === 'bool' ? (row.defaultValue === 'true' ? 'true' : 'false') : row.defaultValue,
            required: row.type === 'bool' ? false : row.required,
            type: row.type === 'bool' ? 'bool' : 'text',
          })),
        runAs: form.runAs.trim(),
        useSudo: form.useSudo,
        notes: form.notes.trim(),
        timeoutSec: Number(form.timeoutSec) || 600,
      }
      if (editing) {
        const { script } = await api.updateScript(editing.id, payload)
        setScripts((prev) => prev.map((s) => (s.id === script.id ? script : s)))
        onToast('脚本已保存')
      } else {
        const { script } = await api.createScript(payload)
        setScripts((prev) => [script, ...prev])
        onToast('脚本已创建，可以直接运行')
      }
      closeForm()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : editing ? '保存失败' : '创建失败')
    } finally {
      setSaving(false)
    }
  }, [closeForm, editing, envRows, form, onToast, paramRows, saving, serverId])

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await api.deleteScript(deleteTarget.id)
      setScripts((prev) => prev.filter((s) => s.id !== deleteTarget.id))
      setDeleteTarget(null)
      onToast('脚本已删除')
    } catch (e) {
      onToast(e instanceof Error ? e.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, deleting, onToast])

  const runServer = useMemo(
    () => servers.find((server) => server.id === runServerId) || null,
    [runServerId, servers],
  )
  const sudoTarget = form.runAs.trim() || 'root'
  const runSudoTarget = runTarget?.useSudo ? runTarget.runAs || 'root' : ''
  const runUser = runServer?.user || ''
  const runIdentity = runTarget
    ? runTarget.useSudo
      ? runSudoTarget === runUser
        ? `${runSudoTarget}（与 SSH 用户相同）`
        : `${runSudoTarget} · sudo`
      : `${runUser || '—'}（SSH 用户）`
    : ''

  return (
    <div className="page">
      <PageHeader
        title="脚本"
        subtitle="保存 sh 脚本并设置默认服务器、环境变量与 sudo；运行时可以改选服务器，执行用户自动跟随目标服务器。"
      >
        <button className="btn primary" onClick={onOpenCreate} disabled={!servers.length}>
          <PlusIcon />
          新建脚本
        </button>
      </PageHeader>

      {!loaded && (
        <div className="glass-lite panel center-panel">
          <span className="spinner" /> 正在加载脚本…
        </div>
      )}

      {loaded && scripts.length === 0 && (
        <div className="empty glass-lite reveal">
          <div className="empty-icon">
            <ScriptIcon />
          </div>
          <h3>还没有脚本</h3>
          <p>
            {servers.length
              ? '点击右上角「新建脚本」，上传或粘贴 sh 脚本并设置默认服务器与环境变量；运行时可以改选服务器，执行用户自动跟随目标服务器。'
              : '先到「服务器」页添加一台服务器，再回来新建脚本。'}
          </p>
          {!servers.length && (
            <button className="btn ghost" onClick={onGoServers}>
              去添加服务器
            </button>
          )}
        </div>
      )}

      {scripts.length > 0 && (
        <div className="app-grid">
          {scripts.map((script) => {
            const last = LAST_RUN[script.lastRun.status || 'idle'] || LAST_RUN.idle
            const running = busyId === script.id
            const defaultUser = serverUser(script.serverId)
            const effectiveUser = script.useSudo ? script.runAs || 'root' : defaultUser
            const needsSudo = script.useSudo && effectiveUser !== defaultUser
            return (
              <article key={script.id} className="glass-lite app-card reveal">
                <div className="app-card-head">
                  <div>
                    <h3 className="app-name">{script.name}</h3>
                    <span className="app-domain mono">{script.filename}</span>
                  </div>
                  <span className={`status-pill ${last.cls}`}>
                    <i />
                    {last.label}
                  </span>
                </div>

                <dl className="app-meta">
                  <div>
                    <dt>默认服务器</dt>
                    <dd title={serverName(script.serverId)}>{serverName(script.serverId)}</dd>
                  </div>
                  <div>
                    <dt>执行用户</dt>
                    <dd
                      className="mono"
                      title={
                        needsSudo
                          ? '通过 sudo 提权执行'
                          : '以目标服务器的 SSH 用户直接执行，随运行时选择的服务器变化'
                      }
                    >
                      {effectiveUser || '—'}
                      {needsSudo ? ' · sudo' : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>最后运行</dt>
                    <dd>
                      {script.lastRun.at ? (
                        <>
                          {new Date(script.lastRun.at).toLocaleString()}
                          {script.lastRun.serverId && script.lastRun.serverId !== script.serverId
                            ? ` · ${serverName(script.lastRun.serverId)}`
                            : ''}
                        </>
                      ) : (
                        '从未运行'
                      )}
                    </dd>
                  </div>
                </dl>

                {script.notes && <p className="app-notes">{script.notes}</p>}
                {script.envKeys.length > 0 && (
                  <p className="app-notes" title={script.envKeys.join('、')}>
                    环境变量：
                    {script.envKeys.length > 4
                      ? `${script.envKeys.slice(0, 4).join('、')} 等 ${script.envKeys.length} 个`
                      : script.envKeys.join('、')}
                  </p>
                )}
                {script.params.length > 0 && (
                  <p className="app-notes" title={script.params.map((param) => param.key).join('、')}>
                    运行参数：
                    {script.params.length > 4
                      ? `${script.params.slice(0, 4).map((param) => param.key).join('、')} 等 ${script.params.length} 个`
                      : script.params.map((param) => param.key).join('、')}
                  </p>
                )}
                {script.lastRun.status === 'failed' && (
                  <p className="app-note err">{script.lastRun.error || '上次运行失败'}</p>
                )}

                <div className="app-actions">
                  <button className="btn primary sm" onClick={() => askRun(script)} disabled={Boolean(busyId)}>
                    {running ? (
                      <>
                        <span className="spinner" /> 执行中…
                      </>
                    ) : (
                      <>
                        <DeployIcon /> 运行
                      </>
                    )}
                  </button>
                  <button className="btn ghost sm" onClick={() => openEdit(script)} disabled={Boolean(busyId)}>
                    编辑
                  </button>
                  <button className="btn ghost sm" onClick={() => setDeleteTarget(script)} disabled={Boolean(busyId)}>
                    删除
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {(logs.length > 0 || busyId) && (
        <section className="glass-lite panel">
          <h2 className="panel-title">执行日志</h2>
          <TerminalLog lines={logs} height="tall" title={logTitle} />
        </section>
      )}

      <Modal open={createOpen || Boolean(editing)} onClose={closeForm} title={editing ? `编辑 · ${editing.name}` : '新建脚本'}>
        <div className="form-grid">
          <div className="field">
            <label>名称</label>
            <input value={form.name} onChange={(e) => patchForm({ name: e.target.value })} placeholder="例如 为新应用创建数据库" />
          </div>

          <div className="field">
            <label>默认服务器</label>
            <select value={serverId} onChange={(e) => setServerId(e.target.value)}>
              {servers.length === 0 && <option value="">请先添加服务器</option>}
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}（{s.user}@{s.host}）
                </option>
              ))}
            </select>
            <p className="form-hint">
              这里只配置默认目标；运行时还可以改选其他服务器，执行用户会自动使用目标服务器的 SSH 用户。
            </p>
          </div>

          <div className="field">
            <label>脚本文件名</label>
            <div className="file-row">
              <input
                className="mono"
                value={form.filename}
                onChange={(e) => patchForm({ filename: e.target.value })}
                placeholder="create-db.sh"
              />
              <button type="button" className="btn ghost sm" onClick={() => fileRef.current?.click()}>
                选择 .sh 文件
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".sh,.bash,text/plain,text/x-shellscript"
                className="hidden"
                onChange={onPickFile}
              />
            </div>
            <p className="form-hint">可以直接上传 .sh 文件覆盖下面的内容；脚本会加密保存在平台。</p>
          </div>

          <div className="field">
            <label>脚本内容</label>
            <textarea
              className="code-editor mono"
              rows={10}
              spellCheck={false}
              value={form.content}
              onChange={(e) => patchForm({ content: e.target.value })}
              placeholder={'#!/usr/bin/env bash\nset -euo pipefail\n\necho "hello"'}
            />
            <p className="form-hint">
              以 bash 通过标准输入执行（不写入服务器磁盘）；环境变量会在脚本前自动 export，可直接用 $变量名。
            </p>
          </div>

          <div className="field">
            <label>执行身份</label>
            {form.useSudo ? (
              <input
                className="mono"
                value={form.runAs}
                onChange={(e) => patchForm({ runAs: e.target.value })}
                placeholder="root"
              />
            ) : (
              <div className="identity-box">
                <span className="mono">{sshUser || '—'}</span>
                <span>目标服务器的 SSH 用户</span>
              </div>
            )}
            <label className="check-row">
              <input type="checkbox" checked={form.useSudo} onChange={(e) => toggleSudo(e.target.checked)} />
              <span>使用 sudo 提权执行（需要目标服务器上已配置免密 sudo）</span>
            </label>
            <p className="form-hint">
              {form.useSudo
                ? sudoTarget === sshUser
                  ? `执行用户与 SSH 用户相同（${sshUser}），会直接执行，不经过 sudo。`
                  : `通过 sudo -n 以 ${sudoTarget} 执行；若目标服务器未配置 NOPASSWD，会在「检查执行身份」步骤失败。`
                : `以所选服务器的 SSH 用户 ${sshUser || '—'} 执行；运行时切换服务器后会自动改用该服务器的用户。需要 root 权限请勾选 sudo。`}
            </p>
          </div>

          <div className="field">
            <label>超时（秒）</label>
            <input
              type="number"
              min={30}
              max={86400}
              value={form.timeoutSec}
              onChange={(e) => patchForm({ timeoutSec: e.target.value })}
            />
          </div>

          <div className="field">
            <label>环境变量（可选）</label>
            <div className="env-editor">
              {envRows.map((row, index) => (
                <div className="script-env-row" key={index}>
                  <input
                    className="mono"
                    value={row.key}
                    placeholder="变量名"
                    onChange={(e) => updateEnvRow(index, { key: e.target.value })}
                  />
                  <input
                    className="mono"
                    value={row.value}
                    placeholder="变量值"
                    onChange={(e) => updateEnvRow(index, { value: e.target.value })}
                  />
                  <button type="button" className="env-row-btn" title="删除变量" onClick={() => removeEnvRow(index)}>
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="link-btn" onClick={addEnvRow}>
                + 添加变量
              </button>
            </div>
            <p className="form-hint">固定环境变量在脚本执行前 export，值不会出现在命令行与日志里；保存时整体加密。</p>
          </div>

          <div className="field">
            <label>运行参数（可选）</label>
            <div className="env-editor">
              {paramRows.map((row, index) => (
                <div className="param-row" key={index}>
                  <input
                    className="mono"
                    value={row.key}
                    placeholder="参数名，如 DB_NAME"
                    onChange={(e) => updateParamRow(index, { key: e.target.value })}
                  />
                  <input
                    value={row.label}
                    placeholder="说明，如 数据库名"
                    onChange={(e) => updateParamRow(index, { label: e.target.value })}
                  />
                  <select
                    value={row.type === 'bool' ? 'bool' : 'text'}
                    title="参数类型"
                    onChange={(e) => {
                      const type = e.target.value === 'bool' ? 'bool' : 'text'
                      updateParamRow(
                        index,
                        type === 'bool' ? { type, defaultValue: 'false', required: false } : { type },
                      )
                    }}
                  >
                    <option value="text">文本</option>
                    <option value="bool">开关</option>
                  </select>
                  {row.type === 'bool' ? (
                    <select
                      value={row.defaultValue === 'true' ? 'true' : 'false'}
                      title="开关默认状态"
                      onChange={(e) => updateParamRow(index, { defaultValue: e.target.value })}
                    >
                      <option value="false">默认关闭</option>
                      <option value="true">默认开启</option>
                    </select>
                  ) : (
                    <input
                      className="mono"
                      value={row.defaultValue}
                      placeholder="默认值（可选）"
                      onChange={(e) => updateParamRow(index, { defaultValue: e.target.value })}
                    />
                  )}
                  <label
                    className="param-required"
                    title={row.type === 'bool' ? '开关参数不需要必填' : '运行时必填'}
                  >
                    <input
                      type="checkbox"
                      checked={row.required}
                      disabled={row.type === 'bool'}
                      onChange={(e) => updateParamRow(index, { required: e.target.checked })}
                    />
                    必填
                  </label>
                  <button type="button" className="env-row-btn" title="删除参数" onClick={() => removeParamRow(index)}>
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="link-btn" onClick={addParamRow}>
                + 添加参数
              </button>
            </div>
            <p className="form-hint">
              运行时弹窗填写，作为环境变量注入脚本；参数值不会保存，参数名不能与固定环境变量重名。类型为「开关」的参数在运行弹窗里显示为勾选框。
            </p>
          </div>

          <div className="field">
            <label>备注（可选）</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => patchForm({ notes: e.target.value })}
              placeholder="用途、影响范围、回滚方式…"
            />
          </div>

          {formError && <div className="form-error">{formError}</div>}
          <div className="modal-foot">
            <button className="btn ghost" onClick={closeForm} disabled={saving}>
              取消
            </button>
            <button className="btn primary" onClick={submit} disabled={saving || !serverId}>
              {saving ? (
                <>
                  <span className="spinner" /> 保存中…
                </>
              ) : editing ? (
                '保存'
              ) : (
                '创建'
              )}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(runTarget)}
        onClose={() => {
          if (!busyId) setRunTarget(null)
        }}
        title={runTarget ? `运行 · ${runTarget.name}` : '运行脚本'}
      >
        {runTarget && (
          <div className="form-grid">
            <div className="field">
              <label>执行服务器</label>
              <select
                value={runServerId}
                onChange={(e) => {
                  setRunServerId(e.target.value)
                  setRunError(null)
                }}
              >
                {servers.length === 0 && <option value="">没有可用的服务器</option>}
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}（{s.user}@{s.host}）
                    {s.id === runTarget.serverId ? ' · 默认' : ''}
                  </option>
                ))}
              </select>
              <p className="form-hint">
                {runServerId === runTarget.serverId
                  ? '这是脚本配置的默认服务器，也可以改选其他服务器执行。'
                  : `已改选 ${runServer?.name || '—'}：${
                      runTarget.useSudo
                        ? `将以 SSH 用户 ${runUser || '—'} 通过 sudo 提权到 ${runSudoTarget}`
                        : `执行用户为 ${runUser || '—'}`
                    }。`}
              </p>
            </div>

            <div className="run-summary">
              <div>
                <span>服务器</span>
                <strong>{runServer?.name || '—'}</strong>
              </div>
              <div>
                <span>执行用户</span>
                <strong className="mono">{runIdentity}</strong>
              </div>
              <div>
                <span>超时</span>
                <strong>{runTarget.timeoutSec} 秒</strong>
              </div>
            </div>

            {runTarget.useSudo && runSudoTarget !== runUser && (
              <p className="form-hint">
                将通过 sudo -n 以 {runSudoTarget} 执行；目标服务器的 SSH 用户 {runUser || '—'} 需要已配置免密 sudo。
              </p>
            )}

            {runTarget.params.map((param) =>
              param.type === 'bool' ? (
                <label className="check-row" key={param.key}>
                  <input
                    type="checkbox"
                    checked={runValues[param.key] === 'true'}
                    onChange={(e) =>
                      setRunValues((cur) => ({ ...cur, [param.key]: e.target.checked ? 'true' : 'false' }))
                    }
                  />
                  <span>
                    {param.label || param.key}
                    <code className="param-key">{param.key}</code>
                  </span>
                </label>
              ) : (
                <div className="field" key={param.key}>
                  <label>
                    {param.label || param.key}
                    {param.required && <span className="req">*</span>}
                    <code className="param-key">{param.key}</code>
                  </label>
                  <input
                    className="mono"
                    value={runValues[param.key] ?? ''}
                    placeholder={param.defaultValue || '请输入'}
                    onChange={(e) => setRunValues((cur) => ({ ...cur, [param.key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') confirmRun()
                    }}
                  />
                </div>
              ),
            )}

            <p className="form-hint">
              参数只用于本次运行，作为环境变量注入，不会保存。
              {runTarget.envKeys.length > 0 &&
                ` 固定环境变量 ${runTarget.envKeys.length} 个（值已隐藏）：${runTarget.envKeys.join('、')}`}
            </p>

            {runError && <div className="form-error">{runError}</div>}

            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setRunTarget(null)} disabled={Boolean(busyId)}>
                取消
              </button>
              <button className="btn primary" onClick={confirmRun} disabled={Boolean(busyId) || !runServerId}>
                {busyId ? (
                  <>
                    <span className="spinner" /> 执行中…
                  </>
                ) : (
                  '运行'
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="删除脚本">
        {deleteTarget && (
          <div className="form-grid">
            <p className="confirm-lede">
              删除 <strong>{deleteTarget.name}</strong>（<span className="mono">{deleteTarget.filename}</span>）？
            </p>
            <p className="form-hint">
              只会删除平台里的脚本记录；脚本已经对服务器造成的变更不会回滚，需要的话请在服务器上手动处理。
            </p>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                取消
              </button>
              <button className="btn danger" onClick={confirmDelete} disabled={deleting}>
                {deleting ? (
                  <>
                    <span className="spinner" /> 删除中…
                  </>
                ) : (
                  '删除'
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
