import crypto from 'node:crypto'

const jobs = new Map()
const locks = new Map()
const MAX_LOG_LINES = 4000

export function createJob(serverId, type, steps) {
  const id = 'job_' + crypto.randomBytes(6).toString('hex')
  const now = new Date().toISOString()
  const job = {
    id,
    serverId,
    type,
    status: 'pending',
    currentStep: null,
    steps: steps.map((s) => ({ id: s.id, title: s.title, status: 'pending', startedAt: null, finishedAt: null, error: null })),
    logs: [],
    createdAt: now,
    finishedAt: null,
    error: null,
    listeners: new Set(),
    seq: 0,
  }
  jobs.set(id, job)
  return job
}

export function getJob(id) {
  return jobs.get(id)
}

export function jobLocked(serverId) {
  return locks.get(serverId) || null
}

export function acquireLock(serverId, jobId) {
  if (locks.has(serverId)) return false
  locks.set(serverId, jobId)
  return true
}

export function releaseLock(serverId) {
  locks.delete(serverId)
}

export function appendLog(job, line, stream = 'out') {
  const text = String(line ?? '')
  for (const chunk of text.split('\n')) {
    const entry = { seq: ++job.seq, at: new Date().toISOString(), stream, text: chunk }
    job.logs.push(entry)
    emit(job, 'log', { stream, text: chunk, at: entry.at })
  }
  if (job.logs.length > MAX_LOG_LINES) job.logs.splice(0, job.logs.length - MAX_LOG_LINES)
}

export function updateStep(job, stepId, patch) {
  const step = job.steps.find((s) => s.id === stepId)
  if (!step) return
  Object.assign(step, patch)
  emit(job, 'step', step)
}

export function setJobState(job, status, error = null) {
  job.status = status
  job.error = error
  if (status === 'done' || status === 'failed') job.finishedAt = new Date().toISOString()
  emit(job, 'state', snapshot(job, false))
}

export function snapshot(job, includeLogs = true) {
  return {
    id: job.id,
    serverId: job.serverId,
    type: job.type,
    status: job.status,
    currentStep: job.currentStep,
    steps: job.steps,
    error: job.error,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    logs: includeLogs ? job.logs : undefined,
  }
}

function emit(job, event, data) {
  for (const listener of job.listeners) {
    try {
      listener(event, data)
    } catch {
      /* ignore broken listeners */
    }
  }
}

export function subscribe(job, fn) {
  job.listeners.add(fn)
  return () => job.listeners.delete(fn)
}

// 进程重启后，把上一次残留的运行中任务标记为中断
export function markInterrupted() {
  for (const job of jobs.values()) {
    if (job.status === 'running' || job.status === 'pending') {
      job.status = 'interrupted'
      job.error = '服务重启，任务已中断'
      job.finishedAt = new Date().toISOString()
      for (const step of job.steps) {
        if (step.status === 'running') {
          step.status = 'failed'
          step.error = job.error
        }
      }
    }
  }
}
