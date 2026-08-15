/**
 * Upload control + status for a user-created account — a broker statement
 * (IBKR Flex .xml, or a best-effort .csv/.xlsx/.xls/.pdf for anything else)
 * gets decoded into trades and folded into that account. Takes plain props
 * (not a whole store object) so it can be driven by whichever single
 * `useAccounts()` instance owns the actual state — two separate hook calls
 * for the same account would each get their own independent useState, so
 * an upload in one instance would never appear in the other's `.trades`.
 */
import { useRef } from 'react'
import { Upload, Trash2 } from 'lucide-react'

export default function AccountUploadBar({ label, fileName, uploadedAt, loading, error, onUpload, onClear }: {
  label: string
  fileName?: string
  uploadedAt?: number
  loading: boolean
  error: string | null
  onUpload: (file: File) => void
  onClear: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onUpload(file)
    e.target.value = ''
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, flexWrap: 'wrap',
    }}>
      <label style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px',
        fontSize: 11, fontWeight: 600, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
        color: 'var(--accent)', cursor: loading ? 'not-allowed' : 'pointer', borderRadius: 4, fontFamily: 'Inter, sans-serif',
      }}>
        <Upload size={12} />
        {loading ? 'Decoding…' : `Upload ${label} statement`}
        <input ref={fileRef} type="file" accept=".xml,.csv,.xlsx,.xls,.pdf" style={{ display: 'none' }} onChange={handleFile} disabled={loading} />
      </label>
      <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
        Accepts an IBKR Flex .xml export, or a .csv/.xlsx/.xls/.pdf statement (Date/Symbol/Quantity/Price columns).
      </span>
      {fileName && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>
          Last import: {fileName} ({uploadedAt ? new Date(uploadedAt).toLocaleDateString() : ''})
          <button onClick={onClear} title="Clear imported trades for this account" style={{
            background: 'none', border: '1px solid var(--border)', color: 'var(--text-4)',
            cursor: 'pointer', padding: '3px 6px', borderRadius: 4, display: 'flex',
          }}>
            <Trash2 size={11} />
          </button>
        </span>
      )}
      {error && (
        <div style={{ width: '100%', fontSize: 11, color: '#ef4444' }}>{error}</div>
      )}
    </div>
  )
}
