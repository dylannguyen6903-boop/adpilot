'use client';

import { useState } from 'react';
import { Header, PageContainer } from '@/components/layout';
import { useApiAction } from '@/hooks/useApi';
import { formatCurrency, formatPercent } from '@/lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';

interface BudgetAllocation {
  campaignId: string;
  campaignName: string;
  currentBudget: number;
  recommendedBudget: number;
  changePercent: number;
  performanceScore: number;
  status: string;
}

interface BudgetSimulation {
  totalBudget: number;
  allocations: BudgetAllocation[];
  projectedMargin: number;
  projectedRoas: number | null;
  projectedCpa: number | null;
  budgetUtilization: number;
}

interface AllocateResponse {
  success: boolean;
  allocation: BudgetSimulation;
}

const BUDGET_PRESETS = [100, 150, 180, 200, 250, 300];

const STATUS_COLORS: Record<string, string> = {
  WINNER: '#22c55e',
  PROMISING: '#eab308',
  WATCH: '#f97316',
  KILL: '#ef4444',
  LEARNING: '#6b7280',
};

const tooltipStyle = {
  background: '#1a2035',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  color: '#f1f5f9',
  fontSize: 13,
};

export default function BudgetAllocatorPage() {
  const [budget, setBudget] = useState(180);
  const [result, setResult] = useState<BudgetSimulation | null>(null);

  const { execute, loading } = useApiAction<AllocateResponse, { totalDailyBudget: number }>('/api/budget/allocate');

  const handleAllocate = async () => {
    const res = await execute({ totalDailyBudget: budget });
    if (res?.allocation) setResult(res.allocation);
  };

  const allocations = result?.allocations || [];
  const activeAllocations = allocations.filter((a) => a.recommendedBudget > 0);

  // Chart data
  const barData = activeAllocations.slice(0, 10).map((a) => ({
    name: a.campaignName.length > 20 ? a.campaignName.slice(0, 20) + '…' : a.campaignName,
    current: a.currentBudget,
    recommended: a.recommendedBudget,
    status: a.status,
  }));

  const pieData = Object.entries(
    activeAllocations.reduce((acc, a) => {
      acc[a.status] = (acc[a.status] || 0) + a.recommendedBudget;
      return acc;
    }, {} as Record<string, number>)
  ).map(([name, value]) => ({
    name,
    value: Math.round(value * 100) / 100,
    fill: STATUS_COLORS[name] || '#6b7280',
  }));

  return (
    <>
      <Header title="Budget Allocator" subtitle="Optimize your daily ad spend allocation" />
      <PageContainer>
        {/* Budget Input */}
        <div className="card mb-lg">
          <div className="card-header">
            <div className="card-title">Total Daily Budget</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-lg)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-xs)' }}>
              <span style={{ fontSize: 'var(--text-lg)', color: 'var(--text-muted)' }}>$</span>
              <input
                type="number"
                className="form-input"
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                style={{ width: 120, fontSize: 'var(--text-2xl)', fontWeight: 700, textAlign: 'center' }}
                id="budget-input"
              />
              <span className="card-subtitle">/ day</span>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
              {BUDGET_PRESETS.map((preset) => (
                <button
                  key={preset}
                  className={`btn btn-sm ${budget === preset ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setBudget(preset)}
                >
                  ${preset}
                </button>
              ))}
            </div>

            <button
              className={`btn btn-primary ${loading ? 'syncing' : ''}`}
              onClick={handleAllocate}
              disabled={loading}
              id="btn-allocate"
            >
              {loading ? '⟳ Calculating...' : '✨ Calculate Allocation'}
            </button>
          </div>
        </div>

        {/* Results */}
        {result && (
          <>
            {/* Projection KPIs */}
            <div className="kpi-grid mb-lg">
              <div className="card kpi-card">
                <div className="card-title">Projected Margin</div>
                <div className="card-value" style={{
                  color: result.projectedMargin >= 0.17 ? 'var(--color-winner)' : 'var(--color-kill)'
                }}>
                  {formatPercent(result.projectedMargin)}
                </div>
                <div className="card-subtitle">Target: 17-20%</div>
              </div>
              <div className="card kpi-card">
                <div className="card-title">Projected ROAS</div>
                <div className="card-value">{result.projectedRoas ? `${result.projectedRoas.toFixed(2)}x` : '—'}</div>
              </div>
              <div className="card kpi-card">
                <div className="card-title">Projected CPA</div>
                <div className="card-value">{formatCurrency(result.projectedCpa)}</div>
              </div>
              <div className="card kpi-card">
                <div className="card-title">Winner Budget %</div>
                <div className="card-value">{result.budgetUtilization.toFixed(0)}%</div>
                <div className="card-subtitle">of budget to Winners</div>
              </div>
            </div>

            {/* Charts */}
            <div className="grid-2 mb-lg">
              <div className="card">
                <div className="card-header"><div className="card-title">Current vs Recommended</div></div>
                <div className="chart-container">
                  {barData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} layout="vertical" margin={{ left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis type="number" stroke="#64748b" fontSize={11} />
                        <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={11} width={120} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="current" fill="rgba(99,102,241,0.3)" name="Current ($)" radius={[0, 4, 4, 0]} />
                        <Bar dataKey="recommended" name="Recommended ($)" radius={[0, 4, 4, 0]}>
                          {barData.map((entry, i) => (
                            <Cell key={i} fill={STATUS_COLORS[entry.status] || '#6b7280'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="empty-state"><div className="empty-state-text">No eligible campaigns</div></div>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-header"><div className="card-title">Budget Distribution</div></div>
                <div className="chart-container">
                  {pieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3} dataKey="value">
                          {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(value) => `$${value}`} />
                        <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="empty-state"><div className="empty-state-text">No data</div></div>
                  )}
                </div>
              </div>
            </div>

            {/* Allocation Table */}
            <div className="card">
              <div className="card-header"><div className="card-title">Allocation Details</div></div>
              <div className="data-table-container">
                <table className="data-table" id="allocation-table">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Status</th>
                      <th>Current</th>
                      <th>Recommended</th>
                      <th>Change</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocations.map((a) => (
                      <tr key={a.campaignId} style={{ opacity: a.recommendedBudget === 0 ? 0.5 : 1 }}>
                        <td style={{ fontWeight: 500 }}>{a.campaignName}</td>
                        <td><span style={{ color: STATUS_COLORS[a.status] }}>{a.status}</span></td>
                        <td className="cell-mono">{formatCurrency(a.currentBudget)}</td>
                        <td className="cell-mono" style={{ fontWeight: 600 }}>{formatCurrency(a.recommendedBudget)}</td>
                        <td className={`cell-mono ${a.changePercent > 0 ? 'cell-positive' : a.changePercent < 0 ? 'cell-negative' : ''}`}>
                          {a.changePercent > 0 ? '+' : ''}{a.changePercent.toFixed(1)}%
                        </td>
                        <td className="cell-mono">{(a.performanceScore * 100).toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {!result && !loading && (
          <div className="card">
            <div className="empty-state" style={{ padding: 'var(--space-2xl)' }}>
              <div className="empty-state-icon">✨</div>
              <div className="empty-state-title">Set Your Budget</div>
              <div className="empty-state-text">
                Enter your total daily budget above and click &quot;Calculate Allocation&quot; to see the AI-optimized distribution across your campaigns.
              </div>
            </div>
          </div>
        )}
      </PageContainer>
    </>
  );
}
