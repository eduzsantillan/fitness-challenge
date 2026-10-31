import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initialize } from './auth';
import './styles.css';
let startupError: string | undefined;
try { await initialize(); } catch (error) { startupError = error instanceof Error ? error.message : 'No se pudo iniciar sesión.'; }
createRoot(document.getElementById('root')!).render(<App startupError={startupError} />);
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* App still works online. */ }); });
}
