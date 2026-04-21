'use client';

import { useState, useEffect } from 'react';
import { Header, PageContainer } from '@/components/layout';
import { useApiData, useApiAction } from '@/hooks/useApi';
import { timeAgo } from '@/lib/utils';

interface ProfileResponse {
  success: boolean;
  profile: Record<string, unknown> | null;
}

interface ConnectionsResponse {
  success: boolean;
  connections: {
    facebook: {
      configured: boolean;
      accounts: { id: string; name?: string; accessToken: string; adAccountId: string }[];
      lastSync: string | null;
      lastSyncStatus: string | null;
      lastError: string | null;
    };
    shopify: {
      configured: boolean;
      storeDomain: string | null;
      lastSync: string | null;
      lastSyncStatus: string | null;
      lastError: string | null;
    };
  };
}

export default function SettingsPage() {
  // Profile form state
  const [storeName, setStoreName] = useState('Frenzidea');
  const [aov, setAov] = useState(87);
  const [marginMin, setMarginMin] = useState(17);
  const [marginMax, setMarginMax] = useState(20);
  const [cogsRate, setCogsRate] = useState(80);
  const [targetCpa, setTargetCpa] = useState(40);
  const [returningRate, setReturningRate] = useState(22);
  const [repeatOrders, setRepeatOrders] = useState(1.5);
  const [thresholdWinner, setThresholdWinner] = useState(0.7);
  const [thresholdPromising, setThresholdPromising] = useState(0.4);
  const [thresholdWatch, setThresholdWatch] = useState(0.2);

  // Connection form state
  const [fbAccounts, setFbAccounts] = useState<{ id: string; accessToken: string; adAccountId: string; name?: string }[]>([]);
  const [fbToken, setFbToken] = useState('');
  const [fbAccountId, setFbAccountId] = useState('');
  const [shopifyDomain, setShopifyDomain] = useState('');
  const [shopifyToken, setShopifyToken] = useState('');

  // Status
  const [profileMsg, setProfileMsg] = useState('');
  const [fbMsg, setFbMsg] = useState('');
  const [shopifyMsg, setShopifyMsg] = useState('');

  // AI Config state
  const [aiProvider, setAiProvider] = useState('openai');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('gpt-4o-mini');
  const [aiMsg, setAiMsg] = useState('');
  const [aiTesting, setAiTesting] = useState(false);

  // Load data
  const { data: profileData } = useApiData<ProfileResponse>('/api/settings/profile');
  const { data: connectionsData, refetch: refetchConnections } = useApiData<ConnectionsResponse>('/api/settings/connections');

  // Save actions
  const { execute: saveProfile, loading: savingProfile } = useApiAction<unknown, unknown>('/api/settings/profile');
  const { execute: saveConnections, loading: savingConnections } = useApiAction<unknown, unknown>('/api/settings/connections');

  // Populate form from loaded data
  useEffect(() => {
    const p = profileData?.profile;
    if (!p) return;
    if (p.store_name) setStoreName(p.store_name as string);
    if (p.aov) setAov(p.aov as number);
    if (p.target_margin_min) setMarginMin((p.target_margin_min as number) * 100);
    if (p.target_margin_max) setMarginMax((p.target_margin_max as number) * 100);
    if (p.avg_cogs_rate) setCogsRate((p.avg_cogs_rate as number) * 100);
    if (p.target_cpa) setTargetCpa(p.target_cpa as number);
    if (p.returning_rate) setReturningRate((p.returning_rate as number) * 100);
    if (p.avg_repeat_orders) setRepeatOrders(p.avg_repeat_orders as number);
    if (p.threshold_winner) setThresholdWinner(p.threshold_winner as number);
    if (p.threshold_promising) setThresholdPromising(p.threshold_promising as number);
    if (p.threshold_watch) setThresholdWatch(p.threshold_watch as number);
    // AI config
    if (p.ai_provider) setAiProvider(p.ai_provider as string);
    if (p.ai_api_key) setAiApiKey(p.ai_api_key as string);
    if (p.ai_model) setAiModel(p.ai_model as string);
  }, [profileData]);

  const connections = connectionsData?.connections;

  useEffect(() => {
    if (connectionsData?.connections?.facebook?.accounts) {
      setFbAccounts(connectionsData.connections.facebook.accounts);
    }
  }, [connectionsData]);

  const handleSaveProfile = async () => {
    setProfileMsg('');
    const putRes = await fetch('/api/settings/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeName,
        aov,
        targetMarginMin: marginMin / 100,
        targetMarginMax: marginMax / 100,
        avgCogsRate: cogsRate / 100,
        targetCpa,
        returningRate: returningRate / 100,
        avgRepeatOrders: repeatOrders,
        thresholdWinner,
        thresholdPromising,
        thresholdWatch,
      }),
    });
    if (putRes.ok) {
      setProfileMsg('✅ Profile saved successfully!');
    } else {
      const err = await putRes.json();
      setProfileMsg(`❌ ${err.error || 'Save failed'}`);
    }
  };

  const handleAddFb = async () => {
    setFbMsg('');
    const newAccounts = [...fbAccounts, { id: Date.now().toString(), accessToken: fbToken, adAccountId: fbAccountId }];
    const res = await fetch('/api/settings/connections', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fbAccounts: newAccounts }),
    });
    const data = await res.json();
    if (res.ok) {
      setFbMsg('✅ Facebook connected! Token validated.');
      setFbToken('');
      setFbAccountId('');
      refetchConnections();
    } else {
      setFbMsg(`❌ ${data.error || 'Connection failed'}`);
    }
  };

  const handleRemoveFb = async (id: string) => {
    setFbMsg('');
    if (!confirm('Are you sure you want to remove this connection?')) return;
    
    const newAccounts = fbAccounts.filter(a => a.id !== id);
    const res = await fetch('/api/settings/connections', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fbAccounts: newAccounts }),
    });
    const data = await res.json();
    if (res.ok) {
      setFbMsg('✅ Connection removed.');
      refetchConnections();
    } else {
      setFbMsg(`❌ ${data.error || 'Removal failed'}`);
    }
  };

  const handleConnectShopify = async () => {
    setShopifyMsg('');
    const res = await fetch('/api/settings/connections', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopifyStoreDomain: shopifyDomain, shopifyAccessToken: shopifyToken }),
    });
    const data = await res.json();
    if (res.ok) {
      setShopifyMsg('✅ Shopify connected!');
      setShopifyToken('');
      refetchConnections();
    } else {
      setShopifyMsg(`❌ ${data.error || 'Connection failed'}`);
    }
  };

  return (
    <>
      <Header title="Settings" subtitle="Configure your business profile and API connections" />
      <PageContainer>
        <div className="grid-2">
          {/* ── Business Profile ── */}
          <div className="card" id="settings-profile">
            <div className="card-header">
              <div className="card-title">📦 Business Profile</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <div className="form-group">
                <label className="form-label">Store Name</label>
                <input className="form-input" type="text" value={storeName} onChange={(e) => setStoreName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Average Order Value (AOV)</label>
                <input className="form-input" type="number" value={aov} onChange={(e) => setAov(Number(e.target.value))} />
                <span className="form-helper">Average revenue per order in USD</span>
              </div>
              <div className="form-group">
                <label className="form-label">Target Margin (Min — Max)</label>
                <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
                  <input className="form-input" type="number" value={marginMin} onChange={(e) => setMarginMin(Number(e.target.value))} style={{ width: 80 }} />
                  <span className="card-subtitle">% —</span>
                  <input className="form-input" type="number" value={marginMax} onChange={(e) => setMarginMax(Number(e.target.value))} style={{ width: 80 }} />
                  <span className="card-subtitle">%</span>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">COGS Rate (%)</label>
                <input className="form-input" type="number" value={cogsRate} onChange={(e) => setCogsRate(Number(e.target.value))} />
                <span className="form-helper">Cost of goods as % of revenue</span>
              </div>
              <div className="form-group">
                <label className="form-label">Target CPA ($)</label>
                <input className="form-input" type="number" value={targetCpa} onChange={(e) => setTargetCpa(Number(e.target.value))} />
              </div>
              <div className="form-group">
                <label className="form-label">Returning Customer Rate (%)</label>
                <input className="form-input" type="number" value={returningRate} onChange={(e) => setReturningRate(Number(e.target.value))} />
              </div>
              <div className="form-group">
                <label className="form-label">Avg Repeat Orders</label>
                <input className="form-input" type="number" value={repeatOrders} step={0.1} onChange={(e) => setRepeatOrders(Number(e.target.value))} />
              </div>

              {profileMsg && (
                <div style={{ fontSize: 'var(--text-sm)', color: profileMsg.startsWith('✅') ? 'var(--color-winner)' : 'var(--color-kill)' }}>
                  {profileMsg}
                </div>
              )}

              <button className={`btn btn-primary ${savingProfile ? 'syncing' : ''}`} onClick={handleSaveProfile} disabled={savingProfile} id="btn-save-profile">
                {savingProfile ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </div>

          {/* ── Right Column: Connections + Thresholds ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            {/* Facebook */}
            <div className="card" id="settings-facebook">
              <div className="card-header">
                <div className="card-title">📘 Facebook Connection</div>
                <span className={`status-badge ${connections?.facebook.configured ? 'winner' : 'kill'}`}>
                  <span className="status-dot" />
                  {connections?.facebook.configured ? 'Connected' : 'Disconnected'}
                </span>
              </div>

              {connections?.facebook.lastSync && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-sm)' }}>
                  Last sync: {timeAgo(connections.facebook.lastSync)} — {connections.facebook.lastSyncStatus}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                {fbAccounts.length > 0 && (
                  <div style={{ borderBottom: '1px solid var(--border-primary)', paddingBottom: 'var(--space-md)', marginBottom: 'var(--space-sm)' }}>
                    <div style={{ marginBottom: 'var(--space-sm)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 600 }}>Active Accounts:</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                      {fbAccounts.map((acc, idx) => (
                        <div key={acc.id || idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-tertiary)', padding: 'var(--space-sm)', borderRadius: 'var(--radius-sm)' }}>
                          <div style={{ fontSize: 'var(--text-xs)' }}>
                            <div style={{ fontWeight: 600 }}>{acc.adAccountId}</div>
                            <div style={{ color: 'var(--text-muted)' }}>{acc.accessToken.substring(0, 15)}...</div>
                          </div>
                          <button className="btn btn-sm btn-danger" onClick={() => handleRemoveFb(acc.id)}>Remove</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">New Ad Account ID</label>
                  <input className="form-input" type="text" placeholder="act_123456789" value={fbAccountId} onChange={(e) => setFbAccountId(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">System User Access Token</label>
                  <input className="form-input" type="password" placeholder="EAABsbCS1iHg..." value={fbToken} onChange={(e) => setFbToken(e.target.value)} />
                </div>
                
                {fbMsg && (
                  <div style={{ fontSize: 'var(--text-sm)', color: fbMsg.startsWith('✅') ? 'var(--color-winner)' : 'var(--color-kill)' }}>
                    {fbMsg}
                  </div>
                )}
                <button className="btn btn-primary" onClick={handleAddFb} disabled={!fbToken || !fbAccountId || savingConnections} id="btn-connect-fb">
                  + Add Connection
                </button>
              </div>
            </div>

            {/* Shopify */}
            <div className="card" id="settings-shopify">
              <div className="card-header">
                <div className="card-title">🟢 Shopify Connection</div>
                <span className={`status-badge ${connections?.shopify.configured ? 'winner' : 'kill'}`}>
                  <span className="status-dot" />
                  {connections?.shopify.configured ? 'Connected' : 'Disconnected'}
                </span>
              </div>

              {connections?.shopify.lastSync && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-sm)' }}>
                  Last sync: {timeAgo(connections.shopify.lastSync)} — {connections.shopify.lastSyncStatus}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <div className="form-group">
                  <label className="form-label">Store Domain</label>
                  <input className="form-input" type="text" placeholder="frenzidea.myshopify.com" value={shopifyDomain} onChange={(e) => setShopifyDomain(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Admin API Access Token</label>
                  <input className="form-input" type="password" placeholder="shpat_xxxxx" value={shopifyToken} onChange={(e) => setShopifyToken(e.target.value)} />
                </div>
                {shopifyMsg && (
                  <div style={{ fontSize: 'var(--text-sm)', color: shopifyMsg.startsWith('✅') ? 'var(--color-winner)' : 'var(--color-kill)' }}>
                    {shopifyMsg}
                  </div>
                )}
                <button className="btn btn-primary" onClick={handleConnectShopify} disabled={!shopifyDomain || !shopifyToken || savingConnections} id="btn-connect-shopify">
                  Connect Shopify
                </button>
              </div>
            </div>

            {/* Decision Thresholds */}
            <div className="card" id="settings-thresholds">
              <div className="card-header">
                <div className="card-title">🎛️ Decision Thresholds</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <div className="form-group">
                  <label className="form-label">Winner Score Threshold</label>
                  <input className="form-input" type="number" value={thresholdWinner} step={0.05} onChange={(e) => setThresholdWinner(Number(e.target.value))} />
                  <span className="form-helper">Score ≥ this = WINNER (default: 0.7)</span>
                </div>
                <div className="form-group">
                  <label className="form-label">Promising Score Threshold</label>
                  <input className="form-input" type="number" value={thresholdPromising} step={0.05} onChange={(e) => setThresholdPromising(Number(e.target.value))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Watch Score Threshold</label>
                  <input className="form-input" type="number" value={thresholdWatch} step={0.05} onChange={(e) => setThresholdWatch(Number(e.target.value))} />
                  <span className="form-helper">Score &lt; this = KILL (default: 0.2)</span>
                </div>
              </div>
            </div>

            {/* AI Configuration */}
            <div className="card" id="settings-ai">
              <div className="card-header">
                <div className="card-title">🧠 AI Configuration</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <div className="form-group">
                  <label className="form-label">Provider</label>
                  <select className="form-input" value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}>
                    <option value="openai">OpenAI</option>
                  </select>
                  <span className="form-helper">GPT-4o-mini recommended for cost-efficiency</span>
                </div>
                <div className="form-group">
                  <label className="form-label">Model</label>
                  <select className="form-input" value={aiModel} onChange={(e) => setAiModel(e.target.value)}>
                    <option value="gpt-4o-mini">GPT-4o-mini ($0.001/req)</option>
                    <option value="gpt-4o">GPT-4o ($0.02/req)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">API Key</label>
                  <input 
                    className="form-input" 
                    type="password" 
                    placeholder="sk-..." 
                    value={aiApiKey} 
                    onChange={(e) => setAiApiKey(e.target.value)} 
                  />
                  <span className="form-helper">Get your key from platform.openai.com/api-keys</span>
                </div>
                {aiMsg && (
                  <div style={{ fontSize: 'var(--text-sm)', color: aiMsg.startsWith('✅') ? 'var(--color-winner)' : 'var(--color-kill)' }}>
                    {aiMsg}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                  <button 
                    className="btn btn-secondary" 
                    disabled={!aiApiKey || aiTesting}
                    onClick={async () => {
                      setAiTesting(true);
                      setAiMsg('');
                      try {
                        const res = await fetch('/api/settings/test-ai', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ provider: aiProvider, apiKey: aiApiKey, model: aiModel }),
                        });
                        const data = await res.json();
                        if (data.valid) {
                          setAiMsg('✅ Connection successful! AI is ready.');
                        } else {
                          setAiMsg(`❌ ${data.error || 'Connection failed'}`);
                        }
                      } catch {
                        setAiMsg('❌ Test failed');
                      } finally {
                        setAiTesting(false);
                      }
                    }}
                    id="btn-test-ai"
                  >
                    {aiTesting ? '⟳ Testing...' : '🧪 Test Connection'}
                  </button>
                  <button 
                    className="btn btn-primary" 
                    disabled={!aiApiKey}
                    onClick={async () => {
                      setAiMsg('');
                      const res = await fetch('/api/settings/profile', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          storeName, aov,
                          targetMarginMin: marginMin / 100,
                          targetMarginMax: marginMax / 100,
                          avgCogsRate: cogsRate / 100,
                          targetCpa,
                          returningRate: returningRate / 100,
                          avgRepeatOrders: repeatOrders,
                          thresholdWinner, thresholdPromising, thresholdWatch,
                          aiProvider, aiApiKey, aiModel,
                        }),
                      });
                      if (res.ok) {
                        setAiMsg('✅ AI config saved!');
                      } else {
                        setAiMsg('❌ Save failed');
                      }
                    }}
                    id="btn-save-ai"
                  >
                    💾 Save AI Config
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </PageContainer>
    </>
  );
}
