import { execScript } from './ssh.js'
import { appendLog, updateStep } from './jobs.js'

const MARKER = 'OJ_EXIT:'

export class StepError extends Error {
  constructor(message, detail) {
    super(message)
    this.detail = detail
  }
}

// 执行一段步骤脚本，实时转发输出；脚本末尾自带 OJ_EXIT 标记以回传退出码
export async function runStep(job, conn, stepId, script, timeoutMs, title) {
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
    throw new StepError(`步骤执行失败（退出码 ${code}）`, tailOf(result.stderr || result.stdout))
  }
  return result
}

// 把要执行的脚本原样回显到日志，方便人工复制到终端复现/排障
export function echoScript(job, title, script) {
  appendLog(job, `$ ${title}`, 'cmd')
  const body = String(script || '').trimEnd()
  if (!body) return
  for (const line of body.split('\n')) appendLog(job, `  ${line}`, 'cmd')
}

function wrapWithMarker(script) {
  return `set -o pipefail\n${script}\nOJ_RC=$?\necho "${MARKER}$OJ_RC"\nexit $OJ_RC\n`
}

function extractExitCode(stdout, fallback) {
  const text = String(stdout || '')
  const idx = text.lastIndexOf(MARKER)
  if (idx === -1) return fallback ?? 1
  const code = Number(text.slice(idx + MARKER.length).trim().split(/\s/)[0])
  return Number.isInteger(code) ? code : 1
}

const logCarry = new WeakMap()

export function forward(job, text, stream) {
  const carry = logCarry.get(job) || ''
  const merged = carry + text
  const lines = merged.split('\n')
  logCarry.set(job, lines.pop() ?? '')
  for (const line of lines) {
    // 不把内部退出码标记暴露给用户
    if (line.startsWith(MARKER)) continue
    appendLog(job, line, stream)
  }
}

export function flushCarry(job) {
  const carry = logCarry.get(job)
  if (carry && !carry.startsWith(MARKER)) appendLog(job, carry, 'out')
  logCarry.delete(job)
}

export function tailOf(text, lines = 6) {
  return String(text || '')
    .trim()
    .split('\n')
    .slice(-lines)
    .join('\n')
}
