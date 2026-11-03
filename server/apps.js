import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = path.join(import.meta.dirname, 'data')
const APPS_FILE = path.join(DATA_DIR, 'apps.json')

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i
const NAME_MAX = 40

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

export function normalizeAppInput(input = {}) {
  const name = String(input.name || '').trim()
  if (!name) throw bad('应用名称不能为空')
  if (name.length > NAME_MAX) throw bad(`应用名称不能超过 ${NAME_MAX} 个字符`)

  const serverId = String(input.serverId || '').trim()
  if (!serverId) throw bad('请选择服务器')

  const domain = String(input.domain || '').trim().toLowerCase()
  if (!domain) throw bad('域名不能为空')
  if (!DOMAIN_RE.test(domain)) throw bad('域名格式不合法，例如 demo.example.com')

  return { name, serverId, domain }
}

export function createApp(input) {
  const { name, serverId, domain } = normalizeAppInput(input)
  if (load().some((a) => a.serverId === serverId && a.domain === domain)) {
    throw bad('该服务器上已有应用使用这个域名')
  }
  const id = 'app_' + crypto.randomBytes(6).toString('hex')
  const now = new Date().toISOString()
  const rec = {
    id,
    serverId,
    name,
    domain,
    kind: 'sample',
    runtime: { baseImage: 'nginx:alpine', port: 80, healthPath: '/' },
    source: { repo: null, ref: null, buildCommand: null, distDir: '.' },
    delivery: { version: null, tag: null, commit: null, deployedAt: null },
    status: 'idle',
    warning: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  }
  load().push(rec)
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
  return {
    id: app.id,
    serverId: app.serverId,
    name: app.name,
    domain: app.domain,
    kind: app.kind,
    runtime: app.runtime,
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
    repo: `/srv/git/${app.id}.git`,
    dir: `/srv/apps/${app.id}`,
  }
}
