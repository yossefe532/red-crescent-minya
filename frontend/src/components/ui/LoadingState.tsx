import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LoadingStateProps {
  label?: string;
  className?: string;
}

export function LoadingState({ label = 'جارٍ التحميل...', className }: LoadingStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center py-14 px-6 text-center', className)}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-8 w-8 animate-spin text-brand-600" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-slate-500">{label}</p>
    </div>
  );
}

export default LoadingState;