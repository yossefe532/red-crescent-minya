import { AlertTriangle } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Replaces window.confirm() for destructive/important actions.
 * Buttons deliberately not adjacent-side-by-side in a way that invites accidental clicks:
 * Cancel is always secondary/ghost; Confirm is clear danger/warning.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  variant = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} size="sm" closeOnBackdrop={!loading}>
      <div className="flex flex-col items-center text-center py-2">
        <div
          className={cn(
            'flex items-center justify-center h-12 w-12 rounded-full mb-4',
            variant === 'danger' && 'bg-danger-50 text-danger-600',
            variant === 'warning' && 'bg-warning-50 text-warning-600',
            variant === 'default' && 'bg-brand-50 text-brand-600'
          )}
        >
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </div>
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-500 max-w-sm">{message}</p>
        <div className="flex w-full gap-3 mt-6">
          <Button variant="secondary" fullWidth onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'default' ? 'primary' : 'danger'}
            fullWidth
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default ConfirmDialog;