import { useEffect, useRef, useState } from 'react'

export interface TerminalLine {
  stream: string
  text: string
  at?: string
}

interface TerminalLogProps {
  lines: TerminalLine[]
  height?: 'inline' | 'tall'
  title?: string
  autoScroll?: boolean
}

function fmtClock(iso?: string) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false })
  } catch {
    return ''
  }
}

export function TerminalLog({ lines, height = 'inline', title = '终端输出', autoScroll = true }: TerminalLogProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!autoScroll || !pinned) return
    const el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, autoScroll, pinned])

  const onScroll = () => {
    const el = boxRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    setPinned(atBottom)
  }

  const copy = async () => {
    const text = lines.map((l) => l.text).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="term">
      <div className="term-bar">
        <span className="term-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="term-title">{title}</span>
        <span className="term-count">{lines.length} 行</span>
        <button className="term-btn" onClick={copy} disabled={!lines.length}>
          {copied ? '已复制' : '复制全部'}
        </button>
        {!pinned && (
          <button
            className="term-btn"
            onClick={() => {
              const el = boxRef.current
              if (el) el.scrollTop = el.scrollHeight
              setPinned(true)
            }}
          >
            回到底部
          </button>
        )}
      </div>
      <div className={`term-body${height === 'tall' ? ' tall' : ''}`} ref={boxRef} onScroll={onScroll}>
        {lines.length === 0 ? (
          <div className="term-empty">等待输出…</div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={`term-line ${line.stream}`}>
              <span className="term-time">{fmtClock(line.at)}</span>
              <span className="term-text">{line.text || ' '}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
