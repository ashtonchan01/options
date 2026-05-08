import { Upload } from 'lucide-react'

interface EmptyStateProps {
  title: string
  message: string
  showUpload?: boolean
}

export default function EmptyState({ title, message, showUpload }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4" style={{ color: '#5D6580' }}>
      {showUpload && (
        <div
          className="rounded-xl p-5"
          style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)' }}
        >
          <Upload size={28} style={{ color: '#6366F1' }} />
        </div>
      )}
      <div className="text-center">
        <p style={{ fontSize: 15, fontWeight: 600, color: '#9198AE', margin: '0 0 4px' }}>{title}</p>
        <p style={{ fontSize: 13, margin: 0 }}>{message}</p>
      </div>
    </div>
  )
}
