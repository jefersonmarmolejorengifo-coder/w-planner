import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './ProductivityPlus.jsx'
import { ToastProvider } from './ui/Toast.jsx'
import { ConfirmProvider } from './ui/ConfirmDialog.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>,
)
