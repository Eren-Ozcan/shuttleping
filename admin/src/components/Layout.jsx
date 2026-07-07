import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { getUser, logout } from '../api.js'

const COMPANY_NAV = [
  { to: '/guzergahlar', label: 'Güzergahlar' },
  { to: '/harita', label: 'Canlı Harita' },
  { to: '/yolcular', label: 'Yolcular' },
  { to: '/araclar', label: 'Araçlar' },
  { to: '/kullanicilar', label: 'Kullanıcılar' },
  { to: '/bildirimler', label: 'Bildirimler' },
]

const SUPER_NAV = [{ to: '/sirketler', label: 'Şirketler' }]

export default function Layout() {
  const navigate = useNavigate()
  const user = getUser()
  const nav = user?.role === 'super_admin' ? SUPER_NAV : COMPANY_NAV

  async function handleLogout() {
    try {
      await logout()
    } finally {
      navigate('/login')
    }
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">🚌 ShuttlePing</div>
        <nav>
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-name">{user?.fullName}</div>
          <button className="btn btn-ghost" onClick={handleLogout}>
            Çıkış Yap
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
