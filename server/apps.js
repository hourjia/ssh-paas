import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { decrypt, encrypt } from './store.js'

const DATA_DIR = path.join(import.meta.dirname, 'data')
const APPS_FILE = path.join(DATA_DIR, 'apps.json')

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i
// 允许 registry:port/namespace/name:tag 与 @sha256:digest
const IMAGE_RE =
  /^(?:[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?(?::\d{1,5})?\/)?(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[\w][\w.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const ALIAS_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const OWNER_RE = /^\d+:\d+$/
const NAME_MAX = 40
const NOTES_MAX = 200
const ENV_MAX = 50

let apps = null

function load() {
  if (apps) return apps
  try {
    const raw = JSON.parse(fs.readFileSync(APPS_FILE, 'utf8'))
    apps = Array.isArray(raw?.apps) ? raw.apps : []
  } catch {
    apps = []
  }
  return apps
}

export function getApps() {
  return load()
}

export function saveApps() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmp = `${APPS_FILE}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify({ apps: load() }, null, 2)}\n`)
  fs.renameSync(tmp, APPS_FILE)
}

export function findApp(id) {
  return load().find((a) => a.id === id) || null
}

function bad(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

function parseEnvInput(raw) {
  if (!raw) return []
  const lines = Array.isArray(raw) ? raw : String(raw).split(/\r?\n/)
  const out = []
  const seen = new Set()
  for (const line of lines) {
    const text = String(line).trim()
    if (!text || text.startsWith('#')) continue
    const idx = text.indexOf('=')
    if (idx <= 0) throw bad(`环境变量格式错误：${text}（应为 KEY=VALUE）`)
    const key = text.slice(0, idx).trim()
    const value = text.slice(idx + 1)
    if (!ENV_KEY_RE.test(key)) throw bad(`环境变量名不合法：${key}`)
    if (seen.has(key)) throw bad(`环境变量重复：${key}`)
    if (value.length > 4096) throw bad(`环境变量 ${key} 的值过长`)
    seen.add(key)
    out.push({ key, value })
  }
  if (out.length > ENV_MAX) throw bad(`环境变量最多 ${ENV_MAX} 个`)
  return out
}

// 环境变量可能含密钥，落盘前整体加密
export function readEnv(app) {
  if (!app?.envEnc) return {}
  const raw = decrypt(app.envEnc)
  if (!raw) throw bad('环境变量解密失败，请检查 server/data/.secret 是否被替换')
  try {
    const list = JSON.parse(raw)
    return Object.fromEntries(list.map((e) => [e.key, e.value]))
  } catch {
    throw bad('环境变量数据损坏')
  }
}

function normalizeDataDir(raw) {
  const value = String(raw || '').trim()
  if (!value) return null
  if (!/^\/srv\/(data|shared)\/[A-Za-z0-9._/-]+$/.test(value) || value.includes('..')) {
    throw bad('数据目录需位于 /srv/data 或 /srv/shared 下，且不能包含 ..')
  }
  return value.replace(/\/+$/, '')
}

function normalizeContainerPath(raw) {
  const value = String(raw || '').trim()
  if (!value) throw bad('容器内数据路径不能为空')
  if (!value.startsWith('/') || value.includes('..') || /\s/.test(value)) {
    throw bad('容器内数据路径需为绝对路径，且不含空格')
  }
  return value
}

export function normalizeAppInput(input = {}) {
  const name = String(input.name || '').trim()
  if (!name) throw bad('应用名称不能为空')
  if (name.length > NAME_MAX) throw bad(`应用名称不能超过 ${NAME_MAX} 个字符`)

  const serverId = String(input.serverId || '').trim()
  if (!serverId) throw bad('请选择服务器')

  const kind = input.kind === 'service' ? 'service' : 'image'

  const image = String(input.image || '').trim()
  if (!image) throw bad('Docker 镜像地址不能为空')
  if (!IMAGE_RE.test(image)) throw bad('镜像地址格式不合法，例如 registry.example.com/team/app:v1')

  const portRaw = input.port === undefined || input.port === null || input.port === '' ? (kind === 'service' ? 5432 : 80) : Number(input.port)
  if (!Number.isInteger(portRaw) || portRaw < 1 || portRaw > 65535) throw bad('端口需为 1-65535')

  const notes = String(input.notes || '').trim()
  if (notes.length > NOTES_MAX) throw bad(`备注不能超过 ${NOTES_MAX} 个字符`)

  let domain = null
  if (kind === 'image') {
    domain = String(input.domain || '').trim().toLowerCase()
    if (!domain) throw bad('域名不能为空')
    if (!DOMAIN_RE.test(domain)) throw bad('域名格式不合法，例如 demo.example.com')
  }

  let service = null
  if (kind === 'service') {
    const alias = String(input.alias || '').trim().toLowerCase()
    if (alias && !ALIAS_RE.test(alias)) throw bad('网络别名只能包含小写字母、数字和短横线')
    const containerPath = normalizeContainerPath(input.containerPath)
    const dataOwner = String(input.dataOwner || '').trim()
    if (dataOwner && !OWNER_RE.test(dataOwner)) throw bad('目录所有者格式为 uid:gid，例如 999:999')
    const healthCmd = String(input.healthCmd || '').trim()
    if (healthCmd.length > 200) throw bad('健康检查命令过长')
    if (/[\r\n]/.test(healthCmd)) throw bad('健康检查命令不能包含换行')
    service = {
      alias: alias || null,
      dataDir: normalizeDataDir(input.dataDir),
      containerPath,
      dataOwner: dataOwner || null,
      healthCmd: healthCmd || null,
    }
  }

  return { kind, name, serverId, domain, image, port: portRaw, notes, env: parseEnvInput(input.env), service }
}

export function createApp(input) {
  const { kind, name, serverId, domain, image, port, notes, env, service } = normalizeAppInput(input)
  const list = load()
  if (kind === 'image' && list.some((a) => a.serverId === serverId && a.domain === domain)) {
    throw bad('该服务器上已有应用使用这个域名')
  }
  if (kind === 'service' && service.alias) {
    const dup = list.find((a) => a.serverId === serverId && a.service?.alias === service.alias)
    if (dup) throw bad(`网络别名 ${service.alias} 已被「${dup.name}」占用`)
  }

  const id = 'app_' + crypto.randomBytes(6).toString('hex')
  const now = new Date().toISOString()
  const rec = {
    id,
    serverId,
    name,
    kind,
    domain,
    image,
    notes,
    envEnc: env.length ? encrypt(JSON.stringify(env)) : null,
    runtime: { port, healthPath: kind === 'image' ? '/' : null },
    service: service ? { ...service, dataDir: service.dataDir || `/srv/data/${id}` } : null,
    delivery: { version: null, tag: null, commit: null, deployedAt: null },
    status: 'idle',
    warning: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  }
  list.push(rec)
  saveApps()
  return rec
}

export function deleteApp(id) {
  const list = load()
  const idx = list.findIndex((a) => a.id === id)
  if (idx === -1) throw bad('应用不存在')
  list.splice(idx, 1)
  saveApps()
}

export function publicApp(app) {
  let envKeys = []
  if (app.envEnc) {
    try {
      const raw = decrypt(app.envEnc)
      if (raw) envKeys = JSON.parse(raw).map((e) => e.key)
    } catch {
      envKeys = []
    }
  }
  return {
    id: app.id,
    serverId: app.serverId,
    name: app.name,
    kind: app.kind || 'image',
    domain: app.domain || null,
    image: app.image || null,
    notes: app.notes || null,
    envKeys,
    runtime: app.runtime,
    service: app.service || null,
    status: app.status,
    warning: app.warning,
    lastError: app.lastError,
    delivery: app.delivery,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  }
}

export function appPaths(app) {
  return {
    dir: `/srv/apps/${app.id}`,
  }
}

// 删除应用时在服务器上执行的清理脚本：容器、部署目录，数据目录需显式授权
export function buildCleanupScript(app, removeData = false) {
  const { dir } = appPaths(app)
  const lines = [
    'set -e',
    `DIR=${dir}`,
    'if [ -d "$DIR" ]; then',
    '  (cd "$DIR" && docker compose down --remove-orphans) || true',
    'fi',
    `docker rm -f ourjia_${app.id} >/dev/null 2>&1 || true`,
    'rm -rf "$DIR"',
  ]
  if (removeData && app.kind === 'service' && app.service?.dataDir) {
    const dataDir = app.service.dataDir
    if (!/^\/srv\/(data|shared)\/[A-Za-z0-9._/-]+$/.test(dataDir) || dataDir.includes('..')) {
      throw bad('数据目录不合法，已拒绝删除')
    }
    lines.push(`rm -rf ${dataDir}`)
  }
  lines.push('echo "已清理容器与部署目录"')
  return lines.join('\n')
}
