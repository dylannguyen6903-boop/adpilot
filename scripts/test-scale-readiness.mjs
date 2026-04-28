import assert from 'node:assert/strict';
import {
  evaluateCampaign,
  evaluateScaleReadiness,
} from '../src/engine/evaluator.ts';

const config = {
  targetCpa: 42,
  aov: 90,
  avgCogsRate: 0.2,
  breakevenCpa: 72,
};

function campaign(overrides = {}) {
  return {
    campaignId: 'camp-1',
    campaignName: 'Test Campaign',
    fbStatus: 'ACTIVE',
    adAccountId: 'act_1',
    spend: 20,
    impressions: 1000,
    clicks: 25,
    conversions: 1,
    addToCart: 5,
    initiateCheckout: 3,
    cpa: 20,
    ctr: 2.5,
    cpm: 20,
    cpc: 0.8,
    roas: 3,
    frequency: 1.2,
    dailyBudget: 50,
    revenueFb: 90,
    spend7d: 80,
    conversions7d: 3,
    atc7d: 12,
    ic7d: 8,
    avgCPA7d: 26.67,
    avgCTR7d: 2.2,
    avgFrequency7d: 1.5,
    avgAOV7d: 90,
    profitPerOrder7d: 45.33,
    ctrTrend: 4,
    cpaTrend: 0,
    cpmTrend: 0,
    daysRunning: 5,
    daysWithPurchases: 2,
    consecutiveProfitDays: 2,
    ...overrides,
  };
}

function readinessFor(data) {
  const evaluation = evaluateCampaign(data, config);
  return {
    evaluation,
    readiness: evaluateScaleReadiness(data, evaluation, config),
  };
}

{
  const { evaluation, readiness } = readinessFor(campaign());
  assert.equal(evaluation.action, 'SCALE');
  assert.equal(readiness.label, 'SCALE_READY');
  assert.equal(readiness.changePercent, 20);
  assert.equal(readiness.recommendedBudget, 60);
}

{
  const { evaluation, readiness } = readinessFor(campaign({
    conversions7d: 1,
    daysWithPurchases: 1,
    consecutiveProfitDays: 1,
    spend7d: 28,
    avgCPA7d: 28,
    profitPerOrder7d: 44,
  }));
  assert.equal(evaluation.action, 'KEEP');
  assert.equal(readiness.label, 'OPPORTUNITY');
  assert.ok(readiness.missingSignals.some((signal) => signal.includes('conversion')));
}

{
  const { evaluation, readiness } = readinessFor(campaign({
    avgFrequency7d: 3.2,
    frequency: 3.4,
  }));
  assert.notEqual(evaluation.action, 'SCALE');
  assert.equal(readiness.label, 'SCALE_BLOCKED');
  assert.ok(readiness.blockers.some((blocker) => blocker.includes('Frequency')));
}

{
  const { evaluation, readiness } = readinessFor(campaign({
    cpaTrend: 31,
  }));
  assert.notEqual(evaluation.action, 'SCALE');
  assert.equal(readiness.label, 'SCALE_BLOCKED');
  assert.ok(readiness.blockers.some((blocker) => blocker.includes('CPA trend')));
}

{
  const { evaluation, readiness } = readinessFor(campaign({
    dailyBudget: 650,
    conversions7d: 6,
    daysWithPurchases: 4,
    consecutiveProfitDays: 3,
    avgCPA7d: 34,
    profitPerOrder7d: 38,
  }));
  assert.notEqual(evaluation.action, 'SCALE');
  assert.equal(readiness.label, 'OPPORTUNITY');
  assert.equal(readiness.changePercent, 5);
}

{
  const bad = campaign({
    spend7d: 160,
    conversions7d: 0,
    avgCPA7d: null,
    profitPerOrder7d: null,
    addToCart: 0,
    initiateCheckout: 0,
    atc7d: 0,
    ic7d: 0,
    ctr: 0.3,
    avgCTR7d: 0.3,
    consecutiveProfitDays: 0,
    daysWithPurchases: 0,
  });
  const evaluation = evaluateCampaign(bad, config);
  assert.equal(evaluation.action, 'KILL');
}

console.log('scale readiness scenarios passed');
