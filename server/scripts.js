import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { decrypt, encrypt } from './store.js'
import { findApp } from './apps.js'
import { appendLog, updateStep, setJobState } from './jobs.js'
import { runStep } from './step-runner.js'
import { sftpUpload } from './ssh.js'
import { formatBytes, readUpload, removeUpload } from './uploads.js'

const DATA_DIR = path.join(import.meta.dirname, 'data')
const SCRIPTS_FILE = path.join(DATA_DIR, 'scripts.json')

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const USER_RE = /^[a-zA-Z_][a-zA-Z0-9_-]{0,31}$/
const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.sh$/

const NAME_MAX = 40
const NOTES_MAX = 200
const FILENAME_MAX = 80
const ENV_MAX = 50
const ENV_VALUE_MAX = 8192
const PARAM_MAX = 20
const PARAM_LABEL_MAX = 40
const UPLOAD_DIR_MAX = 200
const CONTAINER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/
const CONTAINER_ENV = 'APP_CONTAINER'
const CONTENT_MAX = 256 * 1024
const TIMEOUT_MIN = 30
const TIMEOUT_MAX = 86400
const TIMEOUT_DEFAULT = 600
const ECHO_MAX_LINES = 400

let scripts = null

function load() {
  if (scripts) return scripts
  try {
    const raw = JSON.parse(fs.readFileSync(SCRIPTS_FILE, 'utf8'))
    scripts = Array.isArray(raw?.scripts) ? raw.scripts : []
  } catch {
    scripts = []
  }
  return scripts
}

export function getScripts() {
  return load()
}

export function saveScripts() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmp = `${SCRIPTS_FILE}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify({ scripts: load() }, null, 2)}\n`)
  fs.renameSync(tmp, SCRIPTS_FILE)
}

export function findScript(id) {
  return load().find((s) => s.id === id) || null
}

function bad(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

// ---------- 读取（内容与环境变量落盘时整体加密） ----------

export function readScriptContent(rec) {
  const text = decrypt(rec.contentEnc)
  if (text == null) throw bad('脚本内容解密失败，请检查 server/data/.secret 是否被替换')
  return text
}

export function readScriptEnv(rec) {
  if (!rec?.envEnc) return []
  const raw = decrypt(rec.envEnc)
  if (raw == null) throw bad('环境变量解密失败，请检查 server/data/.secret 是否被替换')
  try {
    const list = JSON.parse(raw)
    return list.map((entry) => ({ key: String(entry.key || ''), value: String(entry.value ?? '') }))
  } catch {
    throw bad('环境变量数据损坏')
  }
}

// 容器名：绑定应用时由平台推导（和应用部署时的 container_name 一致），否则用脚本里手填的
export function resolveScriptContainer(rec) {
  if (rec?.appId) return `ourjia_${rec.appId}`
  return rec?.container || null
}

export function publicScript(rec) {
  let envKeys = []
  if (rec.envEnc) {
    try {
      const raw = decrypt(rec.envEnc)
      if (raw) envKeys = JSON.parse(raw).map((entry) => entry.key)
    } catch {
      envKeys = []
    }
  }
  return {
    id: rec.id,
    serverId: rec.serverId,
    name: rec.name,
    filename: rec.filename,
    notes: rec.notes || '',
    envKeys,
    params: Array.isArray(rec.params) ? rec.params : [],
    // 绑定的应用（容器名自动推导）；没有绑定时 appId/appName 为 null，可用手填的容器名
    appId: rec.appId || null,
    appName: rec.appId ? findApp(rec.appId)?.name || null : null,
    container: resolveScriptContainer(rec),
    // 文件参数的上传目录（服务器上的绝对路径），没有文件参数时为 null
    uploadDir: rec.uploadDir || null,
    runAs: rec.useSudo ? rec.runAs || null : null,
    useSudo: Boolean(rec.useSudo),
    timeoutSec: Number(rec.timeoutSec) || TIMEOUT_DEFAULT,
    lastRun: rec.lastRun || { at: null, status: null, error: null, jobId: null, serverId: null },
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  }
}

// 内容与变量值只通过本机接口返回
export function scriptDetail(rec) {
  return { ...publicScript(rec), content: readScriptContent(rec), env: readScriptEnv(rec) }
}

// ---------- 校验 ----------

function normalizeName(raw) {
  const name = String(raw || '').trim()
  if (!name) throw bad('脚本名称不能为空')
  if (name.length > NAME_MAX) throw bad(`脚本名称不能超过 ${NAME_MAX} 个字符`)
  return name
}

function normalizeFilename(raw) {
  let value = String(raw || '').trim().split(/[\\/]/).pop() || ''
  if (!value) value = 'script.sh'
  if (!value.toLowerCase().endsWith('.sh')) value = `${value}.sh`
  if (value.length > FILENAME_MAX) throw bad(`脚本文件名不能超过 ${FILENAME_MAX} 个字符`)
  if (!FILENAME_RE.test(value)) throw bad('脚本文件名只能包含字母、数字、点、下划线和短横线，并以 .sh 结尾')
  return value
}

function normalizeContent(raw) {
  const content = String(raw ?? '')
  if (!content.trim()) throw bad('脚本内容不能为空')
  if (content.length > CONTENT_MAX) throw bad('脚本内容不能超过 256 KB')
  if (content.includes('\0')) throw bad('脚本内容包含非法字符')
  return content
}

function normalizeEnv(raw) {
  if (raw === undefined || raw === null || raw === '') return []
  if (!Array.isArray(raw)) throw bad('环境变量格式不正确')
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw bad('环境变量格式不正确')
    const key = String(item.key ?? '').trim()
    const value = item.value === undefined || item.value === null ? '' : String(item.value)
    if (!key && !value) continue
    if (!key) throw bad('环境变量名不能为空')
    if (!ENV_KEY_RE.test(key)) throw bad(`环境变量名不合法：${key}`)
    if (seen.has(key)) throw bad(`环境变量重复：${key}`)
    if (value.length > ENV_VALUE_MAX) throw bad(`环境变量 ${key} 的值过长`)
    if (/[\r\n]/.test(value)) throw bad(`环境变量 ${key} 的值不能包含换行`)
    seen.add(key)
    out.push({ key, value })
  }
  if (out.length > ENV_MAX) throw bad(`环境变量最多 ${ENV_MAX} 个`)
  return out
}

// 运行参数：脚本预先声明字段，运行时才填值，值不落库。
// type=text 是普通文本；type=bool 在运行弹窗里渲染成开关，值为 'true'/'false'；
// type=file 在运行弹窗里渲染成文件选择框，文件先送到平台暂存，运行时再 SFTP 到「上传目录」，
// 参数值是该文件在服务器上的绝对路径。
function normalizeParams(raw) {
  if (raw === undefined || raw === null || raw === '') return []
  if (!Array.isArray(raw)) throw bad('运行参数格式不正确')
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw bad('运行参数格式不正确')
    const key = String(item.key || '').trim()
    const label = String(item.label || '').trim()
    const type = item.type === 'bool' ? 'bool' : item.type === 'file' ? 'file' : 'text'
    const rawDefault = item.defaultValue === undefined || item.defaultValue === null ? '' : String(item.defaultValue)
    if (!key && !label && !rawDefault) continue
    if (!key) throw bad('参数名不能为空')
    if (!ENV_KEY_RE.test(key)) throw bad(`参数名不合法：${key}（只能用字母、数字、下划线，且不能以数字开头）`)
    if (seen.has(key)) throw bad(`参数重复：${key}`)
    if (label.length > PARAM_LABEL_MAX) throw bad(`参数 ${key} 的说明不能超过 ${PARAM_LABEL_MAX} 个字符`)
    if (type === 'bool') {
      const defaultValue = rawDefault === 'true' || item.defaultValue === true ? 'true' : 'false'
      seen.add(key)
      out.push({ key, label, defaultValue, required: false, type })
      continue
    }
    if (type === 'file') {
      // 文件参数每次运行都必须选文件，没有默认值
      seen.add(key)
      out.push({ key, label, defaultValue: '', required: true, type })
      continue
    }
    if (rawDefault.length > ENV_VALUE_MAX) throw bad(`参数 ${key} 的默认值过长`)
    if (/[\r\n]/.test(rawDefault)) throw bad(`参数 ${key} 的默认值不能包含换行`)
    seen.add(key)
    out.push({
      key,
      label,
      defaultValue: rawDefault,
      required: item.required === true || item.required === 'true',
      type: 'text',
    })
  }
  if (out.length > PARAM_MAX) throw bad(`运行参数最多 ${PARAM_MAX} 个`)
  return out
}

// 文件参数需要一个服务器上的绝对目录来暂存上传的文件（脚本执行完由脚本自己清理）
function normalizeUploadDir(raw, params) {
  const hasFile = params.some((param) => param.type === 'file')
  const value = String(raw ?? '').trim()
  if (!value) {
    if (hasFile) {
      throw bad('脚本里有文件参数，请填写「上传目录」：服务器上的绝对路径，例如 /tmp/ourjia-release')
    }
    return null
  }
  if (value.length > UPLOAD_DIR_MAX) throw bad(`上传目录不能超过 ${UPLOAD_DIR_MAX} 个字符`)
  if (/[\r\n\0]/.test(value)) throw bad('上传目录不能包含换行')
  if (!value.startsWith('/')) throw bad('上传目录必须是绝对路径（以 / 开头）')
  if (value.split('/').includes('..')) throw bad('上传目录不能包含 ..')
  return value.replace(/\/+$/, '') || '/'
}

// 运行前校验用户填写的参数，返回 KEY -> VALUE（文件参数不在这里，见 normalizeRunUploads）
export function normalizeRunValues(raw, params = []) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const out = {}
  for (const param of params) {
    const provided = input[param.key]
    if (param.type === 'file') continue
    if (param.type === 'bool') {
      const fallback = param.defaultValue === 'true' ? 'true' : 'false'
      out[param.key] =
        provided === undefined || provided === null
          ? fallback
          : provided === true || provided === 'true'
            ? 'true'
            : 'false'
      continue
    }
    let value
    if (provided === undefined || provided === null) {
      value = param.defaultValue || ''
    } else {
      value = String(provided)
    }
    if (value.length > ENV_VALUE_MAX) throw bad(`参数 ${param.key} 的值过长`)
    if (/[\r\n]/.test(value)) throw bad(`参数 ${param.key} 的值不能包含换行`)
    if (param.required && !value.trim()) throw bad(`参数「${param.label || param.key}」不能为空`)
    out[param.key] = value
  }
  return out
}

// 文件参数：运行弹窗先把文件传到平台（拿到 token），这里确认 token 仍然有效
export function normalizeRunUploads(raw, params = []) {
  const fileParams = params.filter((param) => param.type === 'file')
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const out = {}
  for (const param of fileParams) {
    const token = String(input[param.key] ?? '').trim()
    if (!token) throw bad(`请选择文件：${param.label || param.key}`)
    if (!readUpload(token)) throw bad(`文件已失效，请重新选择：${param.label || param.key}`)
    out[param.key] = token
  }
  return out
}

// 未启用 sudo 时不记录执行用户：运行时始终使用所选服务器的 SSH 用户，
// 这样在运行时切换服务器后，执行身份会自然跟随目标服务器。
function normalizeRunAs(raw, useSudo) {
  if (!useSudo) return null
  const target = String(raw || '').trim() || 'root'
  if (!USER_RE.test(target)) throw bad('执行用户格式不合法（字母开头，可含数字、下划线、短横线）')
  return target
}

function normalizeTimeout(raw) {
  if (raw === undefined || raw === null || raw === '') return TIMEOUT_DEFAULT
  const value = Number(raw)
  if (!Number.isInteger(value) || value < TIMEOUT_MIN || value > TIMEOUT_MAX) {
    throw bad(`超时需为 ${TIMEOUT_MIN}-${TIMEOUT_MAX} 秒`)
  }
  return value
}

// 绑定应用：容器名由平台推导（ourjia_<appId>），用户不用记
function normalizeAppId(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return null
  const app = findApp(value)
  if (!app) throw bad('绑定的应用不存在（可能已被删除），请重新选择应用，或改为手动填写容器名')
  return app.id
}

// 没有绑定应用时手填容器名；找不到绑定（比如容器不是本平台部署的）才需要
function normalizeContainer(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (!CONTAINER_RE.test(value)) throw bad('容器名格式不合法（字母或数字开头，可含字母、数字、下划线、点、短横线）')
  return value
}

export function normalizeScriptInput(input = {}) {
  const name = normalizeName(input.name)
  const filename = normalizeFilename(input.filename)
  const notes = String(input.notes || '').trim()
  if (notes.length > NOTES_MAX) throw bad(`备注不能超过 ${NOTES_MAX} 个字符`)
  const content = normalizeContent(input.content)
  const env = normalizeEnv(input.env)
  const params = normalizeParams(input.params)
  const envKeys = new Set(env.map((entry) => entry.key))
  for (const param of params) {
    if (envKeys.has(param.key)) throw bad(`参数 ${param.key} 与固定环境变量重名，请换一个名字`)
  }
  const useSudo = input.useSudo === true || input.useSudo === 'true'
  const runAs = normalizeRunAs(input.runAs, useSudo)
  const timeoutSec = normalizeTimeout(input.timeoutSec)
  const uploadDir = normalizeUploadDir(input.uploadDir, params)
  const appId = normalizeAppId(input.appId)
  const container = appId ? `ourjia_${appId}` : normalizeContainer(input.container)
  if (container && (envKeys.has(CONTAINER_ENV) || params.some((param) => param.key === CONTAINER_ENV))) {
    throw bad(`${CONTAINER_ENV} 是平台注入的容器名变量，参数/环境变量请换一个名字`)
  }
  return { name, filename, notes, content, env, params, uploadDir, appId, container, useSudo, runAs, timeoutSec }
}

// ---------- 增删改 ----------

export function createScript(input, server) {
  const data = normalizeScriptInput(input)
  const now = new Date().toISOString()
  const rec = {
    id: 'scr_' + crypto.randomBytes(6).toString('hex'),
    serverId: server.id,
    name: data.name,
    filename: data.filename,
    notes: data.notes,
    contentEnc: encrypt(data.content),
    envEnc: data.env.length ? encrypt(JSON.stringify(data.env)) : null,
    params: data.params,
    uploadDir: data.uploadDir,
    appId: data.appId,
    container: data.container,
    runAs: data.runAs,
    useSudo: data.useSudo,
    timeoutSec: data.timeoutSec,
    lastRun: { at: null, status: null, error: null, jobId: null, serverId: null },
    createdAt: now,
    updatedAt: now,
  }
  load().push(rec)
  saveScripts()
  return rec
}

export function updateScript(rec, input, server) {
  const current = {
    name: rec.name,
    filename: rec.filename,
    notes: rec.notes || '',
    content: readScriptContent(rec),
    env: readScriptEnv(rec),
    params: Array.isArray(rec.params) ? rec.params : [],
    uploadDir: rec.uploadDir || '',
    appId: rec.appId || '',
    container: rec.container || '',
    runAs: rec.runAs || '',
    useSudo: Boolean(rec.useSudo),
    timeoutSec: Number(rec.timeoutSec) || TIMEOUT_DEFAULT,
  }
  const merged = {
    ...current,
    ...Object.fromEntries(Object.entries(input || {}).filter(([, value]) => value !== undefined)),
  }
  const data = normalizeScriptInput(merged)

  Object.assign(rec, {
    serverId: server.id,
    name: data.name,
    filename: data.filename,
    notes: data.notes,
    contentEnc: encrypt(data.content),
    envEnc: data.env.length ? encrypt(JSON.stringify(data.env)) : null,
    params: data.params,
    uploadDir: data.uploadDir,
    appId: data.appId,
    container: data.container,
    runAs: data.runAs,
    useSudo: data.useSudo,
    timeoutSec: data.timeoutSec,
    updatedAt: new Date().toISOString(),
  })
  saveScripts()
  return rec
}

export function deleteScript(id) {
  const list = load()
  const idx = list.findIndex((s) => s.id === id)
  if (idx === -1) throw bad('脚本不存在')
  list.splice(idx, 1)
  saveScripts()
}

// ---------- 执行 ----------

export function planScriptSteps(rec) {
  const hasFile = Array.isArray(rec?.params) && rec.params.some((param) => param.type === 'file')
  const steps = [{ id: 'verify', title: '检查执行身份与 sudo' }]
  if (hasFile) steps.push({ id: 'upload', title: '上传文件到服务器' })
  steps.push({ id: 'run', title: '执行脚本' })
  return steps
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

// 环境变量直接写进 stdin 脚本（export），不出现在命令行/ps，也不落盘
function envPreamble(env) {
  return env.map((entry) => `export ${entry.key}=${shellQuote(entry.value)}`).join('\n')
}

function buildVerifyScript({ serverUser, runAs }) {
  const lines = ['set -e', `TARGET=${shellQuote(runAs)}`]
  lines.push('if ! id -u "$TARGET" >/dev/null 2>&1; then')
  lines.push('  echo "执行用户 $TARGET 在服务器上不存在" >&2')
  lines.push('  exit 12')
  lines.push('fi')
  if (runAs !== serverUser) {
    lines.push('if ! sudo -n -u "$TARGET" true >/dev/null 2>&1; then')
    lines.push(
      `  echo ${shellQuote(
        `sudo 不可用：需要为 SSH 用户 ${serverUser} 配置免密 sudo（NOPASSWD），或改用 root 用户连接`,
      )} >&2`,
    )
    lines.push('  exit 13')
    lines.push('fi')
  }
  lines.push('echo "执行身份检查通过：$TARGET"')
  return lines.join('\n')
}

function buildRunCommand({ serverUser, runAs }) {
  if (runAs === serverUser) return 'bash -s'
  return `sudo -n -u ${shellQuote(runAs)} -- bash -s`
}

function friendlyFailure(err, stepId) {
  if (stepId === 'verify' && err?.detail) {
    const lines = String(err.detail).trim().split('\n').filter(Boolean)
    const last = lines[lines.length - 1]
    if (last) return last.replace(/^sudo:\s*/i, 'sudo：')
  }
  const text = `${err?.message || ''}\n${err?.detail || ''}`
  if (/a password is required|no tty present|askpass|a terminal is required/i.test(text)) {
    return 'sudo 需要密码：请为该用户配置免密 sudo（NOPASSWD），或改用 root 用户连接'
  }
  if (/sudo: (command )?not found/i.test(text)) {
    return '服务器上没有安装 sudo，请改用 root 用户连接'
  }
  return err?.message || '脚本执行失败'
}

// 执行身份：未启用 sudo 时跟随本次执行的目标服务器；启用 sudo 时使用脚本里配置的提权目标。
// 运行时可能改选了服务器，因此这里必须以传入的 server 为准，不能使用脚本配置时的用户。
export function resolveScriptIdentity(rec, server) {
  const runAs = rec.useSudo ? rec.runAs || 'root' : server.user
  return { runAs, useSudo: runAs !== server.user }
}

function runTips(rec, server) {
  const { runAs: asUser } = resolveScriptIdentity(rec, server)
  const tips = [
    `免密 sudo：在服务器上执行 echo "${server.user} ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/ourjia-paas`,
    `确认执行用户存在：id -u ${asUser}`,
    '脚本通过 stdin 传入远端 bash，不会写入服务器磁盘，也不会出现在进程列表里。',
    '需要重复使用的脚本，建议在平台保存后从这里再次运行，便于留存执行记录。',
  ]
  if (Array.isArray(rec.params) && rec.params.some((param) => param.type === 'file')) {
    tips.push(
      `文件参数会通过 SFTP 上传到 ${rec.uploadDir}：确认该目录存在且 ${server.user} 可写，脚本执行完由脚本自己清理安装包。`,
    )
  }
  return tips
}

function uploadFailure(err, rec) {
  const text = `${err?.message || ''}\n${err?.detail || ''}`
  if (/permission denied|EACCES/i.test(text)) {
    return `文件上传失败：${rec.uploadDir} 没有写权限，请改用一个 SSH 用户可写的目录（例如 /tmp/ourjia-release）`
  }
  if (/no such file|ENOENT/i.test(text)) {
    return `文件上传失败：服务器上的目录 ${rec.uploadDir} 不可用`
  }
  return `文件上传失败：${err?.message || '未知错误'}`
}

export async function runScriptJob(job, conn, server, rec, values = {}, uploads = {}) {
  setJobState(job, 'running')
  const content = readScriptContent(rec)
  const fixedEnv = readScriptEnv(rec)
  const params = Array.isArray(rec.params) ? rec.params : []
  const fileParams = params.filter((param) => param.type === 'file')
  const nameParams = params.filter((param) => param.type !== 'file')
  // 未启用 sudo：执行用户跟随本次选择的服务器（运行时可能已切换服务器）
  // 启用 sudo：执行用户是脚本里配置的提权目标，默认为 root
  const { runAs, useSudo } = resolveScriptIdentity(rec, server)
  const timeoutMs = (Number(rec.timeoutSec) || TIMEOUT_DEFAULT) * 1000
  const uploaded = {}

  // 文件参数：SFTP 到脚本配置的上传目录，脚本里拿到的就是服务器上的绝对路径
  const uploadFiles = async () => {
    updateStep(job, 'upload', { status: 'running', startedAt: new Date().toISOString() })
    job.currentStep = 'upload'
    try {
      for (const param of fileParams) {
        const ticket = readUpload(uploads[param.key])
        if (!ticket) throw new Error(`文件已失效，请重新选择：${param.label || param.key}`)
        const remotePath = `${rec.uploadDir === '/' ? '' : rec.uploadDir}/${ticket.name}`
        appendLog(
          job,
          `上传 ${ticket.name}（${formatBytes(ticket.size)}）→ ${server.user}@${server.host}:${remotePath}`,
          'note',
        )
        let loggedPct = -1
        await sftpUpload(conn, ticket.path, remotePath, {
          mode: 0o644,
          onProgress: (transferred, total) => {
            const pct = total > 0 ? Math.floor((transferred / total) * 100) : 0
            if (pct >= loggedPct + 10 || (pct === 100 && loggedPct < 100)) {
              loggedPct = pct
              appendLog(job, `  ${pct}%（${formatBytes(transferred)} / ${formatBytes(total)}）`, 'out')
            }
          },
        })
        uploaded[param.key] = remotePath
        appendLog(job, `  ✓ ${ticket.name} 已就位：${remotePath}`, 'out')
      }
      updateStep(job, 'upload', { status: 'done', finishedAt: new Date().toISOString() })
    } finally {
      for (const param of fileParams) {
        const token = uploads[param.key]
        if (token) removeUpload(token)
      }
    }
  }

  appendLog(job, `脚本 ${rec.filename} → ${server.name}（${server.user}@${server.host}）`, 'note')
  appendLog(
    job,
    `执行用户 ${runAs}${useSudo ? '（sudo 提权）' : '（与 SSH 用户相同，不经过 sudo）'} · 超时 ${Math.round(timeoutMs / 1000)} 秒`,
    'note',
  )
  if (fixedEnv.length) {
    appendLog(job, `固定环境变量：${fixedEnv.map((entry) => entry.key).join('、')}（值已隐藏）`, 'note')
  }
  if (params.length) {
    appendLog(
      job,
      `运行参数：${params.map((param) => (param.label ? `${param.label}(${param.key})` : param.key)).join('、')}（值已隐藏）`,
      'note',
    )
  }
  if (fileParams.length) {
    appendLog(
      job,
      `文件参数：${fileParams.map((param) => param.key).join('、')} → 上传目录 ${rec.uploadDir}`,
      'note',
    )
  }
  const container = resolveScriptContainer(rec)
  if (container) {
    const appName = rec.appId ? findApp(rec.appId)?.name || rec.appId : ''
    appendLog(job, `目标容器 ${container}${appName ? `（应用 ${appName}）` : '（手填容器名）'}`, 'note')
  }

  try {
    await runStep(job, conn, 'verify', buildVerifyScript({ serverUser: server.user, runAs }), 20000, '检查执行身份与 sudo')

    if (fileParams.length) await uploadFiles()

    // 参数环境变量要在上传之后拼：文件参数的值是上传后的服务器路径
    const paramEnv = [
      ...nameParams.map((param) => ({
        key: param.key,
        value: values[param.key] === undefined ? param.defaultValue || '' : values[param.key],
      })),
      ...fileParams.map((param) => ({ key: param.key, value: uploaded[param.key] || '' })),
    ]
    const containerEnv = container ? [{ key: CONTAINER_ENV, value: container }] : []
    const runCode = [envPreamble([...fixedEnv, ...containerEnv, ...paramEnv]), content].join('\n')

    appendLog(job, `$ ${useSudo ? `sudo -n -u ${runAs} -- bash -s` : 'bash -s'}`, 'cmd')
    const lines = content.trimEnd().split('\n')
    for (const line of lines.slice(0, ECHO_MAX_LINES)) appendLog(job, `  ${line}`, 'cmd')
    if (lines.length > ECHO_MAX_LINES) {
      appendLog(job, `  …（其余 ${lines.length - ECHO_MAX_LINES} 行未回显）`, 'note')
    }

    await runStep(job, conn, 'run', runCode, timeoutMs, null, {
      command: buildRunCommand({ serverUser: server.user, runAs }),
    })

    appendLog(job, '', 'out')
    appendLog(job, '✓ 脚本执行完成（退出码 0）', 'note')
    rec.lastRun = { at: new Date().toISOString(), status: 'ok', error: null, jobId: job.id, serverId: server.id }
    saveScripts()
    setJobState(job, 'done')
    return { ok: true }
  } catch (err) {
    const stepId = job.currentStep
    const step = job.steps.find((s) => s.id === stepId)
    if (step && step.status === 'running') {
      updateStep(job, stepId, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: err.detail || err.message,
      })
    }
    const message = stepId === 'upload' ? uploadFailure(err, rec) : friendlyFailure(err, stepId)
    appendLog(job, '', 'out')
    appendLog(job, `✗ 脚本执行失败：${message}`, 'err')
    if (err.detail) {
      for (const line of String(err.detail).split('\n')) appendLog(job, `  ${line}`, 'err')
    }
    appendLog(job, '', 'out')
    appendLog(job, '排查建议', 'note')
    for (const tip of runTips(rec, server)) appendLog(job, `• ${tip}`, 'note')
    rec.lastRun = { at: new Date().toISOString(), status: 'failed', error: message, jobId: job.id, serverId: server.id }
    saveScripts()
    setJobState(job, 'failed', message)
    return { ok: false, error: message }
  }
}
