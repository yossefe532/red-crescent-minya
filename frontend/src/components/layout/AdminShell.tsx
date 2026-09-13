import { cn } from '@/lib/utils';
import Sidebar from './Sidebar';
import Header from './Header';

export interface AdminShellProps {
  title: string;
  subtitle?: string;
  adminName?: string;
  onLogout?: () => void;
  children: React.ReactNode;
}

/**
 * Admin layout: fixed sidebar on desktop, header + drawer on mobile.
 * Content constrained to max-w-7xl.
 */
export function AdminShell({ title, subtitle, adminName, onLogout, children }: AdminShellProps) {
  return (
    <div className="min-h-dvh bg-slate-50">
      <Sidebar />
      <div className="lg:ms-64">
        <Header title={title} subtitle={subtitle} adminName={adminName} onLogout={onLogout} />
        <main className="px-4 sm:px-6 py-6 sm:py-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

export default AdminShell;