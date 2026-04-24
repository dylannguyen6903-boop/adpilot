/**
 * AI-Powered Action Plan Generator for AdPilot V3.0
 *
 * Lifecycle-aware, multi-signal evaluation:
 * 1. Evaluator: Assigns lifecycle phase, funnel health, profit/order per campaign.
 * 2. Scale Engine: Generates scaling recommendations + budget reallocation.
 * 3. AI Deep Analysis: LLM receives enriched context for cross-campaign insights.
 * 4. Merge: Combine evaluator + AI results into final Action Plan.
 *
 * Key improvements over V2:
 * - Profit-adjusted CPA (AOV × margin - CPA, not raw CPA)
 * - 7-day evaluation window (never judge on 1 day)
 * - Prospecting vs Retargeting classification (different CPA tolerances)
 * - Funnel health scoring (CTR, ATC rate, IC rate, trends)
 * - Metric combo diagnosis (6 patterns identifying root cause)
 * - Conservative scaling (5% per 2 days for $500+, not 20%)
 */

import type { ActionItem, ActionType } from '@/types/plan';
import type { DailyMarginResult } from './margin';
import { createAIClient, type AIClient } from '@/lib/ai';
import {
  evaluateCampaign,
  type EvalCampaignData,
  type EvalConfig,
  type CampaignEvaluation,
} from './evaluator';
import {
  getScaleRecommendation,
  generateBudgetReallocation,
  type ScaleRecommendation,
  type BudgetReallocation,
} from './scaleEngine';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

/** Extended campaign data including funnel metrics for V3 evaluation */
export interface CampaignData {
  campaignId: string;
  campaignName: string;
  fbStatus: string;
  adAccountId: string;

  // Today's metrics
  spend: number;
  conversions: number;
  cpa: number | null;
  ctr: number;
  cpm: number;
  cpc: number;
  roas_fb: number | null;
  dailyBudget: number;
  daysRunning: number;
  daysWithData: number;
  addToCart: number;
  initiateCheckout: number;
  revenueFb: number;
  impressions: number;
  clicks: number;
  frequency: number;

  // 7-day aggregated
  spend7d: number;
  conversions7d: number;
  atc7d: number;
  ic7d: number;
  avgCPA7d: number | null;
  avgCTR7d: number;
  avgFrequency7d: number;
  avgAOV7d: number | null;
  profitPerOrder7d: number | null;

  // Trends
  ctrTrend: number;
  cpaTrend: number;
  cpmTrend: number;

  // Stability
  daysWithPurchases: number;
  consecutiveProfitDays: number;
}

export interface PlannerConfig {
  targetCpa: number;
  targetMarginMin: number;
  targetMarginMax: number;
  avgCogsRate: number;
  aov: number;
  returningRate: number;
  avgRepeatOrders: number;
}

export interface GeneratedPlan {
  date: string;
  actions: ActionItem[];
  aiSummary: string | null;
  scaleCount: number;
  killCount: number;
  watchCount: number;
  refreshCount: number;
  learningCount: number;
  projectedMargin: number | null;
  budgetSaved: number;
  summary: string;
  aiUsed: boolean;
  aiTokens: number;
  // V3 additions
  evaluations: CampaignEvaluation[];
  scaleRecommendations: ScaleRecommendation[];
  budgetReallocations: BudgetReallocation[];
  accountHealth: string | null;
}

// ─────────────────────────────────────────
// AI System Prompt (V3)
// ─────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior Media Buyer with $30M+ managed Facebook ad spend for POD/DTC ecommerce. You analyze campaign PORTFOLIOS — not individual ads in isolation.

## YOUR ANALYSIS FRAMEWORK

### 1. Account-Level Health (ALWAYS START HERE)
- Evaluate total account ROAS vs breakeven (1.25×)
- Assess Prospecting (freq <1.2) vs Retargeting (freq >1.35) balance — both are needed
- Check if budget is concentrated on winners or spread thin on losers
- Identify if rising CPMs are account-wide (seasonal/competition) vs campaign-specific

### 2. Per-Campaign Diagnosis Using Metric Combos
For campaigns needing evaluation, identify the root cause pattern:
- High CTR + No ATC → Creative resonates but landing page/pricing issue
- Low CTR + Has purchases → Website converts well, ad needs better hooks  
- High CTR + ATC + No purchase → Checkout/shipping friction
- Low engagement everywhere → Creative or targeting miss
- Converting but thin margins → CPA close to breakeven, monitor

### 3. Profit-Adjusted Evaluation (CRITICAL)
NEVER evaluate CPA in isolation. Calculate: Profit/Order = AOV × (1-COGS) - CPA
A campaign with CPA $60 and AOV $120 (profit $36) is BETTER than CPA $30 + AOV $50 (profit $10).

### 4. Scaling Wisdom
- Budget ≥$500/day: recommend +5% every 2 days (conservative, prevents learning reset)
- Budget <$500/day: recommend +15-20% to build data volume
- NEVER scale more than +20% at once — campaigns tank when scaled too aggressively
- Prospecting campaigns (low freq) NEED higher CPA tolerance — they feed the retargeting funnel

### 5. 7-Day Rule
NEVER make decisions based on 1 bad day. Use 7-day averages.
"We don't make decisions on one bad day. We make decisions on last 7 days. Period."

## OUTPUT FORMAT
Output MUST be valid JSON:
{
  "accountHealth": "2-3 sentence overview of account state, key opportunity, biggest risk",
  "actions": [
    {
      "campaignId": "string",
      "action": "KILL" | "SCALE" | "WATCH" | "KEEP" | "REFRESH",
      "reasoning": "2-3 sentences referencing specific numbers and the diagnostic pattern",
      "insight": "What the user cannot see from raw numbers alone (cross-campaign, trends, market)",
      "scalingRec": "Specific budget change if SCALE, e.g. '$15 → $18/day (+20%)'",
      "confidence": 0-100
    }
  ]
}

Action definitions:
- KILL: Turn off. Unprofitable after sufficient evaluation window. Not recovering.
- SCALE: Increase budget. Proven profitable with stable metrics and room to grow.
- WATCH: Hold position. Promising signals but needs more data to confirm.
- KEEP: Performing adequately. No change needed. (Only include if noteworthy insight.)
- REFRESH: Creative fatigue detected. Don't kill — refresh hooks/visuals first.`;

// ─────────────────────────────────────────
// Build Evaluation Data
// ─────────────────────────────────────────

function buildEvalData(camp: CampaignData): EvalCampaignData {
  return {
    campaignId: camp.campaignId,
    campaignName: camp.campaignName,
    fbStatus: camp.fbStatus,
    adAccountId: camp.adAccountId,
    spend: camp.spend,
    impressions: camp.impressions,
    clicks: camp.clicks,
    conversions: camp.conversions,
    addToCart: camp.addToCart,
    initiateCheckout: camp.initiateCheckout,
    cpa: camp.cpa,
    ctr: camp.ctr,
    cpm: camp.cpm,
    cpc: camp.cpc,
    roas: camp.roas_fb,
    frequency: camp.frequency,
    dailyBudget: camp.dailyBudget,
    revenueFb: camp.revenueFb,
    spend7d: camp.spend7d,
    conversions7d: camp.conversions7d,
    atc7d: camp.atc7d,
    ic7d: camp.ic7d,
    avgCPA7d: camp.avgCPA7d,
    avgCTR7d: camp.avgCTR7d,
    avgFrequency7d: camp.avgFrequency7d,
    avgAOV7d: camp.avgAOV7d,
    profitPerOrder7d: camp.profitPerOrder7d,
    ctrTrend: camp.ctrTrend,
    cpaTrend: camp.cpaTrend,
    cpmTrend: camp.cpmTrend,
    daysRunning: camp.daysRunning,
    daysWithPurchases: camp.daysWithPurchases,
    consecutiveProfitDays: camp.consecutiveProfitDays,
  };
}

// ─────────────────────────────────────────
// AI Analysis (V3 — enriched context)
// ─────────────────────────────────────────

interface AIActionItemV3 {
  campaignId: string;
  action: 'KILL' | 'SCALE' | 'WATCH' | 'KEEP' | 'REFRESH';
  reasoning: string;
  insight?: string;
  scalingRec?: string;
  confidence: number;
}

interface AIPlanResultV3 {
  accountHealth: string;
  actions: AIActionItemV3[];
  totalTokens: number;
  durationMs: number;
}

async function analyzeWithAI(
  campaigns: CampaignData[],
  evaluations: CampaignEvaluation[],
  config: PlannerConfig,
  margin: DailyMarginResult,
  aiClient: AIClient,
): Promise<AIPlanResultV3> {
  // Sort by spend descending, take top 40 for AI analysis
  const topCampaigns = [...campaigns]
    .sort((a, b) => b.spend7d - a.spend7d)
    .slice(0, 40);

  // Build enriched campaign data for LLM
  const campaignData = topCampaigns.map((c) => {
    const evalResult = evaluations.find(e => e.campaignId === c.campaignId);
    return {
      id: c.campaignId,
      name: c.campaignName,
      // Lifecycle & classification
      lifecycle: evalResult?.lifecycle || 'EVALUATING',
      campType: evalResult?.campType || 'MIXED',
      funnelHealth: evalResult?.funnelHealth || 0,
      evalAction: evalResult?.action || 'WATCH',
      diagnosis: evalResult?.diagnosis || '',
      // Key metrics (7-day primary)
      spend7d: `$${c.spend7d.toFixed(0)}`,
      spendToday: `$${c.spend.toFixed(0)}`,
      conversions7d: c.conversions7d,
      cpa7d: c.avgCPA7d ? `$${c.avgCPA7d.toFixed(0)}` : 'N/A',
      ctr7d: `${c.avgCTR7d.toFixed(2)}%`,
      profitPerOrder: c.profitPerOrder7d !== null ? `$${c.profitPerOrder7d.toFixed(0)}` : 'N/A',
      roas: c.roas_fb ? `${c.roas_fb.toFixed(2)}×` : 'N/A',
      // Funnel metrics
      atc7d: c.atc7d,
      ic7d: c.ic7d,
      freq7d: c.avgFrequency7d.toFixed(2),
      // Trends
      ctrTrend: `${c.ctrTrend >= 0 ? '+' : ''}${c.ctrTrend.toFixed(0)}%`,
      cpaTrend: c.avgCPA7d ? `${c.cpaTrend >= 0 ? '+' : ''}${c.cpaTrend.toFixed(0)}%` : 'N/A',
      // Stability
      budget: `$${c.dailyBudget}/day`,
      daysWithPurchases: `${c.daysWithPurchases}/7`,
      consecutiveProfitDays: c.consecutiveProfitDays,
    };
  });

  // Group by lifecycle for structured prompt
  const grouped: Record<string, typeof campaignData> = {};
  for (const c of campaignData) {
    const phase = c.lifecycle;
    if (!grouped[phase]) grouped[phase] = [];
    grouped[phase].push(c);
  }

  const breakevenCpa = config.aov * (1 - config.avgCogsRate);
  const accountROAS = margin.shopifyRevenue > 0 && margin.totalAdSpend > 0
    ? (margin.shopifyRevenue / margin.totalAdSpend).toFixed(2)
    : 'N/A';

  const prompt = `Analyze this Facebook ad portfolio (${topCampaigns.length} campaigns).

BUSINESS CONTEXT:
- Product: Print-on-Demand (POD)
- AOV: $${config.aov} | COGS: ${(config.avgCogsRate * 100).toFixed(0)}% | Breakeven CPA: $${breakevenCpa.toFixed(0)}
- Target CPA: $${config.targetCpa} | Profit/Order @target: $${(breakevenCpa - config.targetCpa).toFixed(0)}
- Current Margin: ${margin.marginPercent} (${margin.marginStatus})
- Account ROAS: ${accountROAS}×
- Total Spend (period): $${margin.totalAdSpend.toFixed(0)} | Revenue: $${margin.shopifyRevenue.toFixed(0)}

CAMPAIGNS BY LIFECYCLE PHASE:
${Object.entries(grouped).map(([phase, camps]) =>
  `\n--- ${phase} (${camps.length} campaigns) ---\n${JSON.stringify(camps, null, 1)}`
).join('\n')}

Focus on:
1. Which campaigns should SCALE and by how much?
2. Which should be KILLED (reference specific numbers)?
3. Any cross-campaign insights (audience overlap, funnel bottlenecks)?
4. Account-level opportunities the data reveals.
5. Any campaigns showing creative fatigue signals?`;

  const response = await aiClient.generateInsight(prompt, SYSTEM_PROMPT);
  const parsed = response.parsed as { accountHealth?: string; actions?: AIActionItemV3[] };

  return {
    accountHealth: parsed?.accountHealth || 'AI analysis completed.',
    actions: parsed?.actions || [],
    totalTokens: response.usage.totalTokens,
    durationMs: response.durationMs,
  };
}

// ─────────────────────────────────────────
// Main: Generate Plan V3
// ─────────────────────────────────────────

export async function generateActionPlanV2(
  campaigns: CampaignData[],
  config: PlannerConfig,
  margin: DailyMarginResult,
  days: number,
  aiConfig?: { provider: string; apiKey: string; model: string }
): Promise<GeneratedPlan> {
  const today = new Date().toISOString().split('T')[0];

  // ── Step 1: Build evaluation config ──
  const evalConfig: EvalConfig = {
    targetCpa: config.targetCpa,
    aov: config.aov,
    avgCogsRate: config.avgCogsRate,
    breakevenCpa: config.aov * (1 - config.avgCogsRate),
  };

  // ── Step 2: Evaluate every campaign ──
  const evalDataList: EvalCampaignData[] = campaigns
    .filter(c => c.fbStatus !== 'PAUSED')
    .map(buildEvalData);

  const evaluations: CampaignEvaluation[] = evalDataList.map(d =>
    evaluateCampaign(d, evalConfig)
  );

  // ── Step 3: Generate scale recommendations ──
  const scaleRecommendations: ScaleRecommendation[] = [];
  for (const evaluation of evaluations) {
    if (evaluation.action === 'SCALE') {
      const data = evalDataList.find(d => d.campaignId === evaluation.campaignId);
      if (data) {
        const rec = getScaleRecommendation(evaluation, data);
        if (rec) scaleRecommendations.push(rec);
      }
    }
  }

  // ── Step 4: Generate budget reallocation ──
  const budgetReallocations = generateBudgetReallocation(evaluations, evalDataList);

  // ── Step 5: AI analysis for non-trivial campaigns ──
  const needsAI = campaigns.filter(c => {
    const evaluation = evaluations.find(e => e.campaignId === c.campaignId);
    return evaluation && evaluation.action !== 'NO_ACTION';
  });

  let aiResult: AIPlanResultV3 | null = null;
  if (aiConfig?.apiKey && needsAI.length > 0) {
    try {
      const aiClient = createAIClient(aiConfig.provider, aiConfig.apiKey, aiConfig.model);
      aiResult = await analyzeWithAI(needsAI, evaluations, config, margin, aiClient);
    } catch (err) {
      console.error('AI analysis failed, using rule-based evaluation only:', err);
    }
  }

  // ── Step 6: Build ActionItems from evaluations + AI ──
  const actions: ActionItem[] = [];
  let actionId = 0;
  let budgetSaved = 0;

  // Map of AI actions for quick lookup
  const aiActionMap = new Map<string, AIActionItemV3>();
  if (aiResult) {
    for (const aiAction of aiResult.actions) {
      aiActionMap.set(aiAction.campaignId, aiAction);
    }
  }

  for (const evaluation of evaluations) {
    // Skip NO_ACTION (learning) and KEEP (performing normally, no card needed)
    if (evaluation.action === 'NO_ACTION' || evaluation.action === 'KEEP') {
      continue;
    }

    const camp = campaigns.find(c => c.campaignId === evaluation.campaignId);
    if (!camp) continue;

    const aiAction = aiActionMap.get(evaluation.campaignId);
    // If AI disagrees and has higher confidence, use AI's recommendation
    const finalAction = (aiAction && aiAction.confidence > evaluation.confidence)
      ? aiAction.action
      : evaluation.action;

    let type: ActionType;
    let description: string;
    let newBudget: number;

    switch (finalAction) {
      case 'KILL':
        type = 'KILL';
        description = `Kill campaign — stop $${camp.dailyBudget.toFixed(0)}/day spend`;
        newBudget = 0;
        budgetSaved += camp.dailyBudget;
        break;

      case 'SCALE': {
        type = 'SCALE';
        const scaleRec = scaleRecommendations.find(r => r.campaignId === camp.campaignId);
        if (scaleRec) {
          description = `Scale budget: $${scaleRec.currentBudget}/day → $${scaleRec.recommendedBudget}/day (+${scaleRec.changePercent}%)`;
          newBudget = scaleRec.recommendedBudget;
        } else {
          const scaledBudget = Math.round(camp.dailyBudget * 1.15 * 100) / 100;
          description = `Scale budget: $${camp.dailyBudget}/day → $${scaledBudget}/day (+15%)`;
          newBudget = scaledBudget;
        }
        break;
      }

      case 'REFRESH':
        type = 'WATCH';
        description = `⚠️ Creative fatigue — refresh hooks/visuals. Don't kill yet.`;
        newBudget = camp.dailyBudget;
        break;

      case 'WATCH':
      default:
        type = 'WATCH';
        description = `Monitor — ${evaluation.diagnosis}`;
        newBudget = camp.dailyBudget;
        break;
    }

    const reasoning = aiAction?.reasoning || evaluation.reasoning;
    const insight = aiAction?.insight || null;

    actions.push({
      id: `action-${++actionId}`,
      type,
      campaignId: camp.campaignId,
      campaignName: camp.campaignName,
      adAccountId: camp.adAccountId,
      description,
      reason: reasoning,
      oldBudget: camp.dailyBudget,
      newBudget,
      currentCpa: camp.avgCPA7d ?? camp.cpa,
      currentLtvCpa: null,
      isCompleted: false,
      completedAt: null,
      aiReasoning: reasoning,
      aiPrediction: insight,
      aiConfidence: aiAction?.confidence ?? evaluation.confidence,
      // V3 fields
      lifecycle: evaluation.lifecycle,
      campType: evaluation.campType,
      funnelHealth: evaluation.funnelHealth,
      profitPerOrder: evaluation.profitPerOrder,
      diagnosis: evaluation.diagnosis,
      // V3.1 — detailed metrics for UI
      spend7d: camp.spend7d,
      conversions7d: camp.conversions7d,
      spendToday: camp.spend,
      ctr7d: camp.avgCTR7d,
      atc7d: camp.atc7d,
      ic7d: camp.ic7d,
      roas7d: camp.roas_fb,
      daysRunning: camp.daysRunning,
      // V3.2 — Creative health
      frequency7d: camp.avgFrequency7d,
      cpm7d: camp.cpm,
      ctrTrend: camp.ctrTrend > 5 ? 'UP' : camp.ctrTrend < -5 ? 'DOWN' : 'STABLE',
    });
  }

  // Sort: KILL first, then SCALE, then WATCH
  const typePriority: Record<string, number> = { KILL: 0, REVERT: 1, SCALE: 2, LAUNCH: 3, WATCH: 4 };
  actions.sort((a, b) => (typePriority[a.type] ?? 9) - (typePriority[b.type] ?? 9));

  // Summary counts
  const scaleCount = actions.filter(a => a.type === 'SCALE').length;
  const killCount = actions.filter(a => a.type === 'KILL').length;
  const watchCount = actions.filter(a => a.type === 'WATCH').length;
  const refreshCount = actions.filter(a => a.description.includes('Creative fatigue')).length;
  const learningCount = evaluations.filter(e => e.lifecycle === 'LEARNING').length;

  const parts: string[] = [];
  if (killCount > 0) parts.push(`🔴 Kill ${killCount} → save $${budgetSaved.toFixed(0)}/day`);
  if (scaleCount > 0) parts.push(`🟢 Scale ${scaleCount}`);
  if (watchCount > 0) parts.push(`🟠 Watch ${watchCount}`);
  if (refreshCount > 0) parts.push(`🔄 Refresh ${refreshCount}`);
  if (learningCount > 0) parts.push(`⚫ ${learningCount} learning`);
  parts.push(`📊 Margin: ${margin.marginPercent}`);

  return {
    date: today,
    actions,
    aiSummary: aiResult?.accountHealth || null,
    scaleCount,
    killCount,
    watchCount,
    refreshCount,
    learningCount,
    projectedMargin: margin.dailyMargin,
    budgetSaved: Math.round(budgetSaved * 100) / 100,
    summary: parts.join(' • '),
    aiUsed: !!aiResult,
    aiTokens: aiResult?.totalTokens || 0,
    evaluations,
    scaleRecommendations,
    budgetReallocations,
    accountHealth: aiResult?.accountHealth || null,
  };
}
