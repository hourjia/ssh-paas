import ssh2 from 'ssh2'

const { Client, utils } = ssh2

function friendlySshError(err) {
  const msg = String(err?.message || err)
  if (msg.includes('All configured authentication methods failed')) {
    return '认证失败：用户名、密码或密钥未被服务器接受'
  }
  if (msg.includes('ECONNREFUSED')) return '连接被拒绝：目标端口没有 SSH 服务在监听'
  if (msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN')) return '无法解析主机名，请检查服务器地址'
  if (msg.includes('ETIMEDOUT') || msg.includes('timed out')) return '连接超时：服务器无响应，请检查地址、端口与防火墙'
  if (msg.includes('EHOSTUNREACH') || msg.includes('ENETUNREACH')) return '网络不可达：无法路由到目标主机'
  return msg
}

// creds: { host, port, user, password?, privateKey? }
export function connectSSH(creds, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      conn.end()
      reject(new Error('连接超时：无法在指定时间内建立 SSH 连接'))
    }, timeoutMs)
    conn.on('ready', () => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      resolve(conn)
    })
    conn.on('error', (err) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      conn.end()
      reject(new Error(friendlySshError(err)))
    })
    conn.on('keyboard-interactive', (_name, _instr, _lang, _prompts, finish) => finish([creds.password ?? '']))
    conn.connect({
      host: creds.host,
      port: creds.port,
      username: creds.user,
      password: creds.password,
      privateKey: creds.privateKey,
      tryKeyboard: true,
      keepaliveInterval: 10000,
      readyTimeout: timeoutMs,
    })
  })
}

export function runCommand(conn, cmd, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(new Error(friendlySshError(err)))
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        stream.close()
        reject(new Error('命令执行超时'))
      }, timeoutMs)
      stream.on('error', (e) => {
        clearTimeout(timer)
        reject(new Error(friendlySshError(e)))
      })
      stream.on('close', (code) => {
        clearTimeout(timer)
        resolve({ code, stdout, stderr })
      })
      stream.on('data', (d) => {
        stdout += d
      })
      stream.stderr.on('data', (d) => {
        stderr += d
      })
    })
  })
}

const PROBE_CMD = '(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"); uname -srm'

export async function probeServer(conn) {
  const t0 = Date.now()
  const { code, stdout } = await runCommand(conn, PROBE_CMD)
  const latencyMs = Date.now() - t0
  let os = null
  if (code === 0) {
    os = stdout.split('\n').map((s) => s.trim()).filter(Boolean).join(' · ') || null
  }
  return { latencyMs, os }
}

export function generateKeyPair(comment = 'ourjia-paas') {
  // ssh2 无法解析 Node crypto 的 PKCS8 ed25519 私钥，改用它自己的 OpenSSH 格式生成器
  const { private: privateKeyPem, public: pubKey } = utils.generateKeyPairSync('ed25519')
  return { privateKeyPem, publicKeyLine: `${pubKey.trim()} ${comment}` }
}

export async function installPublicKey(conn, publicKeyLine) {
  const line = publicKeyLine.replace(/'/g, `'\\''`)
  const cmd =
    `{ mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys; } && ` +
    `{ grep -qxF '${line}' ~/.ssh/authorized_keys || echo '${line}' >> ~/.ssh/authorized_keys; }`
  const { code, stderr } = await runCommand(conn, cmd)
  if (code !== 0) {
    throw new Error(`安装公钥失败：${stderr.trim() || `退出码 ${code}`}`)
  }
}
