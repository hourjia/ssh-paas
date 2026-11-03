import { useRef, useState } from 'react'
import { PlusIcon, RefreshIcon } from '../icons'

interface ActionDockProps {
  showRefresh: boolean
  title?: string
  addLabel?: string
  onAdd: () => void
  onRefresh: () => void
}

export function ActionDock({ showRefresh, title = '服务器', addLabel = '添加', onAdd, onRefresh }: ActionDockProps) {
  const [spinning, setSpinning] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleRefresh = () => {
    setSpinning(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setSpinning(false), 950)
    onRefresh()
  }

  return (
    <div className="toolbar">
      <div className="toolbar-title">
        <h1>{title}</h1>
      </div>
      <div className="toolbar-actions">
        <button className="btn ghost toolbar-btn" onClick={handleRefresh} disabled={!showRefresh}>
          <RefreshIcon className={spinning ? 'spin' : undefined} />
          刷新
        </button>
        <button className="btn primary toolbar-btn" onClick={onAdd}>
          <PlusIcon />
          {addLabel}
        </button>
      </div>
    </div>
  )
}
