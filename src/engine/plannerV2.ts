/**
 * AI-Powered Action Plan Generator for AdPilot V2.0
 *
 * Hybrid approach:
 * 1. Rule-based pre-filter: Auto-KILL obvious losers, auto-LEARNING new campaigns.
 * 2. AI deep analysis: Top N campaigns get analyzed by LLM for nuanced decisions.
 * 3. Merge: Combine rule-based + AI results into final Action Plan.
 */

import type { ActionItem, ActionType } from '@/types/plan';
import type { DailyMarginResult } from './margin';
import { createAIClient, type AIClient } from '@/lib/ai';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export interface CampaignData {
  campaignId: string;
  campaignName: string;
  fbStatus: string;        // ACTIVE or PAUSED
  spend: number;
  conversions: number;
  cpa: number | null;
  ctr: number;
  cpm: number;
  roas_fb: number | null;
  dailyBudget: number;
  daysRunning: number;
  daysWithData: number;
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

export interface AIActionItem {
  campaignId: string;
  action: 'KILL' | 'SCALE' | 'WATCH' | 'KEEP';
  reasoning: string;
  prediction: string;
  confidence: number;   // 0-100
}

export interface AIPlanResult {
  summary: string;
  actions: AIActionItem[];
  totalTokens: number;
  durationMs: number;
}

export interface GeneratedPlan {
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
}

// ─────────────────────────────────────────
// Rule-Based Pre-Filter
// ─────────────────────────────────────────

interface RuleResult {
  campaignId: string;
  campaignName: string;
  action: ActionType | 'SKIP';
  reason: string;
  budget: number;
}

function applyRules(
  campaigns: CampaignData[],
  config: PlannerConfig
): { ruleActions: RuleResult[]; needsAI: CampaignData[] } {
  const ruleActions: RuleResult[] = [];
  const needsAI: CampaignData[] = [];

  const killThreshold = config.targetCpa * 2;

  for (const camp of campaigns) {
    // Skip PAUSED campaigns — they don't need actions
    if (camp.fbStatus === 'PAUSED') {
      continue;
    }

    // Rule 1: LEARNING — too new to judge
    if (camp.daysRunning < 3 || camp.daysWithData < 2) {
      ruleActions.push({
        campaignId: camp.campaignId,
        campaignName: camp.campaignName,
        action: 'SKIP',
        reason: `Campaign is ${camp.daysRunning} day(s) old with ${camp.daysWithData} day(s) of data — still in learning phase.`,
        budget: camp.dailyBudget,
      });
      continue;
    }

    // Rule 2: Auto-KILL — significant spend, zero conversions
    if (camp.conversions === 0 && camp.spend >= killThreshold) {
      ruleActions.push({
        campaignId: camp.campaignId,
        campaignName: camp.campaignName,
        action: 'KILL',
        reason: `$${camp.spend.toFixed(2)} spent with 0 conversions (> $${killThreshold} threshold). Auto-kill.`,
        budget: camp.dailyBudget,
      });
      continue;
    }

    // Rule 3: Auto-KILL — CPA too high (> 3× target) 
    if (camp.cpa !== null && camp.cpa > config.targetCpa * 3) {
      ruleActions.push({
        campaignId: camp.campaignId,
        campaignName: camp.campaignName,
        action: 'KILL',
        reason: `CPA $${camp.cpa.toFixed(2)} is ${(camp.cpa / config.targetCpa).toFixed(1)}× target ($${config.targetCpa}). Auto-kill.`,
        budget: camp.dailyBudget,
      });
      continue;
    }

    // Everything else → pass to AI for nuanced analysis
    needsAI.push(camp);
  }

  return { ruleActions, needsAI };
}

// ─────────────────────────────────────────
// AI Analysis
// ─────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior Media Buyer specializing in Print-on-Demand (POD) Facebook advertising. You analyze campaign performance data and provide actionable recommendations.

Your analysis style:
- Direct and concise. No fluff.
- Data-driven: reference specific numbers (CPA, CTR, ROAS, spend).
- Conservative with budgets: only recommend scaling campaigns with proven profitability.
- Aggressive with cuts: campaigns burning money without results should be killed fast.

Output MUST be valid JSON with this exact structure:
{
  "summary": "2-3 sentence overview of the ad account health and key action",
  "actions": [
    {
      "campaignId": "string",
      "action": "KILL" | "SCALE" | "WATCH" | "KEEP",
      "reasoning": "1-2 sentences explaining WHY this action",
      "prediction": "1 sentence predicting what happens next if current trajectory continues",
      "confidence": 0-100
    }
  ]
}

Action definitions:
- KILL: Turn off immediately. Losing money with low chance of recovery.
- SCALE: Increase budget 20%. Strong performer that can handle more spend.
- WATCH: Do not change anything. Needs more data or is borderline.
- KEEP: Performing adequately. No action needed.`;

async function analyzeWithAI(
  campaigns: CampaignData[],
  config: PlannerConfig,
  margin: DailyMarginResult,
  aiClient: AIClient,
  days: number
): Promise<AIPlanResult> {
  // Sort by spend descending, take top 50
  const topCampaigns = [...campaigns]
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 50);

  // Build data prompt
  const campaignTable = topCampaigns.map((c) => ({
    id: c.campaignId,
    name: c.campaignName,
    spend: `$${c.spend.toFixed(2)}`,
    conv: c.conversions,
    cpa: c.cpa ? `$${c.cpa.toFixed(2)}` : 'N/A',
    ctr: `${c.ctr.toFixed(2)}%`,
    roas: c.roas_fb ? `${c.roas_fb.toFixed(2)}x` : 'N/A',
    budget: `$${c.dailyBudget}/day`,
    days: c.daysRunning,
  }));

  const prompt = `Analyze these ${topCampaigns.length} Facebook ad campaigns from the last ${days} days.

BUSINESS CONTEXT:
- Product: Print-on-Demand (POD) items
- Target CPA: $${config.targetCpa}
- AOV: $${config.aov}
- COGS Rate: ${(config.avgCogsRate * 100).toFixed(0)}%
- Target Margin: ${(config.targetMarginMin * 100).toFixed(0)}-${(config.targetMarginMax * 100).toFixed(0)}%
- Current Margin: ${margin.marginPercent} (${margin.marginStatus})
- Returning Customer Rate: ${(config.returningRate * 100).toFixed(0)}%
- Total Ad Spend (${days}D): $${margin.totalAdSpend.toFixed(2)}
- Shopify Revenue (${days}D): $${margin.shopifyRevenue.toFixed(2)}
- Net Profit: $${margin.netProfit.toFixed(2)}

CAMPAIGN DATA:
${JSON.stringify(campaignTable, null, 2)}

Provide your analysis as JSON. Focus on the top opportunities to KILL (save money) and SCALE (grow revenue). Only include campaigns where you recommend a specific action (KILL, SCALE, or WATCH). Skip campaigns that are performing normally (KEEP) unless noteworthy.`;

  const response = await aiClient.generateInsight(prompt, SYSTEM_PROMPT);

  const parsed = response.parsed as { summary?: string; actions?: AIActionItem[] };

  return {
    summary: parsed?.summary || 'AI analysis completed.',
    actions: parsed?.actions || [],
    totalTokens: response.usage.totalTokens,
    durationMs: response.durationMs,
  };
}

// ─────────────────────────────────────────
// Main: Generate Plan (Hybrid)
// ─────────────────────────────────────────

export async function generateActionPlanV2(
  campaigns: CampaignData[],
  config: PlannerConfig,
  margin: DailyMarginResult,
  days: number,
  aiConfig?: { provider: string; apiKey: string; model: string }
): Promise<GeneratedPlan> {
  const today = new Date().toISOString().split('T')[0];

  // Step 1: Rule-based pre-filter
  const { ruleActions, needsAI } = applyRules(campaigns, config);

  // Step 2: AI analysis (if configured)
  let aiResult: AIPlanResult | null = null;
  if (aiConfig?.apiKey && needsAI.length > 0) {
    try {
      const aiClient = createAIClient(aiConfig.provider, aiConfig.apiKey, aiConfig.model);
      aiResult = await analyzeWithAI(needsAI, config, margin, aiClient, days);
    } catch (err) {
      console.error('AI analysis failed, falling back to rule-based:', err);
    }
  }

  // Step 3: Merge results into ActionItems
  const actions: ActionItem[] = [];
  let actionId = 0;
  let budgetSaved = 0;

  // Rule-based actions
  for (const rule of ruleActions) {
    if (rule.action === 'SKIP') continue; // Learning campaigns, no action
    if (rule.action === 'KILL') {
      budgetSaved += rule.budget;
      actions.push({
        id: `action-${++actionId}`,
        type: 'KILL' as ActionType,
        campaignId: rule.campaignId,
        campaignName: rule.campaignName,
        description: `Kill campaign — stop spending $${rule.budget.toFixed(0)}/day`,
        reason: rule.reason,
        oldBudget: rule.budget,
        newBudget: 0,
        currentCpa: null,
        currentLtvCpa: null,
        isCompleted: false,
        completedAt: null,
        aiReasoning: null,
        aiPrediction: null,
        aiConfidence: null,
      });
    }
  }

  // AI actions
  if (aiResult) {
    for (const aiAction of aiResult.actions) {
      const camp = needsAI.find(c => c.campaignId === aiAction.campaignId);
      if (!camp) continue;

      let type: ActionType;
      let description: string;
      let newBudget: number;

      switch (aiAction.action) {
        case 'KILL':
          type = 'KILL';
          description = `Kill campaign — AI recommends stopping $${camp.dailyBudget.toFixed(0)}/day`;
          newBudget = 0;
          budgetSaved += camp.dailyBudget;
          break;
        case 'SCALE':
          type = 'SCALE';
          const scaledBudget = Math.round(camp.dailyBudget * 1.2 * 100) / 100;
          description = `Scale budget: $${camp.dailyBudget}/day → $${scaledBudget}/day (+20%)`;
          newBudget = scaledBudget;
          break;
        case 'WATCH':
          type = 'WATCH';
          description = `Monitor closely — do NOT change budget ($${camp.dailyBudget.toFixed(0)}/day)`;
          newBudget = camp.dailyBudget;
          break;
        default:
          continue; // KEEP = no action card
      }

      actions.push({
        id: `action-${++actionId}`,
        type,
        campaignId: aiAction.campaignId,
        campaignName: camp.campaignName,
        description,
        reason: aiAction.reasoning,
        oldBudget: camp.dailyBudget,
        newBudget,
        currentCpa: camp.cpa,
        currentLtvCpa: null,
        isCompleted: false,
        completedAt: null,
        aiReasoning: aiAction.reasoning,
        aiPrediction: aiAction.prediction,
        aiConfidence: aiAction.confidence,
      });
    }
  }

  // Sort: KILL first, then SCALE, then WATCH
  const typePriority: Record<string, number> = { KILL: 0, REVERT: 1, SCALE: 2, LAUNCH: 3, WATCH: 4 };
  actions.sort((a, b) => (typePriority[a.type] ?? 9) - (typePriority[b.type] ?? 9));

  // Summary
  const scaleCount = actions.filter(a => a.type === 'SCALE' || a.type === 'LAUNCH').length;
  const killCount = actions.filter(a => a.type === 'KILL').length;
  const watchCount = actions.filter(a => a.type === 'WATCH').length;
  const learningCount = ruleActions.filter(r => r.action === 'SKIP').length;

  const parts: string[] = [];
  if (killCount > 0) parts.push(`🔴 Kill ${killCount} → save $${budgetSaved.toFixed(0)}/day`);
  if (scaleCount > 0) parts.push(`🟢 Scale ${scaleCount}`);
  if (watchCount > 0) parts.push(`🟠 Watch ${watchCount}`);
  if (learningCount > 0) parts.push(`⚫ ${learningCount} learning`);
  parts.push(`📊 Margin: ${margin.marginPercent}`);

  return {
    date: today,
    actions,
    aiSummary: aiResult?.summary || null,
    scaleCount,
    killCount,
    watchCount,
    projectedMargin: margin.dailyMargin,
    budgetSaved: Math.round(budgetSaved * 100) / 100,
    summary: parts.join(' • '),
    aiUsed: !!aiResult,
    aiTokens: aiResult?.totalTokens || 0,
  };
}
