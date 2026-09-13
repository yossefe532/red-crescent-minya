import { useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  UserCheck,
  Activity,
  Settings,
  LogOut,
  Menu,
  X,
  HeartPulse,
} from 'lucide-react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/admin', label: 'لوحة التحكم', icon: LayoutDashboard, end: true, hash: '' },
  { to: '/admin', label: 'المهام', icon: ClipboardList, end: false, hash: 'missions' },
  { to: '/admin', label: 'التسجيلات', icon: UserCheck, end: false, hash: 'registrations' },
  { to: '/admin', label: 'النشاط', icon: Activity, end: false, hash: 'activity' },
  { to: '/admin', label: 'الإعدادات', icon: Settings, end: false, hash: 'settings' },
];

/** Brand / Logo block for sidebar & header */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          'flex items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm shadow-brand-600/30',
          compact ? 'h-9 w-9' : 'h-10 w-10'
        )}
        aria-hidden="true"
      >
        <HeartPulse className={compact ? 'h-5 w-5' : 'h-6 w-6'} />
      </span>
      {!compact && (
        <div className="leading-tight">
          <p className="font-extrabold text-slate-900 text-sm">الهلال الأحمر المصري</p>
          <p className="text-[11px] font-medium text-slate-500">فرع المنيا — نظام التسجيل الذكي</p>
        </div>
      )}
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();

  // Scroll to section on the dashboard; dashboard link scrolls to top
  const goToSection = (hash: string) => {
    onNavigate?.();
    if (!hash) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const el = document.getElementById(hash);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5 flex items-center justify-between">
        <Brand />
        {onNavigate && (
          <button
            onClick={onNavigate}
            aria-label="إغلاق القائمة"
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 lg:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 px-3 space-y-1" aria-label="القائمة الرئيسية">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === '/admin' && !item.hash;
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              onClick={() => goToSection(item.hash)}
              aria-current={isActive && !item.hash ? 'page' : undefined}
              className={cn(
                'w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors duration-150 text-right',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              )}
            >
              <Icon className={cn('h-5 w-5 shrink-0', isActive ? 'text-brand-600' : 'text-slate-400')} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-100">
        <a
          href="#logout"
          onClick={(e) => e.preventDefault()}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500 hover:bg-danger-50 hover:text-danger-700 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <LogOut className="h-5 w-5" aria-hidden="true" />
          تسجيل الخروج
        </a>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden lg:flex w-64 shrink-0 border-e border-slate-200/70 bg-white">
      <div className="fixed inset-y-0 w-64 border-e border-slate-200/70 bg-white z-30">
        <SidebarContent />
      </div>
    </aside>
  );
}

export function MobileDrawer() {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Escape close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Focus first item on open
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => {
        (drawerRef.current?.querySelector('a, button') as HTMLElement)?.focus();
      }, 20);
      return () => clearTimeout(t);
    }
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="فتح القائمة"
        className="lg:hidden inline-flex items-center justify-center rounded-xl p-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <Menu className="h-6 w-6" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-slate-900/50 animate-fade-in"
            onClick={close}
            aria-hidden="true"
          />
          <div
            ref={drawerRef}
            className="absolute inset-y-0 right-0 w-72 max-w-[85vw] bg-white shadow-xl animate-slide-left"
          >
            <SidebarContent onNavigate={close} />
          </div>
        </div>
      )}
    </>
  );
}

export default Sidebar;