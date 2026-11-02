import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = path.join(import.meta.dirname, 'data')
const DB_FILE = path.join(DATA_DIR, 'servers.json')
const SECRET_FILE = path.join(DATA_DIR, '.secret')

function loadSecret() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim()
  const secret = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 })
  return secret
}

const AES_KEY = crypto.createHash('sha256').update(loadSecret()).digest()

export function encrypt(text) {
  if (text == null || text === '') return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', AES_KEY, iv)
  const ct = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('hex'), tag.toString('hex'), ct.toString('hex')].join(':')
}

export function decrypt(blob) {
  if (!blob) return null
  const [ivHex, tagHex, ctHex] = String(blob).split(':')
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', AES_KEY, Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

function loadServers() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
  } catch {
    return []
  }
}

const servers = loadServers()

export function getServers() {
  return servers
}

export function saveServers() {
  const tmp = DB_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(servers, null, 2))
  fs.renameSync(tmp, DB_FILE)
}

export function findServer(id) {
  return servers.find((s) => s.id === id)
}

export function publicServer(rec) {
  const { passwordEnc, privateKeyEnc, ...pub } = rec
  return pub
}
