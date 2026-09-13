import { cn } from '@/lib/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  padding?: boolean;
}

/**
 * Base surface card. Used for KPI, mission cards, panels.
 * Not meant to be used for every box — prefer sections/lists where appropriate.
 */
export function Card({ children, className, padding = true, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'bg-white rounded-2xl border border-slate-200/70 shadow-soft',
        padding && 'p-5',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export default Card;