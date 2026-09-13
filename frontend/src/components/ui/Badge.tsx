import { cn } from '@/lib/utils';

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  icon?: React.ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  success: 'bg-success-50 text-success-700 ring-success-500/30',
  warning: 'bg-warning-50 text-warning-700 ring-warning-500/30',
  danger: 'bg-danger-50 text-danger-700 ring-danger-500/30',
  info: 'bg-info-50 text-info-700 ring-info-500/30',
  brand: 'bg-brand-50 text-brand-700 ring-brand-500/30',
};

export function Badge({ children, variant = 'neutral', icon, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset',
        variantClasses[variant],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export default Badge;