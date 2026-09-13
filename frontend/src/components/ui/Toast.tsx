import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toastStyles: Record<ToastType, { icon: React.ReactNode; ring: string }> = {
  success: {
    icon: <CheckCircle2 className="h-5 w-5 text-success-600" aria-hidden="true" />,
    ring: 'ring-success-500/30',
  },
  error: {
    icon: <CircleAlert className="h-5 w-5 text-danger-600" aria-hidden="true" />,
    ring: 'ring-danger-500/30',
  },
  warning: {
    icon: <TriangleAlert className="h-5 w-5 text-warning-600" aria-hidden="true" />,
    ring: 'ring-warning-500/30',
  },
  info: {
    icon: <Info className="h-5 w-5 text-info-600" aria-hidden="true" />,
    ring: 'ring-info-500/30',
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (type: ToastType, message: string) => {
      const id = ++counter.current;
      setToasts((prev) => [...prev.slice(-4), { id, type, message }]);
      // auto-dismiss after 4s
      window.setTimeout(() => dismiss(id), 4000);
    },
    [dismiss]
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast: push,
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      warning: (m) => push('warning', m),
      info: (m) => push('info', m),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col items-start gap-2 pointer-events-none"
          role="region"
          aria-label="الإشعارات"
          aria-live="polite"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                'pointer-events-auto flex items-center gap-3 rounded-xl bg-white shadow-lg ring-1 px-4 py-3 min-w-0 w-full sm:w-auto sm:max-w-sm',
                'animate-slide-up',
                toastStyles[t.type].ring
              )}
              role={t.type === 'error' ? 'alert' : 'status'}
            >
              {toastStyles[t.type].icon}
              <p className="flex-1 text-sm font-medium text-slate-800 leading-snug">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 rounded-lg p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                aria-label="إغلاق الإشعار"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
}

export default ToastProvider;