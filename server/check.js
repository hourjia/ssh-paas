import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { execScript } from './ssh.js'
import { resolveSwapMb, configHash } from './config.js'

const SCRIPT_DIR = path.join(import.meta.dirname, 'scripts')
const COLLECT_SCRIPT = fs.readFileSync(path.join(SCRIPT_DIR, 'collect.sh'), 'utf8')
const PROBE_MIRROR_SCRIPT = fs.readFileSync(path.join(SCRIPT_DIR, 'probe-mirror.sh'), 'utf8')

function parseKv(text) {
  const out = {}
  for (const line of String(text || '').split('\n')) {
    if (!line) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    if (!/^[A-Za-z0-9_]+$/.test(key)) continue
    out[key] = line.slice(idx + 1)
  }
  return out
}

const num = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function splitList(v) {
  return String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// 采集原始事实
export async function collectFacts(conn) {
  const started = Date.now()
  const result = await execScript(conn, COLLECT_SCRIPT, { timeoutMs: 60000 })
  const facts = parseKv(result.stdout)
  facts.latencyMs = Date.now() - started
  facts.scriptExit = result.code
  if (result.code !== 0 && result.stderr.trim()) facts.scriptStderr = result.stderr.trim().slice(0, 2000)
  return facts
}

// 从平台侧（本机）对一个 TCP 端口发起连接，用于验证安全组/防火墙是否真正放行
export function probeTcpPort(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish({ open: true, error: null }))
    socket.once('timeout', () => finish({ open: false, error: '连接超时' }))
    socket.once('error', (err) => finish({ open: false, error: err.code || err.message }))
    socket.connect(port, host)
  })
}

// 公网 80/443 探测：从平台所在网络发起，覆盖“安全组只开了 22”这类本机检查发现不了的问题
export async function probePublicPorts(ip, ports = [80, 443], timeoutMs = 4000) {
  const target = String(ip || '').trim()
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(target) || target.split('.').some((n) => Number(n) > 255)) return null
  const results = await Promise.all(
    ports.map(async (port) => ({ port, ...(await probeTcpPort(target, port, timeoutMs)) })),
  )
  return { ip: target, results }
}

// 探测镜像加速器：能否真正拉到指定镜像（manifest + 首个 layer 可达）
export async function probeRegistryMirrors(conn, mirrors, imageRef) {
  if (!mirrors.length) return []
  const [repo, tag = 'latest'] = imageRef.split(':')
  const imageName = repo.includes('/') ? repo : `library/${repo}`
  const wrapped = (host) =>
    `IMG='${imageName.replace(/'/g, `'\\''`)}'\nTAG='${String(tag).replace(/'/g, `'\\''`)}'\n` +
    `MIRROR='${String(host).replace(/'/g, `'\\''`)}'\n${PROBE_MIRROR_SCRIPT}`

  const list = []
  for (const mirror of mirrors) {
    try {
      const r = await execScript(conn, wrapped(mirror), { timeoutMs: 40000 })
      list.push(parseProbeResult(mirror, r))
    } catch (err) {
      list.push({ mirror, status: 'fail', detail: err.message })
    }
  }
  return list
}

function parseProbeResult(mirror, r) {
  const line = String(r.stdout || '')
    .split('\n')
    .find((l) => l.startsWith('RESULT|'))
  if (!line) return { mirror, status: 'fail', detail: '探测无输出' }
  const [, status, detail] = line.split('|')
  return { mirror, status: status === 'ok' ? 'ok' : 'fail', detail: detail || '' }
}

// 由事实 + 期望配置生成检查报告
export function buildCheckReport(facts, config, mirrorProbes = [], reach = null) {
  const checks = []
  const add = (id, group, label, status, detail, extra = {}) =>
    checks.push({ id, group, label, status, detail, ...extra })

  const uid = num(facts.UID, 1)
  const sudo = facts.SUDO === 'yes'
  const memTotal = num(facts.MEM_TOTAL_MB)
  const diskAvailGb = num(facts.DISK_AVAIL_KB) / 1024 / 1024
  const swapTotal = num(facts.SWAP_TOTAL_MB)
  const targetSwap = resolveSwapMb(config, memTotal)

  // 初始化台账（提前解析，后面的公网探测判断是否已初始化）
  let record = null
  if (facts.INIT_RECORD === 'yes' && facts.INIT_RECORD_BODY) {
    try {
      record = JSON.parse(facts.INIT_RECORD_BODY)
    } catch {
      record = { unparsable: true }
    }
  }

  // 系统
  const isLinux = Boolean(facts.ARCH)
  add('system', '系统', '操作系统', isLinux ? 'ok' : 'fail',
    isLinux ? `${facts.OS_PRETTY || '未知发行版'} · ${facts.ARCH} · ${facts.KERNEL || ''}` : '无法识别系统')
  add('privilege', '系统', '提权能力', uid === 0 || sudo ? 'ok' : 'fail',
    uid === 0 ? '已是 root 用户' : sudo ? '可通过 sudo 免密提权' : '需要 root 或免密 sudo，否则无法安装软件')
  add('systemd', '系统', 'systemd / cgroup', facts.CGROUP ? 'ok' : 'warn',
    `cgroup 类型：${facts.CGROUP || '未知'}`)
  const tzOk = String(facts.TZ || '') === 'Asia/Shanghai'
  const ntpOk = String(facts.TZ_SYNC || '') === 'yes'
  add('time', '系统', '时区与 NTP', tzOk && ntpOk ? 'ok' : 'warn',
    `${facts.TZ || '未知时区'}（期望 Asia/Shanghai）· NTP ${ntpOk ? '已同步' : '未同步'}`)
  const missingTools = [['GIT', 'git'], ['CURL', 'curl']]
    .filter(([key]) => facts[`TOOL_${key}`] !== 'yes')
    .map(([, name]) => name)
  add('tools', '系统', '基础工具', missingTools.length ? 'warn' : 'ok',
    missingTools.length ? `缺少 ${missingTools.join('、')}，重新初始化可自动安装` : 'git / curl 已安装')
  add('cpu', '系统', 'CPU', num(facts.CPU) >= 1 ? 'ok' : 'fail', `${num(facts.CPU)} 核`)
  add('memory', '系统', '内存', memTotal >= 1024 ? (memTotal >= 2048 ? 'ok' : 'warn') : 'fail',
    `${memTotal} MB 总量 · ${num(facts.MEM_AVAIL_MB)} MB 可用`)
  add('disk', '系统', '磁盘', diskAvailGb >= 10 ? 'ok' : diskAvailGb >= 5 ? 'warn' : 'fail',
    `剩余 ${diskAvailGb.toFixed(1)} GB`)

  // swap
  const swapOk = targetSwap === 0 ? true : swapTotal > 0
  add('swap', '系统', 'Swap', swapOk ? 'ok' : 'warn',
    targetSwap === 0
      ? `按配置不需要 swap（内存 ${memTotal} MB）`
      : swapTotal > 0
        ? `已启用 ${swapTotal} MB，目标 ${targetSwap} MB`
        : `未启用，目标 ${targetSwap} MB`,
    { blocking: false })
  add('swappiness', '系统', 'vm.swappiness', num(facts.SWAPPINESS) === config.swappiness ? 'ok' : 'warn',
    `当前 ${facts.SWAPPINESS ?? '未知'}，期望 ${config.swappiness}`)

  // Docker
  const dockerInstalled = Boolean(facts.DOCKER_VERSION)
  const dockerRunning = facts.DOCKER_RUNNING === 'yes'
  add('docker', 'Docker', 'Docker Engine', dockerInstalled ? (dockerRunning ? 'ok' : 'warn') : 'fail',
    dockerInstalled ? (dockerRunning ? `${facts.DOCKER_VERSION} · 运行中` : `${facts.DOCKER_VERSION} · 未运行`) : '未安装')
  add('compose', 'Docker', 'Compose 插件', facts.COMPOSE_VERSION ? 'ok' : 'fail',
    facts.COMPOSE_VERSION || '未安装（docker compose 不可用）')
  add('buildx', 'Docker', 'Buildx', facts.BUILDX_VERSION ? 'ok' : 'warn',
    facts.BUILDX_VERSION || '未安装')

  const daemonMirrors = splitList(facts.DAEMON_JSON_MIRRORS)
  const desiredMirrors = config.dockerHubMirrors.map((m) => `https://${m}`)
  const mirrorsApplied = desiredMirrors.length === 0
    ? true
    : desiredMirrors.every((m) => daemonMirrors.some((d) => d.replace(/\/+$/, '') === m.replace(/\/+$/, '')))
  add('mirrors', 'Docker', '镜像加速', mirrorsApplied ? 'ok' : config.dockerHubMirrors.length ? 'warn' : 'ok',
    config.dockerHubMirrors.length
      ? `期望 ${desiredMirrors.join('、')}；当前 ${daemonMirrors.length ? daemonMirrors.join('、') : '未配置'}`
      : '未配置加速器，将直连 Docker Hub')

  const dnsDesired = config.advanced.containerDns
  const dnsCurrent = splitList(facts.DAEMON_JSON_DNS)
  const dnsOk = !dnsDesired || dnsDesired.every((d) => dnsCurrent.includes(d))
  add('dns', '网络', '容器 DNS', dnsOk ? 'ok' : 'warn',
    `当前 ${dnsCurrent.length ? dnsCurrent.join('、') : '未显式配置（可能继承回环 DNS 而失效）'}` +
      (dnsDesired ? `；期望 ${dnsDesired.join('、')}` : ''))

  const poolDesired = config.advanced.dockerAddressPool
  const pools = splitList(facts.DAEMON_JSON_POOLS)
  // 未显式配置时，只要实际网络子网不与宿主机网段冲突就算正常
  const hostPrefixes = splitList(facts.IP_ADDRS).map((c) => c.split('/')[0].split('.').slice(0, 2).join('.'))
  const activeSubnets = [facts.NET_PROXY, facts.NET_SHARED].filter(Boolean)
  const poolConflict =
    !poolDesired && pools.length === 0
      ? activeSubnets.some((s) => hostPrefixes.includes(s.split('/')[0].split('.').slice(0, 2).join('.')))
      : false
  const poolOk = poolDesired ? pools.some((p) => p === poolDesired) : !poolConflict
  add('pool', '网络', 'Docker 地址池', poolOk ? 'ok' : 'warn',
    `daemon.json ${pools.length ? pools.join('、') : '未设置（使用 Docker 默认）'}；` +
      `运行网络 ${activeSubnets.length ? activeSubnets.join('、') : '尚未创建'}` +
      (poolDesired ? `；期望 ${poolDesired}` : '') +
      (poolConflict ? '；⚠ 与宿主机网段重叠' : ''))

  // 镜像加速器实测
  if (mirrorProbes.length) {
    const okCount = mirrorProbes.filter((p) => p.status === 'ok').length
    add('mirror-probe', '网络', '镜像源实测', okCount ? 'ok' : 'fail',
      mirrorProbes.map((p) => `${p.mirror}：${p.status === 'ok' ? '可用' : `不可用（${p.detail}）`}`).join('；'),
      { blocking: !okCount })
  } else if (config.dockerHubMirrors.length === 0) {
    add('mirror-probe', '网络', '镜像源实测', 'warn', '未配置加速器，容器镜像将直连 Docker Hub（本机实测可能不通）')
  }

  // 端口：Traefik 自身占用 80/443 属预期，其他进程占用才算冲突
  const ownedByTraefik = /traefik|docker-proxy/.test(String(facts.PORT80_PROC || '')) &&
    String(facts.TRAEFIK_STATE || '').startsWith('running')
  add('port80', '网络', '80 端口', !facts.PORT80 || ownedByTraefik ? 'ok' : 'warn',
    !facts.PORT80
      ? '空闲'
      : ownedByTraefik
        ? '由 Traefik 监听（符合预期）'
        : `已被其他进程占用：${facts.PORT80_PROC || facts.PORT80}`)
  add('port443', '网络', '443 端口', !facts.PORT443 || ownedByTraefik ? 'ok' : 'warn',
    !facts.PORT443
      ? '空闲'
      : ownedByTraefik
        ? '由 Traefik 监听（符合预期）'
        : `已被其他进程占用：${facts.PORT443}`)

  // 公网可达性：从平台侧实测，能发现云安全组 / 外部防火墙只放行 22 的情况
  if (reach?.results?.length) {
    for (const r of reach.results) {
      const label = `公网 ${r.port} 端口`
      if (r.open) {
        add(`reach-${r.port}`, '网络', label, 'ok', `从平台侧可连通 ${reach.ip}:${r.port}`)
      } else {
        const hint = `请检查云厂商安全组 / 外部防火墙是否放行 TCP ${r.port}`
        add(
          `reach-${r.port}`,
          '网络',
          label,
          record ? 'fail' : 'warn',
          record
            ? `已初始化，但从平台侧无法连接 ${reach.ip}:${r.port}（${r.error}）。${hint}`
            : `从平台侧无法连接 ${reach.ip}:${r.port}（${r.error}）；尚未初始化时属正常，${hint}`,
          { blocking: false },
        )
      }
    }
  } else {
    add('reach', '网络', '公网可达性', 'warn', '未能获取服务器公网 IP，无法从外部验证 80/443 是否放行')
  }

  // 防火墙（当前仅检测，不改动）
  add('firewall', '安全', '防火墙', facts.UFW_STATUS === 'active' ? 'ok' : 'warn',
    `ufw：${facts.UFW_STATUS || '未知'} · firewalld：${facts.FIREWALLD || '未知'}`)

  // 平台骨架
  const dirs = [
    ['/srv/apps', facts.DIR__srv_apps],
    ['/srv/shared', facts.DIR__srv_shared],
    ['/srv/traefik', facts.DIR__srv_traefik],
    ['/srv/data', facts.DIR__srv_data],
  ]
  const missingDirs = dirs.filter(([, v]) => v !== 'yes').map(([d]) => d)
  add('dirs', '平台', '目录骨架', missingDirs.length === 0 ? 'ok' : 'warn',
    missingDirs.length ? `缺少 ${missingDirs.join('、')}` : '全部就绪')

  const nets = splitList(facts.NET_NAMES)
  const missingNets = ['proxy-net', 'shared-net'].filter((n) => !nets.includes(n))
  add('networks', '平台', 'Docker 网络', missingNets.length === 0 ? 'ok' : 'warn',
    missingNets.length ? `缺少 ${missingNets.join('、')}` : `${facts.NET_PROXY || ''} / ${facts.NET_SHARED || ''}`)

  const traefikState = String(facts.TRAEFIK_STATE || '')
  const [tState, tHealth] = traefikState.split('|')
  const traefikOk = tState === 'running' && (tHealth === 'healthy' || tHealth === 'none')
  add('traefik', '平台', 'Traefik', traefikOk ? 'ok' : tState ? 'warn' : 'warn',
    tState ? `容器 ${tState}${tHealth && tHealth !== 'none' ? ` · 健康 ${tHealth}` : ''}` : '未部署')

  const acmeOn = config.acme?.ca !== 'none'
  const redirectOn = /redirections\.entrypoint\.to=websecure/.test(String(facts.TRAEFIK_CMD || ''))
  if (!acmeOn) {
    add('redirect', '平台', 'HTTP → HTTPS', 'ok', '未启用 ACME，不强制跳转')
  } else {
    add('redirect', '平台', 'HTTP → HTTPS', redirectOn ? 'ok' : 'warn',
      redirectOn ? '已配置全站永久跳转到 HTTPS' : '未配置 HTTP → HTTPS 跳转，重新初始化后生效')
  }

  // ACME 证书
  const acmeEmail = String(config.acme?.email || '').trim()
  if (config.acme?.ca === 'none') {
    add('acme', '平台', 'ACME 证书', 'ok', '未启用（仅 HTTP 入口）')
  } else {
    add('acme', '平台', 'ACME 邮箱', acmeEmail ? 'ok' : 'warn',
      acmeEmail
        ? `已配置：${acmeEmail}（${config.acme.ca === 'letsencrypt-staging' ? 'LE 测试环境' : "Let's Encrypt"}）`
        : '已启用 ACME 但邮箱为空：证书仍可申请，但收不到到期提醒、账户无法找回')
  }

  // 初始化台账
  add('init-record', '平台', '初始化台账', record ? 'ok' : 'warn',
    record
      ? record.unparsable
        ? '台账文件存在但无法解析'
        : `版本 ${record.version || '未知'} · 完成于 ${record.finishedAt || '未知'}`
      : '尚未初始化')

  const groups = ['系统', 'Docker', '网络', '安全', '平台']
  const summary = {
    total: checks.length,
    ok: checks.filter((c) => c.status === 'ok').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  }
  const canProceed = checks.every((c) => c.status !== 'fail' || c.blocking === false)
  const upToDate = Boolean(record && !record.unparsable && record.configHash === configHash(config))

  return { checks, groups, summary, canProceed, initialized: Boolean(record), upToDate, record, facts }
}

export { COLLECT_SCRIPT }
