/* ============================================
   Campaign-related Type Definitions
   ============================================ */

/** Campaign classification status */
export type CampaignStatus = 'WINNER' | 'PROMISING' | 'WATCH' | 'KILL' | 'LEARNING';

/** Campaign data as returned from Facebook API + our computed fields */
export interface Campaign {
  id: string;
  campaignId: string;           // Facebook campaign ID
  campaignName: string;
  snapshotDate: string;         // ISO date
  snapshotHour: number;         // 0,4,8,12,16,20

  // Facebook raw metrics
  dailyBudget: number;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenueFb: number;
  cpa: number | null;
  ctr: number;
  cpm: number;
  cpc: number;
  roasFb: number | null;
  reach: number;
  frequency: number;

  // Computed fields
  status: CampaignStatus;
  performanceScore: number;       // 0-1
  ltvAdjustedCpa: number | null;  // CPA / LTV_Factor
  marginContribution: number | null;

  createdAt: string;
}

/** Compact campaign row for table display */
export interface CampaignRow {
  campaignId: string;
  campaignName: string;
  status: CampaignStatus;
  spend: number;
  conversions: number;
  cpa: number | null;
  ltvAdjustedCpa: number | null;
  ctr: number;
  roas: number | null;
  dailyBudget: number;
  performanceScore: number;
  marginContribution: number | null;
  daysRunning: number;
}

/** Campaign detail with daily history */
export interface CampaignDetail extends CampaignRow {
  dailyHistory: CampaignDailyData[];
  scalingHistory: ScalingEvent[];
}

/** Daily data point for charts */
export interface CampaignDailyData {
  date: string;
  spend: number;
  conversions: number;
  cpa: number | null;
  ctr: number;
  roas: number | null;
  impressions: number;
  clicks: number;
}

/** Scaling history event */
export interface ScalingEvent {
  id: string;
  campaignId: string;
  campaignName: string;
  action: 'SCALE_UP' | 'SCALE_DOWN' | 'KILL' | 'LAUNCH' | 'REVERT';
  oldBudget: number;
  newBudget: number;
  cpaBefore: number | null;
  cpaAfter: number | null;        // filled in 48h later
  marginBefore: number | null;
  marginAfter: number | null;
  success: boolean | null;
  notes: string;
  createdAt: string;
}

/** Status config for UI display */
export interface StatusConfig {
  label: string;
  emoji: string;
  cssClass: string;
  color: string;
  bgColor: string;
}

export const STATUS_CONFIG: Record<CampaignStatus, StatusConfig> = {
  WINNER: {
    label: 'Winner',
    emoji: '',
    cssClass: 'winner',
    color: 'var(--color-winner)',
    bgColor: 'var(--color-winner-bg)',
  },
  PROMISING: {
    label: 'Promising',
    emoji: '',
    cssClass: 'promising',
    color: 'var(--color-promising)',
    bgColor: 'var(--color-promising-bg)',
  },
  WATCH: {
    label: 'Watch',
    emoji: '',
    cssClass: 'watch',
    color: 'var(--color-watch)',
    bgColor: 'var(--color-watch-bg)',
  },
  KILL: {
    label: 'Kill',
    emoji: '',
    cssClass: 'kill',
    color: 'var(--color-kill)',
    bgColor: 'var(--color-kill-bg)',
  },
  LEARNING: {
    label: 'Learning',
    emoji: '',
    cssClass: 'learning',
    color: 'var(--color-learning)',
    bgColor: 'var(--color-learning-bg)',
  },
};
