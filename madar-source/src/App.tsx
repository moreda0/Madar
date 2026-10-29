import { HashRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useMe } from './lib/access'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { Today } from './pages/Today'
import { Tasks } from './pages/Tasks'
import { Attendance } from './pages/Attendance'
import { Notifications } from './pages/Notifications'
import { Org } from './pages/Org'
import { Settings } from './pages/Settings'
import { Performance } from './pages/Performance'
import { Assistant } from './pages/Assistant'
import { FirstUpload, syncOn } from './components/Sync'
import { useSync } from './lib/sync'

// The shareable single-file preview keeps routes in memory (its host owns the URL hash)
const Router = import.meta.env.VITE_SINGLEFILE ? MemoryRouter : HashRouter

export default function App() {
  const me = useMe()
  const sync = useSync()
  if (syncOn() && sync.needsFirstUpload) return <FirstUpload />
  if (!me || (syncOn() && (sync.status === 'signed-out' || sync.role === 'not-invited'))) return <Login />
  return (
    <Router>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Today />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="performance" element={<Performance />} />
          <Route path="org" element={<Org />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Router>
  )
}
