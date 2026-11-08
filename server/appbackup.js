import { getServers } from './store.js'
import { getApps, readEnvEntries, buildAppRecord, addAppRecord, normalizeEnvEntries } from './apps.js'

export const BACKUP_FORMAT = 'ourjia-paas.apps'
export const BACKUP_VERSION = 1

function bad(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

const serverKey = (server) =>
  `${String(server?.host || '').trim().toLowerCase()}:${Number(server?.port) || 22}:${String(server?.user || '').trim()}`

// 导出：应用配置 + 环境变量明文。服务器只保留身份信息（用于导入时匹配），不导出凭据。
export function buildBackup() {
  const servers = getServers()
  const byId = new Map(servers.map((server) => [server.id, server]))
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    warning: '本文件包含环境变量明文（可能含密钥），请只存放在可信位置，不要提交到公开仓库',
    servers: servers.map((server) => ({
      name: server.name,
      host: server.host,
      port: server.port,
      user: server.user,
    })),
    apps: getApps().map((app) => {
      const server = byId.get(app.serverId) || null
      return {
        id: app.id,
        server: server ? { host: server.host, port: server.port, user: server.user } : null,
        name: app.name,
        kind: app.kind || 'image',
        domain: app.domain || null,
        image: app.image || null,
        notes: app.notes || '',
        env: readEnvEntries(app),
        runtime: app.runtime,
        volumes: app.volumes || [],
        service: app.service || null,
        delivery: app.delivery || null,
        status: app.status,
        createdAt: app.createdAt,
        updatedAt: app.updatedAt,
      }
    }),
  }
}

function assertBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw bad('配置文件内容不是 JSON 对象')
  if (data.format !== BACKUP_FORMAT) throw bad('不是本平台导出的应用配置文件')
  if (Number(data.version) !== BACKUP_VERSION) throw bad(`配置文件版本不支持：${data.version}`)
  if (!Array.isArray(data.apps)) throw bad('配置文件缺少 apps 列表')
  if (data.apps.length > 500) throw bad('单次最多导入 500 个应用')
}

function findServerFor(app, index) {
  if (!app?.server || typeof app.server !== 'object') return null
  return index.get(serverKey(app.server)) || null
}

// 把备份文件里的应用还原成落库结构：字段校验交给 buildAppRecord，避免脏数据进库
function importedRecord(serverId, raw) {
  const kind = raw.kind === 'service' ? 'service' : 'image'
  return {
    id: String(raw.id || ''),
    serverId,
    name: raw.name,
    kind,
    domain: kind === 'service' ? null : raw.domain,
    image: raw.image,
    notes: raw.notes,
    env: Array.isArray(raw.env) ? normalizeEnvEntries(raw.env) : [],
    runtime: raw.runtime && typeof raw.runtime === 'object' ? raw.runtime : {},
    volumes: kind === 'image' && Array.isArray(raw.volumes) ? raw.volumes : [],
    service: kind === 'service' && raw.service && typeof raw.service === 'object' ? raw.service : {},
    delivery: raw.delivery && typeof raw.delivery === 'object' ? raw.delivery : null,
    status: raw.status,
    createdAt: raw.createdAt,
  }
}

export function previewImport(data) {
  assertBackup(data)
  const index = new Map(getServers().map((server) => [serverKey(server), server]))
  const known = new Set(getApps().map((app) => app.id))
  const unmatchedServers = new Set()
  const items = []

  for (const raw of data.apps) {
    const id = String(raw?.id || '')
    const name = String(raw?.name || id || '未命名应用')
    const target = findServerFor(raw, index)
    if (!target) {
      const label = raw?.server
        ? `${raw.server.user || '?'}@${raw.server.host || '?'}:${raw.server.port || 22}`
        : '（缺少服务器信息）'
      if (raw?.server) unmatchedServers.add(label)
      items.push({ id, name, action: 'error', reason: `服务器未纳管：${label}` })
      continue
    }
    if (known.has(id)) {
      items.push({ id, name, action: 'skip', reason: '平台里已存在同 ID 应用' })
      continue
    }
    try {
      buildAppRecord(importedRecord(target.id, raw))
      items.push({
        id,
        name,
        action: 'create',
        reason: `${target.name} · ${raw.kind === 'service' ? '共享服务' : raw.domain || '无域名'}`,
      })
    } catch (err) {
      items.push({ id, name, action: 'error', reason: err.message })
    }
  }

  return {
    items,
    unmatchedServers: [...unmatchedServers],
    summary: {
      create: items.filter((item) => item.action === 'create').length,
      skip: items.filter((item) => item.action === 'skip').length,
      error: items.filter((item) => item.action === 'error').length,
    },
  }
}

export function applyImport(data) {
  assertBackup(data)
  const preview = previewImport(data)
  const index = new Map(getServers().map((server) => [serverKey(server), server]))
  const rawById = new Map(data.apps.map((raw) => [String(raw?.id || ''), raw]))

  const imported = []
  const failed = preview.items
    .filter((item) => item.action === 'error')
    .map((item) => `${item.name}：${item.reason}`)

  for (const item of preview.items) {
    if (item.action !== 'create') continue
    const raw = rawById.get(item.id)
    const target = findServerFor(raw, index)
    if (!target) {
      failed.push(`${item.name}：服务器未纳管`)
      continue
    }
    try {
      imported.push(addAppRecord(importedRecord(target.id, raw)))
    } catch (err) {
      failed.push(`${item.name}：${err.message}`)
    }
  }

  return {
    imported,
    skipped: preview.summary.skip,
    failed,
  }
}
