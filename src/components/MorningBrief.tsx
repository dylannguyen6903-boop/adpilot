'use client';

import { useState } from 'react';
import { useApiData } from '@/hooks/useApi';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

interface DailyMetric {
  date: string;
  profit: number;
  spend: number;
  revenue: number;
  orders: number;
  cpa: number | null;
  margin: number;
}

interface PlanAction {
  type: string;
  oldBudget: number | null;
  newBudget: number | null;
  spend7d?: number;
  conversions7d?: number;
  currentCpa: number | null;
  profitPerOrder?: number | null;
  campaignName: string;
}

interface Scenario {
  id: string;
  title: string;
  description: string;
  impact: number;
  savings: number;
  effort: 'low' | 'medium' | 'high';
}

interface BriefData {
  success: boolean;
  date: string;
  yesterday: DailyMetric | null;
  dayBefore: DailyMetric | null;
  daily: DailyMetric[];
  mtd: {
    profit: number;
    spend: number;
    revenue: number;
    orders: number;
    avgCpa: number | null;
    daysElapsed: number;
    daysRemaining: number;
  };
  forecast: {
    avgDailyProfit7d: number;
    projectedMonthEnd: number;
    target: number;
    gap: number;
    onTrack: boolean;
    dailyNeeded: number;
  };
  alerts: Array<{ type: 'danger' | 'warning' | 'info'; message: string }>;
}

// ─────────────────────────────────────────
// Helper Components
// ─────────────────────────────────────────

function ChangeIndicator({ current, previous, suffix = '', isCurrency = true, invertColor = false }: {
  current: number | null; previous: number | null; suffix?: string; isCurrency?: boolean; invertColor?: boolean;
}) {
  if (current == null || previous == null || previous === 0) return null;
  const diff = current - previous;
  const pct = (diff / Math.abs(previous)) * 100;
  const isPositive = diff > 0;
  const color = invertColor
    ? (isPositive ? '#f87171' : '#4ade80')
    : (isPositive ? '#4ade80' : '#f87171');
  const arrow = isPositive ? '↑' : '↓';
  const prefix = isCurrency ? '$' : '';
  return (
    <span style={{ fontSize: 11, color, fontWeight: 600 }}>
      {arrow} {prefix}{Math.abs(diff).toFixed(0)}{suffix} ({pct > 0 ? '+' : ''}{pct.toFixed(0)}%)
    </span>
  );
}

function AlertBanner({ alerts }: { alerts: Array<{ type: string; message: string }> }) {
  if (alerts.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 'var(--space-md)' }}>
      {alerts.map((a, i) => (
        <div key={i} style={{
          padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500,
          background: a.type === 'danger' ? '#ef444420' : a.type === 'warning' ? '#f9731620' : '#3b82f620',
          color: a.type === 'danger' ? '#f87171' : a.type === 'warning' ? '#fb923c' : '#60a5fa',
          borderLeft: `3px solid ${a.type === 'danger' ? '#ef4444' : a.type === 'warning' ? '#f97316' : '#3b82f6'}`,
        }}>
          {a.type === 'danger' ? '🔴' : a.type === 'warning' ? '⚠️' : 'ℹ️'} {a.message}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────
// Charts
// ─────────────────────────────────────────

const chartTooltipStyle = {
  contentStyle: { background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#999' },
};

function ProfitChart({ data }: { data: DailyMetric[] }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>💰 Profit/ngày</div>
      <ResponsiveContainer width="100%" height={100}>
        <BarChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
          <XAxis dataKey="date" tickFormatter={d => d.slice(8)} tick={{ fontSize: 10, fill: '#666' }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip {...chartTooltipStyle} formatter={((v: number) => [`$${v.toFixed(0)}`, 'Profit']) as never} labelFormatter={l => `Ngày ${l}`} />
          <ReferenceLine y={0} stroke="#444" strokeDasharray="3 3" />
          <Bar dataKey="profit" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.profit >= 0 ? '#4ade80' : '#f87171'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CpaChart({ data, target }: { data: DailyMetric[]; target: number }) {
  const chartData = data.map(d => ({ ...d, cpaVal: d.cpa ?? 0 }));
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>📊 CPA/ngày (target: ${target})</div>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
          <XAxis dataKey="date" tickFormatter={d => d.slice(8)} tick={{ fontSize: 10, fill: '#666' }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip {...chartTooltipStyle} formatter={((v: number) => [`$${v.toFixed(0)}`, 'CPA']) as never} labelFormatter={l => `Ngày ${l}`} />
          <ReferenceLine y={target} stroke="#f97316" strokeDasharray="3 3" label={{ value: `$${target}`, fill: '#f97316', fontSize: 10, position: 'right' }} />
          <Line type="monotone" dataKey="cpaVal" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3, fill: '#60a5fa' }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SpendChart({ data }: { data: DailyMetric[] }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>💸 Spend/ngày</div>
      <ResponsiveContainer width="100%" height={100}>
        <BarChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
          <XAxis dataKey="date" tickFormatter={d => d.slice(8)} tick={{ fontSize: 10, fill: '#666' }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip {...chartTooltipStyle} formatter={((v: number) => [`$${v.toFixed(0)}`, 'Spend']) as never} labelFormatter={l => `Ngày ${l}`} />
          <Bar dataKey="spend" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function OrdersChart({ data }: { data: DailyMetric[] }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>📦 Đơn hàng/ngày</div>
      <ResponsiveContainer width="100%" height={100}>
        <BarChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
          <XAxis dataKey="date" tickFormatter={d => d.slice(8)} tick={{ fontSize: 10, fill: '#666' }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip {...chartTooltipStyle} formatter={((v: number) => [v, 'Đơn']) as never} labelFormatter={l => `Ngày ${l}`} />
          <Bar dataKey="orders" fill="#2dd4bf" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────────────────────────
// Scenario Card
// ─────────────────────────────────────────

const EFFORT_LABELS = {
  low: { label: 'Dễ', color: '#4ade80', bg: '#14532d' },
  medium: { label: 'Trung bình', color: '#facc15', bg: '#422006' },
  high: { label: 'Khó', color: '#f87171', bg: '#7f1d1d' },
};

function ScenarioCard({ s, target }: { s: Scenario; target: number }) {
  const effort = EFFORT_LABELS[s.effort];
  const reachTarget = s.impact >= target;
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 8,
      background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{s.title}</span>
        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: effort.bg, color: effort.color, fontWeight: 600 }}>
          {effort.label}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{s.description}</div>
      <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
        <span>Dự báo: <strong style={{ color: reachTarget ? '#4ade80' : '#f87171' }}>${s.impact.toLocaleString()}</strong></span>
        <span>Tác động: <strong style={{ color: '#4ade80' }}>+${s.savings}/ngày</strong></span>
        {reachTarget && <span style={{ color: '#4ade80', fontWeight: 700 }}>✅ Đạt target</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Main Morning Brief Component
// ─────────────────────────────────────────

export default function MorningBrief({ planActions = [] }: { planActions?: PlanAction[] }) {
  const { data, loading } = useApiData<BriefData>('/api/engine/brief');
  const [showCharts, setShowCharts] = useState(true);

  if (loading) {
    return (
      <div className="card mb-md" style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>
        <div className="loading-spinner" /> Đang tải Morning Brief...
      </div>
    );
  }

  if (!data?.success) return null;

  const { yesterday, dayBefore, daily, mtd, forecast, alerts } = data;

  // Build scenarios from ACTUAL plan engine actions
  const kills = planActions.filter(a => a.type === 'KILL');
  const scales = planActions.filter(a => a.type === 'SCALE' || a.type === 'LAUNCH');
  const killSavings = kills.reduce((s, a) => s + (a.oldBudget ?? 0), 0);
  const killSpend7d = kills.reduce((s, a) => s + (a.spend7d ?? 0), 0);
  const scaleExtra = scales.reduce((s, a) => {
    const dailyOrders = (a.conversions7d ?? 0) / 7;
    const profit = a.profitPerOrder ?? 0;
    return s + (dailyOrders * 0.14 * profit); // 20% budget → 14% more orders (0.7x)
  }, 0);
  const total7dSpend = planActions.reduce((s, a) => s + (a.spend7d ?? 0), 0);
  const total7dOrders = planActions.reduce((s, a) => s + (a.conversions7d ?? 0), 0);
  const currentAvgCpa = total7dOrders > 0 ? total7dSpend / total7dOrders : 0;
  const targetCpa = 42;
  const cpaSavingsPerDay = total7dOrders > 0 ? ((currentAvgCpa - targetCpa) * (total7dOrders / 7)) : 0;

  const scenarios: Scenario[] = [];
  const daysRem = forecast.dailyNeeded > 0 ? Math.round((forecast.target - mtd.profit) / forecast.dailyNeeded) : 0;

  if (kills.length > 0) {
    const proj = mtd.profit + (forecast.avgDailyProfit7d + killSavings) * daysRem;
    scenarios.push({ id: 'cut', title: `Cắt lỗ: Tắt ${kills.length} camp không hiệu quả`, description: `Tiết kiệm $${killSavings.toFixed(0)}/ngày (đã chi $${killSpend7d.toFixed(0)} trong 7 ngày mà lỗ)`, impact: Math.round(proj), savings: Math.round(killSavings), effort: 'low' });
  }
  if (scales.length > 0 && scaleExtra > 0) {
    const proj = mtd.profit + (forecast.avgDailyProfit7d + scaleExtra) * daysRem;
    scenarios.push({ id: 'scale', title: `Scale: Tăng budget ${scales.length} camp tốt nhất +20%`, description: `Ước tính thêm ~$${scaleExtra.toFixed(0)}/ngày profit (bảo thủ 0.7x)`, impact: Math.round(proj), savings: Math.round(scaleExtra), effort: 'medium' });
  }
  if (currentAvgCpa > targetCpa && cpaSavingsPerDay > 0) {
    const proj = mtd.profit + (forecast.avgDailyProfit7d + cpaSavingsPerDay) * daysRem;
    scenarios.push({ id: 'cpa', title: `Tối ưu CPA: $${currentAvgCpa.toFixed(0)} → $${targetCpa}`, description: `Nếu đạt target CPA, tiết kiệm ~$${cpaSavingsPerDay.toFixed(0)}/ngày`, impact: Math.round(proj), savings: Math.round(cpaSavingsPerDay), effort: 'high' });
  }

  // TODOs from actual plan actions
  const todos: string[] = [];
  if (kills.length > 0) todos.push(`Tắt ${kills.length} camp lỗ → tiết kiệm $${killSavings.toFixed(0)}/ngày`);
  if (scales.length > 0) todos.push(`Tăng budget ${scales.length} camp tốt → thêm ~$${scaleExtra.toFixed(0)}/ngày`);
  if (currentAvgCpa > targetCpa) todos.push(`CPA trung bình $${currentAvgCpa.toFixed(0)} > target $${targetCpa} — cần tối ưu`);
  const progressPct = Math.min(100, (mtd.profit / forecast.target) * 100);

  return (
    <div className="card mb-md" style={{ padding: 'var(--space-md)' }}>
      {/* Header */}
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 8 }}>
        ☀️ Morning Brief
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
          {new Date(data.date).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
      </div>

      {/* Alerts */}
      <AlertBanner alerts={alerts} />

      {/* KPI Row: Yesterday | vs Day Before | MTD | Forecast */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
        {/* Yesterday */}
        <div style={{ padding: 12, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Profit hôm qua</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: (yesterday?.profit ?? 0) >= 0 ? '#4ade80' : '#f87171' }}>
            ${(yesterday?.profit ?? 0).toFixed(0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Margin {((yesterday?.margin ?? 0) * 100).toFixed(1)}% · {yesterday?.orders ?? 0} đơn
          </div>
          <ChangeIndicator current={yesterday?.profit ?? null} previous={dayBefore?.profit ?? null} />
        </div>

        {/* Spend yesterday */}
        <div style={{ padding: 12, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Chi hôm qua</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>${(yesterday?.spend ?? 0).toFixed(0)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            CPA: {yesterday?.cpa ? `$${yesterday.cpa.toFixed(0)}` : '—'}
          </div>
          <ChangeIndicator current={yesterday?.spend ?? null} previous={dayBefore?.spend ?? null} invertColor />
        </div>

        {/* MTD */}
        <div style={{ padding: 12, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Profit tháng này</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: mtd.profit >= 0 ? '#4ade80' : '#f87171' }}>
            ${mtd.profit.toFixed(0)}
          </div>
          <div style={{ width: '100%', height: 4, borderRadius: 2, background: '#333', marginTop: 4, overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(0, progressPct)}%`, height: '100%', background: forecast.onTrack ? '#4ade80' : '#f97316', borderRadius: 2 }} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {progressPct.toFixed(1)}% của ${(forecast.target / 1000).toFixed(0)}K · Ngày {mtd.daysElapsed}/{mtd.daysElapsed + mtd.daysRemaining}
          </div>
        </div>

        {/* Forecast */}
        <div style={{ padding: 12, background: forecast.onTrack ? '#14532d40' : '#7f1d1d40', borderRadius: 8, border: `1px solid ${forecast.onTrack ? '#4ade8033' : '#f8717133'}` }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Dự báo cuối tháng</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: forecast.onTrack ? '#4ade80' : '#f87171' }}>
            ${forecast.projectedMonthEnd.toLocaleString()}
          </div>
          <div style={{ fontSize: 11, color: forecast.onTrack ? '#4ade80' : '#f87171', fontWeight: 600 }}>
            {forecast.onTrack ? '✅ On track' : `❌ Thiếu $${forecast.gap.toLocaleString()}`}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Cần: ${forecast.dailyNeeded.toLocaleString()}/ngày
          </div>
        </div>
      </div>

      {/* 7D Trend Charts */}
      <div style={{ marginBottom: 'var(--space-md)' }}>
        <div onClick={() => setShowCharts(!showCharts)} style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, cursor: 'pointer', userSelect: 'none' }}>
          📈 Xu hướng 7 ngày {showCharts ? '▼' : '▶'}
        </div>
        {showCharts && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-sm)' }}>
            <ProfitChart data={daily} />
            <CpaChart data={daily} target={42} />
            <SpendChart data={daily} />
            <OrdersChart data={daily} />
          </div>
        )}
      </div>

      {/* Scenarios */}
      {scenarios.length > 0 && (
        <div style={{ marginBottom: 'var(--space-md)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🎯 Kịch bản Hành động (target: ${(forecast.target / 1000).toFixed(0)}K)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {scenarios.map(s => <ScenarioCard key={s.id} s={s} target={forecast.target} />)}
          </div>
        </div>
      )}

      {/* Top 3 TODO */}
      {todos.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>✅ Việc cần làm ngay</div>
          {todos.map((t, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 0', borderBottom: '1px solid var(--border-primary)' }}>
              {i + 1}. {t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
