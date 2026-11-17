import type { BacktestParams } from '../../backtest/engine'
import { formatStrikePct, shortLabel } from '../../backtest/defaults'
import { MONTH_WEEKS, TRADE_FREQUENCIES, type MonthWeek, type TradeFrequency } from '../../backtest/tradeFrequency'

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
  onChange: (next: BacktestParams) => void
}

export default function ConfigCard({ config, onChange }: Props) {
  function set<K extends keyof BacktestParams>(key: K, value: BacktestParams[K]) {
    onChange({ ...config, [key]: value })
  }
  function toggleDay(id: number) {
    const has = config.entryWeekdays.includes(id)
    const next = has ? config.entryWeekdays.filter(d => d !== id) : [...config.entryWeekdays, id].sort()
    set('entryWeekdays', next)
  }
  const freq = config.tradeFrequency ?? 'daily'
  function setFrequency(next: TradeFrequency) {
    onChange({
      ...config,
      tradeFrequency: next,
      frequencyWeekday: config.frequencyWeekday || config.entryWeekdays[0] || 1,
    })
  }
  function pickScheduleDay(id: number) {
    set('frequencyWeekday', id)
  }

  const strikeStep = config.strikeMode === 'delta' ? 0.01 : 0.1
  const strikeMin = config.strikeMode === 'delta' ? 0.01 : undefined
  const strikeMax = config.strikeMode === 'delta' ? 0.99 : undefined

  return (
    <section className="bt-card bt-form-card">
      <p className="bt-form-summary">{shortLabel(config)}</p>
      <div className="bt-fields bt-fields-compact">
        <label className="bt-field">
          <span>Days to expiry</span>
          <input
            className="bt-input bt-num"
            type="number"
            min={0}
            max={400}
            step={1}
            value={config.dte}
            onChange={e => {
              if (Number.isFinite(e.target.valueAsNumber)) set('dte', Math.max(0, Math.floor(e.target.valueAsNumber)))
            }}
          />
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
        <label className="bt-field wide">
          <span>Trade frequency</span>
          <div className="bt-inline bt-freq-row">
            <select
              className="bt-input"
              value={freq}
              aria-label="Trade frequency"
              onChange={e => setFrequency(e.target.value as TradeFrequency)}
            >
              {TRADE_FREQUENCIES.map(f => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            {freq === 'monthly' && (
              <select
                className="bt-input"
                value={config.frequencyMonthWeek}
                aria-label="Week of month"
                onChange={e => set('frequencyMonthWeek', Number(e.target.value) as MonthWeek)}
              >
                {MONTH_WEEKS.map(w => (
                  <option key={w.id} value={w.id}>{w.label} week</option>
                ))}
              </select>
            )}
            {(freq === 'weekly' || freq === 'monthly') && (
              <div className="bt-chips" role="group" aria-label="Weekday">
                {WEEKDAYS.map(day => (
                  <button
                    key={`sched-${day.id}`}
                    type="button"
                    title={day.title}
                    className={`bt-chip${config.frequencyWeekday === day.id ? ' on' : ''}`}
                    onClick={() => pickScheduleDay(day.id)}
                  >{day.label}</button>
                ))}
              </div>
            )}
          </div>
        </label>
        {(freq === 'daily' || freq === 'alternate') && (
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
        )}
        <label className="bt-field">
          <span>Strike mode</span>
          <select
            className="bt-input"
            value={config.strikeMode}
            aria-label="Strike mode"
            onChange={e => set('strikeMode', e.target.value as BacktestParams['strikeMode'])}
          >
            <option value="pct">Percent vs price</option>
            <option value="delta">Put delta</option>
          </select>
        </label>
        <label className="bt-field wide">
          <span>{config.strikeMode === 'delta' ? 'Short strike: put delta (0.01 steps)' : 'Short strike vs price'}</span>
          <div className="bt-inline">
            <input
              className="bt-input bt-num"
              type="number"
              step={strikeStep}
              min={strikeMin}
              max={strikeMax}
              value={config.strikeValue}
              aria-label="Short strike vs price"
              onChange={e => {
                if (Number.isFinite(e.target.valueAsNumber)) set('strikeValue', e.target.valueAsNumber)
              }}
            />
            {config.strikeMode === 'pct' && (
              <span className="bt-unit" aria-hidden>{formatStrikePct(config.strikeValue)}</span>
            )}
          </div>
        </label>
        <label className="bt-field">
          <span>Spread width (points)</span>
          <input className="bt-input" type="number" min={5} step={5} value={config.width} onChange={e => {
            if (Number.isFinite(e.target.valueAsNumber)) set('width', e.target.valueAsNumber)
          }} />
        </label>
        <label className="bt-field">
          <span>Position size</span>
          <div className="bt-inline">
            <select className="bt-input" value={config.sizing} aria-label="Sizing" onChange={e => set('sizing', e.target.value as BacktestParams['sizing'])}>
              <option value="contracts">Contracts</option>
              <option value="risk">Risk budget</option>
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
          <span>Stop loss</span>
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
          <span>From</span>
          <input className="bt-input" type="date" value={config.startDate} onChange={e => set('startDate', e.target.value)} />
        </label>
        <label className="bt-field">
          <span>To</span>
          <input className="bt-input" type="date" value={config.endDate} onChange={e => set('endDate', e.target.value)} />
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