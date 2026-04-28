# SRS: AdPilot Growth Scale Logic Upgrade

## Goal

AdPilot must become a daily capital allocation tool, not only a loser-kill tool. It should still protect budget with KILL recommendations, but it must also surface profitable campaigns that are ready to scale or close to scale readiness.

## Growth Mode Behavior

- `SCALE` means increase budget manually after user review. The app must never auto-apply budget changes.
- `OPPORTUNITY` means the campaign is profitable or promising enough to display, but one or more signals are still missing before a scale recommendation.
- `SCALE_BLOCKED` is represented as an opportunity/watch card with explicit blockers such as high frequency, CPA trend spike, thin margin, or insufficient conversion sample.
- Small budgets are allowed to scale earlier than mature budgets.

## Thresholds

- Budget `< $100/day`: scale when conversions 7d >= 2, days with purchases >= 2, and either consecutive profit days >= 2 or profit/order is clearly positive. CPA must be <= target CPA * 1.15, frequency < 2.8, and CPA trend <= +25%.
- Budget `$100-$500/day`: scale when conversions 7d >= 4, consecutive profit days >= 3, CPA <= target CPA * 1.10, and trend is not worsening.
- Budget `>= $500/day`: require 5+ consecutive profit days and use conservative scale.
- Recommended budget increase: +20% under $100/day, +15% from $100-$500/day, +5% at $500/day or above.

## UI Requirements

Action Plan must show four groups:

1. `Nên Tắt`
2. `Nên Tăng Budget`
3. `Camp Tốt Đang Chờ Scale`
4. `Theo Dõi`

Opportunity cards must show the readiness score, missing signals or blockers, and a clear next step. The morning brief must count opportunities so the user does not see an empty scale state when near-winners exist.

## Risk Cases

- Lucky conversion: do not scale one-conversion campaigns; show them as opportunities only.
- Delayed purchase cycle: use LTV/profit as a secondary signal, not as a full override for CPA/sample guardrails.
- High frequency fatigue: block scale when frequency is high even if CPA is currently good.
- CPA trend spike: block scale when recent CPA trend is worsening beyond Growth tolerance.
- Large budget campaigns: keep conservative thresholds because false positives cost more.

## Acceptance Criteria

- A small profitable campaign with 2-3 conversions, 2 purchase days, acceptable CPA, and healthy frequency returns `SCALE`.
- A profitable one-conversion campaign returns `OPPORTUNITY`, not `SCALE`.
- A profitable campaign with high frequency returns a blocked opportunity/watch with explicit blocker.
- A campaign with CPA trend spike does not return `SCALE`.
- Large-budget campaigns with only 3 profit days do not return `SCALE`.
- Existing KILL behavior remains intact.
