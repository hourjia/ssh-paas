import https from 'node:https'
import { execScript, sftpWrite } from './ssh.js'
import { appendLog, updateStep, setJobState } from './jobs.js'
import { runStep, flushCarry } from './step-runner.js'
import { appPaths, readEnv, saveApps } from './apps.js'

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms))

export function planDeploySteps(app) {
  if (app?.kind === 'service') {
    return [
      { id: 'config', title: '生成并上传服务配置' },
      { id: 'pull', title: '拉取镜像' },
      { id: 'deploy', title: '启动共享服务' },
    ]
  }
  return [
    { id: 'config', title: '生成并上传部署配置' },
    { id: 'pull', title: '拉取镜像' },
    { id: 'deploy', title: '启动容器' },
    { id: 'health', title: '健康检查' },
  ]
}

function labelLines(app) {
  const id = app.id
  const port = app.runtime?.port || 80
  return [
    '    labels:',
    '      - "traefik.enable=true"',
    '      - "traefik.docker.network=proxy-net"',
    `      - "traefik.http.routers.${id}.rule=Host(\`${app.domain}\`)"`,
    `      - "traefik.http.routers.${id}.entrypoints=websecure"`,
    `      - "traefik.http.routers.${id}.tls=true"`,
    `      - "traefik.http.routers.${id}.tls.certresolver=le"`,
    `      - "traefik.http.services.${id}.loadbalancer.server.port=${port}"`,
    `      - "deploy.app=${id}"`,
    `      - "deploy.image=${app.image || ''}"`,
  ]
}

function networkLines() {
  return [
    '    networks:',
    '      - proxy-net',
    '      - shared-net',
    'networks:',
    '  proxy-net:',
    '    external: true',
    '  shared-net:',
    '    external: true',
    '',
  ]
}

function envLines(env) {
  const keys = Object.keys(env)
  if (!keys.length) return []
  const lines = ['    environment:']
  for (const key of keys) {
    // Compose 会对 $ 做变量插值，先转义成 $$
    const value = String(env[key]).replace(/\$/g, '$$$$')
    lines.push(`      ${key}: ${JSON.stringify(value)}`)
  }
  return lines
}

function buildImageCompose(app, env) {
  return [
    'services:',
    '  app:',
    `    image: ${JSON.stringify(app.image)}`,
    `    container_name: ourjia_${app.id}`,
    '    restart: unless-stopped',
    ...labelLines(app),
    ...envLines(env),
    ...networkLines(),
  ].join('\n')
}

function buildServiceCompose(app, env) {
  const { alias, containerPath, dataDir, healthCmd } = app.service
  const lines = [
    'services:',
    '  app:',
    `    image: ${JSON.stringify(app.image)}`,
    `    container_name: ourjia_${app.id}`,
    '    restart: unless-stopped',
    ...envLines(env),
    '    volumes:',
    `      - ${JSON.stringify(`${dataDir}:${containerPath}`)}`,
  ]
  if (alias) {
    lines.push('    networks:', '      shared-net:', '        aliases:', `          - ${alias}`)
  } else {
    lines.push('    networks:', '      - shared-net')
  }
  if (healthCmd) {
    lines.push(
      '    healthcheck:',
      `      test: ["CMD-SHELL", ${JSON.stringify(healthCmd)}]`,
      '      interval: 10s',
      '      timeout: 5s',
      '      retries: 10',
      '      start_period: 30s',
    )
  }
  lines.push('', 'networks:', '  shared-net:', '    external: true', '')
  return lines.join('\n')
}

function buildPullScript(app) {
  const { dir } = appPaths(app)
  return ['set -e', `cd ${dir}`, 'docker compose pull'].join('\n')
}

function buildImageUpScript(app) {
  const { dir } = appPaths(app)
  return [
    'set -e',
    `cd ${dir}`,
    'docker compose up -d --remove-orphans',
    'docker compose ps',
    'cid=$(docker compose ps -q app)',
    'state=missing',
    'for i in $(seq 1 60); do',
    '  state=$(docker inspect -f "{{.State.Status}}" "$cid" 2>/dev/null || echo missing)',
    '  if [ "$state" = "running" ]; then break; fi',
    '  sleep 2',
    '  if [ "$i" = "60" ]; then',
    '    echo "容器未能启动（状态 $state）"',
    '    docker compose logs --tail 40 || true',
    '    exit 1',
    '  fi',
    'done',
    'echo "容器状态：$state"',
  ].join('\n')
}

function buildServiceUpScript(app) {
  const { dir } = appPaths(app)
  const { dataDir, dataOwner } = app.service
  return [
    'set -e',
    `mkdir -p ${dataDir}`,
    `chmod 700 ${dataDir}`,
    dataOwner
      ? [
          `OWNER=${dataOwner}`,
          `if [ -z "$(ls -A ${dataDir})" ]; then chown -R "$OWNER" ${dataDir}; fi`,
        ].join('\n')
      : '',
    `cd ${dir}`,
    'docker compose up -d --remove-orphans',
    'docker compose ps',
    'cid=$(docker compose ps -q app)',
    'state=missing',
    'health=none',
    'for i in $(seq 1 90); do',
    '  state=$(docker inspect -f "{{.State.Status}}" "$cid" 2>/dev/null || echo missing)',
    '  health=$(docker inspect -f "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}" "$cid" 2>/dev/null || echo none)',
    '  if [ "$state" = "running" ] && { [ "$health" = "healthy" ] || [ "$health" = "none" ]; }; then break; fi',
    '  sleep 2',
    '  if [ "$i" = "90" ]; then',
    '    echo "服务未就绪（state=$state health=$health）"',
    '    docker compose logs --tail 40 || true',
    '    exit 1',
    '  fi',
    'done',
    'echo "容器状态：$state (health: $health)"',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function buildHealthScript(app) {
  const { dir } = appPaths(app)
  const healthPath = app.runtime.healthPath || '/'
  return [
    'set -e',
    `DOMAIN=${app.domain}`,
    `APP_PATH=${healthPath}`,
    'code=000',
    'for i in $(seq 1 30); do',
    '  code=$(curl -ks -o /dev/null -w "%{http_code}" -m 5 -H "Host: $DOMAIN" "https://127.0.0.1$APP_PATH" || echo 000)',
    '  case "$code" in',
    '    2??|3??) echo "应用已通过 Traefik 响应（HTTP $code）"; exit 0;;',
    '  esac',
    '  sleep 2',
    'done',
    `echo "应用未能通过 Traefik 响应（最后 HTTP $code）"`,
    `cd ${dir} && docker compose logs --tail 40 || true`,
    'exit 1',
  ].join('\n')
}

function checkHttps(domain, healthPath, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const req = https.get(
      { host: domain, port: 443, path: healthPath || '/', timeout: timeoutMs, servername: domain },
      (res) => {
        res.resume()
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, code: res.statusCode })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, error: '连接超时' })
    })
    req.on('error', (err) => resolve({ ok: false, error: err.code || err.message }))
  })
}

async function waitHttps(domain, healthPath, timeoutMs = 90000) {
  const started = Date.now()
  let last = { ok: false, error: '未尝试' }
  while (Date.now() - started < timeoutMs) {
    last = await checkHttps(domain, healthPath)
    if (last.ok) return last
    await SLEEP(3000)
  }
  return last
}

function maskedCompose(compose) {
  return compose.replace(/^(\s{6}[A-Za-z_][A-Za-z0-9_]*: ).*$/gm, '$1"***"')
}

function deployTips(app, server) {
  const ssh = `ssh -p ${server.port} ${server.user}@${server.host}`
  if (app.kind === 'service') {
    return [
      `查看日志：${ssh} 'cd /srv/apps/${app.id} && docker compose logs --tail 100'`,
      `健康状态：${ssh} 'docker inspect -f "{{.State.Health.Status}}" ourjia_${app.id}'`,
      `数据目录：${ssh} 'ls -la ${app.service?.dataDir}'（权限失败时确认所有者 ${app.service?.dataOwner || 'root'}）`,
      `应用内连接地址：${app.service?.alias || `ourjia_${app.id}`}:${app.runtime.port}`,
      '共享服务不暴露公网；本地访问可用 SSH 隧道或 docker exec。',
    ]
  }
  return [
    `查看应用日志：${ssh} 'cd /srv/apps/${app.id} && docker compose logs --tail 100'`,
    `确认容器状态：${ssh} 'docker ps --filter name=ourjia_${app.id}'`,
    `证书与路由：${ssh} 'docker logs --tail 100 traefik'`,
    `镜像拉取失败时先在服务器上验证：docker pull ${app.image}（私有仓库需 docker login）`,
    `域名 ${app.domain} 需要解析到 ${server.host}，否则 Let's Encrypt 无法完成 HTTP-01 校验。`,
  ]
}

async function deployImage(job, conn, app) {
  const { dir } = appPaths(app)
  const env = readEnv(app)

  updateStep(job, 'config', { status: 'running', startedAt: new Date().toISOString() })
  job.currentStep = 'config'
  appendLog(job, `镜像 ${app.image} → 容器端口 ${app.runtime.port}`, 'note')
  appendLog(job, `域名 ${app.domain}`, 'note')
  if (Object.keys(env).length) {
    appendLog(job, `环境变量：${Object.keys(env).join('、')}（值已隐藏）`, 'note')
  } else {
    appendLog(job, '未配置环境变量', 'note')
  }
  await execScript(conn, `mkdir -p ${dir} && chmod 700 ${dir}`, { timeoutMs: 15000 })
  const compose = buildImageCompose(app, env)
  await sftpWrite(conn, `${dir}/docker-compose.yml`, compose, 0o600)
  await sftpWrite(
    conn,
    `${dir}/release.json`,
    `${JSON.stringify(
      {
        app: app.id,
        name: app.name,
        kind: app.kind,
        image: app.image,
        domain: app.domain,
        port: app.runtime.port,
        envKeys: Object.keys(env),
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    0o644,
  )
  appendLog(job, `$ cat ${dir}/docker-compose.yml（环境变量值已隐藏）`, 'cmd')
  for (const line of maskedCompose(compose).trimEnd().split('\n')) appendLog(job, `  ${line}`, 'out')
  updateStep(job, 'config', { status: 'done', finishedAt: new Date().toISOString() })

  await runStep(job, conn, 'pull', buildPullScript(app), 900000, '拉取镜像')
  flushCarry(job)

  await runStep(job, conn, 'deploy', buildImageUpScript(app), 300000, '启动容器')
  flushCarry(job)

  await runStep(job, conn, 'health', buildHealthScript(app), 180000, '经 Traefik 健康检查')
  flushCarry(job)

  return { version: app.image, commit: null }
}

async function deployService(job, conn, app) {
  const { dir } = appPaths(app)
  const { alias, dataDir, containerPath, dataOwner, healthCmd } = app.service
  const env = readEnv(app)

  updateStep(job, 'config', { status: 'running', startedAt: new Date().toISOString() })
  job.currentStep = 'config'
  appendLog(job, `镜像 ${app.image} → 容器端口 ${app.runtime.port}`, 'note')
  appendLog(job, `数据目录 ${dataDir} → ${containerPath}`, 'note')
  if (alias) appendLog(job, `网络别名 ${alias}：应用可通过 ${alias}:${app.runtime.port} 访问`, 'note')
  if (dataOwner) appendLog(job, `数据目录所有者 ${dataOwner}`, 'note')
  if (healthCmd) appendLog(job, `健康检查：${healthCmd}`, 'note')
  if (Object.keys(env).length) {
    appendLog(job, `环境变量：${Object.keys(env).join('、')}（值已隐藏）`, 'note')
  } else {
    appendLog(job, '未配置环境变量', 'note')
  }

  await execScript(conn, `mkdir -p ${dir} && chmod 700 ${dir}`, { timeoutMs: 15000 })
  const compose = buildServiceCompose(app, env)
  await sftpWrite(conn, `${dir}/docker-compose.yml`, compose, 0o600)
  await sftpWrite(
    conn,
    `${dir}/release.json`,
    `${JSON.stringify(
      {
        app: app.id,
        name: app.name,
        kind: 'service',
        image: app.image,
        port: app.runtime.port,
        alias,
        dataDir,
        containerPath,
        envKeys: Object.keys(env),
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    0o644,
  )
  appendLog(job, `$ cat ${dir}/docker-compose.yml（环境变量值已隐藏）`, 'cmd')
  for (const line of maskedCompose(compose).trimEnd().split('\n')) appendLog(job, `  ${line}`, 'out')
  updateStep(job, 'config', { status: 'done', finishedAt: new Date().toISOString() })

  await runStep(job, conn, 'pull', buildPullScript(app), 900000, '拉取镜像')
  flushCarry(job)

  await runStep(job, conn, 'deploy', buildServiceUpScript(app), 300000, '启动共享服务')
  flushCarry(job)

  return { version: app.image, commit: null }
}

export async function runDeploy(job, conn, server, app) {
  setJobState(job, 'running')
  try {
    const result =
      app.kind === 'service' ? await deployService(job, conn, app) : await deployImage(job, conn, app)
    const { version, commit } = result

    let warning = null
    if (app.kind === 'service') {
      appendLog(job, '共享服务已启动：只挂在 shared-net，没有公网入口。', 'note')
      if (app.service?.alias) {
        appendLog(job, `应用内连接地址：${app.service.alias}:${app.runtime.port}`, 'note')
      }
    } else {
      // 外网 HTTPS 证书作为软检查：不阻断部署，但记录警告
      appendLog(job, `等待 https://${app.domain} 证书就绪…`, 'note')
      const external = await waitHttps(app.domain, app.runtime.healthPath)
      if (external.ok) {
        appendLog(job, `HTTPS 访问正常（HTTP ${external.code}，证书校验通过）`, 'note')
      } else {
        warning = `HTTPS 尚未就绪：${external.error || `HTTP ${external.code}`}`
        appendLog(
          job,
          `⚠ 外网 HTTPS 尚未就绪（${external.error || `HTTP ${external.code}`}）：域名需解析到 ${server.host} 且证书签发成功后才会生效。`,
          'err',
        )
      }
    }

    Object.assign(app, {
      status: 'running',
      warning,
      lastError: null,
      updatedAt: new Date().toISOString(),
      delivery: { version, tag: version, commit, deployedAt: new Date().toISOString() },
    })
    saveApps()
    setJobState(job, 'done')
    return { ok: true, version, commit }
  } catch (err) {
    const stepId = job.currentStep
    const step = job.steps.find((s) => s.id === stepId)
    if (step && step.status === 'running') {
      updateStep(job, stepId, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: err.detail || err.message,
      })
    }
    appendLog(job, '', 'out')
    appendLog(job, `✗ 部署失败：${err.message}`, 'err')
    if (err.detail) {
      for (const line of String(err.detail).split('\n')) appendLog(job, `  ${line}`, 'err')
    }
    appendLog(job, '', 'out')
    appendLog(job, '排查建议', 'note')
    for (const tip of deployTips(app, server)) appendLog(job, `• ${tip}`, 'note')
    Object.assign(app, {
      status: 'failed',
      lastError: err.message,
      warning: null,
      updatedAt: new Date().toISOString(),
    })
    saveApps()
    setJobState(job, 'failed', err.message)
    return { ok: false, error: err.message }
  }
}
