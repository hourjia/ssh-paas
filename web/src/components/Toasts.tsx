import { CheckIcon } from '../icons'

export interface ToastItem {
  id: number
  msg: string
  leaving: boolean
}

export function Toasts({ items }: { items: ToastItem[] }) {
  return (
    <div className="toast-wrap" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast${t.leaving ? ' out' : ''}`}>
          <CheckIcon />
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  )
}
