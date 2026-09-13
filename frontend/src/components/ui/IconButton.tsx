import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string; // accessible name (aria-label)
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'danger' | 'ghost';
  loading?: boolean;
}

const sizeMap = {
  sm: 'h-9 w-9',
  md: 'h-11 w-11',
  lg: 'h-12 w-12',
};

const iconSizeMap = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
};

const variantMap = {
  default: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'text-danger-600 hover:bg-danger-50',
  ghost: 'text-slate-500 hover:bg-slate-100',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, label, size = 'md', variant = 'default', loading = false, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center rounded-xl transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-500',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          sizeMap[size],
          variantMap[variant],
          className
        )}
        {...props}
      >
        {loading ? <Loader2 className={cn(iconSizeMap[size], 'animate-spin')} aria-hidden="true" /> : children}
      </button>
    );
  }
);
IconButton.displayName = 'IconButton';

export default IconButton;