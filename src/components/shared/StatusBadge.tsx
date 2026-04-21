'use client';

import { STATUS_CONFIG } from '@/types/campaign';
import type { CampaignStatus } from '@/types/campaign';

export default function StatusBadge({ status }: { status: CampaignStatus }) {
  const config = STATUS_CONFIG[status];
  if (!config) return <span className="status-badge learning"><span className="status-dot" />Unknown</span>;

  return (
    <span className={`status-badge ${config.cssClass}`}>
      <span className="status-dot" />
      {config.label}
    </span>
  );
}
