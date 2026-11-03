import { execScript } from './ssh.js'

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SAFE_PATH = /^\/srv\/(apps|git|data)\/[A-Za-z0-9][A-Za-z0-9._-]*$/

export function buildScanScript() {
  return [
    "echo '##CONTAINERS'",
    "docker ps -a --format '{{.Names}}|{{.Label \"deploy.app\"}}|{{.State}}|{{.Status}}' 2>/dev/null | awk -F'|' '$1 ~ /^ourjia_/ || $2 != \"\"' || true",
    "echo '##APPS'",
    'ls -1 /srv/apps 2>/dev/null || true',
    "echo '##GIT'",
    'ls -1 /srv/git 2>/dev/null || true',
    "echo '##DATA'",
    'ls -1 /srv/data 2>/dev/null || true',
  ].join('\n')
}

function splitSections(text) {
  const out = {}
  let current = null
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('##')) {
      current = line.slice(2).trim()
      out[current] = []
    } else if (current && line.trim()) {
      out[current].push(line)
    }
  }
  return out
}

export function parseResources(stdout, serverApps) {
  const known = new Map(serverApps.map((a) => [a.id, a]))
  const sections = splitSections(stdout)

  const containers = []
  for (const line of sections.CONTAINERS || []) {
    const [name, appId, state, status] = line.split('|')
    if (!name || !SAFE_NAME.test(name)) continue
    const id = (appId || name.replace(/^ourjia_/, '')).trim()
    containers.push({
      name,
      appId: id,
      state: state || 'unknown',
      status: status || '',
      orphan: !known.has(id),
    })
  }

  const dirs = []
  const addDirs = (group, list, base) => {
    for (const raw of list || []) {
      const name = raw.trim()
      if (!SAFE_NAME.test(name) || name === '.' || name === '..') continue
      const appId = group === 'git' && name.endsWith('.git') ? name.slice(0, -4) : name
      dirs.push({
        group,
        name,
        path: `${base}/${name}`,
        appId,
        orphan: !known.has(appId),
      })
    }
  }
  addDirs('apps', sections.APPS, '/srv/apps')
  addDirs('git', sections.GIT, '/srv/git')
  addDirs('data', sections.DATA, '/srv/data')

  return {
    apps: serverApps.map((a) => ({ id: a.id, name: a.name, kind: a.kind, status: a.status })),
    containers,
    dirs,
    orphans: {
      containers: containers.filter((c) => c.orphan),
      dirs: dirs.filter((d) => d.orphan),
    },
    scannedAt: new Date().toISOString(),
  }
}

export function buildResourceCleanupScript({ containers = [], paths = [] }) {
  const lines = ['set -e']
  for (const name of containers) {
    if (!SAFE_NAME.test(name)) throw new Error(`容器名不合法：${name}`)
    lines.push(`docker rm -f ${name} >/dev/null 2>&1 || true`)
    lines.push(`echo "已移除容器 ${name}"`)
  }
  for (const path of paths) {
    if (!SAFE_PATH.test(path) || path.includes('..')) throw new Error(`目录不合法：${path}`)
    lines.push(`rm -rf ${path}`)
    lines.push(`echo "已删除目录 ${path}"`)
  }
  return lines.join('\n')
}

export async function scanServerResources(conn, serverApps) {
  const result = await execScript(conn, buildScanScript(), { timeoutMs: 60000 })
  if (result.code !== 0) {
    throw new Error(`资源扫描失败：${result.stderr.trim() || `退出码 ${result.code}`}`)
  }
  return parseResources(result.stdout, serverApps)
}
