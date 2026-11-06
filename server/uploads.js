// 脚本「文件参数」的本机暂存区。
// 浏览器先把文件传到平台（server/data/uploads），运行脚本时再通过 SFTP 送到目标服务器，
// 传输成功后立即删除本机副本：文件不会长期堆在平台上。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Transform } from 'node:stream'

const DATA_DIR = path.join(import.meta.dirname, 'data')
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')

const TOKEN_RE = /^[a-f0-9]{24}$/
const NAME_MAX = 120
const META_VERSION = 1
const TTL_MS = 6 * 60 * 60 * 1000
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024

function bad(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

// 只保留文件名本身：去掉路径、控制字符，并限制长度（保留扩展名）
export function sanitizeFilename(raw) {
  const tail = String(raw || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
  let name = String(tail || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  if (!name || name === '.' || name === '..') name = 'upload.bin'
  if (name.length > NAME_MAX) {
    const ext = path.extname(name).slice(0, 16)
    name = name.slice(0, NAME_MAX - ext.length) + ext
  }
  return name
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB']
  let size = value / 1024
  let i = 0
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i += 1
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[i]}`
}

function uploadPaths(token) {
  return {
    bin: path.join(UPLOAD_DIR, `${token}.bin`),
    meta: path.join(UPLOAD_DIR, `${token}.json`),
  }
}

// 清掉超时未使用的暂存文件（进程崩溃或用户中途关页面留下的）
export function cleanupUploads(now = Date.now()) {
  let entries = []
  try {
    entries = fs.readdirSync(UPLOAD_DIR)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(UPLOAD_DIR, entry)
    try {
      const stat = fs.statSync(full)
      if (now - stat.mtimeMs > TTL_MS) fs.rmSync(full, { force: true })
    } catch {
      /* 文件可能刚被别的请求删掉 */
    }
  }
}

// 把请求体原样落到暂存区，返回 { token, name, size }
export function saveUploadStream(req, rawName) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0)
    if (declared > UPLOAD_MAX_BYTES) {
      req.resume()
      reject(bad(`文件不能超过 ${formatBytes(UPLOAD_MAX_BYTES)}`))
      return
    }

    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
    cleanupUploads()

    const token = crypto.randomBytes(12).toString('hex')
    const name = sanitizeFilename(rawName)
    const { bin, meta } = uploadPaths(token)
    const out = fs.createWriteStream(bin, { mode: 0o600 })
    let size = 0
    let settled = false

    const fail = (err) => {
      if (settled) return
      settled = true
      try {
        req.unpipe(counter)
      } catch {
        /* ignore */
      }
      out.destroy()
      // 不销毁请求：让上层还能把错误信息写回浏览器
      req.resume?.()
      fs.rm(bin, { force: true }, () => fs.rm(meta, { force: true }, () => reject(err)))
    }

    const counter = new Transform({
      transform(chunk, _enc, cb) {
        size += chunk.length
        if (size > UPLOAD_MAX_BYTES) {
          cb(bad(`文件不能超过 ${formatBytes(UPLOAD_MAX_BYTES)}`))
          return
        }
        cb(null, chunk)
      },
    })

    req.on('error', fail)
    counter.on('error', fail)
    out.on('error', (err) => fail(new Error(`写入暂存文件失败：${err.message}`)))

    out.on('finish', () => {
      if (settled) return
      if (!size) {
        fail(bad('上传的文件是空的'))
        return
      }
      settled = true
      const record = { version: META_VERSION, token, name, size, createdAt: new Date().toISOString() }
      try {
        fs.writeFileSync(meta, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
      } catch (err) {
        fs.rm(bin, { force: true }, () => reject(new Error(`写入暂存信息失败：${err.message}`)))
        return
      }
      resolve({ token, name, size })
    })

    req.pipe(counter).pipe(out)
  })
}

// 读取暂存文件信息；不存在或已过期返回 null
export function readUpload(token) {
  const value = String(token || '').trim()
  if (!TOKEN_RE.test(value)) return null
  const { bin, meta } = uploadPaths(value)
  try {
    const record = JSON.parse(fs.readFileSync(meta, 'utf8'))
    if (record?.token !== value) return null
    if (!fs.existsSync(bin)) return null
    const stat = fs.statSync(bin)
    if (Date.now() - stat.mtimeMs > TTL_MS) {
      removeUpload(value)
      return null
    }
    return { token: value, name: sanitizeFilename(record.name), size: stat.size, path: bin }
  } catch {
    return null
  }
}

export function removeUpload(token) {
  const value = String(token || '').trim()
  if (!TOKEN_RE.test(value)) return
  const { bin, meta } = uploadPaths(value)
  fs.rmSync(bin, { force: true })
  fs.rmSync(meta, { force: true })
}
