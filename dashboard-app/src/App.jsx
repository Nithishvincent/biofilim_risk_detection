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

    setPh(d.field1)
    setTemp(d.field2)
    setHumidity(d.field3 ?? '--')
    setFlow(d.field4)
    setTurb(d.field5)
    setTds(d.field6)

    setPhBar((Number(d.field1) / 14) * 100)
    setTempBar((Number(d.field2) / 50) * 100)
    setHumidityBar(d.field3 != null ? Math.min(100, Number(d.field3)) : 0)
    setFlowBar(Math.max(0, 100 - Number(d.field4)))
    setTurbBar(Math.min(Number(d.field5) * 10, 100))
    setTdsBar(Math.min(Number(d.field6) / 10, 100))

    // Parameter status: Normal vs Caution (DSS-linked thresholds)
    const vPh = Number(d.field1), vTemp = Number(d.field2), vFlow = Number(d.field4), vTurb = Number(d.field5), vTds = Number(d.field6)
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

  /* MOCK DATA FOR DEMO */
  const USE_MOCK_DATA = true
  const MOCK_DATA = {
    created_at: new Date().toISOString(),
    field1: '7.2', // pH
    field2: '32.5', // Temp (High)
    field3: '55',   // Humidity
    field4: '40',   // Flow (Low)
    field5: '8.5',  // Turbidity (High)
    field6: '600',  // TDS (High)
    field7: '75.0', // Risk % (High)
    field8: '3'     // Label Code (High)
  }

  async function fetchData() {
    if (USE_MOCK_DATA) {
      // Simulate network delay
      // await new Promise(r => setTimeout(r, 500))

      const latest = MOCK_DATA
      // Create a fake history for the chart based on the mock data
      const fakeFeeds = Array(10).fill(null).map((_, i) => ({
        ...latest,
        created_at: new Date(Date.now() - (9 - i) * 5000).toISOString(),
        field7: (Number(latest.field7) + (Math.random() * 4 - 2)).toFixed(1) // add jitter
      }))

      setFeeds(fakeFeeds)
      updateSystemStatus(new Date().toISOString())
      updateUI(latest, fakeFeeds.at(-2))
      return
    }

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
    // If using mock data, we don't strictly need to poll widely, but keeping it for animation is fine
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
          <button type="button" className="theme-toggle" onClick={toggleTheme}>
            {theme === 'dark' ? '🌞 Light' : '🌙 Dark'}
          </button>
        </div>
      </header>

      <div className="top-section">
        <div className="card">
          <h3>Overall System Health</h3>
          <p className="card-desc">Inverse of biofilm risk (100 − risk). Higher is better.</p>
          <div className="health-track">
            <div
              className="health-fill"
              style={{ width: healthPct + '%', background: healthColor }}
            />
          </div>
          <p className="health-text">{hasData ? healthPct + '%' : '--%'}</p>
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
        <h3>Real-time monitoring</h3>
        <p className="card-desc">Biofilm risk % and system health % over the last 10 readings. Updates every 5 s.</p>
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
          <h4>pH <span className="param-meta">(optimal 6.5–8.5)</span></h4>
          <div className="bar"><span style={{ width: phBar + '%' }} /></div>
          <div className="param-row">
            <small className="param-value">{ph}</small>
            <span className={`param-status param-status--${paramStatus.ph || 'none'}`}>{paramStatus.ph === 'caution' ? 'Caution' : paramStatus.ph === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
        <div className="param-card">
          <h4>Temperature <span className="param-meta">(optimal ≤30 °C)</span></h4>
          <div className="bar"><span style={{ width: tempBar + '%' }} /></div>
          <div className="param-row">
            <small className="param-value">{hasData && temp !== '--' ? `${temp} °C` : temp}</small>
            <span className={`param-status param-status--${paramStatus.temp || 'none'}`}>{paramStatus.temp === 'caution' ? 'Caution' : paramStatus.temp === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
        <div className="param-card">
          <h4>Humidity <span className="param-meta">(typical 40–60%)</span></h4>
          <div className="bar"><span style={{ width: humidityBar + '%' }} /></div>
          <div className="param-row">
            <small className="param-value">{hasData && humidity !== '--' ? `${humidity} %` : humidity}</small>
            <span className={`param-status param-status--${paramStatus.humidity || 'none'}`}>{paramStatus.humidity === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
        <div className="param-card">
          <h4>Flow <span className="param-meta">(optimal ≥60 L/min)</span></h4>
          <div className="bar"><span style={{ width: flowBar + '%' }} /></div>
          <div className="param-row">
            <small className="param-value">{hasData && flow !== '--' ? `${flow} L/min` : flow}</small>
            <span className={`param-status param-status--${paramStatus.flow || 'none'}`}>{paramStatus.flow === 'caution' ? 'Caution' : paramStatus.flow === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
        <div className="param-card">
          <h4>Turbidity <span className="param-meta">(optimal ≤5 NTU)</span></h4>
          <div className="bar"><span style={{ width: turbBar + '%' }} /></div>
          <div className="param-row">
            <small className="param-value">{hasData && turb !== '--' ? `${turb} NTU` : turb}</small>
            <span className={`param-status param-status--${paramStatus.turb || 'none'}`}>{paramStatus.turb === 'caution' ? 'Caution' : paramStatus.turb === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
        <div className="param-card">
          <h4>TDS <span className="param-meta">(optimal ≤500 ppm)</span></h4>
          <div className="bar"><span style={{ width: tdsBar + '%' }} /></div>
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

      <footer className="footer">{lastUpdated} · Refreshes every 5 s</footer>
    </div>
  )
}
