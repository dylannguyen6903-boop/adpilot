'use client';

import { useState, useRef, useEffect } from 'react';
import { Header, PageContainer } from '@/components/layout';
import { useApiData, apiHeaders } from '@/hooks/useApi';
import { formatCurrency } from '@/lib/utils';
import MorningBrief from '@/components/MorningBrief';
import type { GoalBreakdown, GoalRecommendation, CpaSensitivity } from '@/engine/goalEngine';
import type { CampaignEvaluation } from '@/engine/evaluator';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

interface ActionItem {
  id: string;
  type: string;
  campaignId: string;
  campaignName: string;
  adAccountId?: string;
  description: string;
  reason: string;
  oldBudget: number | null;
  newBudget: number | null;
  currentCpa: number | null;
  isCompleted: boolean;
  aiReasoning: string | null;
  aiPrediction: string | null;
  aiConfidence: number | null;
  lifecycle?: string;
  campType?: string;
  funnelHealth?: number;
  profitPerOrder?: number | null;
  diagnosis?: string;
  spend7d?: number;
  conversions7d?: number;
  spendToday?: number;
  ctr7d?: number;
  atc7d?: number;
  ic7d?: number;
  roas7d?: number | null;
  daysRunning?: number;
  frequency7d?: number;
  cpm7d?: number;
  ctrTrend?: string;
}

interface PlanResponse {
  success: boolean;
  plan: {
    date: string;
    actions: ActionItem[];
    aiSummary: string | null;
    scaleCount: number;
    killCount: number;
    watchCount: number;
    refreshCount?: number;
    learningCount?: number;
    projectedMargin: number | null;
    budgetSaved: number;
    summary: string;
    aiUsed: boolean;
    aiTokens: number;
    evaluations?: CampaignEvaluation[];
    accountHealth?: string | null;
  } | null;
  goal: GoalBreakdown | null;
  margin: {
    shopifyRevenue: number;
    totalAdSpend: number;
    netProfit: number;
    dailyMargin: number;
    marginPercent: string;
    marginStatus: string;
  } | null;
  cached: boolean;
  message?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────

const TRACK_COLORS = {
  ahead: 'var(--color-winner)',
  on_track: '#22c55e',
  behind: 'var(--color-watch)',
  critical: 'var(--color-kill)',
};

function GoalProgressBar({ goal }: { goal: GoalBreakdown }) {
  const pct = Math.min(100, goal.monthlyProgressPercent);
  const dayPct = Math.round((goal.actual.daysElapsed / (goal.actual.daysElapsed + goal.actual.daysRemaining)) * 100);
  const color = TRACK_COLORS[goal.trackingStatus];
  const statusLabel = {
    ahead: '🟢 Vượt tiến độ',
    on_track: '🟢 Đúng tiến độ',
    behind: '🟠 Chậm tiến độ',
    critical: '🔴 Cần hành động ngay',
  }[goal.trackingStatus];

  return (
    <div className="card goal-progress-card" id="goal-progress">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
        <div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Mục tiêu tháng</div>
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
            {formatCurrency(goal.actual.monthToDateProfit)}
            <span style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)', fontWeight: 400 }}>
              {' '}/ {formatCurrency(goal.monthlyTarget)}
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 'var(--text-sm)', color, fontWeight: 600 }}>{statusLabel}</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
            Ngày {goal.actual.daysElapsed} — còn {goal.actual.daysRemaining} ngày
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="goal-bar-track">
        <div className="goal-bar-fill" style={{ width: `${pct}%`, background: color }} />
        {/* Day marker */}
        <div className="goal-bar-marker" style={{ left: `${dayPct}%` }} title={`Ngày ${goal.actual.daysElapsed}/${goal.actual.daysElapsed + goal.actual.daysRemaining}`} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 4 }}>
        <span>{pct.toFixed(1)}% hoàn thành</span>
        <span>Dự kiến: {formatCurrency(goal.projectedMonthlyProfit)}</span>
      </div>

      {/* Remaining needed */}
      {goal.amountNeededRestOfMonth > 0 && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 'var(--space-xs)', padding: 'var(--space-xs) var(--space-sm)', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
          Cần thêm <strong>{formatCurrency(goal.amountNeededRestOfMonth)}</strong> trong {goal.actual.daysRemaining} ngày
          → <strong>{formatCurrency(goal.actual.daysRemaining > 0 ? goal.amountNeededRestOfMonth / goal.actual.daysRemaining : 0)}/ngày</strong>
        </div>
      )}
    </div>
  );
}

function DailyKPIs({ goal, margin }: { goal: GoalBreakdown; margin: PlanResponse['margin'] }) {
  const netProfit = margin?.netProfit ?? 0;
  const adSpend = margin?.totalAdSpend ?? goal.actual.todayAdSpend;
  const todayCpa = goal.actual.todayOrders > 0 ? adSpend / goal.actual.todayOrders : null;
  const profitColor = netProfit > 0 ? 'var(--color-winner)' : 'var(--color-kill)';
  return (
    <div className="kpi-grid mb-lg">
      <div className="card kpi-card" id="kpi-daily-profit">
        <div className="card-title">Profit hôm nay</div>
        <div className="card-value" style={{ color: profitColor }}>
          {formatCurrency(netProfit)}
        </div>
        <div className="card-subtitle">Target: {formatCurrency(goal.dailyProfitTarget)}/ngày</div>
      </div>
      <div className="card kpi-card" id="kpi-daily-orders">
        <div className="card-title">Orders hôm nay</div>
        <div className="card-value">{goal.actual.todayOrders}</div>
        <div className="card-subtitle">Cần: {goal.dailyOrdersNeeded}/ngày</div>
      </div>
      <div className="card kpi-card" id="kpi-daily-cpa">
        <div className="card-title">CPA thực tế</div>
        <div className="card-value">
          {todayCpa ? formatCurrency(todayCpa) : '—'}
        </div>
        <div className="card-subtitle">Profit/đơn: {formatCurrency(goal.profitPerOrder)}</div>
      </div>
      <div className="card kpi-card" id="kpi-daily-spend">
        <div className="card-title">Ad Spend hôm nay</div>
        <div className="card-value">{formatCurrency(adSpend)}</div>
        <div className="card-subtitle">Đề xuất: {formatCurrency(goal.dailyAdBudgetNeeded)}/ngày</div>
      </div>
    </div>
  );
}

const LIFECYCLE_LABELS: Record<string, { bg: string; color: string; label: string }> = {
  LEARNING: { bg: '#374151', color: '#9ca3af', label: 'Đang học' },
  EVALUATING: { bg: '#1e3a5f', color: '#60a5fa', label: 'Đang đánh giá' },
  PERFORMING: { bg: '#14532d', color: '#4ade80', label: 'Có lợi nhuận' },
  SCALING: { bg: '#3b0764', color: '#c084fc', label: 'Nên tăng' },
  FATIGUED: { bg: '#7f1d1d', color: '#f87171', label: 'Mệt mỏi' },
};

function LifecycleBadge({ phase }: { phase?: string }) {
  if (!phase) return null;
  const cfg = LIFECYCLE_LABELS[phase] || LIFECYCLE_LABELS.EVALUATING;
  return (
    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: cfg.bg, color: cfg.color, fontWeight: 600 }}>
      {cfg.label}
    </span>
  );
}

const ACTION_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  KILL: { label: 'TẮT', color: '#ef4444', icon: '🔴' },
  SCALE: { label: 'TĂNG', color: '#22c55e', icon: '🟢' },
  WATCH: { label: 'THEO DÕI', color: '#f97316', icon: '🟠' },
  REVERT: { label: 'GIẢM', color: '#f97316', icon: '⚠️' },
  LAUNCH: { label: 'MỚI', color: '#6366f1', icon: '🔵' },
};

function CpaBar({ cpa, target }: { cpa: number | null; target: number }) {
  if (!cpa) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Chưa có đơn</span>;
  const ratio = cpa / target;
  const color = ratio <= 1 ? '#4ade80' : ratio <= 1.3 ? '#facc15' : '#f87171';
  const label = ratio <= 1 ? 'Tốt' : ratio <= 1.3 ? 'Cao' : 'Quá cao';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color }}>${cpa.toFixed(0)}</span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>/ ${target}</span>
      <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: color + '22', color, fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function CampaignCard({ a, targetCpa }: { a: ActionItem; targetCpa: number }) {
  const [open, setOpen] = useState(false);
  const act = ACTION_LABELS[a.type] || ACTION_LABELS.WATCH;
  const profitColor = (a.profitPerOrder ?? 0) > 0 ? '#4ade80' : (a.profitPerOrder ?? 0) < 0 ? '#f87171' : 'var(--text-muted)';

  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-primary)', padding: 'var(--space-md)', marginBottom: 'var(--space-sm)' }}>
      {/* Header: Action + Name + Phase */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-sm)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: act.color, padding: '2px 8px', borderRadius: 4, background: act.color + '22' }}>{act.icon} {act.label}</span>
            <LifecycleBadge phase={a.lifecycle} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{a.campaignName}</div>
        </div>
        {a.type === 'KILL' && a.oldBudget != null && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Tiết kiệm</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#4ade80' }}>${a.oldBudget}/ngày</div>
          </div>
        )}
        {a.type === 'SCALE' && a.oldBudget != null && a.newBudget != null && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Budget</div>
            <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>
              <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>${a.oldBudget}</span>
              <span style={{ color: 'var(--text-muted)', margin: '0 3px' }}>→</span>
              <span style={{ color: '#4ade80', fontWeight: 700 }}>${a.newBudget}</span>
            </div>
          </div>
        )}
      </div>

      {/* Metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)', padding: 'var(--space-sm)', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Chi 7 ngày</div>
          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>${(a.spend7d ?? 0).toFixed(0)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Chi hôm nay</div>
          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>${(a.spendToday ?? 0).toFixed(0)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Đơn (7 ngày)</div>
          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{a.conversions7d ?? 0}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>CPA vs Target</div>
          <CpaBar cpa={a.currentCpa} target={targetCpa} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Lời/đơn</div>
          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: profitColor }}>
            {a.profitPerOrder != null ? `$${a.profitPerOrder.toFixed(0)}` : '—'}
          </div>
        </div>
      </div>

      {/* Diagnosis - always visible */}
      {a.diagnosis && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)', lineHeight: 1.4 }}>
          💡 {a.diagnosis}
        </div>
      )}

      {/* Creative Fatigue Badge */}
      {((a.frequency7d && a.frequency7d > 2.5) || a.ctrTrend === 'DOWN') && (
        <div style={{
          fontSize: 11, padding: '4px 8px', borderRadius: 4, marginBottom: 'var(--space-xs)',
          background: (a.frequency7d ?? 0) > 3.5 ? '#ef444420' : '#f9731620',
          color: (a.frequency7d ?? 0) > 3.5 ? '#f87171' : '#fb923c',
          display: 'flex', gap: 8, alignItems: 'center',
        }}>
          🎨 {a.frequency7d ? `Freq: ${a.frequency7d.toFixed(1)}` : ''}
          {a.ctrTrend === 'DOWN' && ' · CTR ↓'}
          <span style={{ marginLeft: 'auto', fontWeight: 600 }}>
            {(a.frequency7d ?? 0) > 3.5 ? 'Thay creative ngay!' : 'Theo dõi creative'}
          </span>
        </div>
      )}

      {/* Expand for AI reasoning */}
      {(a.aiReasoning || a.reason) && (
        <button onClick={() => setOpen(!open)} style={{ fontSize: 11, color: 'var(--accent-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {open ? '▼ Ẩn chi tiết' : '▶ Xem phân tích chi tiết'}
        </button>
      )}
      {open && (
        <div style={{ marginTop: 'var(--space-xs)', padding: 'var(--space-sm)', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {a.aiReasoning || a.reason}
          {a.aiPrediction && <div style={{ marginTop: 4, color: 'var(--accent-primary)' }}>💡 {a.aiPrediction}</div>}
        </div>
      )}
    </div>
  );
}

function ActionSection({ title, actions, color, targetCpa, sortKey = 'spend', defaultOpen = true }: { title: string; actions: ActionItem[]; color: string; targetCpa: number; sortKey?: 'spend' | 'profit'; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const totalSpend7d = actions.reduce((s, a) => s + (a.spend7d ?? 0), 0);
  
  // Group by adAccountId
  const groupedActions = actions.reduce((acc, a) => {
    const key = a.adAccountId || 'Chưa phân loại';
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {} as Record<string, ActionItem[]>);

  const groupKeys = Object.keys(groupedActions).sort();

  return (
    <div className="card" style={{ padding: 'var(--space-md)' }}>
      <div onClick={() => setIsOpen(!isOpen)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: isOpen ? 'var(--space-md)' : 0, cursor: 'pointer', userSelect: 'none' }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
        <span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>({actions.length})</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>Chi 7 ngày: ${totalSpend7d.toFixed(0)}</span>
        <span style={{ fontSize: 14, color: 'var(--text-muted)', marginLeft: 4 }}>{isOpen ? '▼' : '▶'}</span>
      </div>
      {isOpen && (actions.length === 0 ? (
        <div style={{ padding: 'var(--space-lg)', textAlign: 'center', color: 'var(--text-muted)' }}>Không có camp nào</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {groupKeys.map(key => {
            const groupSorted = [...groupedActions[key]].sort((a, b) => {
              if (sortKey === 'profit') return (b.profitPerOrder ?? -999) - (a.profitPerOrder ?? -999);
              return (b.spend7d ?? 0) - (a.spend7d ?? 0);
            });
            
            return (
              <div key={key}>
                {groupKeys.length > 1 && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 'var(--space-sm)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    📁 Tài khoản: {key}
                  </div>
                )}
                {groupSorted.map(a => <CampaignCard key={a.id} a={a} targetCpa={targetCpa} />)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SensitivityTable({ data }: { data: CpaSensitivity[] }) {
  return (
    <div className="card" id="cpa-sensitivity">
      <div className="card-header">
        <div className="card-title">CPA Sensitivity</div>
      </div>
      <div className="data-table-container">
        <table className="data-table">
          <thead><tr><th>CPA</th><th>Profit/Đơn</th><th>Profit/Ngày</th><th>Profit/Tháng</th></tr></thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.cpa} style={{ color: row.status === 'danger' ? 'var(--color-kill)' : row.status === 'warning' ? 'var(--color-watch)' : 'var(--text-primary)' }}>
                <td className="cell-mono">${row.cpa}</td>
                <td className="cell-mono">${row.profitPerOrder}</td>
                <td className="cell-mono">{formatCurrency(row.dailyProfit)}</td>
                <td className="cell-mono" style={{ fontWeight: 600 }}>{formatCurrency(row.monthlyProfit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AIChatPanel({ planSummary: _planSummary }: { planSummary: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch('/api/engine/chat', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ message: userMsg, history: messages.slice(-6) }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply || 'Không có phản hồi.' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '❌ Lỗi kết nối AI. Kiểm tra cấu hình trong Settings.' }]);
    } finally {
      setLoading(false);
    }
  };

  const suggestions = [
    'Phân tích tại sao profit hôm nay thấp?',
    'Nên scale camp nào lên 50%?',
    'So sánh top 5 camp hiệu quả nhất',
  ];

  return (
    <div className={`ai-chat-panel ${isOpen ? 'open' : ''}`} id="ai-chat">
      <button className="ai-chat-toggle" onClick={() => setIsOpen(!isOpen)}>
        <span>💬 Hỏi AI</span>
        <span style={{ fontSize: 'var(--text-xs)' }}>{isOpen ? '▼' : '▲'}</span>
      </button>

      {isOpen && (
        <div className="ai-chat-body">
          <div className="ai-chat-messages">
            {messages.length === 0 && (
              <div style={{ padding: 'var(--space-md)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                <div style={{ marginBottom: 'var(--space-sm)' }}>Hỏi AI về kế hoạch quảng cáo</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                  {suggestions.map((s, i) => (
                    <button key={i} className="btn btn-sm btn-secondary" onClick={() => { setInput(s); }} style={{ fontSize: 'var(--text-xs)' }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`chat-msg ${msg.role}`}>
                <div className="chat-msg-content">{msg.content}</div>
              </div>
            ))}
            {loading && <div className="chat-msg assistant"><div className="chat-msg-content"><span className="loading-spinner sm" /> Đang phân tích...</div></div>}
            <div ref={messagesEndRef} />
          </div>
          <div className="ai-chat-input">
            <input
              type="text"
              className="form-input"
              placeholder="Nhập câu hỏi..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              disabled={loading}
            />
            <button className="btn btn-primary btn-sm" onClick={sendMessage} disabled={loading || !input.trim()}>
              Gửi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function _AccountOverview({ actions, margin }: { actions: ActionItem[]; margin: { netProfit: number; totalAdSpend: number; shopifyRevenue: number; marginPercent: string } | null }) {
  const kills = actions.filter(a => a.type === 'KILL');
  const scales = actions.filter(a => a.type === 'SCALE');
  const watches = actions.filter(a => a.type === 'WATCH');

  const wastedBudget = kills.reduce((s, a) => s + (a.oldBudget ?? 0), 0);
  const wastedSpend7d = kills.reduce((s, a) => s + (a.spend7d ?? 0), 0);
  const totalSpend7d = actions.reduce((s, a) => s + (a.spend7d ?? 0), 0);
  const totalOrders7d = actions.reduce((s, a) => s + (a.conversions7d ?? 0), 0);
  const profitableCamps = actions.filter(a => (a.profitPerOrder ?? 0) > 0);
  const unprofitableCamps = actions.filter(a => a.conversions7d && a.conversions7d > 0 && (a.profitPerOrder ?? 0) < 0);
  const noOrderCamps = actions.filter(a => (a.spend7d ?? 0) > 30 && !(a.conversions7d));

  const profitToday = margin?.netProfit ?? 0;
  const marginPct = margin?.marginPercent ?? '0%';
  const isHealthy = profitToday > 0 && parseFloat(marginPct) >= 17;

  return (
    <div className="card mb-md" style={{ padding: 'var(--space-md)' }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 8 }}>
        🧠 Tổng quan Tài khoản
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: isHealthy ? '#14532d' : '#7f1d1d', color: isHealthy ? '#4ade80' : '#f87171', fontWeight: 600 }}>
          {isHealthy ? '✅ Khỏe mạnh' : '⚠️ Cần tối ưu'}
        </span>
      </div>

      {/* Tình hình */}
      <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-secondary)', marginBottom: 'var(--space-md)' }}>
        <div>📊 <strong>Tổng chi 7 ngày:</strong> ${totalSpend7d.toFixed(0)} — <strong>{totalOrders7d} đơn</strong> — CPA trung bình: ${totalOrders7d > 0 ? (totalSpend7d / totalOrders7d).toFixed(0) : '∞'}</div>
        <div>💰 <strong>Profit hôm nay:</strong> <span style={{ color: profitToday > 0 ? '#4ade80' : '#f87171', fontWeight: 700 }}>${profitToday.toFixed(0)}</span> — Margin: <span style={{ color: parseFloat(marginPct) >= 17 ? '#4ade80' : '#f87171' }}>{marginPct}</span> (mục tiêu ≥ 17%)</div>
        <div>🟢 <strong>{profitableCamps.length}</strong> camp có lời | 🔴 <strong>{unprofitableCamps.length}</strong> camp lỗ | ⚪ <strong>{noOrderCamps.length}</strong> camp chi &gt;$30 chưa có đơn</div>
      </div>

      {/* Khuyến nghị */}
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 'var(--space-xs)', color: 'var(--text-primary)' }}>📋 Khuyến nghị:</div>
      <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-secondary)' }}>
        {kills.length > 0 && (
          <div style={{ padding: '6px 10px', background: '#ef444415', borderRadius: 6, marginBottom: 4 }}>
            🔴 <strong>Tắt {kills.length} camp</strong> — tiết kiệm <strong style={{ color: '#4ade80' }}>${wastedBudget}/ngày</strong> (đã chi ${wastedSpend7d.toFixed(0)} trong 7 ngày mà không hiệu quả)
          </div>
        )}
        {scales.length > 0 && (
          <div style={{ padding: '6px 10px', background: '#22c55e15', borderRadius: 6, marginBottom: 4 }}>
            🟢 <strong>Tăng budget {scales.length} camp</strong> — các camp có CPA tốt dưới ${42} và đang có lời
          </div>
        )}
        {watches.length > 0 && (
          <div style={{ padding: '6px 10px', background: '#f9731615', borderRadius: 6, marginBottom: 4 }}>
            🟠 <strong>Theo dõi {watches.length} camp</strong> — chưa đủ data hoặc đang trong giai đoạn đánh giá, chưa nên thay đổi
          </div>
        )}
        {unprofitableCamps.length > 0 && (
          <div style={{ padding: '6px 10px', background: '#f9731615', borderRadius: 6, marginBottom: 4 }}>
            ⚠️ <strong>{unprofitableCamps.length} camp có đơn nhưng lỗ</strong> — kiểm tra lại creative hoặc audience, CPA vượt ngưỡng lợi nhuận
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────

export default function ActionPlanPage() {
  const days = 7;
  const today = new Date().toLocaleDateString('vi-VN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const { accounts } = useApiData<{ connections: { facebook: { accounts: { id: string; name?: string; adAccountId: string }[] } } }>('/api/settings/connections').data?.connections?.facebook || { accounts: [] };

  const queryUrl = `/api/engine/plan?days=${days}&force=true${selectedAccount ? `&ad_account_id=${selectedAccount}` : ''}`;
  const { data, loading, refetch } = useApiData<PlanResponse>(queryUrl);
  const [regenerating, setRegenerating] = useState(false);

  const plan = data?.plan;
  const goal = data?.goal ?? null;
  const actions = plan?.actions || [];
  const targetCpa = 42; // from business config

  // Split actions into groups
  const actionKill = actions.filter(a => a.type === 'KILL');
  const actionScale = actions.filter(a => a.type === 'SCALE' || a.type === 'LAUNCH' || a.type === 'REVERT');
  const actionWatch = actions.filter(a => a.type === 'WATCH');

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await fetch(queryUrl, { method: 'POST', headers: apiHeaders() });
      refetch();
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <>
      <Header title="Kế hoạch Hành động" subtitle={`${today}`}>
        {accounts && accounts.length > 0 && (
          <select 
            className="form-input" 
            value={selectedAccount} 
            onChange={e => setSelectedAccount(e.target.value)}
            style={{ width: 'auto', minWidth: '150px', padding: 'var(--space-xs) var(--space-sm)' }}
          >
            <option value="">Tất cả tài khoản</option>
            {accounts.map(acc => (
              <option key={acc.adAccountId} value={acc.adAccountId}>
                {acc.name || acc.adAccountId}
              </option>
            ))}
          </select>
        )}
        <button
          className={`btn btn-primary btn-sm ${regenerating ? 'syncing' : ''}`}
          onClick={handleRegenerate}
          disabled={regenerating}
          id="btn-regenerate-plan"
        >
          {regenerating ? 'Đang phân tích...' : '🤖 Phân tích với AI'}
        </button>
      </Header>
      <PageContainer>
        {loading ? (
          <div className="loading-page"><div className="loading-spinner lg" /><span>Đang tải kế hoạch...</span></div>
        ) : (
          <>
            {/* Morning Brief — 30 second overview */}
            <MorningBrief planActions={actions} />

            {/* Section 1: Goal Progress */}
            {goal && <GoalProgressBar goal={goal} />}

            {/* Section 2: Daily KPIs */}
            {goal && <DailyKPIs goal={goal} margin={data?.margin ?? null} />}

            {/* Section 3: Campaign Actions */}
            {actionKill.length > 0 && (
              <div className="mb-md">
                <ActionSection title="Nên Tắt" actions={actionKill} color="#ef4444" targetCpa={targetCpa} sortKey="spend" />
              </div>
            )}
            {actionScale.length > 0 && (
              <div className="mb-md">
                <ActionSection title="Nên Tăng Budget" actions={actionScale} color="#22c55e" targetCpa={targetCpa} sortKey="profit" />
              </div>
            )}
            <div className="mb-lg">
              <ActionSection title="Theo Dõi — Chưa Cần Hành Động" actions={actionWatch} color="#f97316" targetCpa={targetCpa} sortKey="spend" defaultOpen={false} />
            </div>

            {/* Section 4: CPA Sensitivity + Recommendations */}
            {goal && goal.cpaSensitivity.length > 0 && (
              <div className="grid-2 mb-lg">
                <SensitivityTable data={goal.cpaSensitivity} />
                <div className="card" id="goal-recommendations">
                  <div className="card-header"><div className="card-title">Gợi ý đạt mục tiêu</div></div>
                  {goal.recommendations.length === 0 ? (
                    <div className="empty-state" style={{ padding: 'var(--space-lg)' }}>
                      <div className="empty-state-text">Đang on track — không cần hành động thêm</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', padding: 'var(--space-sm)' }}>
                      {goal.recommendations.slice(0, 5).map((rec, i) => (
                        <RecommendationCard key={i} rec={rec} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Empty state */}
            {!plan && !data?.goal && (
              <div className="card">
                <div className="empty-state" style={{ padding: 'var(--space-2xl)' }}>
                  <div className="empty-state-title">Chưa Có Dữ Liệu</div>
                  <div className="empty-state-text">{data?.message || 'Đồng bộ dữ liệu trước, sau đó bấm Phân tích với AI.'}</div>
                </div>
              </div>
            )}

            {/* AI Chat Panel */}
            <AIChatPanel planSummary={plan?.aiSummary ?? null} />
          </>
        )}
      </PageContainer>
    </>
  );
}

function RecommendationCard({ rec }: { rec: GoalRecommendation }) {
  const typeConfig: Record<string, { icon: string; color: string }> = {
    SCALE_CAMPAIGN: { icon: '📈', color: 'var(--color-winner)' },
    KILL_CAMPAIGN: { icon: '🔴', color: 'var(--color-kill)' },
    INCREASE_BUDGET: { icon: '💰', color: 'var(--accent-primary)' },
    REDUCE_CPA: { icon: '⚠️', color: 'var(--color-watch)' },
  };
  const cfg = typeConfig[rec.type] || typeConfig.INCREASE_BUDGET;

  return (
    <div style={{
      padding: 'var(--space-sm)',
      background: 'var(--bg-tertiary)',
      borderRadius: 'var(--radius-sm)',
      borderLeft: `3px solid ${cfg.color}`,
      fontSize: 'var(--text-xs)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <span style={{ fontWeight: 600 }}>{cfg.icon} {rec.campaignName || rec.type.replace('_', ' ')}</span>
        <span className={`confidence-badge ${rec.confidence >= 80 ? 'high' : rec.confidence >= 50 ? 'medium' : 'low'}`}>
          {rec.confidence}%
        </span>
      </div>
      <div style={{ color: 'var(--text-secondary)' }}>{rec.description}</div>
      <div style={{ color: cfg.color, fontWeight: 600, marginTop: 2 }}>{rec.impact}</div>
    </div>
  );
}
