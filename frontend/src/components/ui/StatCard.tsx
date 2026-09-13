import { cn } from '@/lib/utils';

export interface StatCardProps {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  hint?: string;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'info';
}

const toneMap = {
  brand: 'bg-brand-50 text-brand-600',
  success: 'bg-success-50 text-success-600',
  warning: 'bg-warning-50 text-warning-600',
  danger: 'bg-danger-50 text-danger-600',
  info: 'bg-info-50 text-info-600',
};

export function StatCard({ icon, value, label, hint, tone = 'brand' }: StatCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 shadow-soft p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 leading-none">{value}</p>
          <p className="mt-2 text-xs sm:text-sm font-semibold text-slate-500 truncate">{label}</p>
          {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
        </div>
        <span
          className={cn(
            'flex items-center justify-center h-10 w-10 sm:h-11 sm:w-11 rounded-xl shrink-0',
            toneMap[tone]
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
      </div>
    </div>
  );
}

export default StatCard;