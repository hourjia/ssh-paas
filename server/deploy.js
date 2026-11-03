import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import https from 'node:https'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { sftpUpload } from './ssh.js'
import { appendLog, updateStep, setJobState } from './jobs.js'
import { runStep, flushCarry } from './step-runner.js'
import { appPaths, saveApps } from './apps.js'

const execFileAsync = promisify(execFile)

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms))

async function git(cwd, args) {
  const { stdout, stderr } = await execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })
  return { stdout, stderr }
}

export function planDeploySteps() {
  return [
    { id: 'build', title: '本地构建交付包' },
    { id: 'deliver', title: '更新交付仓库' },
    { id: 'deploy', title: '服务器检出并启动' },
    { id: 'health', title: '健康检查' },
  ]
}

function makeVersion() {
  const iso = new Date().toISOString() // 2026-11-03T07:55:00.000Z
  return `v${iso.replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`
}

function buildCompose(app, version) {
  const id = app.id
  const domain = app.domain
  const port = app.runtime?.port || 80
  return [
    'services:',
    '  app:',
    '    build: .',
    `    container_name: ourjia_${id}`,
    '    restart: unless-stopped',
    '    labels:',
    '      - "traefik.enable=true"',
    '      - "traefik.docker.network=proxy-net"',
    `      - "traefik.http.routers.${id}.rule=Host(\`${domain}\`)"`,
    `      - "traefik.http.routers.${id}.entrypoints=websecure"`,
    `      - "traefik.http.routers.${id}.tls=true"`,
    `      - "traefik.http.routers.${id}.tls.certresolver=le"`,
    `      - "traefik.http.services.${id}.loadbalancer.server.port=${port}"`,
    `      - "deploy.app=${id}"`,
    `      - "deploy.version=${version}"`,
    '    networks:',
    '      - proxy-net',
    '      - shared-net',
    'networks:',
    '  proxy-net:',
    '    external: true',
    '  shared-net:',
    '    external: true',
    '',
  ].join('\n')
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function sampleHtml(app, version) {
  const name = escapeHtml(app.name)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${name}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b1120; color: #e2e8f0;
           font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif; }
    main { padding: 48px 56px; border: 1px solid rgba(148,163,184,.25); border-radius: 20px;
           background: rgba(15,23,42,.7); text-align: center; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { margin: 6px 0; color: #94a3b8; }
    code { color: #7dd3fc; }
  </style>
</head>
<body>
  <main>
    <h1>${name}</h1>
    <p>已通过 OURJIA PAAS 部署</p>
    <p>版本 <code>${version}</code></p>
    <p>${new Date().toISOString()}</p>
  </main>
</body>
</html>
`
}

// 示例应用：静态页面 + 薄 nginx 镜像，用于跑通交付/部署/证书链路
function writeSampleProject(workdir, app, version) {
  const distDir = path.join(workdir, 'dist')
  fs.mkdirSync(distDir, { recursive: true })
  fs.writeFileSync(path.join(distDir, 'index.html'), sampleHtml(app, version))
  fs.writeFileSync(path.join(workdir, 'Dockerfile'), `FROM ${app.runtime.baseImage}\nCOPY dist/ /usr/share/nginx/html\n`)
  fs.writeFileSync(path.join(workdir, 'docker-compose.yml'), buildCompose(app, version))
  fs.writeFileSync(
    path.join(workdir, 'release.json'),
    `${JSON.stringify(
      {
        app: app.id,
        name: app.name,
        kind: app.kind,
        version,
        domain: app.domain,
        port: app.runtime.port,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
  fs.writeFileSync(path.join(workdir, '.gitignore'), '*.bundle\n')
}

function buildDeliverScript(app, bundleRemote) {
  const { repo } = appPaths(app)
  return [
    'set -e',
    `REPO=${repo}`,
    `BUNDLE=${bundleRemote}`,
    'mkdir -p "$(dirname "$REPO")"',
    'if [ ! -d "$REPO" ]; then',
    '  git init --bare "$REPO" >/dev/null',
    '  echo "交付仓库已创建：$REPO"',
    'fi',
    'test -f "$BUNDLE" || { echo "交付包不存在：$BUNDLE"; exit 1; }',
    'git -C "$REPO" fetch "$BUNDLE" "+refs/heads/*:refs/heads/*" "+refs/tags/*:refs/tags/*"',
    'rm -f "$BUNDLE"',
    'git -C "$REPO" for-each-ref --sort=-creatordate --count=3 --format="%(refname:short)" refs/tags',
  ].join('\n')
}

function buildDeployScript(app, tag) {
  const { repo, dir } = appPaths(app)
  return [
    'set -e',
    `REPO=${repo}`,
    `DIR=${dir}`,
    `TAG=${tag}`,
    'mkdir -p /srv/apps',
    'if [ ! -d "$DIR/.git" ]; then',
    '  rm -rf "$DIR"',
    '  git clone "$REPO" "$DIR"',
    'fi',
    'git -C "$DIR" fetch --tags origin',
    'git -C "$DIR" checkout -f "$TAG"',
    'echo "当前版本：$(git -C "$DIR" describe --tags --always)"',
    'cd "$DIR"',
    'docker compose up -d --build --remove-orphans',
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

function deployTips(app, server) {
  const ssh = `ssh -p ${server.port} ${server.user}@${server.host}`
  return [
    `查看应用日志：${ssh} 'cd /srv/apps/${app.id} && docker compose logs --tail 100'`,
    `确认容器状态：${ssh} 'docker ps --filter name=ourjia_${app.id}'`,
    `证书与路由：${ssh} 'docker logs --tail 100 traefik'`,
    `域名 ${app.domain} 需要解析到 ${server.host}，否则 Let's Encrypt 无法完成 HTTP-01 校验。`,
  ]
}

export async function runDeploy(job, conn, server, app) {
  setJobState(job, 'running')
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ourjia-deploy-'))
  const version = makeVersion()
  let commit = null
  try {
    // 1. 本地构建交付包
    updateStep(job, 'build', { status: 'running', startedAt: new Date().toISOString() })
    job.currentStep = 'build'
    appendLog(job, `准备示例应用「${app.name}」 ${version}`, 'note')
    writeSampleProject(workdir, app, version)
    await git(workdir, ['init', '-q'])
    await git(workdir, ['add', '-A'])
    await git(workdir, [
      '-c', 'user.name=Ourjia PaaS',
      '-c', 'user.email=paas@ourjia.local',
      'commit', '-q', '-m', `${app.name} ${version}`,
    ])
    await git(workdir, ['tag', version])
    commit = (await git(workdir, ['rev-parse', 'HEAD'])).stdout.trim()
    appendLog(job, `已生成交付包：dist/ + Dockerfile + docker-compose.yml + release.json`, 'note')
    appendLog(job, `提交 ${commit.slice(0, 12)}，Tag ${version}`, 'note')
    updateStep(job, 'build', { status: 'done', finishedAt: new Date().toISOString() })

    // 2. 通过 git bundle 更新服务器上的交付仓库（不需要额外 Git 托管与凭据）
    const bundleLocal = path.join(workdir, `${app.id}.bundle`)
    await git(workdir, ['bundle', 'create', bundleLocal, '--all'])
    const bundleRemote = `/tmp/ourjia-${app.id}-${version}.bundle`
    const sizeKb = Math.max(1, Math.round(fs.statSync(bundleLocal).size / 1024))
    appendLog(job, `交付包 ${sizeKb} KB，上传到 ${bundleRemote}…`, 'note')
    await sftpUpload(conn, bundleLocal, bundleRemote, 0o600)
    await runStep(
      job, conn, 'deliver',
      buildDeliverScript(app, bundleRemote),
      120000,
      '更新服务器上的交付仓库',
    )
    flushCarry(job)

    // 3. 服务器检出并启动
    await runStep(
      job, conn, 'deploy',
      buildDeployScript(app, version),
      600000,
      '检出 Tag 并构建、启动容器',
    )
    flushCarry(job)

    // 4. 健康检查：本机经 Traefik 必须通；外网 HTTPS 证书作为软检查
    await runStep(job, conn, 'health', buildHealthScript(app), 180000, '经 Traefik 健康检查')
    flushCarry(job)

    appendLog(job, `等待 https://${app.domain} 证书就绪…`, 'note')
    const external = await waitHttps(app.domain, app.runtime.healthPath)
    if (external.ok) {
      appendLog(job, `HTTPS 访问正常（HTTP ${external.code}，证书校验通过）`, 'note')
    } else {
      appendLog(
        job,
        `⚠ 外网 HTTPS 尚未就绪（${external.error || `HTTP ${external.code}`}）：域名需解析到 ${server.host} 且证书签发成功后才会生效。`,
        'err',
      )
    }

    Object.assign(app, {
      status: 'running',
      warning: external.ok ? null : `HTTPS 尚未就绪：${external.error || `HTTP ${external.code}`}`,
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
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true })
  }
}
