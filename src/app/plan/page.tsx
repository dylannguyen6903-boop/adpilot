'use client';

import { useState } from 'react';
import { Header, PageContainer } from '@/components/layout';
import TimeframeSelector from '@/components/shared/TimeframeSelector';
import { useApiData, useApiAction } from '@/hooks/useApi';
import { formatCurrency, formatPercent } from '@/lib/utils';

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
  currentLtvCpa: number | null;
  isCompleted: boolean;
  aiReasoning: string | null;
  aiPrediction: string | null;
  aiConfidence: number | null;
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
    projectedMargin: number | null;
    budgetSaved: number;
    summary: string;
    aiUsed: boolean;
    aiTokens: number;
  } | null;
  cached: boolean;
  message?: string;
}

const ACTION_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  KILL: { icon: '', color: 'var(--color-kill)', bg: 'var(--color-kill-bg)' },
  REVERT: { icon: '', color: 'var(--color-watch)', bg: 'var(--color-watch-bg)' },
  SCALE: { icon: '', color: 'var(--color-winner)', bg: 'var(--color-winner-bg)' },
  LAUNCH: { icon: '', color: 'var(--accent-primary)', bg: 'var(--accent-glow)' },
  WATCH: { icon: '', color: 'var(--color-watch)', bg: 'var(--color-watch-bg)' },
};

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const level = confidence >= 80 ? 'high' : confidence >= 50 ? 'medium' : 'low';
  const label = confidence >= 80 ? 'Cao' : confidence >= 50 ? 'TB' : 'Thấp';
  return (
    <span className={`confidence-badge ${level}`}>
      {confidence}% {label}
    </span>
  );
}

export default function ActionPlanPage() {
  const [days, setDays] = useState(3);

  const today = new Date().toLocaleDateString('vi-VN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const { data, loading, refetch } = useApiData<PlanResponse>(`/api/engine/plan?days=${days}`);
  const { execute: regenerate, loading: regenerating } = useApiAction<PlanResponse>('/api/engine/plan');

  const plan = data?.plan;
  const actions = plan?.actions || [];

  const handleRegenerate = async () => {
    await regenerate();
    refetch();
  };

  return (
    <>
      <Header title="Kế hoạch Hành động" subtitle={`${today} — Đề xuất tự động từ AI`}>
        <TimeframeSelector value={days} onChange={setDays} />
      </Header>
      <PageContainer>
        {/* AI Summary */}
        {plan?.aiSummary && (
          <div className="ai-summary-card" id="ai-summary">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
              <span className="ai-badge ai-label">Phân tích AI</span>
              {plan.aiUsed && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                  {plan.aiTokens} tokens
                </span>
              )}
            </div>
            <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', lineHeight: 'var(--leading-relaxed)' }}>
              {plan.aiSummary}
            </p>
          </div>
        )}

        {/* Summary Cards */}
        <div className="kpi-grid mb-lg">
          <div className="card kpi-card" id="plan-scale-count">
            <div className="card-title">Hành động Scale</div>
            <div className="card-value" style={{ color: 'var(--color-winner)' }}>{plan?.scaleCount ?? '—'}</div>
          </div>
          <div className="card kpi-card" id="plan-kill-count">
            <div className="card-title">Hành động Kill</div>
            <div className="card-value" style={{ color: 'var(--color-kill)' }}>{plan?.killCount ?? '—'}</div>
          </div>
          <div className="card kpi-card" id="plan-budget-saved">
            <div className="card-title">Ngân sách tiết kiệm</div>
            <div className="card-value">{plan ? formatCurrency(plan.budgetSaved) : '—'}</div>
            <div className="card-subtitle">từ các chiến dịch Kill</div>
          </div>
          <div className="card kpi-card" id="plan-projected-margin">
            <div className="card-title">Biên lợi nhuận hiện tại</div>
            <div className="card-value">{plan ? formatPercent(plan.projectedMargin) : '—'}</div>
          </div>
        </div>

        {/* Regenerate Button */}
        <div className="flex-between mb-md">
          <div className="card-title" style={{ fontSize: 'var(--text-lg)' }}>
            {plan?.summary || 'Chưa có kế hoạch nào được tạo'}
          </div>
          <button
            className={`btn btn-primary btn-sm ${regenerating ? 'syncing' : ''}`}
            onClick={handleRegenerate}
            disabled={regenerating}
            id="btn-regenerate-plan"
          >
            {regenerating ? 'Đang phân tích...' : 'Phân tích với AI'}
          </button>
        </div>

        {/* Action List */}
        {loading ? (
          <div className="loading-page"><div className="loading-spinner lg" /><span>Đang tải kế hoạch...</span></div>
        ) : actions.length === 0 ? (
          <div className="card">
            <div className="empty-state" style={{ padding: 'var(--space-2xl)' }}>
              <div className="empty-state-title">Chưa Có Hành Động Nào</div>
              <div className="empty-state-text">
                {data?.message || 'Đồng bộ dữ liệu trước tiên, sau đó bấm Phân tích với AI.'}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {actions.map((action, idx) => {
              const cfg = ACTION_CONFIG[action.type] || ACTION_CONFIG.WATCH;
              return (
                <div
                  key={action.id}
                  className="card"
                  style={{
                    borderLeft: `4px solid ${cfg.color}`,
                    opacity: action.isCompleted ? 0.6 : 1,
                    transition: 'all 0.2s',
                  }}
                  id={`action-${idx}`}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-md)' }}>
                    {/* Action icon */}
                    <div style={{
                      width: 8, height: 40, borderRadius: 4,
                      background: cfg.color, flexShrink: 0,
                    }}>
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                        <span style={{
                          fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.05em',
                          color: cfg.color, textTransform: 'uppercase' as const,
                        }}>
                          {action.type}
                        </span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
                          #{idx + 1}
                        </span>
                        {action.aiConfidence !== null && (
                          <ConfidenceBadge confidence={action.aiConfidence} />
                        )}
                      </div>

                      <div style={{ fontWeight: 600, marginBottom: 'var(--space-xs)', color: 'var(--text-primary)' }}>
                        {action.campaignName}
                      </div>

                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', marginBottom: 'var(--space-xs)' }}>
                        {action.description}
                      </div>

                      {/* AI Reasoning */}
                      {action.aiReasoning && (
                        <div className="ai-reasoning">
                          {action.aiReasoning}
                        </div>
                      )}

                      {/* AI Prediction */}
                      {action.aiPrediction && (
                        <div className="ai-prediction">
                          <strong>Dự đoán:</strong> {action.aiPrediction}
                        </div>
                      )}

                      {/* Fallback: non-AI reason */}
                      {!action.aiReasoning && action.reason && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 'var(--space-xs)' }}>
                          {action.reason}
                        </div>
                      )}

                      {action.currentCpa && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-xs)' }}>
                          CPA: {formatCurrency(action.currentCpa)}
                        </div>
                      )}
                    </div>

                    {/* Budget change */}
                    {action.oldBudget !== null && action.newBudget !== null && (
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Ngân sách</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
                          <span style={{ color: 'var(--text-secondary)', textDecoration: action.type === 'KILL' ? 'line-through' : 'none' }}>
                            ${action.oldBudget}
                          </span>
                          <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>→</span>
                          <span style={{ color: cfg.color, fontWeight: 600 }}>
                            ${action.newBudget}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageContainer>
    </>
  );
}
