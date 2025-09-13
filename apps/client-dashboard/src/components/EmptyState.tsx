import { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center p-8 rounded-lg border border-[#ececec] bg-white shadow-sm">
      {icon && <div className="mb-4 text-slate-500">{icon}</div>}
      <h2 className="text-lg font-semibold text-[#2e2e30] mb-2">{title}</h2>
      {description && <p className="text-sm text-[#6b6b70] mb-4 max-w-md">{description}</p>}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="rounded-md bg-[#2e2e30] px-5 py-2 text-white hover:opacity-90"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}