import { useState, useEffect, useRef, useMemo } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import './App.css'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
)

const API_URL = 'https://api.thingspeak.com/channels/692657/feeds.json?results=10'

function runDSS(d) {
  const risk = Number(d.field7)
  const factors = []
  let score = 0
  if (d.field5 > 5) { score++; factors.push('Turbidity high') }
  if (d.field4 < 60) { score++; factors.push('Flow low') }
  if (d.field6 > 500) { score++; factors.push('TDS high') }
  if (d.field2 > 30) { score++; factors.push('Temperature high') }

  if (risk < 30 && score <= 1) {
    return {
      decision: 'Normal Operation',
      action: 'No maintenance required',
      urgency: 'Low',
      review: 'After 24 hours',
      factors,
    }
  }
  if (risk < 60 || score === 2) {
    return {
      decision: 'Preventive Maintenance',
      action: 'Schedule inspection & partial cleaning',
      urgency: 'Medium',
      review: 'Within 12 hours',
      factors,
    }
  }
  return {
    decision: 'Corrective Action Required',
    action: 'Immediate cleaning & backwash',
    urgency: 'High',
    review: 'Within 1 hour',
    factors,
  }
}

const STAGE_DESCRIPTIONS = {
  'Early Growth': 'Initial attachment phase. Monitor and maintain normal operation.',
  'Developing Biofilm': 'Accumulation in progress. Consider inspection and partial cleaning.',
  'Critical Biofilm': 'Significant buildup. Corrective action and cleaning recommended.',
}

function getSystemStatus(createdAt) {
  const now = new Date()
  const last = new Date(createdAt)
  const diff = (now - last) / 60000

  if (diff < 1) {
    return { text: 'SYSTEM ACTIVE', className: 'system-status system-active' }
  }
  if (diff < 5) {
    return { text: 'DATA STALE', className: 'system-status system-stale' }
  }
  return { text: 'SYSTEM OFFLINE', className: 'system-status system-offline' }
}

const CHEMICALS = {
  chlorine: { name: 'Sodium Hypochlorite (12.5%)', unit: 'ml', rate: 50 }, // 50ml/1000L for shock
  phPlus: { name: 'pH Plus (Sodium Carbonate)', unit: 'g', rate: 50 }, // 50g/1000L
  phMinus: { name: 'pH Minus (Sodium Bisulfate)', unit: 'g', rate: 50 } // 50g/1000L
}

function calculateTreatments(vol, risk, dss, ph) {
  const list = []
  // Disinfection Logic: High risk or DSS recommendation
  if (risk >= 60 || dss !== 'Normal Operation') {
    const amount = (vol / 1000) * CHEMICALS.chlorine.rate
    list.push({ ...CHEMICALS.chlorine, amount: Math.ceil(amount), reason: 'Biofilm risk / Preventive maintenance' })
  }

  // pH Logic
  if (ph !== '--') {
    const p = Number(ph)
    if (p < 6.5) {
      const amount = (vol / 1000) * CHEMICALS.phPlus.rate
      list.push({ ...CHEMICALS.phPlus, amount: Math.ceil(amount), reason: 'Low pH (< 6.5)' })
    } else if (p > 8.5) {
      const amount = (vol / 1000) * CHEMICALS.phMinus.rate
      list.push({ ...CHEMICALS.phMinus, amount: Math.ceil(amount), reason: 'High pH (> 8.5)' })
    }
  }
  return list
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')
  const [systemStatus, setSystemStatus] = useState({ text: 'CHECKING…', className: 'system-status' })
  const [lastUpdated, setLastUpdated] = useState('Last updated: --')
  const [hasData, setHasData] = useState(false)
  const [healthPct, setHealthPct] = useState(0)
  const [healthColor, setHealthColor] = useState('#2ecc71')
  const [riskPercent, setRiskPercent] = useState('--%')
  const [riskBadge, setRiskBadge] = useState({ className: 'badge', text: '---' })
  const [ph, setPh] = useState('--')
  const [temp, setTemp] = useState('--')
  const [humidity, setHumidity] = useState('--')
  const [flow, setFlow] = useState('--')
  const [turb, setTurb] = useState('--')
  const [tds, setTds] = useState('--')
  const [phBar, setPhBar] = useState(0)
  const [tempBar, setTempBar] = useState(0)
  const [humidityBar, setHumidityBar] = useState(0)
  const [flowBar, setFlowBar] = useState(0)
  const [turbBar, setTurbBar] = useState(0)
  const [tdsBar, setTdsBar] = useState(0)
  const [paramStatus, setParamStatus] = useState({})
  const [stage, setStage] = useState('--')
  const [stageDescription, setStageDescription] = useState('')
  const [confidence, setConfidence] = useState('--%')
  const [confidenceNote, setConfidenceNote] = useState('')
  const [dssDecision, setDssDecision] = useState('--')
  const [dssAction, setDssAction] = useState('--')
  const [dssUrgency, setDssUrgency] = useState('--')
  const [dssReview, setDssReview] = useState('--')
  const [contributingFactors, setContributingFactors] = useState([])
  const [trend, setTrend] = useState(null)
  const [feeds, setFeeds] = useState([])
  const [waterVolume, setWaterVolume] = useState(() => Number(localStorage.getItem('waterVolume')) || 1000)
  const [lastMaintenance, setLastMaintenance] = useState(() => localStorage.getItem('lastMaintenance'))
  const [offsets, setOffsets] = useState(() => JSON.parse(localStorage.getItem('calibOffsets')) || { ph: 0, temp: 0, tds: 0 })
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    localStorage.setItem('waterVolume', waterVolume)
  }, [waterVolume])

  useEffect(() => {
    localStorage.setItem('lastMaintenance', lastMaintenance)
  }, [lastMaintenance])

  useEffect(() => {
    localStorage.setItem('calibOffsets', JSON.stringify(offsets))
  }, [offsets])

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission()
    }
  }, [])

  const treatments = useMemo(() => {
    const riskVal = riskPercent === '--%' ? 0 : parseFloat(riskPercent)
    return calculateTreatments(waterVolume, riskVal, dssDecision, ph)
  }, [waterVolume, riskPercent, dssDecision, ph])

  // Alert Logic
  useEffect(() => {
    const riskVal = riskPercent === '--%' ? 0 : parseFloat(riskPercent)
    if (riskVal > 80 && 'Notification' in window && Notification.permission === 'granted') {
      // Simple throttle: check last alert time
      const lastAlert = localStorage.getItem('lastAlertTimestamp')
      const now = Date.now()
      if (!lastAlert || (now - Number(lastAlert) > 3600000)) { // 1 hour
        new Notification('⚠️ High Biofilm Risk Detected', {
          body: `Current Risk: ${riskVal}%. Immediate action required.`,
          icon: '/vite.svg'
        })
        localStorage.setItem('lastAlertTimestamp', now)
      }
    }
  }, [riskPercent])

  const handleExport = () => {
    if (!feeds.length) return
    const headers = ['created_at', 'ph', 'temp', 'humidity', 'flow', 'turbidity', 'tds', 'risk_score', 'status']
    const csv = [
      headers.join(','),
      ...feeds.map(row => [
        row.created_at,
        Number(row.field1) + offsets.ph,
        Number(row.field2) + offsets.temp,
        row.field3,
        row.field4,
        row.field5,
        Number(row.field6) + offsets.tds,
        row.field7,
        row.field8
      ].join(','))
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `biofilm_data_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  const daysSinceMaintenance = useMemo(() => {
    if (!lastMaintenance) return 'Never'
    const diff = Date.now() - new Date(lastMaintenance).getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    return days === 0 ? 'Today' : `${days} days ago`
  }, [lastMaintenance])

  const lastValidData = useRef(null)

  // Theme: apply to document and persist
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark')
    } else {
      root.removeAttribute('data-theme')
    }
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  function updateUI(d, previous) {
    setHasData(true)
    const risk = Number(d.field7)
    const health = Math.max(0, 100 - risk)

    setHealthPct(health)
    setHealthColor(health > 70 ? '#2ecc71' : health > 40 ? '#f1c40f' : '#e74c3c')
    setRiskPercent(risk + '%')

    const badgeClass = d.field8 == 1 ? 'low' : d.field8 == 2 ? 'medium' : 'high'
    const badgeText = d.field8 == 1 ? 'LOW' : d.field8 == 2 ? 'MEDIUM' : 'HIGH'
    setRiskBadge({ className: `badge ${badgeClass}`, text: badgeText })

    // Trend vs previous reading
    if (previous != null) {
      const prevRisk = Number(previous.field7)
      const delta = risk - prevRisk
      if (delta > 0) setTrend({ dir: 'up', diff: delta.toFixed(1) })
      else if (delta < 0) setTrend({ dir: 'down', diff: (-delta).toFixed(1) })
      else setTrend({ dir: 'stable' })
    } else {
      setTrend(null)
    }

    setPh((Number(d.field1) + offsets.ph).toFixed(2))
    setTemp((Number(d.field2) + offsets.temp).toFixed(1))
    setHumidity(d.field3 ?? '--')
    setFlow(d.field4)
    setTurb(d.field5)
    setTds((Number(d.field6) + offsets.tds).toFixed(0))

    setPhBar((Number(d.field1) / 14) * 100)
    setTempBar((Number(d.field2) / 50) * 100)
    setHumidityBar(d.field3 != null ? Math.min(100, Number(d.field3)) : 0)
    setFlowBar(Math.max(0, 100 - Number(d.field4)))
    setTurbBar(Math.min(Number(d.field5) * 10, 100))
    setTdsBar(Math.min((Number(d.field6) + offsets.tds) / 10, 100))

    // Parameter status: Normal vs Caution (DSS-linked thresholds)
    const vPh = Number(d.field1) + offsets.ph, vTemp = Number(d.field2) + offsets.temp, vFlow = Number(d.field4), vTurb = Number(d.field5), vTds = Number(d.field6) + offsets.tds
    setParamStatus({
      ph: (vPh >= 6.5 && vPh <= 8.5) ? 'normal' : 'caution',
      temp: vTemp > 30 ? 'caution' : 'normal',
      humidity: 'normal',
      flow: vFlow < 60 ? 'caution' : 'normal',
      turb: vTurb > 5 ? 'caution' : 'normal',
      tds: vTds > 500 ? 'caution' : 'normal',
    })

    const stageVal = risk < 30 ? 'Early Growth' : risk < 60 ? 'Developing Biofilm' : 'Critical Biofilm'
    setStage(stageVal)
    setStageDescription(STAGE_DESCRIPTIONS[stageVal] || '')

    let agree = 0
    if (d.field5 > 5) agree++
    if (d.field4 < 60) agree++
    if (d.field6 > 500) agree++
    setConfidence(Math.min(100, agree * 33) + '%')
    setConfidenceNote(agree === 0 ? 'No indicators suggest elevated risk.' : `${agree} of 3 indicators (turbidity, flow, TDS) align with risk.`)

    const dss = runDSS(d)
    setDssDecision(dss.decision)
    setDssAction(dss.action)
    setDssUrgency(dss.urgency)
    setDssReview(dss.review)
    setContributingFactors(dss.factors || [])
  }

  function updateSystemStatus(createdAt) {
    const last = new Date(createdAt)
    setSystemStatus(getSystemStatus(createdAt))
    setLastUpdated('Last updated: ' + last.toLocaleTimeString())
  }

  async function fetchData() {
    try {
      const res = await fetch(API_URL)
      const json = await res.json()
      if (!json.feeds?.length) return

      const latest = json.feeds.at(-1)
      const previous = json.feeds.length >= 2 ? json.feeds.at(-2) : null
      lastValidData.current = latest
      setFeeds(json.feeds)
      updateSystemStatus(latest.created_at)
      updateUI(latest, previous)
    } catch {
      if (lastValidData.current) {
        updateSystemStatus(lastValidData.current.created_at)
        updateUI(lastValidData.current, null)
      }
    }
  }

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 5000)
    return () => clearInterval(id)
  }, [])

  const chartData = useMemo(() => ({
    labels: feeds.map((f) =>
      new Date(f.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    ),
    datasets: [
      {
        label: 'Biofilm Risk %',
        data: feeds.map((f) => Number(f.field7)),
        borderColor: theme === 'dark' ? '#4fc3f7' : '#0077b6',
        backgroundColor: theme === 'dark' ? 'rgba(79,195,247,0.12)' : 'rgba(0,119,182,0.12)',
        fill: true,
        tension: 0.3,
        pointRadius: feeds.length <= 5 ? 4 : 3,
        pointHoverRadius: 6,
      },
      {
        label: 'System Health %',
        data: feeds.map((f) => Math.max(0, 100 - Number(f.field7))),
        borderColor: theme === 'dark' ? '#27ae60' : '#2ecc71',
        backgroundColor: theme === 'dark' ? 'rgba(39,174,96,0.08)' : 'rgba(46,204,113,0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: feeds.length <= 5 ? 4 : 3,
        pointHoverRadius: 6,
      },
    ],
  }), [feeds, theme])

  const chartOptions = useMemo(() => {
    const muted = theme === 'dark' ? '#9fb3c8' : '#5f7d8c'
    const grid = theme === 'dark' ? 'rgba(159,179,200,0.15)' : 'rgba(95,125,140,0.15)'
    return {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: true, labels: { color: muted, usePointStyle: true } },
        tooltip: {
          backgroundColor: theme === 'dark' ? '#141d26' : '#fff',
          titleColor: theme === 'dark' ? '#e8f1f8' : '#0b2c3d',
          bodyColor: theme === 'dark' ? '#9fb3c8' : '#5f7d8c',
          borderColor: theme === 'dark' ? '#26323d' : '#dbe9f4',
          borderWidth: 1,
          padding: 10,
          callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y}%` },
        },
      },
      scales: {
        x: {
          grid: { color: grid },
          ticks: { color: muted, maxRotation: 45, font: { size: 11 } },
        },
        y: {
          min: 0,
          max: 100,
          grid: { color: grid },
          ticks: { color: muted, stepSize: 20 },
        },
      },
    }
  }, [theme])

  return (
    <div className="container">
      <header className="header">
        <h1>Biofilm Risk Dashboard</h1>
        <div className="header-right">
          <div className={systemStatus.className}>{systemStatus.text}</div>
          <button className="theme-toggle" onClick={() => setShowSettings(true)} style={{ background: 'var(--text-muted)' }}>⚙️</button>
          <button type="button" className="theme-toggle" onClick={toggleTheme}>
            {theme === 'dark' ? '🌞 Light' : '🌙 Dark'}
          </button>
        </div>
      </header>

      {/* Settings Modal */}
      {showSettings && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <div className="card" style={{ width: '90%', maxWidth: '450px', padding: '32px', animation: 'fadeIn 0.3s ease-out' }}>
            <h3 style={{ marginBottom: '24px', fontSize: '1.5rem', background: 'var(--primary-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Settings & Calibration</h3>

            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                Maintenance
                <small style={{ color: 'var(--text-muted)', fontWeight: 'normal', fontSize: '0.9rem' }}>Last: {daysSinceMaintenance}</small>
              </h4>
              <button
                onClick={() => { setLastMaintenance(new Date().toISOString()); alert('Maintenance Logged!') }}
                style={{ width: '100%', padding: '12px', background: 'var(--success-gradient)', color: 'white', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 6px rgba(16, 185, 129, 0.2)' }}
              >
                ✅ Log Cleaning / Maintenance
              </button>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ marginBottom: '12px' }}>Sensor Offsets</h4>
              <div style={{ display: 'grid', gap: '12px' }}>
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  pH Offset
                  <input type="number" step="0.1" value={offsets.ph} onChange={e => setOffsets({ ...offsets, ph: Number(e.target.value) })} style={{ width: '100px' }} />
                </label>
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  Temp Offset (°C)
                  <input type="number" step="0.1" value={offsets.temp} onChange={e => setOffsets({ ...offsets, temp: Number(e.target.value) })} style={{ width: '100px' }} />
                </label>
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  TDS Offset (ppm)
                  <input type="number" step="1" value={offsets.tds} onChange={e => setOffsets({ ...offsets, tds: Number(e.target.value) })} style={{ width: '100px' }} />
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={handleExport} style={{ flex: 1, padding: '12px', background: 'var(--primary-gradient)', color: 'white', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: '600', boxShadow: '0 4px 6px rgba(37, 99, 235, 0.2)' }}>
                📥 Export CSV
              </button>
              <button onClick={() => setShowSettings(false)} style={{ flex: 1, padding: '12px', background: 'transparent', border: '1px solid var(--glass-border)', color: 'var(--text-muted)', borderRadius: '12px', cursor: 'pointer', fontWeight: '600' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="top-section">
        <div className="card">
          <h3>Overall System Health</h3>
          <p className="card-desc">Inverse of biofilm risk (100 − risk). Higher is better.</p>
          <div className="health-track">
            <div
              className="health-fill"
              style={{ width: healthPct + '%', background: healthColor, boxShadow: `0 0 10px ${healthColor}` }}
            />
          </div>
          <p className="health-text" style={{ fontSize: '1.2rem', textAlign: 'right' }}>{hasData ? healthPct + '%' : '--%'}</p>
        </div>

        <div className="card">
          <h3>Predicted Biofilm Risk</h3>
          <div className="risk-value">{riskPercent}</div>
          <span className={riskBadge.className}>{riskBadge.text}</span>
          {trend && (
            <p className="risk-trend">
              {trend.dir === 'up' && `↑ ${trend.diff}% from last reading`}
              {trend.dir === 'down' && `↓ ${trend.diff}% from last reading`}
              {trend.dir === 'stable' && 'Stable vs last reading'}
            </p>
          )}
          <p className="risk-factors">
            Contributing factors: {contributingFactors.length ? contributingFactors.join(', ') : 'None'}
          </p>
        </div>
      </div>

      <div className="chart-card card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3>Real-time monitoring</h3>
            <p className="card-desc">Biofilm risk % and system health % over the last 10 readings.</p>
          </div>
          <div style={{ padding: '6px 12px', background: 'rgba(0,0,0,0.05)', borderRadius: '20px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Updates every 5s
          </div>
        </div>

        {feeds.length > 0 ? (
          <div className="chart-wrapper">
            <Line data={chartData} options={chartOptions} />
          </div>
        ) : (
          <div className="chart-placeholder">Collecting data… Chart will appear when data is available.</div>
        )}
      </div>

      <div className="params">
        <div className="param-card">
          <h4>pH <span className="param-meta">optimal 6.5–8.5</span></h4>
          <div className="bar"><span style={{ width: phBar + '%', background: paramStatus.ph === 'caution' ? 'var(--warning-gradient)' : 'var(--success-gradient)' }} /></div>
          <div className="param-row">
            <small className="param-value">{ph}</small>
            <span className={`param-status param-status--${paramStatus.ph || 'none'}`}>{paramStatus.ph === 'caution' ? 'Caution' : paramStatus.ph === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
        <div className="param-card">
          <h4>Temp <span className="param-meta">optimal ≤30 °C</span></h4>
          <div className="bar"><span style={{ width: tempBar + '%', background: paramStatus.temp === 'caution' ? 'var(--warning-gradient)' : 'var(--success-gradient)' }} /></div>
          <div className="param-row">
            <small className="param-value">{hasData && temp !== '--' ? `${temp} °C` : temp}</small>
            <span className={`param-status param-status--${paramStatus.temp || 'none'}`}>{paramStatus.temp === 'caution' ? 'Caution' : paramStatus.temp === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
        <div className="param-card">
          <h4>Humidity <span className="param-meta">typical 40–60%</span></h4>
          <div className="bar"><span style={{ width: humidityBar + '%', background: 'var(--primary-gradient)' }} /></div>
          <div className="param-row">
            <small className="param-value">{hasData && humidity !== '--' ? `${humidity} %` : humidity}</small>
            <span className={`param-status param-status--${paramStatus.humidity || 'none'}`}>{paramStatus.humidity === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
        <div className="param-card">
          <h4>Flow <span className="param-meta">optimal ≥60 L/min</span></h4>
          <div className="bar"><span style={{ width: flowBar + '%', background: paramStatus.flow === 'caution' ? 'var(--warning-gradient)' : 'var(--success-gradient)' }} /></div>
          <div className="param-row">
            <small className="param-value">{hasData && flow !== '--' ? `${flow} L/min` : flow}</small>
            <span className={`param-status param-status--${paramStatus.flow || 'none'}`}>{paramStatus.flow === 'caution' ? 'Caution' : paramStatus.flow === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
        <div className="param-card">
          <h4>Turbidity <span className="param-meta">optimal ≤5 NTU</span></h4>
          <div className="bar"><span style={{ width: turbBar + '%', background: paramStatus.turb === 'caution' ? 'var(--warning-gradient)' : 'var(--success-gradient)' }} /></div>
          <div className="param-row">
            <small className="param-value">{hasData && turb !== '--' ? `${turb} NTU` : turb}</small>
            <span className={`param-status param-status--${paramStatus.turb || 'none'}`}>{paramStatus.turb === 'caution' ? 'Caution' : paramStatus.turb === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
        <div className="param-card">
          <h4>TDS <span className="param-meta">optimal ≤500 ppm</span></h4>
          <div className="bar"><span style={{ width: tdsBar + '%', background: paramStatus.tds === 'caution' ? 'var(--warning-gradient)' : 'var(--success-gradient)' }} /></div>
          <div className="param-row">
            <small className="param-value">{hasData && tds !== '--' ? `${tds} ppm` : tds}</small>
            <span className={`param-status param-status--${paramStatus.tds || 'none'}`}>{paramStatus.tds === 'caution' ? 'Caution' : paramStatus.tds === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
      </div>

      <div className="mid-insights">
        <div className="insight-card">
          <h4>Biofilm Stage</h4>
          <p>{stage}</p>
          {stageDescription && <p className="insight-desc">{stageDescription}</p>}
        </div>
        <div className="insight-card">
          <h4>Confidence</h4>
          <p>{confidence}</p>
          {confidenceNote && <p className="insight-desc">{confidenceNote}</p>}
        </div>
        <div className="insight-card"><h4>DSS Decision</h4><p>{dssDecision}</p></div>
        <div className="insight-card"><h4>Urgency</h4><p>{dssUrgency}</p></div>
        <div className="insight-card"><h4>Recommended Action</h4><p>{dssAction}</p></div>
        <div className="insight-card"><h4>Next Review</h4><p>{dssReview}</p></div>
      </div>

      <div className="card" style={{ marginTop: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
          <h3 style={{ margin: 0 }}>Chemical Dosage Recommendations</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            System Volume (L)
            <input
              type="number"
              value={waterVolume}
              onChange={(e) => setWaterVolume(Math.max(0, Number(e.target.value)))}
              style={{ width: '120px', fontWeight: '600' }}
            />
          </label>
        </div>

        {treatments.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
            {treatments.map((t, i) => (
              <div key={i} style={{ padding: '20px', background: 'rgba(37, 99, 235, 0.05)', borderRadius: '16px', border: '1px solid rgba(37, 99, 235, 0.1)', transition: 'transform 0.2s' }}>
                <div style={{ fontWeight: '700', color: 'var(--primary)', marginBottom: '8px', fontSize: '1.1rem' }}>{t.name}</div>
                <div style={{ fontSize: '2rem', fontWeight: '800', display: 'flex', alignItems: 'baseline', gap: '6px', color: 'var(--text-main)' }}>
                  {t.amount} <span style={{ fontSize: '1rem', fontWeight: '500', color: 'var(--text-muted)' }}>{t.unit}</span>
                </div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>ℹ️</span> {t.reason}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            padding: '40px',
            textAlign: 'center',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%)',
            borderRadius: '16px',
            color: 'var(--success)',
            border: '1px solid rgba(16, 185, 129, 0.2)'
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>✅</div>
            <div style={{ fontWeight: '700', fontSize: '1.2rem' }}>System Nominal</div>
            <div style={{ opacity: 0.8, marginTop: '4px' }}>No chemical treatment required at this time.</div>
          </div>
        )}
      </div>

      <footer className="footer">{lastUpdated} · Refreshes every 5 s</footer>
    </div>
  )
}
