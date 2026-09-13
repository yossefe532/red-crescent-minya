import { Bell, LogOut } from 'lucide-react';
import { Brand, MobileDrawer } from './Sidebar';
import { cn } from '@/lib/utils';

export interface HeaderProps {
  title: string;
  subtitle?: string;
  adminName?: string;
  onLogout?: () => void;
}

export function Header({ title, subtitle, adminName, onLogout }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200/70">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 h-16">
        <div className="flex items-center gap-2 min-w-0">
          <MobileDrawer />
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900 leading-tight truncate">{title}</h1>
            {subtitle && <p className="text-xs text-slate-500 leading-tight mt-0.5 truncate">{subtitle}</p>}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {adminName && (
            <span className="hidden sm:inline-flex text-sm font-semibold text-slate-600 px-2">
              {adminName}
            </span>
          )}
          <button
            aria-label="الإشعارات"
            className="relative inline-flex items-center justify-center h-11 w-11 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Bell className="h-5 w-5" />
            <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-brand-600 ring-2 ring-white" aria-hidden="true" />
          </button>
          {onLogout && (
            <button
              onClick={onLogout}
              aria-label="تسجيل الخروج"
              className={cn(
                'inline-flex items-center justify-center h-11 w-11 rounded-xl text-slate-500',
                'hover:bg-danger-50 hover:text-danger-700 transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
              )}
            >
              <LogOut className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

export default Header;