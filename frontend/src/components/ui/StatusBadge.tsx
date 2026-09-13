import { CheckCircle2, Clock3, XCircle, Ban, Circle, Loader2, Activity } from 'lucide-react';
import Badge from './Badge';
import type { BadgeVariant } from './Badge';

/**
 * Unified status badge system.
 * Statuses used by the system:
 *  - registrations: CONFIRMED / WAITING / CANCELLED
 *  - missions:      OPEN / CLOSED / FULL (from API)
 *  - derived:       ACTIVE (missions with at least one registration, not closed)
 */
export interface StatusBadgeProps {
  status: string;
  className?: string;
}

const REGISTRATION_STATUS: Record<string, { label: string; variant: BadgeVariant; icon: React.ReactNode }> = {
  CONFIRMED: { label: 'مؤكد', variant: 'success', icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> },
  WAITING: { label: 'قيد الانتظار', variant: 'warning', icon: <Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> },
  CANCELLED: { label: 'ملغي', variant: 'danger', icon: <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> },
};

const MISSION_STATUS: Record<string, { label: string; variant: BadgeVariant; icon: React.ReactNode }> = {
  OPEN: { label: 'نشطة', variant: 'success', icon: <Activity className="h-3.5 w-3.5" aria-hidden="true" /> },
  CLOSED: { label: 'مغلقة', variant: 'neutral', icon: <Ban className="h-3.5 w-3.5" aria-hidden="true" /> },
  FULL: { label: 'اكتملت', variant: 'info', icon: <Circle className="h-3.5 w-3.5" aria-hidden="true" /> },
  ACTIVE: { label: 'نشطة', variant: 'success', icon: <Activity className="h-3.5 w-3.5" aria-hidden="true" /> },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const key = (status || '').toUpperCase();
  const def = REGISTRATION_STATUS[key] || MISSION_STATUS[key];
  if (!def) {
    return (
      <Badge variant="neutral" icon={<Loader2 className="h-3.5 w-3.5" aria-hidden="true" />} className={className}>
        {status || 'غير معروف'}
      </Badge>
    );
  }
  return (
    <Badge variant={def.variant} icon={def.icon} className={className}>
      {def.label}
    </Badge>
  );
}

export default StatusBadge;