import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './App'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

// Note: intentionally NOT wrapped in <StrictMode>. The 3D engine owns a long-lived
// WebGL context + render loop; StrictMode's double-invoke of effects would spin up
// and tear down two contexts on mount. We manage lifecycle explicitly instead.
createRoot(container).render(<App />)
