import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

/** If something breaks while drawing the app, say so instead of leaving a blank page. The map itself is safe in storage. */
class Safety extends Component<{ children: ReactNode }, { broken: boolean }> {
  state = { broken: false }
  static getDerivedStateFromError() {
    return { broken: true }
  }
  render() {
    if (!this.state.broken) return this.props.children
    const pl = navigator.language.toLowerCase().startsWith('pl')
    return (
      <div className="broken">
        <p>{pl ? 'Coś poszło nie tak. Twoja mapa jest bezpieczna — wystarczy odświeżyć stronę.' : 'Something went wrong. Your map is safe — reloading the page will bring it back.'}</p>
        <button className="primary" onClick={() => location.reload()}>
          {pl ? 'Odśwież' : 'Reload'}
        </button>
      </div>
    )
  }
}

// Development only: #dev=<json> writes saved state before the app starts, so a
// device that can't be tapped (a simulator) can still be shown a given screen.
if (import.meta.env.DEV && location.hash.startsWith('#dev=')) {
  const state = JSON.parse(decodeURIComponent(location.hash.slice(5))) as Record<string, unknown>
  for (const [key, value] of Object.entries(state)) localStorage.setItem(key, JSON.stringify(value))
  history.replaceState(null, '', location.pathname + location.search)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Safety>
      <App />
    </Safety>
  </StrictMode>,
)
