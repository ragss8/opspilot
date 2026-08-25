import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpenText,
  Bot,
  ChevronRight,
  CircleHelp,
  Command,
  LayoutDashboard,
  Menu,
  Radio,
  Search,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

const navigation = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/copilot', label: 'AI Copilot', icon: Bot },
  { to: '/knowledge', label: 'Knowledge', icon: BookOpenText },
  { to: '/incidents', label: 'Incidents', icon: AlertTriangle, count: 7 },
];

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const location = useLocation();
  const navigate = useNavigate();

  const openCommand = useCallback(() => {
    navigate('/copilot');
    window.setTimeout(() => document.getElementById('copilot-message')?.focus(), 80);
  }, [navigate]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openCommand();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [openCommand]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`} aria-label="Primary navigation">
        <div className="brand">
          <div className="brand__mark" aria-hidden="true">
            <Command size={20} strokeWidth={2.4} />
          </div>
          <div>
            <div className="brand__name">OpsPilot</div>
            <div className="brand__tag"><Sparkles size={10} /> AI command center</div>
          </div>
          <button className="icon-button sidebar__close" aria-label="Close navigation" onClick={() => setMenuOpen(false)}>
            <X size={19} />
          </button>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-switcher__avatar">NW</div>
          <div className="workspace-switcher__copy">
            <span>Network operations</span>
            <small>Synthetic demo workspace</small>
          </div>
          <ChevronRight size={16} aria-hidden="true" />
        </div>

        <nav className="main-nav">
          <div className="nav-label">Command</div>
          {navigation.map(({ to, label, icon: Icon, count, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}>
              <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
              <span>{label}</span>
              {count ? <span className="nav-link__count">{count}</span> : null}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__spacer" />

        <div className="nav-label">Workspace</div>
        <button className="nav-link nav-link--button" type="button" disabled title="Settings are outside this portfolio demo">
          <Settings size={18} strokeWidth={1.9} />
          <span>Settings</span>
        </button>
        <button className="nav-link nav-link--button" type="button" disabled title="Help center is outside this portfolio demo">
          <CircleHelp size={18} strokeWidth={1.9} />
          <span>Help center</span>
        </button>

        <div className="system-card">
          <div className="system-card__top">
            <span className="live-dot"><span /></span>
            <strong>Systems operational</strong>
          </div>
          <div className="system-card__row"><span>Vector index</span><span>16 sources</span></div>
          <div className="system-card__row"><span>Last sync</span><span>2 min ago</span></div>
        </div>

        <div className="operator-card">
          <div className="operator-card__avatar">AK</div>
          <div><strong>Alex Kim</strong><span>Duty operator</span></div>
          <span className="operator-card__status" aria-label="Online" />
        </div>
      </aside>

      {menuOpen ? <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}

      <div className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMenuOpen(true)}>
            <Menu size={21} />
          </button>
          <Link to="/" className="mobile-brand" aria-label="OpsPilot home">
            <Command size={18} /> OpsPilot
          </Link>
          <button className="command-search" type="button" onClick={openCommand}>
            <Search size={16} />
            <span>Search fleet, incidents, or knowledge</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="topbar__right">
            <div className="live-status"><Radio size={14} /><span>Live</span></div>
            <time dateTime={clock.toISOString()}>
              {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              <small>{Intl.DateTimeFormat().resolvedOptions().timeZone.replace('_', ' ')}</small>
            </time>
            <Link className="topbar__copilot" to="/copilot"><Sparkles size={15} /> Ask copilot</Link>
          </div>
        </header>

        <main id="main-content" className="main-content">
          <Outlet />
        </main>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'mobile-nav__active' : '')}>
              <Icon size={19} />
              <span>{label === 'AI Copilot' ? 'Copilot' : label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
