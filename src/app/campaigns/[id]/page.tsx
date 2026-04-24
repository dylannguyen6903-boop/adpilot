'use client';

import { use } from 'react';
import Link from 'next/link';
import { Header, PageContainer } from '@/components/layout';
import StatusBadge from '@/components/shared/StatusBadge';
import { useApiData } from '@/hooks/useApi';
import { formatCurrency, formatPercent } from '@/lib/utils';
import type { CampaignStatus } from '@/types/campaign';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from 'recharts';

interface CampaignSnapshot {
  campaign_id: string;
  campaign_name: string;
  status: CampaignStatus | null;
  spend: number;
  conversions: number;
  cpa: number | null;
  ltv_adjusted_cpa: number | null;
  ctr: number;
  cpm: number;
  cpc: number;
  roas_fb: number | null;
  daily_budget: number;
  performance_score: number | null;
  margin_contribution: number | null;
  reach: number;
  frequency: number;
  impressions: number;
  clicks: number;
  snapshot_date: string;
}

interface InsightsResponse {
  success: boolean;
  insights: CampaignSnapshot[];
}

const tooltipStyle = {
  background: '#1a2035',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  color: '#f1f5f9',
  fontSize: 13,
};

const _initNow = Date.now();
const _sevenDaysAgo = new Date(_initNow - 7 * 86400000).toISOString().split('T')[0];
const _today = new Date(_initNow).toISOString().split('T')[0];

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data, loading } = useApiData<InsightsResponse>(
    `/api/facebook/insights?from=${_sevenDaysAgo}&to=${_today}&campaign_id=${id}`
  );

  const insights = data?.insights || [];
  const latest = insights.length > 0 ? insights[insights.length - 1] : null;

  const chartData = insights.map((i) => ({
    date: i.snapshot_date.slice(5),
    spend: Math.round(i.spend * 100) / 100,
    cpa: i.cpa ? Math.round(i.cpa * 100) / 100 : null,
    conversions: i.conversions,
    ctr: Math.round(i.ctr * 100) / 100,
  }));

  if (loading) {
    return (
      <>
        <Header title="Campaign Detail" subtitle="Loading..." />
        <PageContainer>
          <div className="loading-page"><div className="loading-spinner lg" /><span>Loading campaign data...</span></div>
        </PageContainer>
      </>
    );
  }

  if (!latest) {
    return (
      <>
        <Header title="Campaign Detail" subtitle="No data available" />
        <PageContainer>
          <div className="empty-state">
            <div className="empty-state-icon">📊</div>
            <div className="empty-state-title">No Data Found</div>
            <div className="empty-state-text">Campaign &quot;{id}&quot; has no data. It may not have been synced yet.</div>
            <Link href="/campaigns" className="btn btn-secondary mt-md">← Back to Campaigns</Link>
          </div>
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <Header title={latest.campaign_name} subtitle="7-day performance analysis" />
      <PageContainer>
        {/* Back + Status */}
        <div className="flex-between mb-md">
          <Link href="/campaigns" className="btn btn-secondary btn-sm">← Back</Link>
          <StatusBadge status={latest.status || 'LEARNING'} />
        </div>

        {/* KPI Cards */}
        <div className="kpi-grid mb-lg">
          <div className="card kpi-card">
            <div className="card-title">Daily Budget</div>
            <div className="card-value">{formatCurrency(latest.daily_budget)}</div>
          </div>
          <div className="card kpi-card">
            <div className="card-title">Spend (Today)</div>
            <div className="card-value">{formatCurrency(latest.spend)}</div>
          </div>
          <div className="card kpi-card">
            <div className="card-title">CPA</div>
            <div className="card-value">{formatCurrency(latest.cpa)}</div>
            <div className="card-subtitle">LTV-Adj: {formatCurrency(latest.ltv_adjusted_cpa)}</div>
          </div>
          <div className="card kpi-card">
            <div className="card-title">Conversions</div>
            <div className="card-value">{latest.conversions}</div>
          </div>
          <div className="card kpi-card">
            <div className="card-title">CTR / CPC</div>
            <div className="card-value">{latest.ctr.toFixed(2)}%</div>
            <div className="card-subtitle">CPC: {formatCurrency(latest.cpc)}</div>
          </div>
          <div className="card kpi-card">
            <div className="card-title">Margin</div>
            <div className="card-value">{formatPercent(latest.margin_contribution)}</div>
            <div className="card-subtitle">Score: {((latest.performance_score || 0) * 100).toFixed(0)}/100</div>
          </div>
        </div>

        {/* Charts */}
        <div className="grid-2 mb-lg">
          <div className="card">
            <div className="card-header"><div className="card-title">Spend & CPA (7d)</div></div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={12} />
                  <YAxis yAxisId="right" orientation="right" stroke="#64748b" fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line yAxisId="left" type="monotone" dataKey="spend" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} name="Spend ($)" />
                  <Line yAxisId="right" type="monotone" dataKey="cpa" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} name="CPA ($)" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div className="card-title">Conversions (7d)</div></div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
                  <YAxis stroke="#64748b" fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="conversions" fill="#22c55e" radius={[4, 4, 0, 0]} name="Conversions" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Raw Metrics Table */}
        <div className="card">
          <div className="card-header"><div className="card-title">Daily Breakdown</div></div>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Spend</th>
                  <th>Impressions</th>
                  <th>Clicks</th>
                  <th>CTR</th>
                  <th>Conv.</th>
                  <th>CPA</th>
                  <th>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {insights.map((i) => (
                  <tr key={i.snapshot_date}>
                    <td>{i.snapshot_date}</td>
                    <td className="cell-mono">{formatCurrency(i.spend)}</td>
                    <td className="cell-mono">{i.impressions.toLocaleString()}</td>
                    <td className="cell-mono">{i.clicks}</td>
                    <td className="cell-mono">{i.ctr.toFixed(2)}%</td>
                    <td className="cell-mono">{i.conversions}</td>
                    <td className="cell-mono">{formatCurrency(i.cpa)}</td>
                    <td className="cell-mono">{i.roas_fb ? `${i.roas_fb.toFixed(2)}x` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </PageContainer>
    </>
  );
}
