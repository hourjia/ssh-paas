import { useRef, useState } from 'react'
import { PlusIcon, RefreshIcon } from '../icons'

interface ActionDockProps {
  showRefresh: boolean
  onAdd: () => void
  onRefresh: () => void
}

export function ActionDock({ showRefresh, onAdd, onRefresh }: ActionDockProps) {
  const [spinning, setSpinning] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleRefresh = () => {
    setSpinning(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setSpinning(false), 950)
    onRefresh()
  }

  return (
    <div className="action-dock glass sheen">
      <button className="icon-btn primary" data-tip="添加" aria-label="添加" onClick={onAdd}>
        <PlusIcon />
      </button>
      {showRefresh && (
        <button className="icon-btn" data-tip="刷新状态" aria-label="刷新状态" onClick={handleRefresh}>
          <RefreshIcon className={spinning ? 'spin' : undefined} />
        </button>
      )}
    </div>
  )
}
