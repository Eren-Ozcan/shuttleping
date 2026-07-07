import { Routes, Route, Navigate } from 'react-router-dom'
import { getUser } from './api.js'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import RoutesPage from './pages/RoutesPage.jsx'
import Vehicles from './pages/Vehicles.jsx'
import Users from './pages/Users.jsx'
import Passengers from './pages/Passengers.jsx'
import LiveMap from './pages/LiveMap.jsx'
import Notifications from './pages/Notifications.jsx'
import Companies from './pages/Companies.jsx'

function RequireAuth({ children }) {
  return getUser() ? children : <Navigate to="/login" replace />
}

export default function App() {
  const user = getUser()
  const home = user?.role === 'super_admin' ? '/sirketler' : '/guzergahlar'

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to={home} replace />} />
        <Route path="/guzergahlar" element={<RoutesPage />} />
        <Route path="/araclar" element={<Vehicles />} />
        <Route path="/kullanicilar" element={<Users />} />
        <Route path="/yolcular" element={<Passengers />} />
        <Route path="/harita" element={<LiveMap />} />
        <Route path="/bildirimler" element={<Notifications />} />
        <Route path="/sirketler" element={<Companies />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
