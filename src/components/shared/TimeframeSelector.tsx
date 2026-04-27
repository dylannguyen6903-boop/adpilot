'use client';

interface TimeframeSelectorProps {
  value: string;
  onChange: (value: string) => void;
  options?: { label: string; value: string }[];
}

const DEFAULT_OPTIONS = [
  { label: 'Hôm nay', value: '1' },
  { label: 'Hôm qua', value: 'yesterday' },
  { label: '3N', value: '3' },
  { label: '7N', value: '7' },
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
          id={`timeframe-${opt.value}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
