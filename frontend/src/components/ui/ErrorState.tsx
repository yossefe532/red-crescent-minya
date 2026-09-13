import { CircleAlert, RefreshCw } from 'lucide-react';
import Button from './Button';
import { cn } from '@/lib/utils';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'حدث خطأ',
  message = 'تعذر تحميل البيانات. حاول مرة أخرى.',
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center py-14 px-6',
        className
      )}
    >
      <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-danger-50 text-danger-600 mb-4">
        <CircleAlert className="h-7 w-7" aria-hidden="true" />
      </div>
      <h3 className="text-base font-bold text-slate-800">{title}</h3>
      <p className="mt-1.5 text-sm text-slate-500 max-w-sm">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-5">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          إعادة المحاولة
        </Button>
      )}
    </div>
  );
}

export default ErrorState;