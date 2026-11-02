import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { encrypt, decrypt, getServers, saveServers, findServer, publicServer } from './store.js'
import { connectSSH, probeServer, generateKeyPair, installPublicKey } from './ssh.js'

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

function parseTarget(raw) {
  let host = String(raw || '').trim()
  if (!host) throw badRequest('服务器地址不能为空')
  let port = 22
  const m = host.match(/^(.+):(\d+)$/)
  if (m && !m[1].includes(':')) {
    host = m[1]
    port = Number(m[2])
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw badRequest('端口不合法（1-65535）')
  return { host, port }
}

app.get('/api/servers', wrap((_req, res) => {
  res.json({ servers: getServers().map(publicServer) })
}))

app.post('/api/servers', wrap(async (req, res) => {
  const { address, name, user, password, keyAuth } = req.body || {}
  if (!String(user || '').trim()) throw badRequest('SSH 用户不能为空')
  if (!password) throw badRequest('SSH 密码不能为空')
  const { host, port } = parseTarget(address)
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
  console.log(`[ourjia-paas] server listening on http://127.0.0.1:${PORT}`)
})
