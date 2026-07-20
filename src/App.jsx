import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import './App.css'

const STREETS = ['preflop', 'flop', 'turn', 'river']

export default function App() {
  const [view, setView] = useState('home') // 'home' | 'create' | 'track'
  const [trackers, setTrackers] = useState([])
  const [outcomes, setOutcomes] = useState({}) // tracker_id -> outcomes[]
  const [activeTracker, setActiveTracker] = useState(null)
  const [counts, setCounts] = useState({}) // outcome_id -> count
  const [lastLogged, setLastLogged] = useState(null)

  // create form state
  const [newName, setNewName] = useState('')
  const [newStreet, setNewStreet] = useState('preflop')
  const [newOutcomes, setNewOutcomes] = useState([''])

  useEffect(() => {
    loadTrackers()
  }, [])

  async function loadTrackers() {
    const { data: t } = await supabase.from('trackers').select('*').order('created_at')
    const { data: o } = await supabase.from('tracker_outcomes').select('*').order('sort_order')
    setTrackers(t || [])
    const grouped = {}
    ;(o || []).forEach(oc => {
      if (!grouped[oc.tracker_id]) grouped[oc.tracker_id] = []
      grouped[oc.tracker_id].push(oc)
    })
    setOutcomes(grouped)
  }

  async function loadCounts(trackerId) {
    const { data } = await supabase
      .from('tracking_events')
      .select('outcome_id')
      .eq('tracker_id', trackerId)
    const c = {}
    ;(data || []).forEach(e => { c[e.outcome_id] = (c[e.outcome_id] || 0) + 1 })
    setCounts(c)
  }

  async function createTracker() {
    const cleanOutcomes = newOutcomes.map(s => s.trim()).filter(Boolean)
    if (!newName.trim() || cleanOutcomes.length === 0) {
      alert('Need a name and at least one outcome')
      return
    }
    const { data: tracker, error } = await supabase
      .from('trackers')
      .insert({ name: newName.trim(), street: newStreet })
      .select()
      .single()
    if (error) { alert('Error creating tracker: ' + error.message); return }

    const rows = cleanOutcomes.map((label, i) => ({
      tracker_id: tracker.id, label, sort_order: i
    }))
    const { error: e2 } = await supabase.from('tracker_outcomes').insert(rows)
    if (e2) { alert('Error creating outcomes: ' + e2.message); return }

    setNewName('')
    setNewStreet('preflop')
    setNewOutcomes([''])
    await loadTrackers()
    setView('home')
  }

  async function logEvent(outcomeId) {
    const { error } = await supabase
      .from('tracking_events')
      .insert({ tracker_id: activeTracker.id, outcome_id: outcomeId })
    if (error) { alert('Error logging: ' + error.message); return }
    setCounts(prev => ({ ...prev, [outcomeId]: (prev[outcomeId] || 0) + 1 }))
    setLastLogged(outcomeId)
    setTimeout(() => setLastLogged(null), 600)
  }

  async function deleteTracker(id) {
    if (!confirm('Delete this tracking and all its data?')) return
    await supabase.from('trackers').delete().eq('id', id)
    await loadTrackers()
  }

  // ---------- HOME ----------
  if (view === 'home') {
    return (
      <div className="app">
        <h1>Live Tracker</h1>
        <div className="tracker-list">
          {trackers.map(t => (
            <div key={t.id} className="tracker-row">
              <button
                className="tracker-btn"
                onClick={async () => {
                  setActiveTracker(t)
                  await loadCounts(t.id)
                  setView('track')
                }}
              >
                <span className="tracker-name">{t.name}</span>
                <span className="tracker-street">{t.street}</span>
              </button>
              <button className="delete-btn" onClick={() => deleteTracker(t.id)}>×</button>
            </div>
          ))}
          {trackers.length === 0 && <p className="empty">No trackings yet.</p>}
        </div>
        <button className="create-btn" onClick={() => setView('create')}>
          + Create new tracking
        </button>
      </div>
    )
  }

  // ---------- CREATE ----------
  if (view === 'create') {
    return (
      <div className="app">
        <h1>New tracking</h1>

        <label className="field-label">Street</label>
        <div className="street-row">
          {STREETS.map(s => (
            <button
              key={s}
              className={`street-btn ${newStreet === s ? 'active' : ''}`}
              onClick={() => setNewStreet(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <label className="field-label">Name</label>
        <input
          className="text-input"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="e.g. PFR"
        />

        <label className="field-label">Outcomes</label>
        {newOutcomes.map((o, i) => (
          <div key={i} className="outcome-input-row">
            <input
              className="text-input"
              value={o}
              onChange={e => {
                const copy = [...newOutcomes]
                copy[i] = e.target.value
                setNewOutcomes(copy)
              }}
              placeholder={`Outcome ${i + 1}, e.g. Fold`}
            />
            <button
              className="delete-btn"
              onClick={() => setNewOutcomes(newOutcomes.filter((_, j) => j !== i))}
            >×</button>
          </div>
        ))}
        <button className="add-outcome-btn" onClick={() => setNewOutcomes([...newOutcomes, ''])}>
          + Add outcome
        </button>

        <div className="button-row">
          <button className="secondary-btn" onClick={() => setView('home')}>Cancel</button>
          <button className="create-btn" onClick={createTracker}>Save tracking</button>
        </div>
      </div>
    )
  }

  // ---------- TRACK ----------
  if (view === 'track' && activeTracker) {
    const list = outcomes[activeTracker.id] || []
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    return (
      <div className="app">
        <button className="back-btn" onClick={() => { setView('home'); setActiveTracker(null) }}>
          ← Back
        </button>
        <h1>{activeTracker.name}</h1>
        <p className="subtitle">{activeTracker.street} · {total} logged</p>
        <div className="outcome-grid">
          {list.map(o => (
            <button
              key={o.id}
              className={`outcome-btn ${lastLogged === o.id ? 'flash' : ''}`}
              onClick={() => logEvent(o.id)}
            >
              <span className="outcome-label">{o.label}</span>
              <span className="outcome-count">{counts[o.id] || 0}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return null
}
