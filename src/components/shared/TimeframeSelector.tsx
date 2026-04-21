'use client';

import { useState } from 'react';

interface TimeframeSelectorProps {
  value: number;
  onChange: (days: number) => void;
  options?: { label: string; value: number }[];
}

const DEFAULT_OPTIONS = [
  { label: 'Today', value: 1 },
  { label: '3D', value: 3 },
  { label: '7D', value: 7 },
];

export default function TimeframeSelector({
  value,
  onChange,
  options = DEFAULT_OPTIONS,
}: TimeframeSelectorProps) {
  return (
    <div className="timeframe-selector" role="group" aria-label="Timeframe selector">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`timeframe-btn ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
          id={`timeframe-${opt.value}d`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
