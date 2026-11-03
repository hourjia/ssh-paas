import { execScript, sftpWrite } from './ssh.js'
import { configHash, resolveSwapMb, resolveTraefikImage } from './config.js'
import { collectFacts, probeRegistryMirrors } from './check.js'
import { appendLog, updateStep, setJobState } from './jobs.js'

const INIT_DIR = '/srv/.ourjia'
const INIT_RECORD = `${INIT_DIR}/init.json`
const DAEMON_JSON = '/etc/docker/daemon.json'
const EVERYTHING_EXIT = 'OJ_EXIT:'

class StepError extends Error {
  constructor(message, detail) {
    super(message)
    this.detail = detail
  }
}

// 执行一段步骤脚本，实时转发输出；脚本末尾自带 OJ_EXIT 标记以回传退出码
async function runStep(job, conn, stepId, script, timeoutMs, title) {
  updateStep(job, stepId, { status: 'running', startedAt: new Date().toISOString() })
  job.currentStep = stepId
  if (title) echoScript(job, title, script)
  const result = await execScript(conn, wrapWithMarker(script), {
    timeoutMs,
    onStdout: (text) => forward(job, text, 'out'),
    onStderr: (text) => forward(job, text, 'err'),
  })
  const code = extractExitCode(result.stdout, result.code)
  updateStep(job, stepId, { status: code === 0 ? 'done' : 'failed', finishedAt: new Date().toISOString() })
  if (code !== 0) {
    const tail = tailOf(result.stderr || result.stdout)
    throw new StepError(`步骤执行失败（退出码 ${code}）`, tail)
  }
  return result
}

// 把要执行的脚本原样回显到日志，方便人工复制到终端复现/排障
function echoScript(job, title, script) {
  appendLog(job, `$ ${title}`, 'cmd')
  const body = String(script || '').trimEnd()
  if (!body) return
  for (const line of body.split('\n')) appendLog(job, `  ${line}`, 'cmd')
}

function wrapWithMarker(script) {
  return `set -o pipefail\n${script}\nOJ_RC=$?\necho "${EVERYTHING_EXIT}$OJ_RC"\nexit $OJ_RC\n`
}

function extractExitCode(stdout, fallback) {
  const text = String(stdout || '')
  const idx = text.lastIndexOf(EVERYTHING_EXIT)
  if (idx === -1) return fallback ?? 1
  const code = Number(text.slice(idx + EVERYTHING_EXIT.length).trim().split(/\s/)[0])
  return Number.isInteger(code) ? code : 1
}

let logCarry = new WeakMap()

function forward(job, text, stream) {
  const carry = logCarry.get(job) || ''
  const merged = carry + text
  const lines = merged.split('\n')
  logCarry.set(job, lines.pop() ?? '')
  for (const line of lines) {
    // 不把内部退出码标记暴露给用户
    if (line.startsWith(EVERYTHING_EXIT)) continue
    appendLog(job, line, stream)
  }
}

function flushCarry(job) {
  const carry = logCarry.get(job)
  if (carry && !carry.startsWith(EVERYTHING_EXIT)) appendLog(job, carry, 'out')
  logCarry.delete(job)
}

function tailOf(text, lines = 6) {
  return String(text || '')
    .trim()
    .split('\n')
    .slice(-lines)
    .join('\n')
}

// 生成 daemon.json：合并已有内容，只覆盖我们管理的键
function buildDaemonJson(existing, config, autoDns, autoPool) {
  const base = existing && typeof existing === 'object' ? { ...existing } : {}
  if (config.dockerHubMirrors.length) {
    base['registry-mirrors'] = config.dockerHubMirrors.map((m) => `https://${m}`)
  } else {
    delete base['registry-mirrors']
  }
  const dns = config.advanced.containerDns ?? autoDns
  if (dns && dns.length) base.dns = dns
  const pool = config.advanced.dockerAddressPool ?? autoPool
  if (pool) base['default-address-pools'] = [{ base: pool, size: 24 }]
  base['log-driver'] = base['log-driver'] || 'json-file'
  base['log-opts'] = { ...(base['log-opts'] || {}), 'max-size': '20m', 'max-file': '3' }
  base['live-restore'] = true
  return base
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

// 依据宿主机网卡（排除 docker 虚拟接口）挑选不冲突的 /16
function pickAddressPool(facts) {
  const used = new Set()
  for (const cidr of String(facts.IP_ADDRS || '').split(',')) {
    const ip = cidr.split('/')[0]
    if (!ip) continue
    used.add(ip.split('.').slice(0, 2).join('.'))
  }
  // 同步排除 Docker 已创建网络占用的网段
  for (const cidr of String(facts.NET_PROXY || '').split(',')) {
    const ip = cidr.split('/')[0]
    if (ip) used.add(ip.split('.').slice(0, 2).join('.'))
  }
  const candidates = ['10.201', '10.202', '10.203', '10.204', '10.205']
  for (const prefix of candidates) {
    if (!used.has(prefix)) return `${prefix}.0.0/16`
  }
  return '10.250.0.0/16'
}

function autoContainerDns(facts) {
  const upstream = String(facts.DNS_UPSTREAM || '')
    .split(',')
    .map((s) => s.trim())
    .filter((ip) => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && !ip.startsWith('127.'))
  if (upstream.length) return upstream.slice(0, 3)
  return ['223.5.5.5', '119.29.29.29']
}

export function planSteps(config) {
  const steps = [
    { id: 'preflight', title: '预检' },
    { id: 'system', title: '基础工具与系统调优（git/curl、时区/NTP、swap）' },
    { id: 'docker', title: '安装 Docker / Compose / Buildx' },
    { id: 'docker-config', title: '配置 Docker（daemon.json）' },
    { id: 'skeleton', title: '创建目录骨架与网络' },
    { id: 'traefik', title: '部署 Traefik' },
    { id: 'record', title: '写入初始化台账' },
  ]
  if (config.acme.ca === 'none') steps.splice(5, 1, { id: 'traefik', title: '部署 Traefik（不启用 ACME）' })
  return steps
}

export async function runInit(job, conn, server, config) {
  setJobState(job, 'running')
  try {
    // 1. 预检：重新采集事实并实测镜像源
    updateStep(job, 'preflight', { status: 'running', startedAt: new Date().toISOString() })
    job.currentStep = 'preflight'
    appendLog(job, '采集服务器事实…', 'note')
    const facts = await collectFacts(conn)
    const memTotal = Number(facts.MEM_TOTAL_MB) || 0
    appendLog(job, `系统 ${facts.OS_PRETTY || '?'} · ${facts.ARCH} · 内存 ${memTotal}MB`, 'note')

    const uid = Number(facts.UID)
    if (uid !== 0 && facts.SUDO !== 'yes') {
      throw new StepError('需要 root 或免密 sudo 才能初始化', '当前用户权限不足')
    }
    // 端口冲突检查：Traefik 自身占用的 80/443 不算冲突（支持重复执行）
    const traefikOwnsPorts =
      /traefik|docker-proxy/.test(String(facts.PORT80_PROC || '')) &&
      String(facts.TRAEFIK_STATE || '').startsWith('running')
    for (const port of ['PORT80', 'PORT443']) {
      if (facts[port] && !traefikOwnsPorts) {
        const label = port === 'PORT80' ? '80' : '443'
        throw new StepError(`${label} 端口已被其他进程占用，无法部署 Traefik`,
          facts.PORT80_PROC || facts[port])
      }
    }

    const image = resolveTraefikImage(config)
    if (config.acme.ca !== 'none' && !String(config.acme.email || '').trim()) {
      appendLog(job, '⚠ 已启用 ACME 但未填写邮箱：证书仍可申请，但收不到到期提醒、账户无法找回；可在「配置」中补充。', 'note')
    }
    let mirrorProbes = []
    if (config.dockerHubMirrors.length) {
      appendLog(job, `实测镜像加速器（目标镜像 ${image}）…`, 'note')
      mirrorProbes = await probeRegistryMirrors(conn, config.dockerHubMirrors, image)
      for (const p of mirrorProbes) {
        appendLog(job, `  ${p.mirror}: ${p.status === 'ok' ? '可用' : `不可用 - ${p.detail}`}`, p.status === 'ok' ? 'note' : 'err')
      }
      if (!mirrorProbes.some((p) => p.status === 'ok')) {
        throw new StepError('所有镜像加速器均不可用，无法拉取镜像', '请更换加速地址后重试')
      }
    }
    updateStep(job, 'preflight', { status: 'done', finishedAt: new Date().toISOString() })
    flushCarry(job)

    // 2. 基础工具 + 时区/NTP + 系统调优
    const swapMb = resolveSwapMb(config, memTotal)
    const systemScript = buildSystemScript(swapMb, config.swappiness)
    await runStep(job, conn, 'system', systemScript, 300000, '安装基础工具、配置时区/NTP 与 swap')
    flushCarry(job)

    // 3. Docker
    const dockerScript = buildDockerScript(config)
    await runStep(job, conn, 'docker', dockerScript, 900000, '安装 Docker / Compose / Buildx')
    flushCarry(job)

    // 写 daemon.json：先校验再原子替换，配置没变就不写、不重启
    updateStep(job, 'docker-config', { status: 'running', startedAt: new Date().toISOString() })
    job.currentStep = 'docker-config'
    appendLog(job, '$ 读取并合并 /etc/docker/daemon.json', 'cmd')
    const existingRaw = await execScript(conn, 'cat /etc/docker/daemon.json 2>/dev/null || true', { timeoutMs: 15000 })
    const existingText = String(existingRaw.stdout || '').trim()
    let existing = {}
    if (existingText) {
      const parsed = safeJsonParse(existingText, undefined)
      if (parsed === undefined) {
        throw new StepError(
          '/etc/docker/daemon.json 不是合法 JSON，初始化已停止',
          '为避免覆盖你现有的配置，未写入任何内容。请先修复或备份后移走该文件，再重试。',
        )
      }
      existing = parsed && typeof parsed === 'object' ? parsed : {}
    }
    const desired = buildDaemonJson(existing, config, autoContainerDns(facts), pickAddressPool(facts))
    const daemonText = JSON.stringify(desired, null, 2) + '\n'
    const daemonUnchanged = existingText !== '' && JSON.stringify(existing) === JSON.stringify(desired)

    if (daemonUnchanged) {
      appendLog(job, 'daemon.json 已符合期望配置，跳过写入与 Docker 重启', 'note')
      updateStep(job, 'docker-config', { status: 'done', finishedAt: new Date().toISOString() })
    } else {
      const backupScript = [
        `mkdir -p /etc/docker`,
        `if [ -f ${DAEMON_JSON} ]; then cp ${DAEMON_JSON} ${DAEMON_JSON}.bak.$(date +%s); fi`,
      ].join('\n')
      echoScript(job, '备份现有 daemon.json', backupScript)
      await execScript(conn, backupScript, { timeoutMs: 15000 })

      await sftpWrite(conn, `${DAEMON_JSON}.ourjia.tmp`, daemonText, 0o644)

      const validateScript = [
        `TMP=${DAEMON_JSON}.ourjia.tmp`,
        'if command -v dockerd >/dev/null 2>&1; then',
        '  if dockerd --validate --config-file="$TMP" >/tmp/ourjia-dockerd-validate.log 2>&1; then',
        '    echo "daemon.json 校验通过"',
        '  elif grep -q "flag provided but not defined" /tmp/ourjia-dockerd-validate.log; then',
        '    echo "当前 dockerd 不支持 --validate，跳过校验"',
        '  else',
        '    echo "daemon.json 校验失败："',
        '    cat /tmp/ourjia-dockerd-validate.log',
        '    exit 1',
        '  fi',
        'fi',
      ].join('\n')
      echoScript(job, '校验 daemon.json（dockerd --validate）', validateScript)
      const validate = await execScript(conn, validateScript, {
        timeoutMs: 30000,
        onStdout: (t) => forward(job, t, 'out'),
        onStderr: (t) => forward(job, t, 'err'),
      })
      if (validate.code !== 0) {
        await execScript(conn, `rm -f ${DAEMON_JSON}.ourjia.tmp`, { timeoutMs: 10000 })
        throw new StepError('daemon.json 校验失败，已保留原配置', tailOf(validate.stdout || validate.stderr))
      }

      await execScript(conn, `mv -f ${DAEMON_JSON}.ourjia.tmp ${DAEMON_JSON} && chmod 644 ${DAEMON_JSON}`, {
        timeoutMs: 15000,
      })
      appendLog(job, `$ cat ${DAEMON_JSON}`, 'cmd')
      for (const line of daemonText.trimEnd().split('\n')) appendLog(job, `  ${line}`, 'out')
      appendLog(job, 'daemon.json 已写入（原文件已备份为 daemon.json.bak.<时间戳>）', 'note')

      const reloadScript = [
        'systemctl enable docker',
        'systemctl restart docker',
        'for i in $(seq 1 30); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done',
        'exit 1',
      ].join('\n')
      echoScript(job, '重启 Docker 使配置生效', reloadScript)
      const reload = await execScript(
        conn,
        `set -e\n${reloadScript}\n`,
        { timeoutMs: 120000, onStdout: (t) => forward(job, t, 'out'), onStderr: (t) => forward(job, t, 'err') },
      )
      if (reload.code !== 0) {
        appendLog(job, 'Docker 未能使用新配置启动，回滚 daemon.json…', 'err')
        const rollbackScript = [
          `LATEST=$(ls -t ${DAEMON_JSON}.bak.* 2>/dev/null | head -1)`,
          `if [ -n "$LATEST" ]; then cp "$LATEST" ${DAEMON_JSON}; else rm -f ${DAEMON_JSON}; fi`,
          'systemctl restart docker',
          'for i in $(seq 1 30); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done',
          'exit 1',
        ].join('\n')
        echoScript(job, '回滚 daemon.json 并重启 Docker', rollbackScript)
        const rollback = await execScript(conn, rollbackScript, {
          timeoutMs: 120000,
          onStdout: (t) => forward(job, t, 'out'),
          onStderr: (t) => forward(job, t, 'err'),
        })
        throw new StepError(
          'Docker 重启后无法就绪，已回滚 daemon.json',
          rollback.code === 0
            ? '已恢复到上一份 daemon.json。请检查镜像加速地址或地址池是否可用后重试。'
            : tailOf(reload.stderr || reload.stdout),
        )
      }
      appendLog(job, 'Docker 已重启并应用新配置', 'note')
      // 备份只保留最近 5 份
      await execScript(conn, `ls -t ${DAEMON_JSON}.bak.* 2>/dev/null | tail -n +6 | xargs -r rm -f`, {
        timeoutMs: 10000,
      })
      updateStep(job, 'docker-config', { status: 'done', finishedAt: new Date().toISOString() })
      flushCarry(job)
    }

    // 4. 骨架
    const pool = config.advanced.dockerAddressPool ?? pickAddressPool(facts)
    const skeletonScript = buildSkeletonScript(pool)
    await runStep(job, conn, 'skeleton', skeletonScript, 120000, '创建目录骨架与 Docker 网络')
    flushCarry(job)

    // 5. Traefik：先用 SFTP 落地配置文件，再执行部署脚本
    const idBase = server.id
    const composeYaml = buildTraefikCompose(config)
    const envFile = buildTraefikEnv(config, idBase)
    appendLog(job, '$ mkdir -p /srv/traefik/logs && chmod 700 /srv/traefik', 'cmd')
    await execScript(conn, 'mkdir -p /srv/traefik/logs && chmod 700 /srv/traefik', { timeoutMs: 15000 })

    // 宿主机上的 access.log 不受 daemon.json 的容器日志限制，需要单独的 logrotate
    const logrotateConf = [
      '/srv/traefik/logs/*.log {',
      '  daily',
      '  rotate 14',
      '  missingok',
      '  notifempty',
      '  compress',
      '  delaycompress',
      '  copytruncate',
      '}',
      '',
    ].join('\n')
    appendLog(job, '$ cat /etc/logrotate.d/traefik', 'cmd')
    for (const line of logrotateConf.trimEnd().split('\n')) appendLog(job, `  ${line}`, 'out')
    await execScript(conn, 'mkdir -p /etc/logrotate.d', { timeoutMs: 15000 })
    await sftpWrite(conn, '/etc/logrotate.d/traefik', logrotateConf, 0o644)
    appendLog(job, '已写入 Traefik 访问日志轮转配置（每日，保留 14 份，copytruncate）', 'note')

    await sftpWrite(conn, '/srv/traefik/docker-compose.yml', composeYaml, 0o644)
    await sftpWrite(conn, '/srv/traefik/.env', envFile, 0o600)
    appendLog(job, '$ cat /srv/traefik/docker-compose.yml', 'cmd')
    for (const line of composeYaml.trimEnd().split('\n')) appendLog(job, `  ${line}`, 'out')
    appendLog(job, '$ cat /srv/traefik/.env', 'cmd')
    for (const line of envFile.trimEnd().split('\n')) appendLog(job, `  ${line}`, 'out')
    const traefikScript = buildTraefikScript(config, image)
    await runStep(job, conn, 'traefik', traefikScript, 900000, '拉取镜像并启动 Traefik')
    flushCarry(job)

    // 6. 台账
    const record = {
      version: 1,
      serverId: server.id,
      configHash: configHash(config),
      config,
      finishedAt: new Date().toISOString(),
      image,
      swapMb,
      addressPool: pool,
    }
    await execScript(conn, `mkdir -p ${INIT_DIR}`, { timeoutMs: 15000 })
    await sftpWrite(conn, INIT_RECORD, JSON.stringify(record, null, 2) + '\n', 0o600)
    updateStep(job, 'record', { status: 'done', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() })
    appendLog(job, `初始化台账已写入 ${INIT_RECORD}`, 'note')

    setJobState(job, 'done')
    return { ok: true, record }
  } catch (err) {
    const stepId = job.currentStep
    const failedStepTitle = job.steps.find((s) => s.id === stepId)?.title
    if (stepId) {
      const step = job.steps.find((s) => s.id === stepId)
      if (step && step.status === 'running') {
        updateStep(job, stepId, {
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error: err.detail || err.message,
        })
      }
    }
    appendLog(job, '', 'out')
    appendLog(job, `✗ 初始化失败于「${failedStepTitle || '未知步骤'}」：${err.message}`, 'err')
    if (err.detail) {
      appendLog(job, '错误输出：', 'err')
      for (const line of String(err.detail).split('\n')) appendLog(job, `  ${line}`, 'err')
    }
    appendLog(job, '', 'out')
    appendLog(job, '─'.repeat(60), 'note')
    appendLog(job, '排查建议', 'note')
    appendLog(job, '─'.repeat(60), 'note')
    for (const tip of troubleshootingTips(stepId, server, err)) appendLog(job, `• ${tip}`, 'note')
    appendLog(job, '• 可直接在服务器终端执行上面回显的命令，复现并手工处理该步骤。', 'note')
    appendLog(job, '• 处理完成后回到本页再次点击「重新初始化」，已完成的步骤会跳过。', 'note')
    flushCarry(job)
    setJobState(job, 'failed', err.message)
    return { ok: false, error: err.message }
  }
}

function troubleshootingTips(stepId, server, err) {
  const both = [`ssh -p ${server.port} ${server.user}@${server.host}`, `ssh -p ${server.port} ${server.user}@${server.host} 'tail -n 50 /var/log/syslog'`]
  const msg = String(err?.message || '')
  if (stepId === 'preflight') {
    return [
      '预检未通过时不会修改服务器任何配置，可放心修正后重试。',
      `手工检查端口占用：ssh -p ${server.port} ${server.user}@${server.host} 'ss -ltnp | grep -E ":80|:443"'`,
      msg.includes('镜像')
        ? '所有镜像加速器都不可用时，请在「配置」里更换地址（可先用 docker.m.daocloud.io）。'
        : '如需以非 root 用户执行，请确认已配置免密 sudo（sudo -n true）。',
    ]
  }
  if (stepId === 'system') {
    return [
      'swap 相关操作可在服务器上手工确认：swapon --show; cat /proc/sys/vm/swappiness',
      '若 swapfile 已被占用且大小不符，脚本会保留现状以避免破坏正在使用的 swap。',
      `时区与 NTP：ssh -p ${server.port} ${server.user}@${server.host} 'timedatectl status'`,
      '基础工具安装失败通常是 apt 源或锁冲突，可稍后重试或手工安装 git / curl。',
    ]
  }
  if (stepId === 'docker') {
    return [
      'apt 锁冲突常见于 unattended-upgrades，可稍等后重试，或手工执行：sudo systemctl stop unattended-upgrades',
      `手工安装命令：ssh -p ${server.port} ${server.user}@${server.host} 'sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 docker-buildx'`,
      '若系统源不可用，可在配置中把「Docker 安装源」改为官方源。',
    ]
  }
  if (stepId === 'docker-config') {
    return [
      '校验失败时服务器上的配置不会被修改；请检查镜像加速地址与地址池格式。',
      `手工查看：ssh -p ${server.port} ${server.user}@${server.host} 'cat /etc/docker/daemon.json'`,
      `若原文件不是合法 JSON，可备份后移走：ssh -p ${server.port} ${server.user}@${server.host} 'sudo mv /etc/docker/daemon.json /etc/docker/daemon.json.bad'`,
      'Docker 重启失败时会自动回滚到 /etc/docker/daemon.json.bak.* 中最近的一份。',
    ]
  }
  if (stepId === 'skeleton') {
    return [
      '目录或网络已存在会跳过，属于正常情况。',
      `手工查看：ssh -p ${server.port} ${server.user}@${server.host} 'ls -la /srv && docker network ls'`,
    ]
  }
  if (stepId === 'traefik') {
    return [
      `查看容器日志：ssh -p ${server.port} ${server.user}@${server.host} 'docker logs --tail 100 traefik'`,
      `确认配置：ssh -p ${server.port} ${server.user}@${server.host} 'cat /srv/traefik/docker-compose.yml'`,
      `重新拉起：ssh -p ${server.port} ${server.user}@${server.host} 'cd /srv/traefik && docker compose up -d'`,
      '若镜像拉取失败，请确认加速器可用，或先在服务器上手工 docker pull traefik:v3.6 验证。',
    ]
  }
  return [`登录服务器确认状态：${both[0]}`]
}

function buildSystemScript(swapMb, swappiness, timezone = 'Asia/Shanghai') {
  const lines = [
    'set -e',
    'export DEBIAN_FRONTEND=noninteractive',
    'APT="apt-get -o DPkg::Lock::Timeout=300 -o Acquire::Retries=3"',
    '',
    '# 基础工具：方案要求 git / curl，后续交付链路依赖',
    'if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then',
    '  echo "安装基础工具 git / curl…"',
    '  if $APT update -qq && $APT install -y git curl ca-certificates; then',
    '    echo "基础工具安装完成"',
    '  else',
    '    echo "警告：基础工具安装失败，后续步骤可能依赖 git / curl"',
    '  fi',
    'else',
    '  echo "git / curl 已安装，跳过"',
    'fi',
    '',
    '# 时区与 NTP',
    `TZ_TARGET=${timezone}`,
    'if command -v timedatectl >/dev/null 2>&1; then',
    '  cur=$(timedatectl show -p Timezone --value 2>/dev/null || true)',
    '  if [ "$cur" != "$TZ_TARGET" ]; then',
    '    timedatectl set-timezone "$TZ_TARGET" 2>/dev/null || echo "警告：设置时区失败"',
    '  fi',
    '  timedatectl set-ntp true 2>/dev/null || echo "警告：启用 NTP 同步失败"',
    '  systemctl enable --now systemd-timesyncd >/dev/null 2>&1 || true',
    '  echo "时区 $(timedatectl show -p Timezone --value 2>/dev/null)，NTP 同步 $(timedatectl show -p NTPSynchronized --value 2>/dev/null)"',
    'else',
    `  ln -sf "/usr/share/zoneinfo/${timezone}" /etc/localtime 2>/dev/null || true`,
    '  echo "无 timedatectl，已通过 /etc/localtime 设置时区"',
    'fi',
    '',
    '# swap',
    `TARGET_MB=${swapMb}`,
    'CUR_MB=$(awk \'/SwapTotal/{printf "%d", $2/1024}\' /proc/meminfo)',
    'if [ "$TARGET_MB" -gt 0 ]; then',
    '  if [ "$CUR_MB" -ge "$TARGET_MB" ]; then',
    '    echo "swap 已满足（当前 ${CUR_MB}MB ≥ 目标 ${TARGET_MB}MB），跳过"',
    '  elif [ -f /swapfile ] && swapon --show=NAME --noheadings 2>/dev/null | grep -q "^/swapfile$"; then',
    '    echo "swapfile 已启用但小于目标（${CUR_MB}MB < ${TARGET_MB}MB），保持现状以避免破坏正在使用的 swap"',
    '  else',
    '    echo "创建 ${TARGET_MB}MB swapfile…"',
    '    if [ -f /swapfile ]; then',
    '      swapon --show=NAME --noheadings 2>/dev/null | grep -q "^/swapfile$" && swapoff /swapfile || true',
    '    fi',
    '    fallocate -l "${TARGET_MB}M" /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count="$TARGET_MB" status=none',
    '    chmod 600 /swapfile',
    '    mkswap /swapfile >/dev/null',
    '    swapon /swapfile',
    '  fi',
    '  grep -q "^/swapfile " /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab',
    'else',
    '  echo "按配置不创建 swap"',
    'fi',
    `echo 'vm.swappiness = ${swappiness}' > /etc/sysctl.d/99-ourjia.conf`,
    `sysctl -w vm.swappiness=${swappiness} >/dev/null`,
    'echo "swap: $(awk \'/SwapTotal/{printf "%d", $2/1024}\' /proc/meminfo)MB, swappiness=$(cat /proc/sys/vm/swappiness)"',
  ]
  return lines.join('\n')
}

function buildDockerScript(config) {
  const source = config.dockerInstallSource
  const lines = [
    'set -e',
    'export DEBIAN_FRONTEND=noninteractive',
    'APT="apt-get -o DPkg::Lock::Timeout=300 -o Acquire::Retries=3"',
    'if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then',
    '  echo "Docker 与 Compose 已安装，跳过安装"',
    'else',
    '  echo "更新 apt 索引…"',
    '  $APT update -qq',
  ]
  if (config.aptMirror) {
    lines.push(
      '  echo "按配置切换 apt 源到 ' + config.aptMirror + '"',
      `  if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then`,
      `    cp -n /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/ubuntu.sources.ourjia.bak 2>/dev/null || true`,
      `    sed -i 's#^URIs:.*#URIs: ${config.aptMirror}#' /etc/apt/sources.list.d/ubuntu.sources`,
      '  fi',
      '  $APT update -qq',
    )
  }
  if (source === 'official') {
    lines.push(
      '  echo "使用 Docker 官方源安装"',
      '  $APT install -y ca-certificates curl gnupg',
      '  install -m 0755 -d /etc/apt/keyrings',
      '  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc',
      '  chmod a+r /etc/apt/keyrings/docker.asc',
      `  . /etc/os-release`,
      '  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list',
      '  $APT update -qq',
      '  $APT install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin',
    )
  } else {
    // auto/system：优先系统源，失败才回退官方源
    lines.push('  echo "使用系统源安装 Docker…"')
    lines.push('  if $APT install -y docker.io docker-compose-v2 docker-buildx; then')
    lines.push('    echo "系统源安装完成"')
    lines.push('  else')
    lines.push('    echo "系统源失败，回退官方源…"')
    lines.push('    $APT install -y ca-certificates curl gnupg')
    lines.push('    install -m 0755 -d /etc/apt/keyrings')
    lines.push('    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc')
    lines.push('    chmod a+r /etc/apt/keyrings/docker.asc')
    lines.push('    . /etc/os-release')
    lines.push('    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list')
    lines.push('    $APT update -qq')
    lines.push('    $APT install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin')
    lines.push('  fi')
  }
  lines.push(
    'fi',
    'systemctl enable docker >/dev/null 2>&1 || true',
    'systemctl start docker',
    'docker --version',
    'docker compose version 2>/dev/null || true',
  )
  return lines.join('\n')
}

function buildSkeletonScript(pool) {
  return [
    'set -e',
    'mkdir -p /srv/apps /srv/shared /srv/traefik /srv/data /srv/.ourjia',
    'chmod 755 /srv/apps /srv/shared /srv/traefik /srv/data',
    'if ! docker network inspect proxy-net >/dev/null 2>&1; then',
    `  docker network create --driver bridge --subnet ${replacePool(pool, 0)} proxy-net`,
    'else',
    '  echo "proxy-net 已存在"',
    'fi',
    'if ! docker network inspect shared-net >/dev/null 2>&1; then',
    `  docker network create --driver bridge --subnet ${replacePool(pool, 1)} shared-net`,
    'else',
    '  echo "shared-net 已存在"',
    'fi',
    'for n in proxy-net shared-net; do',
    '  subnet=$(docker network inspect "$n" -f "{{range .IPAM.Config}}{{.Subnet}}{{end}}" 2>/dev/null || true)',
    '  echo "$n|$subnet"',
    'done',
  ].join('\n')
}

function replacePool(pool, offset) {
  const [base] = pool.split('/')
  const parts = base.split('.')
  return `${parts[0]}.${parts[1]}.${Number(parts[2]) + offset}.0/24`
}

function buildTraefikCompose(config) {
  const acme = config.acme
  const acmeArgs = []
  if (acme.ca !== 'none') {
    acmeArgs.push('--certificatesresolvers.le.acme.email=${ACME_EMAIL}')
    acmeArgs.push('--certificatesresolvers.le.acme.storage=/acme/acme.json')
    acmeArgs.push('--certificatesresolvers.le.acme.httpchallenge=true')
    acmeArgs.push('--certificatesresolvers.le.acme.httpchallenge.entrypoint=web')
    if (acme.ca === 'letsencrypt-staging') {
      acmeArgs.push('--certificatesresolvers.le.acme.caserver=https://acme-staging-v02.api.letsencrypt.org/directory')
    }
  }
  const commands = [
    '--api.dashboard=false',
    '--ping=true',
    '--log.level=INFO',
    '--accesslog=true',
    '--accesslog.filepath=/logs/access.log',
    '--providers.docker=true',
    '--providers.docker.exposedbydefault=false',
    '--providers.docker.network=proxy-net',
    '--entrypoints.web.address=:80',
    '--entrypoints.websecure.address=:443',
    // 启用 ACME 时全站 HTTP → HTTPS；Traefik 的 ACME 校验路由优先级更高，不受跳转影响
    ...(acme.ca !== 'none'
      ? [
          '--entrypoints.web.http.redirections.entrypoint.to=websecure',
          '--entrypoints.web.http.redirections.entrypoint.scheme=https',
          '--entrypoints.web.http.redirections.entrypoint.permanent=true',
        ]
      : []),
    ...acmeArgs,
  ]
  return [
    'services:',
    '  traefik:',
    `    image: ${resolveTraefikImage(config)}`,
    '    container_name: traefik',
    '    restart: unless-stopped',
    '    ports:',
    '      - "80:80"',
    '      - "443:443"',
    '    volumes:',
    '      - /var/run/docker.sock:/var/run/docker.sock:ro',
    '      - /srv/traefik/acme.json:/acme/acme.json',
    '      - /srv/traefik/logs:/logs',
    '    env_file:',
    '      - .env',
    '    command:',
    ...commands.map((c) => `      - "${c}"`),
    '    networks:',
    '      - proxy-net',
    '    healthcheck:',
    '      test: ["CMD", "traefik", "healthcheck", "--ping"]',
    '      interval: 30s',
    '      timeout: 5s',
    '      retries: 3',
    '      start_period: 20s',
    '',
    'networks:',
    '  proxy-net:',
    '    external: true',
    '',
  ].join('\n')
}

function buildTraefikEnv(config, serverId) {
  return [
    `TRAEFIK_IMAGE=${resolveTraefikImage(config)}`,
    `ACME_EMAIL=${config.acme.email || ''}`,
    `SERVER_ID=${serverId}`,
    '',
  ].join('\n')
}

function buildTraefikScript(config, image) {
  return [
    'set -e',
    'cd /srv/traefik',
    'if [ ! -s acme.json ]; then',
    '  touch acme.json',
    'fi',
    'chmod 600 acme.json',
    'mkdir -p logs',
    'test -s docker-compose.yml || { echo "缺少 docker-compose.yml"; exit 1; }',
    '# 拉取镜像：带重试，避免镜像源抖动导致长时间卡住',
    `echo "拉取镜像 ${image}…"`,
    `for i in 1 2 3; do`,
    `  if docker pull "${image}" 2>&1; then break; fi`,
    `  echo "第 $i 次拉取失败，10 秒后重试…"`,
    '  sleep 10',
    '  if [ "$i" = "3" ]; then echo "镜像拉取连续失败"; exit 1; fi',
    'done',
    'docker compose up -d --remove-orphans 2>&1',
    'echo "等待 Traefik 就绪…"',
    'for i in $(seq 1 40); do',
    '  state=$(docker inspect -f "{{.State.Status}}" traefik 2>/dev/null || echo missing)',
    '  health=$(docker inspect -f "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}" traefik 2>/dev/null || echo none)',
    '  if [ "$state" = "running" ] && [ "$health" != "unhealthy" ]; then',
    '    echo "Traefik 容器状态：$state (health: $health)"',
    '    break',
    '  fi',
    '  if [ "$i" = "40" ]; then echo "Traefik 未能就绪：$state/$health"; docker logs --tail 40 traefik 2>&1 || true; exit 1; fi',
    '  sleep 2',
    'done',
    'echo "检查本地 80 端口路由…"',
    'code=$(curl -s -o /dev/null -w \'%{http_code}\' -m 8 http://127.0.0.1/ || echo 000)',
    'echo "本机 HTTP 状态：$code"',
    'case "$code" in',
    '  404) echo "入口已监听（无匹配路由，符合预期）";;',
    '  301|302|307|308) echo "入口已监听（按配置跳转 HTTPS，符合预期）";;',
    '  000) echo "警告：本机 80 端口无响应";;',
    '  *) echo "本机 80 返回 $code";;',
    'esac',
    'docker compose ps 2>&1',
  ].join('\n')
}

// 供单测/诊断复用（不参与运行时导入）
export { buildSystemScript, buildTraefikCompose }
