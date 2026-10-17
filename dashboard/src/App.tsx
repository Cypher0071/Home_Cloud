import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import PageLoader from './components/PageLoader'
import RouteErrorBoundary from './components/RouteErrorBoundary'
import { retryDynamicImport } from './utils/dynamicImport'
import { useWallpaper } from './hooks/useWallpaper'
import './App.css'

const Login = lazy(() => retryDynamicImport(() => import('./pages/login')))
const Desktop = lazy(() => retryDynamicImport(() => import('./pages/desktop')))

function App() {
  useWallpaper()

  return (
    <RouteErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/terminal" element={<ProtectedRoute><Desktop /></ProtectedRoute>} />
            <Route path="/metrics" element={<ProtectedRoute><Desktop /></ProtectedRoute>} />
            <Route path="/files" element={<ProtectedRoute><Desktop /></ProtectedRoute>} />
            <Route path="/docker" element={<ProtectedRoute><Desktop /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Desktop /></ProtectedRoute>} />
            <Route path="/" element={<ProtectedRoute><Desktop /></ProtectedRoute>} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </RouteErrorBoundary>
  )
}

export default App
