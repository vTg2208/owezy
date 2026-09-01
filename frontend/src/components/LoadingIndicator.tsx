interface LoadingProps {
  label: string;
  className?: string;
}

function LoadingMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`loading-mark${compact ? ' loading-mark-compact' : ''}`} aria-hidden="true">
      <span className="loading-mark-sun" />
    </span>
  );
}

export function LoadingLabel({ label }: Pick<LoadingProps, 'label'>) {
  return (
    <span className="loading-label">
      <LoadingMark compact />
      <span>{label}</span>
    </span>
  );
}

export default function LoadingIndicator({ label, className = '' }: LoadingProps) {
  return (
    <div role="status" aria-label={label} className={`loading-indicator ${className}`.trim()}>
      <LoadingMark />
      <span>{label}</span>
    </div>
  );
}
