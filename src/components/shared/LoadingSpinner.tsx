export default function LoadingSpinner({ size = 'md', text }: { size?: 'sm' | 'md' | 'lg'; text?: string }) {
  return (
    <div className="loading-page">
      <div className={`loading-spinner ${size}`} />
      {text && <span>{text}</span>}
    </div>
  );
}
