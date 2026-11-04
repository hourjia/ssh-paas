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

function normalizeEnvEntry(item) {
  let key
  let values
  let note = ''
  if (typeof item === 'string') {
    const text = item.trim()
    if (!text || text.startsWith('#')) return null
    const idx = text.indexOf('=')
    if (idx <= 0) throw bad(`环境变量格式错误：${text}（应为 KEY=VALUE）`)
    key = text.slice(0, idx).trim()
    values = [text.slice(idx + 1)]
  } else if (item && typeof item === 'object') {
    key = String(item.key || '').trim()
    if (Array.isArray(item.values)) values = item.values.map(String)
    else if (item.value !== undefined) values = [String(item.value)]
    else values = ['']
    note = String(item.note || '').trim().slice(0, 200)
  } else {
    throw bad('环境变量格式不正确')
  }

  if (!key) throw bad('环境变量名不能为空')
  if (!ENV_KEY_RE.test(key)) throw bad(`环境变量名不合法：${key}`)
  if (!values.length) values = ['']
  if (values.length > 20) throw bad(`环境变量 ${key} 的值最多 20 项`)
  for (const value of values) {
    if (String(value).length > 4096) throw bad(`环境变量 ${key} 的值过长`)
  }
  return { key, values, note }
}

function parseEnvInput(raw) {
  if (!raw) return []
  const items = typeof raw === 'string' ? raw.split(/\r?\n/) : raw
  if (!Array.isArray(items)) throw bad('环境变量格式不正确')
  const out = []
  const seen = new Set()
  for (const item of items) {
    const entry = normalizeEnvEntry(item)
    if (!entry) continue
    if (seen.has(entry.key)) throw bad(`环境变量重复：${entry.key}`)
    seen.add(entry.key)
    out.push(entry)
  }
  if (out.length > ENV_MAX) throw bad(`环境变量最多 ${ENV_MAX} 个`)
  return out
}

// 环境变量可能含密钥，落盘前整体加密
export function readEnvEntries(app) {
  if (!app?.envEnc) return []
  const raw = decrypt(app.envEnc)
  if (!raw) throw bad('环境变量解密失败，请检查 server/data/.secret 是否被替换')
  try {
    const list = JSON.parse(raw)
    return list.map((entry) => ({
      key: entry.key,
      values: Array.isArray(entry.values) ? entry.values.map(String) : [String(entry.value ?? '')],
      note: entry.note || '',
    }))
  } catch {
    throw bad('环境变量数据损坏')
  }
}

// 多值变量在注入容器时用逗号连接
export function readEnv(app) {
  const entries = readEnvEntries(app)
  return Object.fromEntries(entries.map((entry) => [entry.key, entry.values.join(',')]))
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

function normalizeHealthPath(raw) {
  const value = String(raw || '/').trim() || '/'
  if (!value.startsWith('/') || /\s/.test(value) || value.length > 200) {
    throw bad('健康检查路径需以 / 开头，且不含空格')
  }
  return value
}

function normalizeVolumes(raw) {
  if (raw === undefined || raw === null || raw === '') return []
  if (!Array.isArray(raw)) throw bad('数据卷配置格式不正确')
  if (raw.length > 5) throw bad('数据卷最多 5 个')
  const names = new Set()
  const urls = new Set()
  return raw.map((item) => {
    const name = String(item?.name || 'media').trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{0,19}$/.test(name)) throw bad('数据卷名称只能包含小写字母、数字和短横线')
    if (names.has(name)) throw bad(`数据卷名称重复：${name}`)
    names.add(name)

    const mountPath = normalizeContainerPath(item?.mountPath)
    const serveUrl = String(item?.serveUrl || '').trim()
    if (serveUrl) {
      if (!/^\/[A-Za-z0-9._/-]*\/$/.test(serveUrl) || serveUrl.includes('..')) {
        throw bad('媒体 URL 需以 / 开头和结尾，例如 /media/')
      }
      if (urls.has(serveUrl)) throw bad(`媒体 URL 重复：${serveUrl}`)
      urls.add(serveUrl)
    }
    const owner = String(item?.owner || '').trim()
    if (owner && !OWNER_RE.test(owner)) throw bad('数据卷所有者格式为 uid:gid，例如 1000:1000')

    return { name, mountPath, serveUrl: serveUrl || null, owner: owner || null }
  })
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

  let healthPath = null
  let volumes = []
  if (kind === 'image') {
    healthPath = normalizeHealthPath(input.healthPath)
    volumes = normalizeVolumes(input.volumes)
  }

  return { kind, name, serverId, domain, image, port: portRaw, notes, env: parseEnvInput(input.env), service, healthPath, volumes }
}

export function createApp(input) {
  const { kind, name, serverId, domain, image, port, notes, env, service, healthPath, volumes } = normalizeAppInput(input)
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
    runtime: { port, healthPath: kind === 'image' ? healthPath : null },
    volumes:
      kind === 'image'
        ? volumes.map((v) => ({
            ...v,
            hostPath: `/srv/data/${id}/${v.name}`,
            readOnly: false,
          }))
        : [],
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
    volumes: app.volumes || [],
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
    `docker rm -f ourjia_${app.id}_media >/dev/null 2>&1 || true`,
    'rm -rf "$DIR"',
  ]
  if (removeData) {
    const dirs = new Set()
    if (app.kind === 'image') {
      // 所有媒体卷都在 /srv/data/<appId>/ 下，直接删父目录
      dirs.add(`/srv/data/${app.id}`)
    } else if (app.service?.dataDir) {
      dirs.add(app.service.dataDir)
    }
    for (const dataDir of dirs) {
      if (!/^\/srv\/(data|shared)\/[A-Za-z0-9._/-]+$/.test(dataDir) || dataDir.includes('..')) {
        throw bad('数据目录不合法，已拒绝删除')
      }
      lines.push(`rm -rf ${dataDir}`)
    }
  }
  lines.push('echo "已清理容器与部署目录"')
  return lines.join('\n')
}

// 手动停止：保留容器与数据目录，之后可手动启动
export function buildStopScript(app) {
  const { dir } = appPaths(app)
  return [
    'set -e',
    `DIR=${dir}`,
    'if [ -f "$DIR/docker-compose.yml" ]; then',
    '  cd "$DIR"',
    '  docker compose stop',
    'fi',
    `docker stop ourjia_${app.id} >/dev/null 2>&1 || true`,
    `docker stop ourjia_${app.id}_media >/dev/null 2>&1 || true`,
    'echo "服务已停止，数据目录保持不变"',
  ].join('\n')
}

// 手动启动：只启动已存在的容器，不拉镜像、不改 compose；容器被删掉时提示重新部署
export function buildStartScript(app) {
  const { dir } = appPaths(app)
  return [
    'set -e',
    `DIR=${dir}`,
    'if [ ! -f "$DIR/docker-compose.yml" ]; then',
    '  echo "还没有部署配置，请先重新部署" >&2',
    '  exit 1',
    'fi',
    'cd "$DIR"',
    'if [ -z "$(docker compose ps -q app)" ]; then',
    '  echo "容器不存在，请重新部署" >&2',
    '  exit 1',
    'fi',
    'docker compose start',
    'docker compose ps',
  ].join('\n')
}

export function updateApp(app, input = {}) {
  const list = load()
  const name = input.name !== undefined ? String(input.name).trim() : app.name
  if (!name) throw bad('应用名称不能为空')
  if (name.length > NAME_MAX) throw bad(`应用名称不能超过 ${NAME_MAX} 个字符`)

  const image = input.image !== undefined ? String(input.image).trim() : app.image
  if (!IMAGE_RE.test(image)) throw bad('镜像地址格式不合法，例如 registry.example.com/team/app:v1')

  const port =
    input.port !== undefined && input.port !== null && input.port !== ''
      ? Number(input.port)
      : app.runtime?.port || (app.kind === 'service' ? 5432 : 80)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw bad('端口需为 1-65535')

  const notes = input.notes !== undefined ? String(input.notes).trim() : app.notes || ''
  if (notes.length > NOTES_MAX) throw bad(`备注不能超过 ${NOTES_MAX} 个字符`)

  if (input.env !== undefined) {
    const env = parseEnvInput(input.env)
    app.envEnc = env.length ? encrypt(JSON.stringify(env)) : null
  }

  if (app.kind === 'service') {
    const current = app.service || {}
    const alias = input.alias !== undefined ? String(input.alias).trim().toLowerCase() : current.alias || ''
    if (alias && !ALIAS_RE.test(alias)) throw bad('网络别名只能包含小写字母、数字和短横线')
    if (alias) {
      const dup = list.find((a) => a.id !== app.id && a.serverId === app.serverId && a.service?.alias === alias)
      if (dup) throw bad(`网络别名 ${alias} 已被「${dup.name}」占用`)
    }

    const containerPath =
      input.containerPath !== undefined ? normalizeContainerPath(input.containerPath) : current.containerPath
    const dataDir =
      input.dataDir !== undefined
        ? normalizeDataDir(input.dataDir) || current.dataDir
        : current.dataDir
    const dataOwner = input.dataOwner !== undefined ? String(input.dataOwner).trim() : current.dataOwner || ''
    if (dataOwner && !OWNER_RE.test(dataOwner)) throw bad('目录所有者格式为 uid:gid，例如 999:999')
    const healthCmd = input.healthCmd !== undefined ? String(input.healthCmd).trim() : current.healthCmd || ''
    if (healthCmd.length > 200 || /[\r\n]/.test(healthCmd)) throw bad('健康检查命令过长或包含换行')

    Object.assign(app, {
      name,
      image,
      notes,
      runtime: { ...app.runtime, port },
      service: {
        alias: alias || null,
        dataDir,
        containerPath,
        dataOwner: dataOwner || null,
        healthCmd: healthCmd || null,
      },
      updatedAt: new Date().toISOString(),
    })
    saveApps()
    return app
  }

  const domain = input.domain !== undefined ? String(input.domain).trim().toLowerCase() : app.domain
  if (!DOMAIN_RE.test(domain)) throw bad('域名格式不合法，例如 demo.example.com')
  if (list.some((a) => a.id !== app.id && a.serverId === app.serverId && a.domain === domain)) {
    throw bad('该服务器上已有应用使用这个域名')
  }

  const healthPath = input.healthPath !== undefined ? normalizeHealthPath(input.healthPath) : app.runtime?.healthPath || '/'

  let volumes = app.volumes || []
  if (input.volumes !== undefined) {
    const normalized = normalizeVolumes(input.volumes)
    const existing = new Map((app.volumes || []).map((v) => [v.name, v]))
    volumes = normalized.map((v) => ({
      ...v,
      hostPath: existing.get(v.name)?.hostPath || `/srv/data/${app.id}/${v.name}`,
      readOnly: false,
    }))
  }

  Object.assign(app, {
    name,
    image,
    domain,
    notes,
    volumes,
    runtime: { ...app.runtime, port, healthPath },
    updatedAt: new Date().toISOString(),
  })
  saveApps()
  return app
}

