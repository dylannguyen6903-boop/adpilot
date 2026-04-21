'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  section?: string;
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊', section: 'overview' },
  { href: '/campaigns', label: 'Campaigns', icon: '📋', section: 'overview' },
  { href: '/plan', label: 'Action Plan', icon: '✅', section: 'tools' },
  { href: '/budget', label: 'Budget Allocator', icon: '💰', section: 'tools' },
  { href: '/settings', label: 'Settings', icon: '⚙️', section: 'system' },
];

export default function Sidebar() {
  const pathname = usePathname();

  const sections = [
    { key: 'overview', label: 'Overview' },
    { key: 'tools', label: 'Tools' },
    { key: 'system', label: 'System' },
  ];

  return (
    <aside className="sidebar" id="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">A</div>
        <span className="sidebar-logo-text">AdPilot</span>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {sections.map((section) => (
          <div key={section.key}>
            <div className="sidebar-section-title">{section.label}</div>
            {navItems
              .filter((item) => item.section === section.key)
              .map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/dashboard' && pathname.startsWith(item.href));

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`sidebar-link ${isActive ? 'active' : ''}`}
                    id={`nav-${item.href.slice(1)}`}
                  >
                    <span className="sidebar-link-icon">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>

      {/* Footer — Sync Status */}
      <div className="sidebar-footer">
        <div className="sidebar-sync-status">
          <span className="sidebar-sync-dot" />
          <span>Auto-sync: 4h</span>
        </div>
      </div>
    </aside>
  );
}
