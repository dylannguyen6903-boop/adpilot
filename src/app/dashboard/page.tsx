'use client';

import { useState } from 'react';
import { Header, PageContainer } from '@/components/layout';
import TimeframeSelector from '@/components/shared/TimeframeSelector';
import { useApiData, useAdAccounts } from '@/hooks/useApi';
import { formatCurrency, formatRoas, formatNumber } from '@/lib/utils';
import { getAdAccountDateMinusDays } from '@/lib/timezone';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  BarChart, Bar,
} from 'recharts';

// ─── Types ─────────────────────────────────

interface MarginApiResponse {
  success: boolean;
  margin: {
    shopifyRevenue: number;
    totalAdSpend: number;
    netProfit: number;
    dailyMargin: number;
    marginStatus: string;
    marginPercent: string;
    message: string;
    hasRoomToScale: boolean;
  };
}

interface CampaignsApiResponse {
  success: boolean;
  campaigns: Array<{
    campaign_id: string;
    campaign_name: string;
    fb_status: string;
    status: string;
    spend: number;
    conversions: number;
    cpa: number | null;
    ctr: number;
    roas_fb: number | null;
  }>;
  count: number;
}

interface InsightsApiResponse {
  success: boolean;
  insights: Array<{
    snapshot_date: string;
    spend: number;
    conversions: number;
    cpa: number | null;
    ctr: number;
    roas_fb: number | null;
  }>;
}

interface CollectionItem {
  collection: string;
  attributed_fb_revenue: number;
  non_fb_revenue: number;
  unattributed_revenue: number;
  total_revenue: number;
  order_count: number;
  items_sold: number;
  allocated_spend: number;
  fb_profit: number;
  fb_roas: number | null;
}

interface CollectionsApiResponse {
  period: string;
  methodology: string;
  summary: {
    total_revenue: number;
    attributed_fb_revenue: number;
    non_fb_revenue: number;
    unattributed_revenue: number;
    total_fb_spend: number;
    fb_profit: number;
    fb_roas: number | null;
    collections_count: number;
  };
  collections: CollectionItem[];
}

interface CustomerLtvApiResponse {
  period: string;
  methodology: string;
  summary: {
    total_customers: number;
    total_orders: number;
    total_revenue: number;
    avg_ltv: number;
    avg_orders_per_customer: number;
    repeat_rate: number;
    repeat_customers: number;
    total_fb_spend: number;
    fb_cac: number;
    fb_ltv_cac_ratio: number;
  };
  channel_ltv: Array<{
    channel: string;
    customer_count: number;
    total_revenue: number;
    avg_ltv: number;
    avg_orders: number;
    repeat_rate: number;
  }>;
  cohorts: Array<{
    cohort_month: string;
    customer_count: number;
    total_revenue: number;
    avg_ltv: number;
    repeat_count: number;
    repeat_rate: number;
    avg_orders: number;
  }>;
  top_customers: Array<{
    email_hash: string;
    order_count: number;
    lifetime_revenue: number;
    first_order_date: string;
    last_order_date: string;
    first_touch_channel: string;
    first_campaign: string | null;
  }>;
}

// ─── Constants ─────────────────────────────

const CHART_COLORS = {
  winner: '#22c55e',
  promising: '#eab308',
  watch: '#f97316',
  kill: '#ef4444',
  learning: '#6b7280',
};

const STATUS_LABELS: Record<string, string> = {
  WINNER: 'Winner',
  PROMISING: 'Promising',
  WATCH: 'Watch',
  KILL: 'Kill',
  LEARNING: 'Learning',
};

const COLLECTION_META: Record<string, { icon: string; color: string; bg: string }> = {
  billiards: { icon: '🎱', color: '#6366f1', bg: 'rgba(99,102,241,0.12)' },
  bowling:   { icon: '🎳', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  darts:     { icon: '🎯', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  fishing:   { icon: '🐟', color: '#06b6d4', bg: 'rgba(6,182,212,0.12)' },
  other:     { icon: '📦', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
};

const ATTRIBUTION_COLORS: Record<string, string> = {
  attributed_fb: '#0a84ff',
  non_fb: '#ff9f0a',
  unattributed: '#8e8e93',
};

// ─── Helpers ───────────────────────────────

function getRoasColor(roas: number | null): string {
  if (roas == null) return '#8e8e93';
  if (roas >= 5) return '#30d158';
  if (roas >= 3) return '#ffd60a';
  if (roas >= 1) return '#ff9f0a';
  return '#ff453a';
}

// ─── Page Component ────────────────────────

export default function DashboardPage() {
  const [timeframe, setTimeframe] = useState('1');
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [today] = useState(() => new Date().toISOString().split('T')[0]);
  const [fromDate] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]);

  const { accounts } = useAdAccounts();

  const isYesterday = timeframe === 'yesterday';
  const days = isYesterday ? 1 : parseInt(timeframe, 10);
  const yesterdayDate = getAdAccountDateMinusDays(1);
  const dateParam = isYesterday ? `&date=${yesterdayDate}` : '';
  const qsAccount = selectedAccount ? `&ad_account_id=${selectedAccount}` : '';

  const { data: marginData, error: marginError } = useApiData<MarginApiResponse>(`/api/engine/margin?days=${days}${dateParam}${qsAccount}`);
  const { data: campaignsData, error: campaignsError } = useApiData<CampaignsApiResponse>(`/api/facebook/campaigns?days=${days}${dateParam}${qsAccount}`);
  const { data: insightsData } = useApiData<InsightsApiResponse>(`/api/facebook/insights?from=${fromDate}&to=${today}${qsAccount}`);
  // TKT-00249: Pass exact timeframe + date param to collections (mirrors margin/campaigns APIs)
  // Disable collections fetch when specific ad account is selected (no account filtering support yet)
  const collectionsUrl = selectedAccount ? null : `/api/shopify/collections?days=${days}${dateParam}`;
  const { data: collectionsData, loading: collectionsLoading, error: collectionsError } = useApiData<CollectionsApiResponse>(collectionsUrl);

  // Phase 2: Customer LTV (always 90-day lookback, all accounts)
  const ltvUrl = selectedAccount ? null : `/api/shopify/customer-ltv?days=90${dateParam}`;
  const { data: ltvData, loading: ltvLoading, error: ltvError } = useApiData<CustomerLtvApiResponse>(ltvUrl);

  const coreErrors = [marginError, campaignsError].filter(Boolean);
  const hasDataError = coreErrors.length > 0;

  const margin = marginData?.margin;
  const campaigns = campaignsData?.campaigns || [];
  const collections = collectionsData?.collections || [];
  const collSummary = collectionsData?.summary;

  // KPIs
  const totalSpend = campaigns.reduce((s, c) => s + (c.spend || 0), 0);
  const totalConversions = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
  const avgCpa = totalConversions > 0 ? totalSpend / totalConversions : null;
  const activeCampaigns = campaigns.filter(c => c.fb_status !== 'PAUSED').length;
  const pausedCampaigns = campaigns.filter(c => c.fb_status === 'PAUSED').length;
  const shopifyRevenue = margin?.shopifyRevenue || 0;
  const trueRoas = totalSpend > 0 ? shopifyRevenue / totalSpend : null;
  const netProfit = margin?.netProfit || 0;

  // Status pie chart
  const statusCounts = campaigns.reduce((acc, c) => {
    const s = c.status || 'LEARNING';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const pieData = Object.entries(statusCounts).map(([name, value]) => ({
    name: STATUS_LABELS[name] || name,
    value,
    color: CHART_COLORS[name.toLowerCase() as keyof typeof CHART_COLORS] || '#6b7280',
  }));

  // Spend trend
  const dailyMap = new Map<string, { spend: number; conversions: number; cpa: number | null }>();
  (insightsData?.insights || []).forEach((i) => {
    const existing = dailyMap.get(i.snapshot_date);
    if (existing) {
      existing.spend += i.spend || 0;
      existing.conversions += i.conversions || 0;
      existing.cpa = existing.conversions > 0 ? existing.spend / existing.conversions : null;
    } else {
      dailyMap.set(i.snapshot_date, { spend: i.spend || 0, conversions: i.conversions || 0, cpa: i.cpa });
    }
  });

  const trendData = Array.from(dailyMap.entries())
    .map(([date, d]) => ({ date: date.slice(5), spend: Math.round(d.spend * 100) / 100, cpa: d.cpa ? Math.round(d.cpa * 100) / 100 : null, conversions: d.conversions }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Collection bar chart data
  const collBarData = collections.map(c => {
    const meta = COLLECTION_META[c.collection] || COLLECTION_META.other;
    return {
      name: c.collection.charAt(0).toUpperCase() + c.collection.slice(1),
      icon: meta.icon,
      fb_revenue: c.attributed_fb_revenue,
      spend: c.allocated_spend,
      profit: c.fb_profit,
      roas: c.fb_roas,
    };
  });

  // Attribution revenue breakdown for pie
  const attrPieData = collSummary ? [
    { name: 'FB Attributed', value: collSummary.attributed_fb_revenue, color: ATTRIBUTION_COLORS.attributed_fb },
    { name: 'Non-FB', value: collSummary.non_fb_revenue, color: ATTRIBUTION_COLORS.non_fb },
    { name: 'Unattributed', value: collSummary.unattributed_revenue, color: ATTRIBUTION_COLORS.unattributed },
  ].filter(d => d.value > 0) : [];

  const marginClass = margin?.marginStatus === 'CRITICAL' ? 'critical' : margin?.marginStatus === 'HEALTHY' ? 'healthy' : 'on-target';
  const timeframeLabel = isYesterday ? 'Hôm qua' : days === 1 ? 'Hôm nay' : `${days} ngày qua`;

  // Max ROAS for bar scaling
  const maxRoas = Math.max(...collections.map(c => c.fb_roas || 0), 1);

  return (
    <>
      <Header title="Tổng quan" subtitle={`Báo cáo ${timeframeLabel} — hiệu suất nhanh`}>
        {accounts && accounts.length > 0 && (
          <select className="form-input" value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}
            style={{ width: 'auto', minWidth: '150px', padding: 'var(--space-xs) var(--space-sm)' }}>
            <option value="">Tất cả tài khoản</option>
            {accounts.map(acc => (<option key={acc.adAccountId} value={acc.adAccountId}>{acc.name || acc.adAccountId}</option>))}
          </select>
        )}
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </Header>
      <PageContainer>
        {/* Data Error Alert */}
        {hasDataError && (
          <div className="card" id="dashboard-error-alert" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)', border: '1px solid var(--color-kill)', background: 'rgba(239, 68, 68, 0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
              <span style={{ fontSize: 'var(--text-xl)' }}>⚠️</span>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--color-kill)', marginBottom: 2 }}>Không tải được dữ liệu</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{coreErrors.join(' • ')} — Kiểm tra kết nối Facebook/Shopify trong Settings.</div>
              </div>
            </div>
          </div>
        )}

        {!hasDataError && (
          <>
            {/* Margin Alert */}
            {margin && (
              <div className={`margin-alert ${marginClass}`} id="margin-alert-banner">
                <span className="margin-alert-icon"><span className={`status-dot ${marginClass}`}></span></span>
                <div><strong>Biên lợi nhuận: {margin.marginPercent}</strong> — {margin.message}</div>
              </div>
            )}

            {/* KPI Grid */}
            <div className="kpi-grid mb-lg">
              <div className="card kpi-card" id="kpi-total-spend"><div className="card-title">Total Spend</div><div className="card-value">{formatCurrency(totalSpend)}</div><div className="card-subtitle">{timeframeLabel}</div></div>
              <div className="card kpi-card" id="kpi-revenue"><div className="card-title">Shopify Revenue</div><div className="card-value">{formatCurrency(shopifyRevenue)}</div><div className="card-subtitle">{timeframeLabel}</div></div>
              <div className="card kpi-card" id="kpi-profit"><div className="card-title">Net Profit</div><div className="card-value" style={{ color: netProfit >= 0 ? 'var(--color-winner)' : 'var(--color-kill)' }}>{formatCurrency(netProfit)}</div><div className="card-subtitle">Doanh thu − Giá vốn − Phí Q/C</div></div>
              <div className="card kpi-card" id="kpi-roas"><div className="card-title">True ROAS</div><div className="card-value">{formatRoas(trueRoas)}</div><div className="card-subtitle">Doanh thu / Chi phí Q/C</div></div>
              <div className="card kpi-card" id="kpi-cpa"><div className="card-title">Avg CPA</div><div className="card-value">{formatCurrency(avgCpa)}</div><div className="card-subtitle">{formatNumber(totalConversions)} chuyển đổi</div></div>
              <div className="card kpi-card" id="kpi-active"><div className="card-title">Active Campaigns</div><div className="card-value">{activeCampaigns}</div><div className="card-subtitle">Đang chạy • {pausedCampaigns} tạm dừng</div></div>
            </div>
          </>
        )}

        {/* Charts Row */}
        <div className="grid-2">
          <div className="card">
            <div className="card-header"><div className="card-title">Xu hướng Spend & CPA (7N)</div></div>
            <div className="chart-container">
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
                    <YAxis yAxisId="left" stroke="#64748b" fontSize={12} />
                    <YAxis yAxisId="right" orientation="right" stroke="#64748b" fontSize={12} />
                    <Tooltip contentStyle={{ background: '#1a2035', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f1f5f9', fontSize: 13 }} />
                    <Line yAxisId="left" type="monotone" dataKey="spend" stroke="#6366f1" strokeWidth={2} dot={false} name="Spend ($)" />
                    <Line yAxisId="right" type="monotone" dataKey="cpa" stroke="#f97316" strokeWidth={2} dot={false} name="CPA ($)" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (<div className="empty-state"><div className="empty-state-text">Đồng bộ dữ liệu để xem xu hướng.</div></div>)}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div className="card-title">Tình trạng chiến dịch</div></div>
            <div className="chart-container">
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={4} dataKey="value">
                      {pieData.map((entry, i) => (<Cell key={`cell-${i}`} fill={entry.color} />))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#1a2035', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f1f5f9' }} />
                    <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (<div className="empty-state"><div className="empty-state-text">Chưa có dữ liệu chiến dịch.</div></div>)}
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════
            Collection P&L Section (Phase 1 UI)
            ═══════════════════════════════════════════ */}
        <div className="collection-section" id="collection-pnl-section">
          <div className="collection-section-header">
            <div className="collection-section-title">
              📊 Collection P&L
              <span className="collection-section-badge">Directional</span>
            </div>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
              {selectedAccount ? 'Chọn "Tất cả tài khoản" để xem' : collectionsData?.period || `${timeframeLabel} • Tất cả tài khoản`}
            </span>
          </div>

          {/* P1-2: Show message when specific account is selected */}
          {selectedAccount ? (
            <div className="card" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-sm)' }}>🔍</div>
              <div style={{ color: 'var(--text-secondary)' }}>Collection P&L hiện chỉ hỗ trợ xem tất cả tài khoản.</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-xs)' }}>Chọn &quot;Tất cả tài khoản&quot; từ dropdown để xem dữ liệu.</div>
            </div>
          ) : collectionsError ? (
            <div className="card" style={{ padding: 'var(--space-md)', border: '1px solid var(--color-watch)', background: 'rgba(255,159,10,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                <span>⚠️</span>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--color-watch)' }}>Collection P&L không tải được</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{collectionsError}</div>
                </div>
              </div>
            </div>
          ) : collectionsLoading ? (
            <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-2xl)' }}>
              <div className="loading-spinner"></div>
              <span style={{ marginLeft: 'var(--space-md)', color: 'var(--text-muted)' }}>Đang tải Collection P&L...</span>
            </div>
          ) : collSummary ? (
            <>
              {/* Summary KPIs */}
              <div className="collection-kpi-row">
                <div className="collection-kpi">
                  <div className="collection-kpi-label">FB Attributed Revenue</div>
                  <div className="collection-kpi-value" style={{ color: '#0a84ff' }}>{formatCurrency(collSummary.attributed_fb_revenue)}</div>
                </div>
                <div className="collection-kpi">
                  <div className="collection-kpi-label">FB Ad Spend</div>
                  <div className="collection-kpi-value">{formatCurrency(collSummary.total_fb_spend)}</div>
                </div>
                <div className="collection-kpi">
                  <div className="collection-kpi-label">FB Profit</div>
                  <div className="collection-kpi-value" style={{ color: collSummary.fb_profit >= 0 ? '#30d158' : '#ff453a' }}>
                    {formatCurrency(collSummary.fb_profit)}
                  </div>
                </div>
                <div className="collection-kpi">
                  <div className="collection-kpi-label">FB ROAS</div>
                  <div className="collection-kpi-value" style={{ color: getRoasColor(collSummary.fb_roas) }}>
                    {formatRoas(collSummary.fb_roas)}
                  </div>
                </div>
                <div className="collection-kpi">
                  <div className="collection-kpi-label">Total Revenue</div>
                  <div className="collection-kpi-value">{formatCurrency(collSummary.total_revenue)}</div>
                </div>
              </div>

              {/* Revenue & Spend Bar Chart + Attribution Pie */}
              <div className="grid-2" style={{ marginBottom: 'var(--space-lg)' }}>
                <div className="card">
                  <div className="card-header"><div className="card-title">Revenue vs Spend by Collection</div></div>
                  <div className="chart-container">
                    {collBarData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={collBarData} layout="vertical" margin={{ left: 20, right: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis type="number" stroke="#64748b" fontSize={12} tickFormatter={(v: number) => `$${v}`} />
                          <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={12} width={80} />
                          <Tooltip contentStyle={{ background: '#1a2035', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f1f5f9', fontSize: 13 }}
                            formatter={(value: unknown) => formatCurrency(Number(value))} />
                          <Bar dataKey="fb_revenue" name="FB Revenue" fill="#0a84ff" radius={[0, 4, 4, 0]} />
                          <Bar dataKey="spend" name="Ad Spend" fill="#ff453a" radius={[0, 4, 4, 0]} />
                          <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (<div className="empty-state"><div className="empty-state-text">Chưa có dữ liệu collection.</div></div>)}
                  </div>
                </div>

                <div className="card">
                  <div className="card-header"><div className="card-title">Revenue Attribution</div></div>
                  <div className="chart-container">
                    {attrPieData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={attrPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                            {attrPieData.map((entry, i) => (<Cell key={`attr-${i}`} fill={entry.color} />))}
                          </Pie>
                          <Tooltip contentStyle={{ background: '#1a2035', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f1f5f9' }}
                            formatter={(value: unknown) => formatCurrency(Number(value))} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : null}
                  </div>
                  <div className="attribution-legend">
                    {attrPieData.map(d => (
                      <div key={d.name} className="attribution-legend-item">
                        <div className="attribution-legend-dot" style={{ background: d.color }}></div>
                        <span className="attribution-legend-label">{d.name}</span>
                        <span className="attribution-legend-value">{formatCurrency(d.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Collection Detail Table */}
              <div className="card">
                <div className="card-header">
                  <div className="card-title">Collection Detail</div>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                    {collections.length} collections • Inferred mapping
                  </span>
                </div>
                <div className="data-table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Collection</th>
                        <th>Orders</th>
                        <th>FB Revenue</th>
                        <th>Ad Spend</th>
                        <th>Profit</th>
                        <th>ROAS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {collections.map(c => {
                        const meta = COLLECTION_META[c.collection] || COLLECTION_META.other;
                        const roasColor = getRoasColor(c.fb_roas);
                        const roasWidth = c.fb_roas ? Math.min((c.fb_roas / maxRoas) * 100, 100) : 0;
                        return (
                          <tr key={c.collection}>
                            <td>
                              <div className="collection-name-cell">
                                <div className="collection-icon" style={{ background: meta.bg, color: meta.color }}>{meta.icon}</div>
                                <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{c.collection}</span>
                              </div>
                            </td>
                            <td>{c.order_count}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{formatCurrency(c.attributed_fb_revenue)}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{formatCurrency(c.allocated_spend)}</td>
                            <td className={c.fb_profit >= 0 ? 'cell-positive' : 'cell-negative'} style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                              {formatCurrency(c.fb_profit)}
                            </td>
                            <td>
                              <div className="roas-bar-container">
                                <div className="roas-bar-track">
                                  <div className="roas-bar-fill" style={{ width: `${roasWidth}%`, background: roasColor }}></div>
                                </div>
                                <span className="roas-bar-label" style={{ color: roasColor }}>
                                  {c.fb_roas ? `${c.fb_roas.toFixed(1)}x` : '—'}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 'var(--space-md)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  ⚠️ Collection mapping is inferred from product title/type keywords. ROAS computed on FB attributed orders only (id_match + name_match).
                </div>
              </div>
            </>
          ) : (
            <div className="card" style={{ padding: 'var(--space-2xl)', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--text-3xl)', marginBottom: 'var(--space-md)' }}>📊</div>
              <div style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-sm)' }}>Collection P&L chưa có dữ liệu</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Chạy Attribution Sync trong Settings để bắt đầu.</div>
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════
            Customer LTV Section (Phase 2)
            ═══════════════════════════════════════════ */}
        <div className="collection-section" id="customer-ltv-section">
          <div className="collection-section-header">
            <div className="collection-section-title">
              👤 Customer LTV
              <span className="collection-section-badge" style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>Phase 2</span>
            </div>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
              {selectedAccount ? 'Chọn "Tất cả tài khoản" để xem' : ltvData?.period || '90 ngày • Tất cả tài khoản'}
            </span>
          </div>

          {selectedAccount ? (
            <div className="card" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-sm)' }}>🔍</div>
              <div style={{ color: 'var(--text-secondary)' }}>Customer LTV hiện chỉ hỗ trợ xem tất cả tài khoản.</div>
            </div>
          ) : ltvError ? (
            <div className="card" style={{ padding: 'var(--space-md)', border: '1px solid var(--color-watch)', background: 'rgba(255,159,10,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                <span>⚠️</span>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--color-watch)' }}>Customer LTV không tải được</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{ltvError}</div>
                </div>
              </div>
            </div>
          ) : ltvLoading ? (
            <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-2xl)' }}>
              <div className="loading-spinner"></div>
              <span style={{ marginLeft: 'var(--space-md)', color: 'var(--text-muted)' }}>Đang tải Customer LTV...</span>
            </div>
          ) : ltvData && ltvData.summary.total_customers > 0 ? (
            <>
              {/* LTV KPIs */}
              <div className="collection-kpi-row">
                <div className="collection-kpi">
                  <div className="collection-kpi-label">Customers</div>
                  <div className="collection-kpi-value" style={{ color: '#818cf8' }}>{formatNumber(ltvData.summary.total_customers)}</div>
                </div>
                <div className="collection-kpi">
                  <div className="collection-kpi-label">Avg LTV</div>
                  <div className="collection-kpi-value" style={{ color: '#30d158' }}>{formatCurrency(ltvData.summary.avg_ltv)}</div>
                </div>
                <div className="collection-kpi">
                  <div className="collection-kpi-label">Repeat Rate</div>
                  <div className="collection-kpi-value" style={{ color: ltvData.summary.repeat_rate >= 10 ? '#30d158' : '#ff9f0a' }}>{ltvData.summary.repeat_rate}%</div>
                </div>
                <div className="collection-kpi">
                  <div className="collection-kpi-label">FB CAC</div>
                  <div className="collection-kpi-value" style={{ color: '#ff9f0a' }}>{formatCurrency(ltvData.summary.fb_cac)}</div>
                </div>
                <div className="collection-kpi">
                  <div className="collection-kpi-label">LTV/CAC</div>
                  <div className="collection-kpi-value" style={{ color: ltvData.summary.fb_ltv_cac_ratio >= 3 ? '#30d158' : ltvData.summary.fb_ltv_cac_ratio >= 1 ? '#ff9f0a' : '#ff453a' }}>
                    {ltvData.summary.fb_ltv_cac_ratio > 0 ? `${ltvData.summary.fb_ltv_cac_ratio.toFixed(1)}x` : '—'}
                  </div>
                </div>
              </div>

              {/* Channel LTV Bar Chart */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-lg)' }}>
                <div className="card" style={{ padding: 'var(--space-lg)' }}>
                  <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-md)', color: 'var(--text-primary)' }}>Avg LTV by Acquisition Channel</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={ltvData.channel_ltv} layout="vertical" margin={{ left: 20, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#8e8e93' }} tickFormatter={(v: number) => `$${v}`} />
                      <YAxis type="category" dataKey="channel" tick={{ fontSize: 11, fill: '#8e8e93' }} width={100} />
                      <Tooltip
                        contentStyle={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                        formatter={(value: unknown) => [`$${Number(value).toFixed(2)}`, 'Avg LTV']}
                      />
                      <Bar dataKey="avg_ltv" fill="#818cf8" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Cohort Summary */}
                <div className="card" style={{ padding: 'var(--space-lg)' }}>
                  <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-md)', color: 'var(--text-primary)' }}>Monthly Cohorts</h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="campaign-table" style={{ fontSize: 'var(--text-xs)' }}>
                      <thead>
                        <tr>
                          <th>COHORT</th>
                          <th>CUSTOMERS</th>
                          <th>AVG LTV</th>
                          <th>REPEAT %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ltvData.cohorts.map(c => (
                          <tr key={c.cohort_month}>
                            <td style={{ fontWeight: 600 }}>{c.cohort_month}</td>
                            <td>{c.customer_count}</td>
                            <td style={{ fontFamily: 'var(--font-mono)' }}>{formatCurrency(c.avg_ltv)}</td>
                            <td>
                              <span style={{ color: c.repeat_rate >= 10 ? '#30d158' : '#ff9f0a' }}>{c.repeat_rate}%</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Top Customers Table */}
              <div className="card" style={{ padding: 'var(--space-lg)' }}>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-md)', color: 'var(--text-primary)' }}>Top Customers by Lifetime Revenue</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table className="campaign-table" style={{ fontSize: 'var(--text-xs)' }}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>CUSTOMER</th>
                        <th>ORDERS</th>
                        <th>LIFETIME REV</th>
                        <th>FIRST ORDER</th>
                        <th>CHANNEL</th>
                        <th>FIRST CAMPAIGN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ltvData.top_customers.map((c, i) => (
                        <tr key={c.email_hash}>
                          <td style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{c.email_hash}</td>
                          <td>{c.order_count}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#30d158' }}>{formatCurrency(c.lifetime_revenue)}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{c.first_order_date}</td>
                          <td>
                            <span style={{ 
                              padding: '2px 8px', 
                              borderRadius: 4, 
                              fontSize: 'var(--text-xs)',
                              background: c.first_touch_channel === 'FB Attributed' ? 'rgba(10,132,255,0.15)' : 'rgba(255,159,10,0.15)',
                              color: c.first_touch_channel === 'FB Attributed' ? '#0a84ff' : '#ff9f0a'
                            }}>{c.first_touch_channel}</span>
                          </td>
                          <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.first_campaign || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 'var(--space-md)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  ⚠️ Customer emails are hashed for privacy. First-touch = channel of earliest attributed order. LTV = all orders from this customer in the lookback window.
                </div>
              </div>
            </>
          ) : (
            <div className="card" style={{ padding: 'var(--space-2xl)', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--text-3xl)', marginBottom: 'var(--space-md)' }}>👤</div>
              <div style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-sm)' }}>Customer LTV chưa có dữ liệu</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Chạy Attribution Sync trong Settings để bắt đầu.</div>
            </div>
          )}
        </div>

      </PageContainer>
    </>
  );
}
