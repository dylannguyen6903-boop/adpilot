'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Header, PageContainer } from '@/components/layout';
import TimeframeSelector from '@/components/shared/TimeframeSelector';
import StatusBadge from '@/components/shared/StatusBadge';
import { useApiData } from '@/hooks/useApi';
import { formatCurrency, formatPercent } from '@/lib/utils';
import type { CampaignStatus } from '@/types/campaign';

interface CampaignSnapshot {
  campaign_id: string;
  campaign_name: string;
  fb_status: string;
  effective_status: string;
  status: CampaignStatus | null;
  spend: number;
  conversions: number;
  cpa: number | null;
  ltv_adjusted_cpa: number | null;
  ctr: number;
  roas_fb: number | null;
  daily_budget: number;
  performance_score: number | null;
  margin_contribution: number | null;
  snapshot_date: string;
  days_with_data: number;
}

interface CampaignsResponse {
  success: boolean;
  campaigns: CampaignSnapshot[];
  count: number;
  days: number;
  fromDate: string;
  toDate: string;
}

const STATUS_FILTERS: Array<{ value: CampaignStatus | 'ALL'; label: string; icon: string }> = [
  { value: 'ALL', label: 'Tất cả', icon: '' },
  { value: 'WINNER', label: 'Winner', icon: '' },
  { value: 'PROMISING', label: 'Promising', icon: '' },
  { value: 'WATCH', label: 'Watch', icon: '' },
  { value: 'KILL', label: 'Kill', icon: '' },
  { value: 'LEARNING', label: 'Learning', icon: '' },
];

type SortKey = 'spend' | 'conversions' | 'cpa' | 'ctr' | 'performance_score';

export default function CampaignsPage() {
  const [days, setDays] = useState(1);
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | 'ALL'>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [sortAsc, setSortAsc] = useState(false);

  const { data, loading } = useApiData<CampaignsResponse>(`/api/facebook/campaigns?days=${days}`);

  const campaigns = data?.campaigns || [];
  const timeframeLabel = days === 1 ? 'Hôm nay' : `${days} ngày qua`;

  // Filter
  const filtered = statusFilter === 'ALL'
    ? campaigns
    : campaigns.filter((c) => c.status === statusFilter);

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    const aVal = (a[sortKey] as number) ?? 0;
    const bVal = (b[sortKey] as number) ?? 0;
    return sortAsc ? aVal - bVal : bVal - aVal;
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortAsc ? ' ↑' : ' ↓';
  };

  return (
    <>
      <Header title="Chiến dịch" subtitle={`${campaigns.length} chiến dịch — ${timeframeLabel}`}>
        <TimeframeSelector value={days} onChange={setDays} />
      </Header>
      <PageContainer>
        {/* Filters */}
        <div className="flex-between mb-md" style={{ flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
            {STATUS_FILTERS.map((f) => {
              const count = f.value === 'ALL'
                ? campaigns.length
                : campaigns.filter((c) => c.status === f.value).length;
              return (
                <button
                  key={f.value}
                  className={`btn btn-sm ${statusFilter === f.value ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setStatusFilter(f.value)}
                  id={`filter-${f.value.toLowerCase()}`}
                >
                  {f.icon} {f.label} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="loading-page"><div className="loading-spinner lg" /><span>Đang tải chiến dịch...</span></div>
        ) : sorted.length === 0 ? (
          <div className="card">
            <div className="empty-state" style={{ padding: 'var(--space-2xl)' }}>
              <div className="empty-state-title">Chưa có chiến dịch</div>
              <div className="empty-state-text">
                {campaigns.length === 0
                  ? 'Kết nối tài khoản Facebook Ads trong Cài đặt và tiến hành đồng bộ.'
                  : `Không có chiến dịch nào khớp với bộ lọc "${statusFilter}".`}
              </div>
              {campaigns.length === 0 && (
                <Link href="/settings" className="btn btn-primary mt-md">Đến trang Cài đặt</Link>
              )}
            </div>
          </div>
        ) : (
          <div className="data-table-container">
            <table className="data-table" id="campaigns-table">
              <thead>
                <tr>
                  <th>Chiến dịch</th>
                  <th>Trạng thái</th>
                  <th onClick={() => handleSort('spend')} style={{ cursor: 'pointer' }}>Spend{sortIndicator('spend')}</th>
                  <th onClick={() => handleSort('conversions')} style={{ cursor: 'pointer' }}>Conv.{sortIndicator('conversions')}</th>
                  <th onClick={() => handleSort('cpa')} style={{ cursor: 'pointer' }}>CPA{sortIndicator('cpa')}</th>
                  <th>CPA (LTV)</th>
                  <th onClick={() => handleSort('ctr')} style={{ cursor: 'pointer' }}>CTR{sortIndicator('ctr')}</th>
                  <th>ROAS</th>
                  <th>Margin</th>
                  <th onClick={() => handleSort('performance_score')} style={{ cursor: 'pointer' }}>Điểm{sortIndicator('performance_score')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => {
                  const isPaused = c.fb_status === 'PAUSED' || c.effective_status === 'PAUSED';
                  const isActive = !isPaused;
                  return (
                    <tr key={c.campaign_id} className={isPaused ? 'row-paused' : ''} style={{ opacity: isPaused ? 0.6 : 1 }}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                          <span style={{
                            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                            background: isActive ? '#22c55e' : '#6b7280',
                            boxShadow: isActive ? '0 0 6px rgba(34,197,94,0.4)' : 'none',
                          }} title={isActive ? 'Active' : 'Off'} />
                          <Link href={`/campaigns/${c.campaign_id}`} style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                            {c.campaign_name}
                          </Link>
                          {isPaused && <span className="paused-badge" style={{ background: 'rgba(107,114,128,0.2)', color: '#9ca3af', fontSize: '10px', padding: '1px 6px', borderRadius: '4px', marginLeft: '4px' }}>Off</span>}
                        </div>
                      </td>
                      <td><StatusBadge status={c.status || 'LEARNING'} /></td>
                      <td className="cell-mono">{formatCurrency(c.spend)}</td>
                      <td className="cell-mono">{c.conversions}</td>
                      <td className={`cell-mono ${c.cpa && c.cpa > 45 ? 'cell-negative' : c.cpa && c.cpa < 35 ? 'cell-positive' : ''}`}>
                        {formatCurrency(c.cpa)}
                      </td>
                      <td className="cell-mono">{formatCurrency(c.ltv_adjusted_cpa)}</td>
                      <td className="cell-mono">{c.ctr ? `${c.ctr.toFixed(2)}%` : '—'}</td>
                      <td className="cell-mono">{c.roas_fb ? `${c.roas_fb.toFixed(2)}x` : '—'}</td>
                      <td className={`cell-mono ${c.margin_contribution && c.margin_contribution > 0 ? 'cell-positive' : c.margin_contribution && c.margin_contribution < 0 ? 'cell-negative' : ''}`}>
                        {formatPercent(c.margin_contribution)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                          <div style={{
                            width: 40, height: 4, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden'
                          }}>
                            <div style={{
                              width: `${(c.performance_score || 0) * 100}%`,
                              height: '100%',
                              background: (c.performance_score || 0) > 0.7 ? 'var(--color-winner)' : (c.performance_score || 0) > 0.4 ? 'var(--color-promising)' : 'var(--color-kill)',
                              borderRadius: 2,
                            }} />
                          </div>
                          <span className="cell-mono cell-muted">{((c.performance_score || 0) * 100).toFixed(0)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageContainer>
    </>
  );
}
