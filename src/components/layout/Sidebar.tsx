'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  section?: string;
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Tổng quan', section: 'overview' },
  { href: '/campaigns', label: 'Chiến dịch', section: 'overview' },
  { href: '/plan', label: 'Kế hoạch', section: 'tools' },
  { href: '/budget', label: 'Phân bổ ngân sách', section: 'tools' },
  { href: '/settings', label: 'Cài đặt', section: 'system' },
];

export default function Sidebar() {
  const pathname = usePathname();

  const sections = [
    { key: 'overview', label: 'Tổng quan' },
    { key: 'tools', label: 'Công cụ' },
    { key: 'system', label: 'Hệ thống' },
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
          <span>Tự động đồng bộ: 4h</span>
        </div>
      </div>
    </aside>
  );
}
