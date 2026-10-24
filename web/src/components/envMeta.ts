import type { EnvStatus } from '../types'
import type { Tone } from './ui'

export const envTone = (s: EnvStatus): Tone =>
  s === 'ready' ? 'ok' : s === 'needs_manual' ? 'warn' : s === 'failed' ? 'err' : 'off'

export const envLabel = (s: EnvStatus) =>
  s === 'ready' ? '环境就绪' : s === 'needs_manual' ? '需人工确认' : s === 'failed' ? '检查失败' : '未检查'

export const checkItemMeta: Record<string, { text: string; tone: Tone }> = {
  ok: { text: '正常', tone: 'ok' },
  missing: { text: '缺失', tone: 'warn' },
  broken: { text: '异常', tone: 'err' },
  no_permission: { text: '无权限', tone: 'warn' },
}

export const envMetaForTask = (s: 'running' | 'success' | 'needs_manual' | 'failed'): { text: string; tone: Tone } =>
  s === 'success'
    ? { text: '环境就绪', tone: 'ok' }
    : s === 'needs_manual'
      ? { text: '需人工确认', tone: 'warn' }
      : s === 'failed'
        ? { text: '检查失败', tone: 'err' }
        : { text: '执行中', tone: 'info' }
