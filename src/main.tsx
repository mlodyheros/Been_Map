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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Safety>
      <App />
    </Safety>
  </StrictMode>,
)
