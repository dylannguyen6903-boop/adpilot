'use client';

import { useState, useRef, useEffect } from 'react';
import { Header, PageContainer } from '@/components/layout';
import { useApiData } from '@/hooks/useApi';
import { formatCurrency, formatPercent } from '@/lib/utils';
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
  description: string;
  reason: string;
  oldBudget: number | null;
  newBudget: number | null;
  currentCpa: number | null;
  isCompleted: boolean;
  aiReasoning: string | null;
  aiPrediction: string | null;
  aiConfidence: number | null;
  // V3
  lifecycle?: string;
  campType?: string;
  funnelHealth?: number;
  profitPerOrder?: number | null;
  diagnosis?: string;
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

function DailyKPIs({ goal }: { goal: GoalBreakdown }) {
  const profitColor = goal.isOnTrack ? 'var(--color-winner)' : 'var(--color-kill)';
  return (
    <div className="kpi-grid mb-lg">
      <div className="card kpi-card" id="kpi-daily-profit">
        <div className="card-title">Profit hôm nay</div>
        <div className="card-value" style={{ color: profitColor }}>
          {formatCurrency(goal.actual.todayRevenue * 0.8 - goal.actual.todayAdSpend)}
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
        <div className="card-value" style={{ color: goal.actual.todayCpa && goal.actual.todayCpa > goal.profitPerOrder + (goal.actual.todayCpa ?? 0) ? 'var(--color-kill)' : 'var(--text-primary)' }}>
          {goal.actual.todayCpa ? formatCurrency(goal.actual.todayCpa) : '—'}
        </div>
        <div className="card-subtitle">Profit/đơn: {formatCurrency(goal.profitPerOrder)}</div>
      </div>
      <div className="card kpi-card" id="kpi-daily-spend">
        <div className="card-title">Ad Spend hôm nay</div>
        <div className="card-value">{formatCurrency(goal.actual.todayAdSpend)}</div>
        <div className="card-subtitle">Đề xuất: {formatCurrency(goal.dailyAdBudgetNeeded)}/ngày</div>
      </div>
    </div>
  );
}

const LIFECYCLE_COLORS: Record<string, { bg: string; color: string }> = {
  LEARNING: { bg: '#374151', color: '#9ca3af' },
  EVALUATING: { bg: '#1e3a5f', color: '#60a5fa' },
  PERFORMING: { bg: '#14532d', color: '#4ade80' },
  SCALING: { bg: '#3b0764', color: '#c084fc' },
  FATIGUED: { bg: '#7f1d1d', color: '#f87171' },
};

const CAMPTYPE_LABELS: Record<string, { icon: string; label: string }> = {
  PROSPECTING: { icon: '🔵', label: 'TOF' },
  RETARGETING: { icon: '🟠', label: 'BOF' },
  MIXED: { icon: '⚪', label: 'Mix' },
};

function LifecycleBadge({ phase }: { phase?: string }) {
  if (!phase) return null;
  const cfg = LIFECYCLE_COLORS[phase] || LIFECYCLE_COLORS.EVALUATING;
  return (
    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: cfg.bg, color: cfg.color, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>
      {phase}
    </span>
  );
}

function FunnelHealthBar({ score }: { score?: number }) {
  if (score === undefined || score === null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const color = score >= 70 ? '#4ade80' : score >= 40 ? '#facc15' : '#f87171';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 40, height: 5, borderRadius: 3, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color }}>{score}</span>
    </div>
  );
}

function ActionTable({ title, actions, type, color }: {
  title: string;
  actions: ActionItem[];
  type: 'action' | 'watch';
  color: string;
}) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  return (
    <div className="card" id={`table-${type}`}>
      <div className="card-header">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
          {title}
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 400 }}>({actions.length})</span>
        </div>
      </div>
      {actions.length === 0 ? (
        <div className="empty-state" style={{ padding: 'var(--space-lg)' }}>
          <div className="empty-state-text">{type === 'action' ? 'Không có hành động cần thiết' : 'Không có camp cần theo dõi'}</div>
        </div>
      ) : (
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 55 }}>Loại</th>
                <th>Campaign</th>
                <th style={{ width: 65 }}>Phase</th>
                <th style={{ width: 50 }}>Health</th>
                <th style={{ width: 70 }}>Profit/Đơn</th>
                <th style={{ width: 65 }}>CPA</th>
                {type === 'action' && <th style={{ width: 130 }}>Budget</th>}
                {type === 'watch' && <th style={{ width: 70 }}>Budget</th>}
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => {
                const cfg = ACTION_STYLES[a.type] || ACTION_STYLES.WATCH;
                const isExpanded = expandedRow === a.id;
                const ct = CAMPTYPE_LABELS[a.campType || ''] || CAMPTYPE_LABELS.MIXED;
                return (
                  <>
                    <tr
                      key={a.id}
                      onClick={() => setExpandedRow(isExpanded ? null : a.id)}
                      style={{ cursor: 'pointer', opacity: a.isCompleted ? 0.5 : 1 }}
                    >
                      <td>
                        <span style={{ color: cfg.color, fontWeight: 700, fontSize: 10, textTransform: 'uppercase' as const }}>
                          {a.type}
                        </span>
                      </td>
                      <td style={{ fontSize: 'var(--text-sm)' }}>
                        <div style={{ fontWeight: 500 }}>{a.campaignName}</div>
                        <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                          <span style={{ fontSize: 9 }}>{ct.icon} {ct.label}</span>
                        </div>
                      </td>
                      <td><LifecycleBadge phase={a.lifecycle} /></td>
                      <td><FunnelHealthBar score={a.funnelHealth} /></td>
                      <td className="cell-mono" style={{ fontSize: 11, color: (a.profitPerOrder ?? 0) > 0 ? '#4ade80' : (a.profitPerOrder ?? 0) < 0 ? '#f87171' : 'var(--text-muted)' }}>
                        {a.profitPerOrder != null ? `$${a.profitPerOrder.toFixed(0)}` : '—'}
                      </td>
                      <td className="cell-mono" style={{ fontSize: 11 }}>{a.currentCpa ? `$${a.currentCpa.toFixed(0)}` : '—'}</td>
                      {type === 'action' && (
                        <td className="cell-mono" style={{ fontSize: 11 }}>
                          {a.oldBudget !== null && a.newBudget !== null ? (
                            <>
                              <span style={{ textDecoration: a.type === 'KILL' ? 'line-through' : 'none', color: 'var(--text-muted)' }}>${a.oldBudget}</span>
                              <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>→</span>
                              <span style={{ color: cfg.color, fontWeight: 600 }}>${a.newBudget}</span>
                            </>
                          ) : '—'}
                        </td>
                      )}
                      {type === 'watch' && (
                        <td className="cell-mono" style={{ fontSize: 11 }}>{a.oldBudget !== null ? `$${a.oldBudget}` : '—'}</td>
                      )}
                    </tr>
                    {isExpanded && (
                      <tr key={`${a.id}-detail`}>
                        <td colSpan={type === 'action' ? 8 : 7} style={{ background: 'var(--bg-tertiary)', padding: 'var(--space-sm) var(--space-md)' }}>
                          {a.diagnosis && <div style={{ fontSize: 11, color: 'var(--accent-primary)', marginBottom: 4 }}>📊 {a.diagnosis}</div>}
                          {a.aiReasoning && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{a.aiReasoning}</div>}
                          {a.aiPrediction && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>💡 {a.aiPrediction}</div>}
                          {!a.aiReasoning && a.reason && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{a.reason}</div>}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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

function AIChatPanel({ planSummary }: { planSummary: string | null }) {
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
        headers: { 'Content-Type': 'application/json' },
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

// ─────────────────────────────────────────
// Constants
// ─────────────────────────────────────────

const ACTION_STYLES: Record<string, { color: string }> = {
  KILL: { color: 'var(--color-kill)' },
  REVERT: { color: 'var(--color-watch)' },
  SCALE: { color: 'var(--color-winner)' },
  LAUNCH: { color: 'var(--accent-primary)' },
  WATCH: { color: 'var(--color-watch)' },
};

// ─────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────

export default function ActionPlanPage() {
  const days = 7;
  const today = new Date().toLocaleDateString('vi-VN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const { data, loading, refetch } = useApiData<PlanResponse>(`/api/engine/plan?days=${days}&force=true`);
  const [regenerating, setRegenerating] = useState(false);

  const plan = data?.plan;
  const goal = data?.goal ?? null;
  const actions = plan?.actions || [];

  // Split actions into two groups
  const actionNow = actions.filter(a => a.type === 'KILL' || a.type === 'SCALE' || a.type === 'LAUNCH' || a.type === 'REVERT');
  const actionWatch = actions.filter(a => a.type === 'WATCH');

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await fetch(`/api/engine/plan?days=${days}`, { method: 'POST' });
      refetch();
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <>
      <Header title="Kế hoạch Hành động" subtitle={`${today}`}>
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
            {/* Section 1: Goal Progress */}
            {goal && <GoalProgressBar goal={goal} />}

            {/* Account Health + AI Summary */}
            {plan?.aiSummary && (
              <div className="ai-summary-card mb-md" id="ai-summary">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                  <span className="ai-badge ai-label">🧠 Account Health</span>
                  {plan.aiUsed && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{plan.aiTokens} tokens</span>}
                  {plan.learningCount !== undefined && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>⚫ {plan.learningCount} learning</span>}
                </div>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', lineHeight: 'var(--leading-relaxed)', margin: 0 }}>{plan.aiSummary}</p>
              </div>
            )}

            {/* Section 2: Daily KPIs */}
            {goal && <DailyKPIs goal={goal} />}

            {/* Section 3: Dual Tables */}
            <div className="grid-2 mb-lg">
              <ActionTable title="Hành Động Ngay" actions={actionNow} type="action" color="var(--color-kill)" />
              <ActionTable title="Theo Dõi" actions={actionWatch} type="watch" color="var(--color-watch)" />
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
