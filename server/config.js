import crypto from 'node:crypto'

export const CONFIG_VERSION = 1

export function defaultConfig() {
  return {
    dockerHubMirrors: [],
    aptMirror: null,
    dockerInstallSource: 'auto',
    swapMb: 'auto',
    swappiness: 10,
    traefikVersion: 'v3.6',
    acme: { email: '', ca: 'letsencrypt' },
    advanced: {
      containerDns: null,
      dockerAddressPool: null,
    },
  }
}

const MIRROR_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/i
const APT_MIRROR_RE = /^https?:\/\/[^\s"'\\]+$/i
const IP_CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/

function bad(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

function normalizeMirror(raw) {
  let value = String(raw || '').trim()
  if (!value) return null
  value = value.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  if (!MIRROR_RE.test(value)) throw bad(`镜像地址不合法：${raw}`)
  return value
}

function normalizeCidr(raw) {
  const value = String(raw || '').trim()
  if (!value) return null
  if (!IP_CIDR_RE.test(value)) throw bad(`地址池需为 CIDR 格式，如 10.201.0.0/16`)
  const [ip, bits] = value.split('/')
  const octets = ip.split('.').map(Number)
  if (octets.some((n) => n > 255)) throw bad('地址池 IP 段不合法')
  const prefix = Number(bits)
  if (prefix < 16 || prefix > 24) throw bad('地址池掩码需在 /16 ~ /24 之间')
  return value
}

function normalizeDns(raw) {
  if (raw == null) return null
  const list = Array.isArray(raw) ? raw : String(raw).split(/[\s,]+/)
  const ips = list.map((s) => String(s).trim()).filter(Boolean)
  for (const ip of ips) {
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.split('.').some((n) => Number(n) > 255)) {
      throw bad(`DNS 地址不合法：${ip}`)
    }
  }
  if (ips.length > 3) throw bad('DNS 最多填 3 个')
  return ips.length ? ips : null
}

export function normalizeConfig(input = {}, base = defaultConfig()) {
  const raw = input && typeof input === 'object' ? input : {}

  const mirrorsRaw = raw.dockerHubMirrors ?? base.dockerHubMirrors
  const mirrors = (Array.isArray(mirrorsRaw) ? mirrorsRaw : String(mirrorsRaw).split(/[\s,]+/))
    .map(normalizeMirror)
    .filter(Boolean)
  if (mirrors.length > 5) throw bad('Docker 镜像加速地址最多 5 个')

  const aptMirrorRaw = raw.aptMirror !== undefined ? raw.aptMirror : base.aptMirror
  let aptMirror = null
  if (aptMirrorRaw != null && String(aptMirrorRaw).trim() !== '') {
    const value = String(aptMirrorRaw).trim().replace(/\/+$/, '')
    if (!APT_MIRROR_RE.test(value)) throw bad('apt 镜像地址需以 http:// 或 https:// 开头')
    aptMirror = value
  }

  const installSource = raw.dockerInstallSource ?? base.dockerInstallSource
  if (!['auto', 'system', 'official'].includes(installSource)) throw bad('Docker 安装源不合法')

  const swapRaw = raw.swapMb !== undefined ? raw.swapMb : base.swapMb
  let swapMb = 'auto'
  if (swapRaw !== 'auto' && swapRaw !== null && swapRaw !== '') {
    const n = Number(swapRaw)
    if (!Number.isInteger(n) || n < 0 || n > 8192) throw bad('swap 大小需为 0 或 256~8192 MB')
    if (n !== 0 && n < 256) throw bad('swap 大小至少 256 MB')
    swapMb = n
  }

  const swapinessRaw = raw.swappiness !== undefined ? raw.swappiness : base.swappiness
  const swappiness = Number(swapinessRaw)
  if (!Number.isInteger(swappiness) || swappiness < 0 || swappiness > 100) throw bad('vm.swappiness 需为 0~100')

  const traefikVersion = String(raw.traefikVersion ?? base.traefikVersion).trim()
  if (!/^v?\d+(\.\d+){0,2}(-[\w.]+)?$/.test(traefikVersion)) throw bad('Traefik 版本格式不合法，如 v3.6')

  const acmeRaw = raw.acme ?? {}
  const email = String(acmeRaw.email ?? base.acme.email ?? '').trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('ACME 邮箱格式不合法')
  const ca = acmeRaw.ca ?? base.acme.ca ?? 'letsencrypt'
  if (!['letsencrypt', 'letsencrypt-staging', 'none'].includes(ca)) throw bad('ACME CA 不合法')

  const advRaw = raw.advanced ?? {}
  const advanced = {
    containerDns: normalizeDns(advRaw.containerDns !== undefined ? advRaw.containerDns : base.advanced.containerDns),
    dockerAddressPool: normalizeCidr(
      advRaw.dockerAddressPool !== undefined ? advRaw.dockerAddressPool : base.advanced.dockerAddressPool,
    ),
  }

  return {
    dockerHubMirrors: mirrors,
    aptMirror,
    dockerInstallSource: installSource,
    swapMb,
    swappiness,
    traefikVersion,
    acme: { email, ca },
    advanced,
  }
}

export function configHash(config) {
  return crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 16)
}

// 目标 swap 大小：auto 时内存 < 4G 建 2G
export function resolveSwapMb(config, memTotalMb) {
  if (config.swapMb !== 'auto') return config.swapMb
  if (!Number.isFinite(memTotalMb) || memTotalMb <= 0) return 0
  return memTotalMb < 4096 ? 2048 : 0
}

export function resolveTraefikImage(config) {
  const tag = config.traefikVersion.startsWith('v') ? config.traefikVersion : `v${config.traefikVersion}`
  return `traefik:${tag}`
}
