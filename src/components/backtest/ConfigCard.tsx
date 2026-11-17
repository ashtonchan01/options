import type { BacktestParams } from '../../backtest/engine'
import { shortLabel } from '../../backtest/defaults'

const DTE_CHIPS = Array.from({ length: 22 }, (_, i) => i)
const WEEKDAYS: { id: number; label: string; title: string }[] = [
  { id: 1, label: 'M', title: 'Monday' },
  { id: 2, label: 'T', title: 'Tuesday' },
  { id: 3, label: 'W', title: 'Wednesday' },
  { id: 4, label: 'T', title: 'Thursday' },
  { id: 5, label: 'F', title: 'Friday' },
]

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function parseClock(value: string): number | null {
  const [h, m] = value.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

interface Props {
  config: BacktestParams
  color: string
  canRemove: boolean
  onChange: (next: BacktestParams) => void
  onRemove: () => void
}

export default function ConfigCard({ config, color, canRemove, onChange, onRemove }: Props) {
  function set<K extends keyof BacktestParams>(key: K, value: BacktestParams[K]) {
    onChange({ ...config, [key]: value })
  }
  function toggleDay(id: number) {
    const has = config.entryWeekdays.includes(id)
    const next = has ? config.entryWeekdays.filter(d => d !== id) : [...config.entryWeekdays, id].sort()
    set('entryWeekdays', next)
  }

  const strikeStep = config.strikeMode === 'delta' ? 0.01 : config.strikeMode === 'pct' ? 0.1 : 1
  const strikeMin = config.strikeMode === 'delta' ? 0.01 : 0
  const strikeMax = config.strikeMode === 'delta' ? 0.99 : undefined

  return (
    <section className="bt-card" style={{ borderTop: `3px solid ${color}` }}>
      <div className="bt-card-head">
        <span className="bt-swatch" style={{ background: color }} />
        <strong>{shortLabel(config)}</strong>
        {canRemove && (
          <button type="button" className="bt-text-btn" onClick={onRemove}>Remove</button>
        )}
      </div>

      <div className="bt-field wide">
        <span>DTE, in trading days</span>
        <div className="bt-dte-row">
          <div className="bt-chips" role="group" aria-label="Days to expiry">
            {DTE_CHIPS.map(n => (
              <button
                key={n}
                type="button"
                className={`bt-chip${config.dte === n ? ' on' : ''}`}
                onClick={() => set('dte', n)}
              >{n}</button>
            ))}
          </div>
          <label className={`bt-custom${config.dte > 21 ? ' on' : ''}`}>
            Custom
            <input
              className="bt-input bt-dte"
              type="number"
              min={0}
              max={400}
              step={1}
              value={config.dte}
              aria-label="Custom DTE in trading days"
              onChange={e => {
                if (Number.isFinite(e.target.valueAsNumber)) set('dte', Math.max(0, Math.floor(e.target.valueAsNumber)))
              }}
            />
          </label>
        </div>
        <p className="bt-hint">0 is the entry session. If that day has no SPXW expiry, the trade uses the next real one and the row shows the actual count.</p>
      </div>

      <div className="bt-fields">
        <label className="bt-field">
          <span>Entry days</span>
          <div className="bt-chips" role="group" aria-label="Entry days">
            {WEEKDAYS.map(day => (
              <button
                key={day.id}
                type="button"
                title={day.title}
                className={`bt-chip${config.entryWeekdays.includes(day.id) ? ' on' : ''}`}
                onClick={() => toggleDay(day.id)}
              >{day.label}</button>
            ))}
          </div>
        </label>
        <label className="bt-field">
          <span>Entry time (ET)</span>
          <input
            className="bt-input"
            type="time"
            value={clock(config.entryMinute)}
            onChange={e => {
              const next = parseClock(e.target.value)
              if (next != null) set('entryMinute', next)
            }}
          />
        </label>

        <div className="bt-field wide">
          <span>Short strike</span>
          <div className="bt-inline">
            <button type="button" className={`bt-chip${config.strikeMode === 'pct' && config.strikeValue === 0 ? ' on' : ''}`} onClick={() => onChange({ ...config, strikeMode: 'pct', strikeValue: 0 })}>ATM</button>
            <button type="button" className={`bt-chip${config.strikeMode === 'pct' && config.strikeValue === 3 ? ' on' : ''}`} onClick={() => onChange({ ...config, strikeMode: 'pct', strikeValue: 3 })}>3% OTM</button>
            <select
              className="bt-input"
              value={config.strikeMode}
              aria-label="Strike method"
              onChange={e => set('strikeMode', e.target.value as BacktestParams['strikeMode'])}
            >
              <option value="pct">% OTM</option>
              <option value="delta">Delta</option>
              <option value="points">Points OTM</option>
            </select>
            <input
              className="bt-input bt-num"
              type="number"
              step={strikeStep}
              min={strikeMin}
              max={strikeMax}
              value={config.strikeValue}
              aria-label="Strike distance"
              onChange={e => {
                if (Number.isFinite(e.target.valueAsNumber)) set('strikeValue', e.target.valueAsNumber)
              }}
            />
          </div>
        </div>

        <label className="bt-field">
          <span>Width (points)</span>
          <input className="bt-input" type="number" min={5} step={5} value={config.width} onChange={e => {
            if (Number.isFinite(e.target.valueAsNumber)) set('width', e.target.valueAsNumber)
          }} />
        </label>
        <label className="bt-field">
          <span>Sizing</span>
          <div className="bt-inline">
            <select className="bt-input" value={config.sizing} aria-label="Sizing" onChange={e => set('sizing', e.target.value as BacktestParams['sizing'])}>
              <option value="contracts">Contracts</option>
              <option value="risk">Risk $</option>
            </select>
            {config.sizing === 'contracts' ? (
              <input className="bt-input bt-num" type="number" min={1} step={1} aria-label="Contracts" value={config.contracts} onChange={e => {
                if (Number.isFinite(e.target.valueAsNumber)) set('contracts', e.target.valueAsNumber)
              }} />
            ) : (
              <input className="bt-input bt-num" type="number" min={100} step={100} aria-label="Risk budget" value={config.riskBudget} onChange={e => {
                if (Number.isFinite(e.target.valueAsNumber)) set('riskBudget', e.target.valueAsNumber)
              }} />
            )}
          </div>
        </label>

        <label className="bt-field">
          <span>Take profit</span>
          <div className="bt-inline">
            <input type="checkbox" checked={config.takeProfitOn} aria-label="Take profit enabled" onChange={e => set('takeProfitOn', e.target.checked)} />
            <input className="bt-input bt-num" type="number" min={1} max={99} step={1} disabled={!config.takeProfitOn} aria-label="Take profit percent of credit" value={config.takeProfitPct} onChange={e => {
              if (Number.isFinite(e.target.valueAsNumber)) set('takeProfitPct', e.target.valueAsNumber)
            }} />
            <span className="bt-unit">% of credit</span>
          </div>
        </label>
        <label className="bt-field">
          <span>Stop</span>
          <div className="bt-inline">
            <select className="bt-input" value={config.stopType} aria-label="Stop type" onChange={e => set('stopType', e.target.value as BacktestParams['stopType'])}>
              <option value="multiple">Multiple of credit</option>
              <option value="strike">SPX at short strike</option>
              <option value="none">None</option>
            </select>
            {config.stopType === 'multiple' && (
              <input className="bt-input bt-num" type="number" min={0.1} step={0.1} aria-label="Stop multiple" value={config.stopMultiple} onChange={e => {
                if (Number.isFinite(e.target.valueAsNumber)) set('stopMultiple', e.target.valueAsNumber)
              }} />
            )}
          </div>
        </label>

        <label className="bt-field">
          <span>VIX min</span>
          <input className="bt-input" type="number" step={0.5} placeholder="Any" value={config.vixMin ?? ''} onChange={e => set('vixMin', e.target.value === '' ? null : Number(e.target.value))} />
        </label>
        <label className="bt-field">
          <span>VIX max</span>
          <input className="bt-input" type="number" step={0.5} placeholder="Any" value={config.vixMax ?? ''} onChange={e => set('vixMax', e.target.value === '' ? null : Number(e.target.value))} />
        </label>
        <label className="bt-field">
          <span>From</span>
          <input className="bt-input" type="date" value={config.startDate} onChange={e => set('startDate', e.target.value)} />
        </label>
        <label className="bt-field">
          <span>To</span>
          <input className="bt-input" type="date" value={config.endDate} onChange={e => set('endDate', e.target.value)} />
        </label>
        <label className="bt-field">
          <span>Skew (vol pts / 1% OTM)</span>
          <input className="bt-input" type="number" min={0} step={0.1} value={config.skewPerPct} onChange={e => {
            if (Number.isFinite(e.target.valueAsNumber)) set('skewPerPct', e.target.valueAsNumber)
          }} />
        </label>
        <label className="bt-field">
          <span>Slippage (points / spread)</span>
          <input className="bt-input" type="number" min={0} step={0.05} value={config.slippage} onChange={e => {
            if (Number.isFinite(e.target.valueAsNumber)) set('slippage', e.target.valueAsNumber)
          }} />
        </label>
        <label className="bt-field">
          <span>Rate %</span>
          <input className="bt-input" type="number" step={0.1} value={config.ratePct} onChange={e => {
            if (Number.isFinite(e.target.valueAsNumber)) set('ratePct', e.target.valueAsNumber)
          }} />
        </label>
        <label className="bt-field">
          <span>Dividend %</span>
          <input className="bt-input" type="number" step={0.1} value={config.divPct} onChange={e => {
            if (Number.isFinite(e.target.valueAsNumber)) set('divPct', e.target.valueAsNumber)
          }} />
        </label>
        <label className="bt-field wide">
          <span>Starting capital ($)</span>
          <input className="bt-input" type="number" min={1000} step={1000} value={config.startingCapital} onChange={e => {
            if (Number.isFinite(e.target.valueAsNumber)) set('startingCapital', e.target.valueAsNumber)
          }} />
        </label>
      </div>
    </section>
  )
}
