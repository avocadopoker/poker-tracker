import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import './App.css'

const STREETS = ['preflop', 'flop', 'turn', 'river']

export default function App() {
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!authReady) return <div className="app"><p className="empty">Loading…</p></div>
  if (recovering) return <ResetPassword onDone={() => setRecovering(false)} />
  if (!session) return <Auth />
  return <Main userId={session.user.id} />
}

// ---------------- RESET PASSWORD ----------------
function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function save() {
    if (password.length < 6) { setMsg('Password must be at least 6 characters'); return }
    setBusy(true); setMsg('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setMsg(error.message); setBusy(false); return }
    setMsg('Password updated. You are logged in.')
    setBusy(false)
    setTimeout(onDone, 800)
  }

  return (
    <div className="app auth">
      <h1>Set new password</h1>
      <label className="field-label">New password</label>
      <input className="text-input" type="password" value={password}
        onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
      {msg && <p className="auth-msg">{msg}</p>}
      <button className="create-btn" style={{ marginTop: 20 }} onClick={save} disabled={busy}>
        {busy ? '…' : 'Save new password'}
      </button>
    </div>
  )
}

// ---------------- AUTH ----------------
function Auth() {
  const [mode, setMode] = useState('login') // 'login' | 'signup' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [info, setInfo] = useState('')

  async function submit() {
    setBusy(true); setMsg(''); setInfo('')

    if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      })
      if (error) setMsg(error.message)
      else setInfo('Reset link sent. Check your email.')
      setBusy(false)
      return
    }

    const fn = mode === 'login'
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password })
    const { error } = await fn
    if (error) setMsg(error.message)
    setBusy(false)
  }

  const cta = mode === 'login' ? 'Log in' : mode === 'signup' ? 'Create account' : 'Send reset link'

  return (
    <div className="app auth">
      <h1>Live Tracker</h1>
      <label className="field-label">Email</label>
      <input className="text-input" type="email" value={email}
        onChange={e => setEmail(e.target.value)} placeholder="you@email.com" />
      {mode !== 'forgot' && (
        <>
          <label className="field-label">Password</label>
          <input className="text-input" type="password" value={password}
            onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
        </>
      )}
      {msg && <p className="auth-msg">{msg}</p>}
      {info && <p className="auth-info">{info}</p>}
      <button className="create-btn" style={{ marginTop: 20 }} onClick={submit} disabled={busy}>
        {busy ? '…' : cta}
      </button>

      {mode === 'login' && (
        <button className="link-btn" onClick={() => { setMode('forgot'); setMsg(''); setInfo('') }}>
          Forgot password?
        </button>
      )}
      {mode === 'forgot' && (
        <button className="link-btn" onClick={() => { setMode('login'); setMsg(''); setInfo('') }}>
          ← Back to log in
        </button>
      )}
      {mode !== 'forgot' && (
        <button className="link-btn" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMsg(''); setInfo('') }}>
          {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Log in'}
        </button>
      )}
    </div>
  )
}

// ---------------- MAIN ----------------
function Main({ userId }) {
  const [screen, setScreen] = useState('tracking') // 'tracking' | 'database' | 'settings'
  const [trackers, setTrackers] = useState([])
  const [outcomes, setOutcomes] = useState({}) // tracker_id -> outcomes[]
  const [events, setEvents] = useState([]) // all events (for database counts)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const { data: t } = await supabase.from('trackers').select('*').order('created_at')
    const { data: o } = await supabase.from('tracker_outcomes').select('*').order('sort_order')
    const { data: e } = await supabase.from('tracking_events').select('tracker_id, outcome_id')
    setTrackers(t || [])
    const grouped = {}
    ;(o || []).forEach(oc => {
      if (!grouped[oc.tracker_id]) grouped[oc.tracker_id] = []
      grouped[oc.tracker_id].push(oc)
    })
    setOutcomes(grouped)
    setEvents(e || [])
  }

  return (
    <div className="app has-nav">
      {screen === 'tracking' && (
        <Tracking userId={userId} trackers={trackers} outcomes={outcomes} onLogged={loadAll} />
      )}
      {screen === 'database' && (
        <Database trackers={trackers} outcomes={outcomes} events={events} />
      )}
      {screen === 'settings' && (
        <Settings userId={userId} trackers={trackers} outcomes={outcomes} onChange={loadAll} />
      )}

      <nav className="bottom-nav">
        {['tracking', 'database', 'settings'].map(s => (
          <button key={s} className={screen === s ? 'active' : ''} onClick={() => setScreen(s)}>
            {s}
          </button>
        ))}
      </nav>
    </div>
  )
}

// ---------------- TRACKING ----------------
function Tracking({ userId, trackers, outcomes, onLogged }) {
  const [street, setStreet] = useState(null)
  const [play, setPlay] = useState(null)
  const [flash, setFlash] = useState(null)
  const [sessionCounts, setSessionCounts] = useState({}) // outcome_id -> count this view

  async function log(outcomeId) {
    const { error } = await supabase.from('tracking_events').insert({
      tracker_id: play.id, outcome_id: outcomeId, user_id: userId
    })
    if (error) { alert('Error: ' + error.message); return }
    setSessionCounts(p => ({ ...p, [outcomeId]: (p[outcomeId] || 0) + 1 }))
    setFlash(outcomeId)
    setTimeout(() => setFlash(null), 500)
    onLogged()
  }

  // Result view
  if (play) {
    const list = outcomes[play.id] || []
    return (
      <div className="screen">
        <button className="back-btn" onClick={() => { setPlay(null); setSessionCounts({}) }}>← {street}</button>
        <h1>{play.name}</h1>
        <div className="outcome-grid">
          {list.map(o => (
            <button key={o.id} className={`outcome-btn ${flash === o.id ? 'flash' : ''}`} onClick={() => log(o.id)}>
              <span className="outcome-label">{o.label}</span>
              <span className="outcome-count">{sessionCounts[o.id] || 0}</span>
            </button>
          ))}
          {list.length === 0 && <p className="empty">No results defined for this play.</p>}
        </div>
      </div>
    )
  }

  // Plays-in-street view
  if (street) {
    const plays = trackers.filter(t => t.street === street)
    return (
      <div className="screen">
        <button className="back-btn" onClick={() => setStreet(null)}>← streets</button>
        <h1>{street}</h1>
        <div className="list">
          {plays.map(p => (
            <button key={p.id} className="row-btn" onClick={() => setPlay(p)}>{p.name}</button>
          ))}
          {plays.length === 0 && <p className="empty">No plays for {street}. Add one in Settings.</p>}
        </div>
      </div>
    )
  }

  // Street list
  return (
    <div className="screen">
      <h1>Tracking</h1>
      <div className="list">
        {STREETS.map(s => (
          <button key={s} className="row-btn big" onClick={() => setStreet(s)}>{s}</button>
        ))}
      </div>
    </div>
  )
}

// ---------------- DATABASE ----------------
function Database({ trackers, outcomes, events }) {
  // count events per outcome and per tracker
  const perOutcome = {}
  const perTracker = {}
  events.forEach(e => {
    perOutcome[e.outcome_id] = (perOutcome[e.outcome_id] || 0) + 1
    perTracker[e.tracker_id] = (perTracker[e.tracker_id] || 0) + 1
  })

  const byStreet = STREETS.map(street => {
    const plays = trackers
      .filter(t => t.street === street)
      .sort((a, b) => (perTracker[b.id] || 0) - (perTracker[a.id] || 0))
    return { street, plays }
  })

  const anyData = trackers.length > 0

  return (
    <div className="screen">
      <h1>Database</h1>
      {!anyData && <p className="empty">No plays yet. Create some in Settings.</p>}
      {byStreet.map(({ street, plays }) => (
        plays.length > 0 && (
          <div key={street} className="db-street">
            <h2 className="db-street-title">{street}</h2>
            {plays.map(p => {
              const total = perTracker[p.id] || 0
              const list = outcomes[p.id] || []
              return (
                <div key={p.id} className="db-card">
                  <div className="db-card-head">
                    <span className="db-name">{p.name}</span>
                    <span className="db-total">{total} tracked</span>
                  </div>
                  <div className="db-rows">
                    {list.map(o => {
                      const c = perOutcome[o.id] || 0
                      const pct = total > 0 ? Math.round((c / total) * 100) : 0
                      return (
                        <div key={o.id} className="db-row">
                          <span className="db-row-label">{o.label}</span>
                          <div className="db-bar-wrap">
                            <div className="db-bar" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="db-row-pct">{pct}%</span>
                          <span className="db-row-count">({c})</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )
      ))}
    </div>
  )
}

// ---------------- SETTINGS ----------------
function Settings({ userId, trackers, outcomes, onChange }) {
  const [adding, setAdding] = useState(false)
  const [street, setStreet] = useState('preflop')
  const [name, setName] = useState('')
  const [opts, setOpts] = useState([''])
  const [busy, setBusy] = useState(false)

  async function save() {
    const clean = opts.map(s => s.trim()).filter(Boolean)
    if (!name.trim() || clean.length === 0) { alert('Need a name and at least one result'); return }
    setBusy(true)
    const { data: tracker, error } = await supabase.from('trackers')
      .insert({ name: name.trim(), street, user_id: userId }).select().single()
    if (error) { alert(error.message); setBusy(false); return }
    const rows = clean.map((label, i) => ({
      tracker_id: tracker.id, user_id: userId, label, sort_order: i
    }))
    const { error: e2 } = await supabase.from('tracker_outcomes').insert(rows)
    if (e2) { alert(e2.message); setBusy(false); return }
    setName(''); setStreet('preflop'); setOpts(['']); setAdding(false); setBusy(false)
    onChange()
  }

  async function del(id) {
    if (!confirm('Delete this play and all its tracked data?')) return
    await supabase.from('trackers').delete().eq('id', id)
    onChange()
  }

  if (adding) {
    return (
      <div className="screen">
        <button className="back-btn" onClick={() => setAdding(false)}>← settings</button>
        <h1>Add play</h1>

        <label className="field-label">Type</label>
        <div className="street-row">
          {STREETS.map(s => (
            <button key={s} className={`street-btn ${street === s ? 'active' : ''}`} onClick={() => setStreet(s)}>{s}</button>
          ))}
        </div>

        <label className="field-label">Name</label>
        <input className="text-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. cbet" />

        <label className="field-label">Results</label>
        {opts.map((o, i) => (
          <div key={i} className="outcome-input-row">
            <input className="text-input" value={o}
              onChange={e => { const c = [...opts]; c[i] = e.target.value; setOpts(c) }}
              placeholder={`Result ${i + 1}, e.g. fold`} />
            <button className="delete-btn" onClick={() => setOpts(opts.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button className="add-outcome-btn" onClick={() => setOpts([...opts, ''])}>+ Add result</button>

        <button className="create-btn" style={{ marginTop: 24 }} onClick={save} disabled={busy}>
          {busy ? '…' : 'Save play'}
        </button>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="settings-head">
        <h1>Settings</h1>
        <button className="signout-btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>

      {STREETS.map(s => {
        const plays = trackers.filter(t => t.street === s)
        if (plays.length === 0) return null
        return (
          <div key={s} className="db-street">
            <h2 className="db-street-title">{s}</h2>
            {plays.map(p => (
              <div key={p.id} className="settings-row">
                <div>
                  <span className="tracker-name">{p.name}</span>
                  <span className="settings-opts">{(outcomes[p.id] || []).map(o => o.label).join(' · ')}</span>
                </div>
                <button className="delete-btn" onClick={() => del(p.id)}>×</button>
              </div>
            ))}
          </div>
        )
      })}
      {trackers.length === 0 && <p className="empty">No plays yet.</p>}

      <button className="create-btn" style={{ marginTop: 24 }} onClick={() => setAdding(true)}>+ Add play</button>
    </div>
  )
}
