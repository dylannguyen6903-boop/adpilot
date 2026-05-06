'use client';

import { useState, useEffect } from 'react';
import { apiHeaders } from '@/hooks/useApi';

interface HeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

interface SyncStatus {
  lastSync: string | null;
  status: string | null;
  error: string | null;
}

export default function Header({ title, subtitle, children }: HeaderProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<SyncStatus | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);

  // Check last sync status on mount
  useEffect(() => {
    fetch('/api/settings/connections', { headers: apiHeaders() })
      .then(r => r.json())
      .then(data => {
        const fb = data?.connections?.facebook;
        const shopify = data?.connections?.shopify;
        
        // Show error banner if Facebook or Shopify last sync failed
        if (fb?.lastSyncStatus === 'FAILED' || shopify?.lastSyncStatus === 'FAILED') {
          setSyncError({
            lastSync: fb?.lastSync || shopify?.lastSync,
            status: 'FAILED',
            error: fb?.lastError || shopify?.lastError || 'Đồng bộ thất bại. Kiểm tra Cài đặt → Kết nối.',
          });
        } else if (fb?.lastSyncStatus === 'PARTIAL') {
          setSyncError({
            lastSync: fb?.lastSync,
            status: 'PARTIAL',
            error: fb?.lastError || 'Một số tài khoản không thể đồng bộ.',
          });
        }
      })
      .catch(() => { /* ignore */ });
  }, []);

  const handleRefresh = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncResult(null);

    try {
      // Sync both in parallel
      const [fbRes, shopifyRes] = await Promise.allSettled([
        fetch('/api/facebook/sync', { method: 'POST', headers: apiHeaders() }),
        fetch('/api/shopify/sync', { method: 'POST', headers: apiHeaders() }),
      ]);

      const fbOk = fbRes.status === 'fulfilled' && fbRes.value.ok;
      const shopifyOk = shopifyRes.status === 'fulfilled' && shopifyRes.value.ok;

      // Parse error details from failed sync
      let errorDetail = '';
      if (!fbOk && fbRes.status === 'fulfilled') {
        try {
          const fbData = await fbRes.value.json();
          errorDetail = fbData.error || fbData.accountErrors?.[0]?.error || '';
        } catch { /* ignore */ }
      }
      if (!shopifyOk && shopifyRes.status === 'fulfilled') {
        try {
          const shopifyData = await shopifyRes.value.json();
          errorDetail = errorDetail || shopifyData.error || '';
        } catch { /* ignore */ }
      }

      if (fbOk && shopifyOk) {
        setSyncResult('✅ Đồng bộ thành công');
        setSyncError(null);
        setErrorDismissed(false);
        // Only reload on success — wait for user to see the success message
        setTimeout(() => window.location.reload(), 1500);
      } else if (fbOk || shopifyOk) {
        setSyncResult('⚠️ Đồng bộ một phần');
        setSyncError({
          lastSync: new Date().toISOString(),
          status: 'PARTIAL',
          error: errorDetail || (!fbOk ? 'Lỗi đồng bộ Facebook' : 'Lỗi đồng bộ Shopify'),
        });
        setErrorDismissed(false);
        // Still reload on partial — some data was updated
        setTimeout(() => window.location.reload(), 2500);
      } else {
        setSyncResult('❌ Đồng bộ thất bại');
        setSyncError({
          lastSync: new Date().toISOString(),
          status: 'FAILED',
          error: errorDetail || 'Lỗi đồng bộ Facebook và Shopify. Kiểm tra API token.',
        });
        setErrorDismissed(false);
        // Do NOT reload on total failure — let user see the error
      }
    } catch (err) {
      console.error('Sync error:', err);
      setSyncResult('❌ Lỗi kết nối');
      // Do NOT reload on network error
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      {/* Sync Error Banner */}
      {syncError && !errorDismissed && (
        <div className={`sync-error-banner ${syncError.status === 'FAILED' ? 'critical' : 'warning'}`} id="sync-error-banner">
          <div className="sync-error-content">
            <span className="sync-error-icon">
              <span className={`status-dot ${syncError.status === 'FAILED' ? 'kill' : 'watch'}`} />
            </span>
            <div className="sync-error-text">
              <strong>
                {syncError.status === 'FAILED' ? 'Lỗi Đồng Bộ' : 'Đồng Bộ Một Phần'}
              </strong>
              <span>{syncError.error}</span>
            </div>
          </div>
          <button
            className="sync-error-dismiss"
            onClick={() => setErrorDismissed(true)}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <header className="header" id="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <button 
            className="mobile-menu-btn d-lg-none" 
            onClick={() => document.getElementById('sidebar')?.classList.toggle('open')}
            style={{ fontSize: 24, display: 'none', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
          >
            ☰
          </button>
          <div className="header-title">
            <h1>{title}</h1>
            {subtitle && <p className="d-none d-sm-block">{subtitle}</p>}
          </div>
        </div>

        <div className="header-actions">
          {children}
          {syncResult && (
            <span style={{
              fontSize: 'var(--text-xs)',
              color: syncResult.includes('thành công') ? 'var(--color-winner)' 
                   : syncResult.includes('một phần') ? 'var(--color-watch)' 
                   : 'var(--color-kill)',
              marginRight: 'var(--space-sm)',
              animation: 'fadeIn 0.3s ease',
            }}>
              {syncResult}
            </span>
          )}
          <button
            className={`header-refresh-btn ${syncing ? 'syncing' : ''}`}
            onClick={handleRefresh}
            disabled={syncing}
            id="btn-refresh-now"
            title="Đồng bộ dữ liệu Facebook & Shopify"
          >
            <span className="btn-icon">{syncing ? '⟳' : '↻'}</span>
            {!syncing && <span>Đồng bộ</span>}
          </button>
        </div>
      </header>
    </>
  );
}
