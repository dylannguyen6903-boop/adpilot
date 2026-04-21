'use client';

import { useState, useEffect } from 'react';

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
    fetch('/api/settings/connections')
      .then(r => r.json())
      .then(data => {
        const fb = data?.connections?.facebook;
        const shopify = data?.connections?.shopify;
        
        // Show error banner if Facebook or Shopify last sync failed
        if (fb?.lastSyncStatus === 'FAILED' || shopify?.lastSyncStatus === 'FAILED') {
          setSyncError({
            lastSync: fb?.lastSync || shopify?.lastSync,
            status: 'FAILED',
            error: fb?.lastError || shopify?.lastError || 'Sync failed. Check Settings → Connections.',
          });
        } else if (fb?.lastSyncStatus === 'PARTIAL') {
          setSyncError({
            lastSync: fb?.lastSync,
            status: 'PARTIAL',
            error: fb?.lastError || 'Some accounts failed to sync.',
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
        fetch('/api/facebook/sync', { method: 'POST' }),
        fetch('/api/shopify/sync', { method: 'POST' }),
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

      if (fbOk && shopifyOk) {
        setSyncResult('✅ Synced successfully');
        setSyncError(null);
        setErrorDismissed(false);
      } else if (fbOk || shopifyOk) {
        setSyncResult('⚠️ Partial sync');
        setSyncError({
          lastSync: new Date().toISOString(),
          status: 'PARTIAL',
          error: errorDetail || (!fbOk ? 'Facebook sync failed' : 'Shopify sync failed'),
        });
        setErrorDismissed(false);
      } else {
        setSyncResult('❌ Sync failed');
        setSyncError({
          lastSync: new Date().toISOString(),
          status: 'FAILED',
          error: errorDetail || 'Both Facebook and Shopify sync failed. Check API tokens in Settings.',
        });
        setErrorDismissed(false);
      }

      // Auto-reload page data after sync
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      console.error('Sync error:', err);
      setSyncResult('❌ Error');
    } finally {
      setTimeout(() => setSyncing(false), 1000);
    }
  };

  return (
    <>
      {/* Sync Error Banner */}
      {syncError && !errorDismissed && (
        <div className={`sync-error-banner ${syncError.status === 'FAILED' ? 'critical' : 'warning'}`} id="sync-error-banner">
          <div className="sync-error-content">
            <span className="sync-error-icon">
              {syncError.status === 'FAILED' ? '🔴' : '🟡'}
            </span>
            <div className="sync-error-text">
              <strong>
                {syncError.status === 'FAILED' ? 'Sync Failed' : 'Partial Sync'}
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
              color: syncResult.includes('✅') ? 'var(--color-winner)' 
                   : syncResult.includes('⚠️') ? 'var(--color-watch)' 
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
            title="Sync data from Facebook & Shopify"
          >
            <span className="btn-icon">{syncing ? '⟳' : '🔄'}</span>
            <span>{syncing ? 'Syncing...' : 'Refresh Now'}</span>
          </button>
        </div>
      </header>
    </>
  );
}
