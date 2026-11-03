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

// 通过 stdin 把脚本交给远端 bash，避免命令行转义问题，并实时回传输出
export function execScript(conn, script, { timeoutMs = 60000, onStdout, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    conn.exec('bash -s', (err, stream) => {
      if (err) return reject(new Error(friendlySshError(err)))
      let stdout = ''
      let stderr = ''
      let settled = false
      let timer
      const settle = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn(value)
      }
      timer = setTimeout(() => {
        try {
          stream.signal('KILL')
        } catch {
          /* ignore */
        }
        try {
          stream.close()
        } catch {
          /* ignore */
        }
        settle(reject, new Error('远程脚本执行超时'))
      }, timeoutMs)
      stream.on('data', (d) => {
        const text = d.toString('utf8')
        stdout += text
        onStdout?.(text)
      })
      stream.stderr.on('data', (d) => {
        const text = d.toString('utf8')
        stderr += text
        onStderr?.(text)
      })
      stream.on('error', (e) => settle(reject, new Error(friendlySshError(e))))
      stream.on('close', (code, signal) => settle(resolve, { code, signal, stdout, stderr }))
      stream.end(script.endsWith('\n') ? script : `${script}\n`)
    })
  })
}

export function sftpWrite(conn, remotePath, content, mode = 0o644) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(new Error(friendlySshError(err)))
      const finish = (e) => {
        sftp.end()
        if (e) reject(e)
        else resolve()
      }
      const stream = sftp.createWriteStream(remotePath, { mode })
      stream.on('error', finish)
      stream.on('close', () => sftp.chmod(remotePath, mode, finish))
      stream.end(Buffer.from(content, 'utf8'))
    })
  })
}

// 二进制文件上传（git bundle 等），不能走 sftpWrite 的字符串编码
export function sftpUpload(conn, localPath, remotePath, mode = 0o600) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(new Error(friendlySshError(err)))
      sftp.fastPut(localPath, remotePath, (putErr) => {
        if (putErr) {
          sftp.end()
          reject(putErr)
          return
        }
        sftp.chmod(remotePath, mode, (chmodErr) => {
          sftp.end()
          if (chmodErr) reject(chmodErr)
          else resolve()
        })
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
