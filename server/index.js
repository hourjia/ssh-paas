import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { encrypt, decrypt, getServers, saveServers, findServer, publicServer } from './store.js'
import { connectSSH, probeServer, generateKeyPair, installPublicKey, execScript } from './ssh.js'
import { defaultConfig, normalizeConfig, resolveTraefikImage } from './config.js'
import { collectFacts, buildCheckReport, probeRegistryMirrors, probePublicPorts } from './check.js'
import { createJob, getJob, snapshot, subscribe, acquireLock, releaseLock, jobLocked, markInterrupted } from './jobs.js'
import { runInit, planSteps } from './init.js'
import { getApps, findApp, createApp, updateApp, deleteApp, publicApp, saveApps, buildCleanupScript, readEnvEntries } from './apps.js'
import { runDeploy, planDeploySteps } from './deploy.js'
import { scanServerResources, buildResourceCleanupScript } from './resources.js'
import { listTemplates } from './templates.js'

const PORT = Number(process.env.PORT) || 8787
const now = () => new Date().toISOString()

const app = express()
app.use(express.json())

function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    if (err?.type === 'entity.parse.failed') err = badRequest('请求体不是合法 JSON')
    res.status(err.status || 500).json({ error: err.message || '服务器内部错误' })
  })
}

function parseTarget(raw, rawPort) {
  let host = String(raw || '').trim()
  if (!host) throw badRequest('服务器地址不能为空')
  let port = 22
  const m = host.match(/^(.+):(\d+)$/)
  if (m && !m[1].includes(':')) {
    host = m[1]
    port = Number(m[2])
  } else if (rawPort !== undefined && rawPort !== null && String(rawPort).trim() !== '') {
    port = Number(rawPort)
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw badRequest('端口不合法（1-65535）')
  return { host, port }
}

function serverCredentials(rec) {
  const creds = { host: rec.host, port: rec.port, user: rec.user }
  if (rec.authType === 'key') {
    creds.privateKey = decrypt(rec.privateKeyEnc)
    if (!creds.privateKey) throw badRequest('尚未安装密钥，无法连接')
  } else {
    creds.password = decrypt(rec.passwordEnc)
    if (!creds.password) throw badRequest('未保存密码，无法连接')
  }
  return creds
}

async function withConnection(rec, fn) {
  const conn = await connectSSH(serverCredentials(rec))
  try {
    return await fn(conn)
  } finally {
    conn.end()
  }
}

const PRIVATE_IPV4_RE = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/

// 公网 IP 采集失败时，用 SSH 连接地址兜底（仅当它是公网 IPv4）
function reachTarget(facts, rec) {
  const ip = String(facts.PUBLIC_IP || '').trim()
  if (ip) return ip
  const host = String(rec.host || '').trim()
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) && !PRIVATE_IPV4_RE.test(host)) return host
  return ''
}

function serverConfig(rec) {
  return normalizeConfig(rec.config || {}, defaultConfig())
}

app.get('/api/servers', wrap((_req, res) => {
  res.json({ servers: getServers().map(publicServer) })
}))

app.post('/api/servers', wrap(async (req, res) => {
  const { address, name, port: rawPort, user, password, keyAuth } = req.body || {}
  if (!String(user || '').trim()) throw badRequest('SSH 用户不能为空')
  if (!password) throw badRequest('SSH 密码不能为空')
  const { host, port } = parseTarget(address, rawPort)
  const trimmedUser = String(user).trim()
  const dup = getServers().find((s) => s.host === host && s.port === port && s.user === trimmedUser)
  if (dup) throw badRequest('该服务器（地址 + 端口 + 用户）已存在')
  const displayName = String(name || '').trim() || (port === 22 ? host : `${host}:${port}`)

  const rec = {
    id: 'srv_' + crypto.randomBytes(6).toString('hex'),
    name: displayName,
    host,
    port,
    user: trimmedUser,
    authType: keyAuth ? 'key' : 'password',
    passwordEnc: null,
    privateKeyEnc: null,
    publicKey: null,
    keyInstalled: false,
    status: 'unknown',
    lastError: null,
    latencyMs: null,
    os: null,
    config: defaultConfig(),
    init: { state: 'unknown', lastCheckAt: null, lastInitAt: null, summary: null, error: null },
    createdAt: now(),
    lastCheckAt: null,
  }

  let conn
  try {
    conn = await connectSSH({ host, port, user: trimmedUser, password })
    if (keyAuth) {
      const { privateKeyPem, publicKeyLine } = generateKeyPair()
      await installPublicKey(conn, publicKeyLine)
      const vconn = await connectSSH({ host, port, user: trimmedUser, privateKey: privateKeyPem })
      try {
        const probe = await probeServer(vconn)
        Object.assign(rec, {
          publicKey: publicKeyLine,
          privateKeyEnc: encrypt(privateKeyPem),
          keyInstalled: true,
          status: 'online',
          latencyMs: probe.latencyMs,
          os: probe.os,
          lastCheckAt: now(),
        })
      } finally {
        vconn.end()
      }
    } else {
      const probe = await probeServer(conn)
      Object.assign(rec, {
        passwordEnc: encrypt(password),
        status: 'online',
        latencyMs: probe.latencyMs,
        os: probe.os,
        lastCheckAt: now(),
      })
    }
  } catch (err) {
    rec.status = 'offline'
    rec.lastError = err.message
    conn?.end()
    throw err // 添加即验证：连接失败不落库
  }
  conn.end()

  getServers().push(rec)
  saveServers()
  res.json({ server: publicServer(rec) })
}))

app.post('/api/servers/:id/test', wrap(async (req, res) => {
  const rec = findServer(req.params.id)
  if (!rec) throw badRequest('服务器不存在')

  const creds = { host: rec.host, port: rec.port, user: rec.user }
  if (rec.authType === 'key') {
    creds.privateKey = decrypt(rec.privateKeyEnc)
    if (!creds.privateKey) throw badRequest('尚未安装密钥，无法连接')
  } else {
    creds.password = decrypt(rec.passwordEnc)
    if (!creds.password) throw badRequest('未保存密码，无法连接')
  }

  try {
    const conn = await connectSSH(creds)
    try {
      const probe = await probeServer(conn)
      Object.assign(rec, {
        status: 'online',
        lastError: null,
        latencyMs: probe.latencyMs,
        os: probe.os,
        lastCheckAt: now(),
      })
    } finally {
      conn.end()
    }
  } catch (err) {
    Object.assign(rec, { status: 'offline', lastError: err.message, lastCheckAt: now() })
  }
  saveServers()
  res.json({ server: publicServer(rec) })
}))

app.delete('/api/servers/:id', wrap((req, res) => {
  const servers = getServers()
  const idx = servers.findIndex((s) => s.id === req.params.id)
  if (idx === -1) throw badRequest('服务器不存在')
  servers.splice(idx, 1)
  saveServers()
  res.json({ ok: true })
}))

app.get('/api/servers/:id/config', wrap((req, res) => {
  const rec = findServer(req.params.id)
  if (!rec) throw badRequest('服务器不存在')
  res.json({ config: serverConfig(rec) })
}))

app.put('/api/servers/:id/config', wrap((req, res) => {
  const rec = findServer(req.params.id)
  if (!rec) throw badRequest('服务器不存在')
  if (jobLocked(rec.id)) throw badRequest('该服务器有进行中的任务，请等待完成后再修改配置')
  rec.config = normalizeConfig(req.body?.config || {}, defaultConfig())
  saveServers()
  res.json({ config: rec.config })
}))

app.post('/api/servers/:id/check', wrap(async (req, res) => {
  const rec = findServer(req.params.id)
  if (!rec) throw badRequest('服务器不存在')
  const config = serverConfig(rec)
  const refreshMirrors = req.body?.refreshMirrors === true

  const started = Date.now()
  const { facts, probes } = await withConnection(rec, async (conn) => {
    const facts = await collectFacts(conn)
    let probes = []
    if (refreshMirrors || config.dockerHubMirrors.length) {
      probes = await probeRegistryMirrors(conn, config.dockerHubMirrors, resolveTraefikImage(config))
    }
    return { facts, probes }
  })
  const latencyMs = Date.now() - started

  // 公网 80/443 从平台侧实测：只靠服务器本机的 ss 看不到云安全组
  const reach = await probePublicPorts(reachTarget(facts, rec), [80, 443])
  const report = buildCheckReport(facts, config, probes, reach)

  rec.os = facts.OS_PRETTY ? `${facts.OS_PRETTY} · ${facts.KERNEL || ''}`.trim() : rec.os
  rec.status = 'online'
  rec.lastError = null
  rec.latencyMs = latencyMs
  rec.lastCheckAt = now()
  rec.init = {
    state: report.initialized ? (report.upToDate ? 'ready' : 'drifted') : 'uninitialized',
    lastCheckAt: now(),
    lastInitAt: report.record?.finishedAt || rec.init?.lastInitAt || null,
    summary: report.summary,
    error: null,
  }
  saveServers()
  res.json({ ...report, server: publicServer(rec), latencyMs: rec.latencyMs })
}))

app.post('/api/servers/:id/init', wrap(async (req, res) => {
  const rec = findServer(req.params.id)
  if (!rec) throw badRequest('服务器不存在')
  const running = jobLocked(rec.id)
  if (running) throw badRequest('该服务器已有进行中的任务')

  const config = normalizeConfig(req.body?.config || rec.config || {}, defaultConfig())
  rec.config = config
  saveServers()

  const job = createJob(rec.id, 'init', planSteps(config))
  if (!acquireLock(rec.id, job.id)) throw badRequest('该服务器已有进行中的任务')
  res.json({ job: snapshot(job) })

  // 后台执行
  ;(async () => {
    let conn
    try {
      conn = await connectSSH(serverCredentials(rec))
      await runInit(job, conn, rec, config)
    } catch (err) {
      const { setJobState, appendLog } = await import('./jobs.js')
      appendLog(job, `连接失败：${err.message}`, 'err')
      setJobState(job, 'failed', err.message)
    } finally {
      conn?.end()
      releaseLock(rec.id)
      rec.init = {
        state: job.status === 'done' ? 'ready' : 'uninitialized',
        lastCheckAt: now(),
        lastInitAt: job.status === 'done' ? now() : rec.init?.lastInitAt || null,
        summary: rec.init?.summary || null,
        error: job.status === 'failed' ? job.error : null,
      }
      saveServers()
    }
  })()
}))

app.get('/api/templates', wrap((_req, res) => {
  res.json({ templates: listTemplates() })
}))

app.get('/api/apps', wrap((_req, res) => {
  res.json({ apps: getApps().map(publicApp) })
}))

app.post('/api/apps', wrap((req, res) => {
  const server = findServer(String(req.body?.serverId || ''))
  if (!server) throw badRequest('服务器不存在')
  const rec = createApp({ ...req.body, serverId: server.id })
  res.json({ app: publicApp(rec) })
}))

app.get('/api/apps/:id/env', wrap((req, res) => {
  const ip = req.socket.remoteAddress
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
    throw badRequest('仅允许本机读取环境变量')
  }
  const rec = findApp(req.params.id)
  if (!rec) throw badRequest('应用不存在')
  res.json({ env: readEnvEntries(rec) })
}))

app.put('/api/apps/:id', wrap((req, res) => {
  const rec = findApp(req.params.id)
  if (!rec) throw badRequest('应用不存在')
  if (jobLocked(rec.serverId)) throw badRequest('该服务器有进行中的任务，请等待完成后再修改')
  const updated = updateApp(rec, req.body || {})
  res.json({ app: publicApp(updated) })
}))

app.delete('/api/apps/:id', wrap(async (req, res) => {
  const rec = findApp(req.params.id)
  if (!rec) throw badRequest('应用不存在')
  if (jobLocked(rec.serverId)) throw badRequest('该服务器有进行中的任务，请等待完成后再删除')

  const cleanup = req.query.cleanup === '1'
  const removeData = req.query.data === '1'
  let detail = null

  if (cleanup) {
    const server = findServer(rec.serverId)
    if (!server) throw badRequest('应用所属服务器不存在，无法清理')
    const script = buildCleanupScript(rec, removeData)
    await withConnection(server, async (conn) => {
      const result = await execScript(conn, script, { timeoutMs: 120000 })
      if (result.code !== 0) {
        const message = result.stderr.trim() || `退出码 ${result.code}`
        throw new Error(`服务器清理失败：${message}`)
      }
      detail = result.stdout.trim()
    })
  }

  deleteApp(rec.id)
  res.json({ ok: true, detail })
}))

app.post('/api/apps/:id/deploy', wrap(async (req, res) => {
  const rec = findApp(req.params.id)
  if (!rec) throw badRequest('应用不存在')
  const server = findServer(rec.serverId)
  if (!server) throw badRequest('应用所属服务器不存在')
  if (jobLocked(server.id)) throw badRequest('该服务器已有进行中的任务，请等待完成')

  const job = createJob(server.id, 'deploy', planDeploySteps(rec))
  if (!acquireLock(server.id, job.id)) throw badRequest('该服务器已有进行中的任务')
  rec.status = 'deploying'
  rec.lastError = null
  saveApps()
  res.json({ job: snapshot(job), app: publicApp(rec) })

  ;(async () => {
    let conn
    try {
      conn = await connectSSH(serverCredentials(server))
      await runDeploy(job, conn, server, rec)
    } catch (err) {
      const { setJobState, appendLog } = await import('./jobs.js')
      appendLog(job, `连接失败：${err.message}`, 'err')
      rec.status = 'failed'
      rec.lastError = err.message
      saveApps()
      setJobState(job, 'failed', err.message)
    } finally {
      conn?.end()
      releaseLock(server.id)
    }
  })()
}))

app.get('/api/servers/:id/resources', wrap(async (req, res) => {
  const rec = findServer(req.params.id)
  if (!rec) throw badRequest('服务器不存在')
  const serverApps = getApps().filter((a) => a.serverId === rec.id)
  const data = await withConnection(rec, (conn) => scanServerResources(conn, serverApps))
  res.json(data)
}))

app.post('/api/servers/:id/resources/cleanup', wrap(async (req, res) => {
  const rec = findServer(req.params.id)
  if (!rec) throw badRequest('服务器不存在')
  if (jobLocked(rec.id)) throw badRequest('该服务器有进行中的任务，请等待完成后再清理')

  const containers = Array.isArray(req.body?.containers) ? req.body.containers.map(String) : []
  const paths = Array.isArray(req.body?.paths) ? req.body.paths.map(String) : []
  if (!containers.length && !paths.length) throw badRequest('没有选中要清理的资源')

  // 清理前重新扫描，只允许删除当前确实属于孤儿的资源
  const serverApps = getApps().filter((a) => a.serverId === rec.id)
  const scanned = await withConnection(rec, (conn) => scanServerResources(conn, serverApps))
  const orphanContainers = new Set(scanned.orphans.containers.map((c) => c.name))
  const orphanPaths = new Set(scanned.orphans.dirs.map((d) => d.path))
  for (const name of containers) {
    if (!orphanContainers.has(name)) throw badRequest(`容器 ${name} 不是孤儿资源，已拒绝清理`)
  }
  for (const path of paths) {
    if (!orphanPaths.has(path)) throw badRequest(`目录 ${path} 不是孤儿资源，已拒绝清理`)
  }

  const script = buildResourceCleanupScript({ containers, paths })
  const detail = await withConnection(rec, async (conn) => {
    const result = await execScript(conn, script, { timeoutMs: 120000 })
    if (result.code !== 0) {
      throw new Error(`清理失败：${result.stderr.trim() || `退出码 ${result.code}`}`)
    }
    return result.stdout.trim()
  })
  res.json({ ok: true, removed: { containers, paths }, detail })
}))

app.get('/api/jobs/:id', wrap((req, res) => {
  const job = getJob(req.params.id)
  if (!job) throw badRequest('任务不存在')
  res.json({ job: snapshot(job, true) })
}))

app.get('/api/jobs/:id/stream', (req, res) => {
  const job = getJob(req.params.id)
  if (!job) {
    res.status(404).json({ error: '任务不存在' })
    return
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  // 先补发已有日志与状态，支持断线重连
  send('state', snapshot(job, false))
  for (const log of job.logs) send('log', { stream: log.stream, text: log.text, at: log.at })
  const unsubscribe = subscribe(job, send)
  const ping = setInterval(() => res.write(': ping\n\n'), 15000)
  const cleanup = () => {
    clearInterval(ping)
    unsubscribe()
  }
  req.on('close', cleanup)
})

app.use('/api', (_req, res) => {
  res.status(404).json({ error: '接口不存在' })
})

// 生产模式：托管前端构建产物
const distDir = path.join(import.meta.dirname, '..', 'web', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      return res.sendFile(path.join(distDir, 'index.html'))
    }
    next()
  })
}

app.listen(PORT, () => {
  markInterrupted()
  console.log(`[ourjia-paas] server listening on http://127.0.0.1:${PORT}`)
})
