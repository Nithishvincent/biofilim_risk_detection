import { useState, useEffect, useRef, useMemo } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  RadialLinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line, Radar, Bar } from 'react-chartjs-2'

import {
  Microscope,
  Shield,
  Activity,
  Droplet,
  Thermometer,
  Wind,
  Cloud,
  Zap,
  AlertTriangle,
  Check,
  Settings,
  FlaskConical,
  Wifi,
  WifiOff
} from './components/Icons'
import './App.css'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  RadialLinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
)

const API_URL = 'https://api.thingspeak.com/channels/692657/feeds.json?results=10'

const CHEMICALS = {
  chlorine: { name: 'Sodium Hypochlorite (12.5%)', unit: 'ml', rate: 50 }, // 50ml/1000L for shock
  phPlus: { name: 'pH Plus (Sodium Carbonate)', unit: 'g', rate: 50 }, // 50g/1000L
  phMinus: { name: 'pH Minus (Sodium Bisulfate)', unit: 'g', rate: 50 } // 50g/1000L
}

function predictBiofilmRisk(temp, ph, turbidity, flow, tds) {
  // Simple heuristic model for demo purposes
  // Real model would be ML-based trained on historical data
  let score = 10 // Base risk

  // Temp factor (ideal for biofilm: 20-35C)
  if (temp > 20 && temp < 35) score += 20
  else if (temp > 35) score += 10

  // pH factor (extreme pH inhibits growth, neutral promotes)
  if (ph > 6.5 && ph < 8.0) score += 20

  // Turbidity factor (suspended particles provide surface area)
  if (turbidity > 5) score += 25

  // Stagnation factor (low flow promotes attachment)
  if (flow < 10) score += 25

  // Nutrients/TDS
  if (tds > 500) score += 10

  return Math.min(score, 100)
}

function dssLogic(risk, ph, turbidity) {
  if (risk > 80) return "Critical: Immediate chemical shock required."
  if (risk > 60) return "Warning: Increase flow rate and monitor."
  if (ph < 6.5 || ph > 8.5) return "Action: Adjust pH levels."
  if (turbidity > 10) return "Action: Check filtration system."
  return "Normal Operation"
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

// Helper to determine biofilm stage
const getBiofilmStage = (risk) => {
  if (risk < 30) return { stage: 'Initial Attachment', color: 'green', desc: 'Planktonic cells attaching.' }
  if (risk < 60) return { stage: 'Irreversible Attachment', color: 'orange', desc: 'EPS production starting.' }
  if (risk < 85) return { stage: 'Maturation I', color: 'orange', desc: 'Microcolonies forming.' }
  return { stage: 'Maturation II / Dispersion', color: 'red', desc: 'Critical mass reached.' }
}


export default function App() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [feeds, setFeeds] = useState([])
  const [lastUpdate, setLastUpdate] = useState(null)

  const [waterVolume, setWaterVolume] = useState(() => Number(localStorage.getItem('waterVolume')) || 1000)
  const [lastMaintenance, setLastMaintenance] = useState(() => localStorage.getItem('lastMaintenance') || null)
  const [showSettings, setShowSettings] = useState(false)
  const [offsets, setOffsets] = useState(() => {
    const saved = localStorage.getItem('calibOffsets')
    return saved ? JSON.parse(saved) : { ph: 0, temp: 0, tds: 0 }
  })

  const [theme, setTheme] = useState('light')
  const [connectionStatus, setConnectionStatus] = useState('connecting') // connected, disconnected, connecting

  useEffect(() => {
    localStorage.setItem('waterVolume', waterVolume)
  }, [waterVolume])

  useEffect(() => {
    localStorage.setItem('lastMaintenance', lastMaintenance)
  }, [lastMaintenance])

  useEffect(() => {
    localStorage.setItem('calibOffsets', JSON.stringify(offsets))
  }, [offsets])

  useEffect(() => {
    localStorage.setItem('calibOffsets', JSON.stringify(offsets))
  }, [offsets])

  // Apply theme to body
  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission()
    }
  }, [])

  // Lock body scroll when settings modal is open
  useEffect(() => {
    if (showSettings) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [showSettings])

  const fetchData = async () => {
    try {
      // setLoading(true) // Don't block UI on background updates
      const res = await fetch(API_URL)
      const json = await res.json()
      if (json.feeds && json.feeds.length > 0) {
        const latest = json.feeds[json.feeds.length - 1]
        setData(latest)
        setFeeds(json.feeds)
        setLastUpdate(new Date().toLocaleTimeString())

        // Check if data is stale (> 60 seconds)
        const lastTime = new Date(latest.created_at).getTime()
        const now = Date.now()
        const isStale = (now - lastTime) > 60000

        // Check Status Code (Field 8) and Staleness
        // 0 = Manual Shutdown
        // >60s = Timeout/Crash
        const statusCode = Number(latest.field8)

        if (statusCode === 0 || isStale) {
          setConnectionStatus('disconnected') // Consolidate to "Offline"
        } else {
          setConnectionStatus('connected') // Active
        }
      }
    } catch (err) {
      console.error("Error fetching data:", err)
      setConnectionStatus('disconnected')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000) // Poll every 5s
    return () => clearInterval(interval)
  }, [])

  // Derived Values
  const getVal = (field, offsetKey = null) => {
    if (!data || !data[field]) return '--'
    let val = parseFloat(data[field])
    if (offsetKey) val += (offsets[offsetKey] || 0)
    return isNaN(val) ? '--' : val.toFixed(1)
  }

  const rawPh = getVal('field1', 'ph') // pH
  const rawTemp = getVal('field2', 'temp') // Temp
  const rawHumidity = getVal('field3') // Humidity
  const rawFlow = getVal('field4') // Flow
  const rawTurbidity = getVal('field5') // Turbidity
  const rawTds = getVal('field6', 'tds') // TDS

  const ph = rawPh
  const temp = rawTemp
  const humidity = rawHumidity
  const flow = rawFlow
  const turb = rawTurbidity
  const tds = rawTds

  // Calculate Risk
  // Calculate Risk
  // PRIORITIZE ML MODEL from Backend (Field 7)
  // If Field 7 is present, use it. Otherwise fallback to frontend heuristic.
  const rawRisk = data && data.field7 ? Number(data.field7) : null

  const riskScore = (rawRisk !== null)
    ? rawRisk
    : (ph !== '--' && temp !== '--' && turb !== '--' && flow !== '--' && tds !== '--')
      ? predictBiofilmRisk(Number(temp), Number(ph), Number(turb), Number(flow), Number(tds))
      : 0

  const riskPercent = (ph !== '--') ? Number(riskScore).toFixed(1) + '%' : '--%'

  // Auto-maintenance suggestion
  useEffect(() => {
    if (riskScore > 80 && !lastMaintenance) {
      // If risk is critical and no maintenance logged, suggest it
      // In a real app, this might be a persistent state
    }
  }, [riskScore, lastMaintenance])

  useEffect(() => {
    const riskVal = riskScore
    if (riskVal > 80 && 'Notification' in window && Notification.permission === 'granted') {
      const lastAlert = localStorage.getItem('lastAlertTimestamp')
      const now = Date.now()
      if (!lastAlert || (now - Number(lastAlert) > 3600000)) {
        new Notification('⚠️ High Biofilm Risk Detected', {
          body: `Current Risk: ${riskVal}%. Immediate action required.`
        })
        localStorage.setItem('lastAlertTimestamp', now)
      }
    }
  }, [riskScore])

  // Auto-estimate volume from flow
  const estimateVolume = () => {
    if (flow !== '--') {
      // Heuristic: Flow (L/min) * 60 min * 4 hours turnover
      const est = Math.round(Number(flow) * 60 * 4)
      setWaterVolume(est)
      alert(`Volume estimated at ${est} L based on current flow rate.`)
    } else {
      alert("Cannot estimate volume: Flow rate data unavailable.")
    }
  }

  // Badge Logic
  const getRiskBadge = (score) => {
    if (score < 30) return { text: 'Low Risk', className: 'badge low' }
    if (score < 60) return { text: 'Moderate Risk', className: 'badge medium' }
    return { text: 'High Risk', className: 'badge high' }
  }
  const riskBadge = getRiskBadge(riskScore)
  const biofilmStage = getBiofilmStage(riskScore)

  // System Health (Inverse of Risk for demo)
  const healthPct = (ph !== '--') ? Number((100 - riskScore).toFixed(1)) : 0
  const healthColor = healthPct > 70 ? 'var(--success-gradient)' : healthPct > 40 ? 'var(--warning-gradient)' : 'var(--danger-gradient)'

  // Contributing Factors
  const contributingFactors = []
  if (data) {
    if (Number(temp) > 30) contributingFactors.push('High Temp')
    if (Number(flow) < 10) contributingFactors.push('Low Flow')
    if (Number(turb) > 5) contributingFactors.push('High Turbidity')
    if (Number(ph) < 6.5 || Number(ph) > 8.5) contributingFactors.push('Unstable pH')
  }

  // Trend Analysis
  const getTrend = () => {
    if (feeds.length < 2) return null
    const curr = predictBiofilmRisk(
      Number(feeds[feeds.length - 1].field2) + offsets.temp,
      Number(feeds[feeds.length - 1].field1) + offsets.ph,
      Number(feeds[feeds.length - 1].field5),
      Number(feeds[feeds.length - 1].field4),
      Number(feeds[feeds.length - 1].field6) + offsets.tds
    )
    const prev = predictBiofilmRisk(
      Number(feeds[feeds.length - 2].field2) + offsets.temp,
      Number(feeds[feeds.length - 2].field1) + offsets.ph,
      Number(feeds[feeds.length - 2].field5),
      Number(feeds[feeds.length - 2].field4),
      Number(feeds[feeds.length - 2].field6) + offsets.tds
    )
    const diff = curr - prev
    if (Math.abs(diff) < 2) return { dir: 'stable', diff: 0 }
    return { dir: diff > 0 ? 'up' : 'down', diff: Math.abs(diff) }
  }
  const trend = getTrend()

  // DSS Decision
  const dssDecision = (ph !== '--') ? dssLogic(riskScore, Number(ph), Number(turb)) : 'Waiting for data...'

  // Suggested Actions/Treatments
  const treatments = (ph !== '--') ? calculateTreatments(waterVolume, riskScore, dssDecision, ph) : []

  // Chart Data
  const chartData = {
    labels: feeds.map(f => {
      const d = new Date(f.created_at)
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }),
    datasets: [
      {
        label: 'Biofilm Risk %',
        data: feeds.map(f => {
          if (f.field7) return Number(f.field7) // Use ML Model History
          return predictBiofilmRisk(
            Number(f.field2) + offsets.temp,
            Number(f.field1) + offsets.ph,
            Number(f.field5),
            Number(f.field4),
            Number(f.field6) + offsets.tds
          )
        }),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.2)',
        tension: 0.4,
        fill: true
      },
      {
        label: 'System Health %',
        data: feeds.map(f => {
          const r = f.field7 ? Number(f.field7) : predictBiofilmRisk(
            Number(f.field2) + offsets.temp,
            Number(f.field1) + offsets.ph,
            Number(f.field5),
            Number(f.field4),
            Number(f.field6) + offsets.tds
          )
          return 100 - r
        }),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        tension: 0.4,
        fill: true
      }
    ]
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: { mode: 'index', intersect: false }
    },
    scales: {
      y: { min: 0, max: 100, grid: { color: 'rgba(0,0,0,0.05)' } },
      x: { grid: { display: false } }
    },
    interaction: { mode: 'nearest', axis: 'x', intersect: false }
  }

  // Parameter Status
  const getParamStatus = (val, type) => {
    if (val === '--') return null
    const v = Number(val)
    if (type === 'ph') return (v < 6.5 || v > 8.5) ? 'caution' : 'normal'
    if (type === 'temp') return (v > 30) ? 'caution' : 'normal'
    if (type === 'flow') return (v < 60) ? 'caution' : 'normal'
    if (type === 'turb') return (v > 5) ? 'caution' : 'normal'
    if (type === 'tds') return (v > 500) ? 'caution' : 'normal'
    return 'normal' // default
  }

  const paramStatus = {
    ph: getParamStatus(ph, 'ph'),
    temp: getParamStatus(temp, 'temp'),
    flow: getParamStatus(flow, 'flow'),
    turb: getParamStatus(turb, 'turb'),
    tds: getParamStatus(tds, 'tds'),
    humidity: 'normal'
  }

  // Visual Bars % (clamped 0-100 for width)
  const calcBar = (val, max) => {
    if (val === '--') return 0
    return Math.min(100, Math.max(0, (Number(val) / max) * 100))
  }

  const phBar = calcBar(ph, 14)
  const tempBar = calcBar(temp, 50)
  const humidityBar = calcBar(humidity, 100)
  const flowBar = calcBar(flow, 100)
  const turbBar = calcBar(turb, 20)
  const tdsBar = calcBar(tds, 1000)

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

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>Biofilm Risk Detection</h1>
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            <span>IoT-Enabled Real-Time Monitor</span>
            <span>•</span>
            <span>Last updated: {lastUpdate || 'Connecting...'}</span>
          </div>
        </div>
        <div className="header-right">
          <div className={`system-status ${connectionStatus === 'connected' ? 'system-active pulse-animation' : 'system-offline'}`}>
            {connectionStatus === 'connected' ? '● System Active' : '● System Inactive (Last Logged)'}
          </div>
          <button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title="Toggle Theme">
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          <button
            className="theme-toggle"
            onClick={() => setShowSettings(true)}
            title="Settings & Calibration"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <div className="card" style={{ width: '90%', maxWidth: '450px', padding: '32px', animation: 'fadeIn 0.3s ease-out' }}>
            <h3 style={{ marginBottom: '24px', fontSize: '1.5rem', background: 'var(--primary-gradient)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Settings & Calibration</h3>

            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                Maintenance
                <small style={{ color: 'var(--text-muted)', fontWeight: 'normal', fontSize: '0.9rem' }}>Last: {daysSinceMaintenance}</small>
              </h4>
              <button
                onClick={() => { setLastMaintenance(new Date().toISOString()); alert('Maintenance Logged!') }}
                style={{ width: '100%', padding: '12px', background: 'var(--success-gradient)', color: 'white', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 6px rgba(16, 185, 129, 0.2)' }}
              >
                <Check size={16} style={{ display: 'inline', marginRight: '6px' }} />
                Log Cleaning / Maintenance
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
        {/* Biofilm Risk Card - Redesigned */}
        <div className="card rich-card animate-fade-in hover-scale">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3>Biofilm Risk Prediction</h3>
              <p className="card-desc" style={{ marginBottom: '20px' }}>Real-time growth probability analysis.</p>
            </div>
            <div className={`icon-wrapper ${riskScore > 60 ? 'red' : riskScore > 30 ? 'orange' : 'green'} animate-scale-in`}>
              {riskScore > 60 ? <AlertTriangle /> : <Activity />}
            </div>
          </div>

          <div className="ring-container">
            {/* Simple SVG Ring visual */}
            <svg style={{ transform: 'rotate(-90deg)' }} width="120" height="120">
              <circle cx="60" cy="60" r="54" fill="none" stroke="var(--glass-border)" strokeWidth="12" />
              <circle
                cx="60" cy="60" r="54"
                fill="none"
                stroke={riskScore > 60 ? 'var(--danger)' : riskScore > 30 ? 'var(--warning)' : 'var(--success)'}
                strokeWidth="12"
                strokeDasharray={339.292}
                strokeDashoffset={339.292 - (339.292 * riskScore) / 100}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 1s ease-in-out' }}
              />
            </svg>
            <div className="ring-value">{riskPercent}</div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <span className={riskBadge.className}>{riskBadge.text}</span>
            {trend && (
              <p className="risk-trend" style={{ marginTop: '12px', fontSize: '0.9rem' }}>
                {trend.dir === 'up' && <span style={{ color: 'var(--danger)' }}>Trends ↑ {trend.diff}%</span>}
                {trend.dir === 'down' && <span style={{ color: 'var(--success)' }}>Trends ↓ {trend.diff}%</span>}
                {trend.dir === 'stable' && <span style={{ color: 'var(--text-muted)' }}>Stable vs last reading</span>}
              </p>
            )}
          </div>
        </div>

        {/* System Health Card - Redesigned */}
        <div className="card rich-card animate-fade-in hover-scale" style={{ animationDelay: '0.2s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3>System Health</h3>
              <p className="card-desc" style={{ marginBottom: '20px' }}>Overall stability and resilience.</p>
            </div>
            <div className={`icon-wrapper ${healthPct > 70 ? 'green' : healthPct > 40 ? 'orange' : 'red'} animate-scale-in`}>
              <Shield />
            </div>
          </div>

          <div className="ring-container">
            <svg style={{ transform: 'rotate(-90deg)' }} width="120" height="120">
              <circle cx="60" cy="60" r="54" fill="none" stroke="var(--glass-border)" strokeWidth="12" />
              <circle
                cx="60" cy="60" r="54"
                fill="none"
                stroke={healthPct > 70 ? 'var(--success)' : healthPct > 40 ? 'var(--warning)' : 'var(--danger)'}
                strokeWidth="12"
                strokeDasharray={339.292}
                strokeDashoffset={339.292 - (339.292 * healthPct) / 100}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 1s ease-in-out' }}
              />
            </svg>
            <div className="ring-value">{healthPct}%</div>
          </div>

          <div style={{ textAlign: 'center', marginTop: '8px' }}>
            <p className="risk-factors">
              {contributingFactors.length ? (
                <>
                  <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Strain Factors:</span>
                  {contributingFactors.join(' • ')}
                </>
              ) : (
                <span style={{ color: 'var(--success)' }}>Optimal Conditions</span>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card animate-slide-up stagger-1 hover-scale">
          <h4>Biofilm Stage</h4>
          <div className="icon-wrapper blue" style={{ marginBottom: '12px' }}><Microscope size={20} /></div>
          <div className="stat-value">{biofilmStage.stage}</div>
          <div className="stat-sub">{biofilmStage.desc}</div>
        </div>

        <div className="stat-card animate-slide-up stagger-2 hover-scale">
          <h4>Data Confidence</h4>
          <div className="icon-wrapper orange" style={{ marginBottom: '12px' }}><Activity size={20} /></div>
          <div className="stat-value">{[ph, temp, flow, turb, tds].filter(v => v !== '--').length}/5 Active</div>
          <div className="stat-sub">Live Sensor Streams</div>
        </div>

        <div className="stat-card animate-slide-up stagger-3 hover-scale">
          <h4>DSS Decision</h4>
          <div className={`icon-wrapper ${dssDecision.includes('Normal') ? 'green' : 'red'}`} style={{ marginBottom: '12px' }}>
            {dssDecision.includes('Normal') ? <Check size={20} /> : <AlertTriangle size={20} />}
          </div>
          <div className="stat-value" style={{ fontSize: '1rem' }}>{dssDecision}</div>
        </div>

        <div className="stat-card animate-slide-up stagger-4 hover-scale">
          <h4>Dev. Status</h4>
          <div className={`icon-wrapper ${connectionStatus === 'connected' ? 'green' : 'red'}`} style={{ marginBottom: '12px' }}>
            {connectionStatus === 'connected' ? <Wifi size={20} /> : <WifiOff size={20} />}
          </div>
          <div className="stat-value">
            {connectionStatus === 'connected' ? 'Online' : 'Offline'}
          </div>
          <div className="stat-sub">
            {connectionStatus === 'connected' ? 'Signal Stable' : 'Last Logged Data'}
          </div>
        </div>

        <div className="stat-card animate-slide-up stagger-4 hover-scale" style={{ animationDelay: '0.5s' }}>
          <h4>Last Maint.</h4>
          <div className="icon-wrapper green" style={{ marginBottom: '12px' }}><Settings size={20} /></div>
          <div className="stat-value">{daysSinceMaintenance}</div>
          <div className="stat-sub">{lastMaintenance ? new Date(lastMaintenance).toLocaleDateString() : 'No record'}</div>
        </div>
      </div>

      <div className="card rich-card chart-card animate-fade-in" style={{ marginTop: '32px', animationDelay: '0.4s' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3>Real-time Monitoring</h3>
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

      {/* Advanced Visualizations: Deep Dive */}
      <div className="top-section" style={{ marginTop: '32px' }}>
        <div className="card rich-card animate-fade-in" style={{ animationDelay: '0.6s' }}>
          <h3>Water Quality Profile</h3>
          <p className="card-desc">Normalized metrics (0-100) to visualize balance.</p>
          <div style={{ height: '300px', display: 'flex', justifyContent: 'center' }}>
            <Radar
              data={{
                labels: ['pH', 'Temp', 'Flow', 'Turbidity', 'TDS'],
                datasets: [{
                  label: 'Current Status',
                  data: [
                    (Number(ph) / 14) * 100,
                    (Number(temp) / 50) * 100,
                    (Number(flow) / 100) * 100,
                    (Number(turb) / 20) * 100,
                    (Number(tds) / 1000) * 100
                  ],
                  backgroundColor: 'rgba(37, 99, 235, 0.2)',
                  borderColor: '#2563eb',
                  borderWidth: 2,
                }]
              }}
              options={{
                scales: {
                  r: {
                    suggestedMin: 0,
                    suggestedMax: 100,
                    grid: { color: 'rgba(0,0,0,0.1)' },
                    angleLines: { color: 'rgba(0,0,0,0.1)' }
                  }
                },
                plugins: { legend: { display: false } }
              }}
            />
          </div>
        </div>

        <div className="card rich-card animate-fade-in" style={{ animationDelay: '0.7s' }}>
          <h3>Safety Thresholds</h3>
          <p className="card-desc">Current values vs. Recommended Limits.</p>
          <div style={{ height: '300px' }}>
            <Bar
              plugins={[{
                id: 'limitLine',
                afterDatasetsDraw: (chart) => {
                  const { ctx, scales: { x }, chartArea: { top, bottom } } = chart
                  if (!x) return
                  const xValue = x.getPixelForValue(100)

                  ctx.save()
                  ctx.beginPath()
                  ctx.lineWidth = 2
                  ctx.strokeStyle = '#a0a0a0ff'
                  ctx.setLineDash([6, 4])
                  ctx.moveTo(xValue, top)
                  ctx.lineTo(xValue, bottom)
                  ctx.stroke()
                  ctx.restore()
                }
              }]}
              data={{
                labels: ['pH', 'Temperature', 'Turbidity'],
                datasets: [
                  // Layer 1: The Value Bar
                  {
                    label: 'Current Level',
                    data: [
                      (Number(ph) / 8.5) * 100,
                      (Number(temp) / 30) * 100,
                      (Number(turb) / 5) * 100
                    ],
                    backgroundColor: (context) => {
                      const val = context.raw
                      // Red if Critical (>100%), otherwise Identity Color
                      if (val > 100) return '#ef4444'

                      // Identity Colors
                      if (context.dataIndex === 0) return '#3b82f6' // pH: Blue
                      if (context.dataIndex === 1) return '#f59e0b' // Temp: Orange
                      if (context.dataIndex === 2) return '#10b981' // Turb: Green
                      return '#64748b'
                    },
                    borderRadius: 6,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8,
                    order: 1, // Draw behind line
                  },
                  // Layer 2: The Limit Line (Keep for Legend, but line drawn by plugin covers it)
                  {
                    label: 'Safety Limit',
                    data: [100, 100, 100],
                    type: 'line',
                    borderColor: '#ef4444', // Keep color for Legend
                    borderWidth: 0,         // Hide the dataset line (drawn by plugin)
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    fill: false,
                    order: 0
                  }
                ]
              }}
              options={{
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                  padding: { right: 30 } // Space for tooltips/labels
                },
                scales: {
                  x: {
                    beginAtZero: true,
                    max: 120, // Enough room to show "Over Limit" bars
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    title: { display: true, text: '% of Safe Limit' }
                  },
                  y: {
                    grid: { display: false },
                    ticks: {
                      font: { weight: 'bold', size: 12 },
                      autoSkip: false
                    }
                  }
                },
                plugins: {
                  legend: {
                    display: true,
                    position: 'bottom',
                    labels: { usePointStyle: true, padding: 20 }
                  },
                  tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: '#1e293b',
                    bodyColor: '#475569',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    padding: 12,
                    boxPadding: 4,
                    callbacks: {
                      label: (context) => {
                        const val = context.raw
                        // Generic label for limit line
                        if (context.dataset.label === 'Safety Limit') return 'Safety Limit: 100%'

                        let realVal = 0, limit = 0, unit = ''
                        if (context.dataIndex === 0) { realVal = Number(ph); limit = 8.5; unit = '' }
                        if (context.dataIndex === 1) { realVal = Number(temp); limit = 30; unit = '°C' }
                        if (context.dataIndex === 2) { realVal = Number(turb); limit = 5; unit = 'NTU' }

                        const pct = val.toFixed(1)
                        return `${realVal}${unit} (Limit: ${limit}${unit}) • ${pct}%`
                      }
                    }
                  }
                }
              }}
            />
          </div>
        </div>
      </div>

      <div className="params animate-slide-up" style={{ animationDelay: '0.5s' }}>
        <div className="param-card hover-scale">
          <h4>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Droplet size={16} color="var(--primary)" /> pH</span>
            <span className="param-meta">optimal 6.5–8.5</span>
          </h4>
          <div className="bar"><span style={{ width: phBar + '%', background: paramStatus.ph === 'caution' ? 'var(--warning-gradient)' : 'var(--success-gradient)' }} /></div>
          <div className="param-row">
            <small className="param-value">{ph}</small>
            <span className={`param-status param-status--${paramStatus.ph || 'none'}`}>{paramStatus.ph === 'caution' ? 'Caution' : paramStatus.ph === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
        <div className="param-card">
          <h4>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Thermometer size={16} color="var(--danger)" /> Temp</span>
            <span className="param-meta">optimal ≤30 °C</span>
          </h4>
          <div className="bar"><span style={{ width: tempBar + '%', background: paramStatus.temp === 'caution' ? 'var(--warning-gradient)' : 'var(--success-gradient)' }} /></div>
          <div className="param-row">
            <small className="param-value">{temp !== '--' ? `${temp} °C` : temp}</small>
            <span className={`param-status param-status--${paramStatus.temp || 'none'}`}>{paramStatus.temp === 'caution' ? 'Caution' : paramStatus.temp === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
        <div className="param-card">
          <h4>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Cloud size={16} color="var(--text-muted)" /> Humidity</span>
            <span className="param-meta">typical 40–60%</span>
          </h4>
          <div className="bar"><span style={{ width: humidityBar + '%', background: 'var(--primary-gradient)' }} /></div>
          <div className="param-row">
            <small className="param-value">{humidity !== '--' ? `${humidity} %` : humidity}</small>
            <span className={`param-status param-status--${paramStatus.humidity || 'none'}`}>{paramStatus.humidity === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
        <div className="param-card">
          <h4>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Wind size={16} color="var(--primary)" /> Flow</span>
            <span className="param-meta">optimal ≥60 L/min</span>
          </h4>
          <div className="bar"><span style={{ width: flowBar + '%', background: paramStatus.flow === 'caution' ? 'var(--warning-gradient)' : 'var(--success-gradient)' }} /></div>
          <div className="param-row">
            <small className="param-value">{flow !== '--' ? `${flow} L/min` : flow}</small>
            <span className={`param-status param-status--${paramStatus.flow || 'none'}`}>{paramStatus.flow === 'caution' ? 'Caution' : paramStatus.flow === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
        <div className="param-card">
          <h4>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Zap size={16} color="var(--warning)" /> Turbidity</span>
            <span className="param-meta">optimal ≤5 NTU</span>
          </h4>
          <div className="bar"><span style={{ width: turbBar + '%', background: paramStatus.turb === 'caution' ? 'var(--warning-gradient)' : 'var(--success-gradient)' }} /></div>
          <div className="param-row">
            <small className="param-value">{turb !== '--' ? `${turb} NTU` : turb}</small>
            <span className={`param-status param-status--${paramStatus.turb || 'none'}`}>{paramStatus.turb === 'caution' ? 'Caution' : paramStatus.turb === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
        <div className="param-card">
          <h4>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Activity size={16} color="var(--text-muted)" /> TDS</span>
            <span className="param-meta">optimal ≤500 ppm</span>
          </h4>
          <div className="bar"><span style={{ width: tdsBar + '%', background: paramStatus.tds === 'caution' ? 'var(--warning-gradient)' : 'var(--success-gradient)' }} /></div>
          <div className="param-row">
            <small className="param-value">{tds !== '--' ? `${tds} ppm` : tds}</small>
            <span className={`param-status param-status--${paramStatus.tds || 'none'}`}>{paramStatus.tds === 'caution' ? 'Caution' : paramStatus.tds === 'normal' ? 'Normal' : '—'}</span>
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <h4>Biofilm Stage</h4>
          <div className="icon-wrapper blue" style={{ marginBottom: '12px' }}><Microscope size={20} /></div>
          <div className="stat-value">{biofilmStage.stage}</div>
          <div className="stat-sub">{biofilmStage.desc}</div>
        </div>

        <div className="stat-card">
          <h4>Confidence</h4>
          <div className="icon-wrapper orange" style={{ marginBottom: '12px' }}><Activity size={20} /></div>
          <div className="stat-value">3 Indic.</div>
          <div className="stat-sub">Flow, Turb, TDS matched</div>
        </div>

        <div className="stat-card">
          <h4>DSS Decision</h4>
          <div className={`icon-wrapper ${dssDecision.includes('Normal') ? 'green' : 'red'}`} style={{ marginBottom: '12px' }}>
            {dssDecision.includes('Normal') ? <Check size={20} /> : <AlertTriangle size={20} />}
          </div>
          <div className="stat-value" style={{ fontSize: '1rem' }}>{dssDecision}</div>
        </div>

        <div className="stat-card">
          <h4>Maintenance</h4>
          <div className={`icon-wrapper ${daysSinceMaintenance.includes('Today') ? 'green' : riskScore > 80 ? 'red' : 'blue'}`} style={{ marginBottom: '12px' }}>
            <Settings size={20} />
          </div>
          <div className="stat-value">{riskScore > 80 && !daysSinceMaintenance.includes('Today') ? 'Required' : 'Status OK'}</div>
          <div className="stat-sub">{lastMaintenance ? new Date(lastMaintenance).toLocaleDateString() : 'No record'}</div>
        </div>
      </div>

      <div className="card rich-card" style={{ marginTop: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="icon-wrapper blue" style={{ marginBottom: 0, width: '40px', height: '40px' }}><FlaskConical size={20} /></div>
            <div>
              <h3 style={{ margin: 0 }}>Chemical Dosage</h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Automated treatment recommendations</p>
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            System Volume (L)
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="number"
                value={waterVolume}
                onChange={(e) => setWaterVolume(Math.max(0, Number(e.target.value)))}
                style={{ width: '80px', fontWeight: '600', padding: '8px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}
              />
              <button
                onClick={estimateVolume}
                title="Auto-estimate from flow rate"
                style={{ padding: '8px', background: 'var(--primary-gradient)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
              >
                ⚡
              </button>
            </div>
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
                  <AlertTriangle size={14} /> {t.reason}
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
            <div style={{ marginBottom: '16px', display: 'inline-flex', padding: '16px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.2)' }}>
              <Check size={32} />
            </div>
            <div style={{ fontWeight: '700', fontSize: '1.2rem' }}>System Nominal</div>
            <div style={{ opacity: 0.8, marginTop: '4px' }}>No chemical treatment required at this time.</div>
          </div>
        )}
      </div>

      <div className="footer">
        <p>Last updated: {lastUpdate} · Refreshes every 5s</p>
      </div>
    </div >
  )
}
