'use client';

import { useState } from 'react';
import { Header, PageContainer } from '@/components/layout';
import TimeframeSelector from '@/components/shared/TimeframeSelector';
import { useApiData } from '@/hooks/useApi';
import { formatCurrency, formatPercent, formatRoas, formatNumber } from '@/lib/utils';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';

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

export default function DashboardPage() {
  const [days, setDays] = useState(3);
  const today = new Date().toISOString().split('T')[0];
  const fromDate = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const { data: marginData } = useApiData<MarginApiResponse>(`/api/engine/margin?days=${days}`);
  const { data: campaignsData } = useApiData<CampaignsApiResponse>(`/api/facebook/campaigns?days=${days}`);
  const { data: insightsData } = useApiData<InsightsApiResponse>(`/api/facebook/insights?from=${fromDate}&to=${today}`);

  const margin = marginData?.margin;
  const campaigns = campaignsData?.campaigns || [];

  // Calculate KPIs from aggregated data
  const totalSpend = campaigns.reduce((s, c) => s + (c.spend || 0), 0);
  const totalConversions = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
  const avgCpa = totalConversions > 0 ? totalSpend / totalConversions : null;
  const activeCampaigns = campaigns.filter(c => c.fb_status !== 'PAUSED').length;
  const pausedCampaigns = campaigns.filter(c => c.fb_status === 'PAUSED').length;
  const shopifyRevenue = margin?.shopifyRevenue || 0;
  const trueRoas = totalSpend > 0 ? shopifyRevenue / totalSpend : null;
  const netProfit = margin?.netProfit || 0;

  // Status distribution for pie chart
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

  // Aggregate daily insights for trend chart
  const dailyMap = new Map<string, { spend: number; conversions: number; cpa: number | null }>();
  (insightsData?.insights || []).forEach((i) => {
    const existing = dailyMap.get(i.snapshot_date);
    if (existing) {
      existing.spend += i.spend || 0;
      existing.conversions += i.conversions || 0;
      existing.cpa = existing.conversions > 0 ? existing.spend / existing.conversions : null;
    } else {
      dailyMap.set(i.snapshot_date, {
        spend: i.spend || 0,
        conversions: i.conversions || 0,
        cpa: i.cpa,
      });
    }
  });

  const trendData = Array.from(dailyMap.entries())
    .map(([date, d]) => ({
      date: date.slice(5),
      spend: Math.round(d.spend * 100) / 100,
      cpa: d.cpa ? Math.round(d.cpa * 100) / 100 : null,
      conversions: d.conversions,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Margin banner
  const marginClass = margin?.marginStatus === 'CRITICAL' ? 'critical'
    : margin?.marginStatus === 'HEALTHY' ? 'healthy' : 'on-target';
  const marginIcon = '';

  const timeframeLabel = days === 1 ? 'Hôm nay' : `${days} ngày qua`;

  return (
    <>
      <Header title="Tổng quan" subtitle={`Báo cáo ${timeframeLabel} — hiệu suất nhanh`}>
        <TimeframeSelector value={days} onChange={setDays} />
      </Header>
      <PageContainer>
        {/* Margin Alert */}
        {margin && (
          <div className={`margin-alert ${marginClass}`} id="margin-alert-banner">
            <span className="margin-alert-icon"><span className={`status-dot ${marginClass}`}></span></span>
            <div>
              <strong>Biên lợi nhuận: {margin.marginPercent}</strong> — {margin.message}
            </div>
          </div>
        )}

        {/* KPI Grid */}
        <div className="kpi-grid mb-lg">
          <div className="card kpi-card" id="kpi-total-spend">
            <div className="card-title">Total Spend</div>
            <div className="card-value">{formatCurrency(totalSpend)}</div>
            <div className="card-subtitle">{timeframeLabel}</div>
          </div>
          <div className="card kpi-card" id="kpi-revenue">
            <div className="card-title">Shopify Revenue</div>
            <div className="card-value">{formatCurrency(shopifyRevenue)}</div>
            <div className="card-subtitle">{timeframeLabel}</div>
          </div>
          <div className="card kpi-card" id="kpi-profit">
            <div className="card-title">Net Profit</div>
            <div className="card-value" style={{ color: netProfit >= 0 ? 'var(--color-winner)' : 'var(--color-kill)' }}>
              {formatCurrency(netProfit)}
            </div>
            <div className="card-subtitle">Doanh thu − Giá vốn − Phí Q/C</div>
          </div>
          <div className="card kpi-card" id="kpi-roas">
            <div className="card-title">True ROAS</div>
            <div className="card-value">{formatRoas(trueRoas)}</div>
            <div className="card-subtitle">Doanh thu / Chi phí Q/C</div>
          </div>
          <div className="card kpi-card" id="kpi-cpa">
            <div className="card-title">Avg CPA</div>
            <div className="card-value">{formatCurrency(avgCpa)}</div>
            <div className="card-subtitle">{formatNumber(totalConversions)} chuyển đổi</div>
          </div>
          <div className="card kpi-card" id="kpi-active">
            <div className="card-title">Active Campaigns</div>
            <div className="card-value">{activeCampaigns}</div>
            <div className="card-subtitle">
              Đang chạy • {pausedCampaigns} tạm dừng
            </div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid-2">
          {/* Spend & CPA Trend */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Xu hướng Spend & CPA (7N)</div>
            </div>
            <div className="chart-container">
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
                    <YAxis yAxisId="left" stroke="#64748b" fontSize={12} />
                    <YAxis yAxisId="right" orientation="right" stroke="#64748b" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        background: '#1a2035',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        color: '#f1f5f9',
                        fontSize: 13,
                      }}
                    />
                    <Line yAxisId="left" type="monotone" dataKey="spend" stroke="#6366f1" strokeWidth={2} dot={false} name="Spend ($)" />
                    <Line yAxisId="right" type="monotone" dataKey="cpa" stroke="#f97316" strokeWidth={2} dot={false} name="CPA ($)" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-state">
                  <div className="empty-state-text">Đồng bộ dữ liệu để xem xu hướng.</div>
                </div>
              )}
            </div>
          </div>

          {/* Campaign Distribution */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Tình trạng chiến dịch</div>
            </div>
            <div className="chart-container">
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={`cell-${i}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: '#1a2035',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        color: '#f1f5f9',
                      }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      wrapperStyle={{ fontSize: 12, color: '#94a3b8' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-state">
                  <div className="empty-state-text">Chưa có dữ liệu chiến dịch.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </PageContainer>
    </>
  );
}
