import React, { useState, useEffect } from 'react';
import {
  Plus,
  LayoutDashboard,
  MapPin,
  Settings,
  Link2,
  MessageCircle,
  Download,
  RefreshCw,
  Play,
  StopCircle,
  Copy,
  X,
  AlertTriangle,
  CheckCircle2,
  Users,
  BarChart3,
  CalendarDays,
  Clock3,
  Trash2,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import AdminShell from '@/components/layout/AdminShell';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import StatusBadge from '@/components/ui/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import StatCard from '@/components/ui/StatCard';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import Skeleton from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { formatEgyptTime } from '@/lib/timezone';
import MissionControlPanel from './MissionControlPanel';
import {
  checkSession,
  loginAdmin,
  logoutAdmin,
  listMissions,
  createMission,
  getMissionRegistrations,
  cancelRegistration,
  restoreRegistration,
  moveRegistrationStatus,
  fetchAudioPlaybackUrl,
  getExportCsvUrl,
  getRegistrationAnswers,
} from '@/api/admin';
import type { Mission, Registration, MissionCreateResponse, AdminUser, RegistrationAnswer } from '@/api/admin';

interface Props {}

export function AdminDashboard(_props: Props) {
  const { success: toastSuccess, error: toastError } = useToast();
  // === ALL ORIGINAL STATE — UNTOUCHED ===
  const [showControlPanel, setShowControlPanel] = useState(false);
  const [controlPanelMission, setControlPanelMission] = useState<Mission | null>(null);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [loginUsername, setLoginUsername] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [missions, setMissions] = useState<Mission[]>([]);
  const [loadingMissions, setLoadingMissions] = useState(false);
  const [selectedMission, setSelectedMission] = useState<Mission | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newLocation, setNewLocation] = useState('مقر الهلال الأحمر بالمنيا');
  const [newCapacity, setNewCapacity] = useState(10);
  const [newWaitingList, setNewWaitingList] = useState(0);
  const [newTelegramNotifications, setNewTelegramNotifications] = useState(true);
  const [newStartDate, setNewStartDate] = useState('');
  const [newEndDate, setNewEndDate] = useState('');
  const [creatingMission, setCreatingMission] = useState(false);
  const [createModalSuccess, setCreateModalSuccess] = useState<MissionCreateResponse | null>(null);

  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [regCounts, setRegCounts] = useState({ confirmed: 0, waitlist: 0, cancelled: 0, total: 0 });
  const [loadingRegistrations, setLoadingRegistrations] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [cancelFeedback, setCancelFeedback] = useState<string | null>(null);

  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // === NEW: Confirm dialog state ===
  const [confirmCancel, setConfirmCancel] = useState<Registration | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<Registration | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [movingStatus, setMovingStatus] = useState<string | null>(null); // registrationId being moved

  // ── Step 12: Registration answers display ──
  const [expandedRegId, setExpandedRegId] = useState<string | null>(null);
  const [regAnswers, setRegAnswers] = useState<RegistrationAnswer[]>([]);
  const [loadingAnswers, setLoadingAnswers] = useState(false);

  const handleToggleAnswers = async (regId: string) => {
    if (expandedRegId === regId) {
      setExpandedRegId(null);
      setRegAnswers([]);
      return;
    }
    setExpandedRegId(regId);
    setLoadingAnswers(true);
    try {
      const answers = await getRegistrationAnswers(regId);
      setRegAnswers(answers);
    } catch {
      setRegAnswers([]);
    } finally {
      setLoadingAnswers(false);
    }
  };

  // === ALL ORIGINAL HANDLERS — UNTOUCHED ===
  const handlePlayAudio = async (registrationId: string) => {
    try {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      setAudioError(null);
      const url = await fetchAudioPlaybackUrl(registrationId);
      setAudioUrl(url);
      setPlayingAudioId(registrationId);
    } catch (err: any) {
      setAudioError(err?.message || 'فشل تحميل التسجيل الصوتي');
      console.error('Audio fetch failed:', err);
      setTimeout(() => setAudioError(null), 5000);
    }
  };

  useEffect(() => {
    (async () => {
      setLoadingMissions(true);
      try {
        const user = await checkSession();
        if (user) {
          setAdminUser(user);
          const data = await listMissions();
          setMissions(data.missions);
        } else {
          setAdminUser(null);
        }
      } catch {
        setAdminUser(null);
      } finally {
        setLoadingMissions(false);
      }
    })();
  }, []);

  const loadMissionsList = async () => {
    setLoadingMissions(true);
    try {
      const data = await listMissions();
      setMissions(data.missions);
    } catch {
      setAdminUser(null);
    } finally {
      setLoadingMissions(false);
    }
  };

  const loadRegistrations = async (missionId: string) => {
    setLoadingRegistrations(true);
    try {
      const data = await getMissionRegistrations(missionId, {
        status: filterStatus || undefined,
        search: searchQuery.trim() || undefined,
      });
      setRegistrations(data.registrations);
      setRegCounts({
        confirmed: data.confirmed,
        waitlist: data.waitlist,
        cancelled: data.cancelled,
        total: data.total,
      });
    } catch (err: any) {
      console.error('Failed to load registrations:', err);
    } finally {
      setLoadingRegistrations(false);
    }
  };

  useEffect(() => {
    if (selectedMission) {
      loadRegistrations(selectedMission.id);
      const interval = setInterval(() => {
        loadRegistrations(selectedMission.id);
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [selectedMission, filterStatus, searchQuery]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const user = await loginAdmin(loginUsername, loginPassword);
      setAdminUser(user);
      const data = await listMissions();
      setMissions(data.missions);
    } catch (err: any) {
      setLoginError(err.message || 'بيانات تسجيل الدخول غير صحيحة');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logoutAdmin();
    setAdminUser(null);
    setMissions([]);
    setSelectedMission(null);
  };

  const handleCreateMission = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingMission(true);
    try {
      const startIso = newStartDate ? new Date(newStartDate).toISOString() : new Date(Date.now() + 86400000).toISOString();
      const endIso = newEndDate ? new Date(newEndDate).toISOString() : new Date(Date.now() + 2 * 86400000).toISOString();

      const created = await createMission({
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        location: newLocation.trim() || undefined,
        start_at: startIso,
        end_at: endIso,
        capacity: Number(newCapacity),
        waiting_list: Number(newWaitingList || 0),
        telegram_notifications: newTelegramNotifications,
      });

      setCreateModalSuccess(created);
      await loadMissionsList();
      toastSuccess('تم إنشاء المهمة بنجاح');
    } catch (err: any) {
      toastError(err.message || 'فشل إنشاء المهمة');
    } finally {
      setCreatingMission(false);
    }
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setCreateModalSuccess(null);
    setNewTitle('');
    setNewDescription('');
    setNewCapacity(10);
  };

  // ConfirmDialog replaces window.confirm()
  const confirmCancelRegistration = (reg: Registration) => {
    setConfirmCancel(reg);
  };

  const doCancelRegistration = async () => {
    if (!confirmCancel) return;
    setCancelling(true);
    try {
      const res = await cancelRegistration(confirmCancel.id);
      toastSuccess(res.message);
      setConfirmCancel(null);
      if (selectedMission) {
        await loadRegistrations(selectedMission.id);
        await loadMissionsList();
      }
    } catch (err: any) {
      toastError(err.message || 'فشل إلغاء التسجيل');
    } finally {
      setCancelling(false);
    }
  };

  // Restore cancelled registration
  const confirmRestoreRegistration = (reg: Registration) => {
    setConfirmRestore(reg);
  };

  const doRestoreRegistration = async () => {
    if (!confirmRestore) return;
    setRestoring(true);
    try {
      const res = await restoreRegistration(confirmRestore.id);
      toastSuccess(res.message);
      setConfirmRestore(null);
      if (selectedMission) {
        await loadRegistrations(selectedMission.id);
        await loadMissionsList();
      }
    } catch (err: any) {
      toastError(err.message || 'فشل استرجاع التسجيل');
    } finally {
      setRestoring(false);
    }
  };

  // Move registration between WAITLIST <-> CONFIRMED (mirrors Telegram bot)
  const handleMoveStatus = async (reg: Registration, targetStatus: 'CONFIRMED' | 'WAITLIST') => {
    setMovingStatus(reg.id);
    try {
      const res = await moveRegistrationStatus(reg.id, targetStatus);
      toastSuccess(res.message);
      if (selectedMission) {
        await loadRegistrations(selectedMission.id);
        await loadMissionsList();
      }
    } catch (err: any) {
      toastError(err.message || 'فشل تغيير حالة المتطوع');
    } finally {
      setMovingStatus(null);
    }
  };

  const openControlPanel = (mission: Mission) => {
    setControlPanelMission(mission);
    setShowControlPanel(true);
  };

  const closeControlPanel = () => {
    setShowControlPanel(false);
    setControlPanelMission(null);
  };

  const handleControlPanelUpdate = async () => {
    await loadMissionsList();
    if (selectedMission && controlPanelMission && selectedMission.id === controlPanelMission.id) {
      const updated = missions.find(m => m.id === selectedMission.id);
      if (updated) {
        setSelectedMission(updated);
        setControlPanelMission(updated);
      }
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    toastSuccess(`تم نسخ ${label} بنجاح`);
    setTimeout(() => setCopiedText(null), 3000);
  };

  // ========== LOGIN SCREEN ==========
  if (!adminUser) {
    return (
      <div className="min-h-dvh bg-slate-900 flex items-center justify-center p-4">
        {/* Thin brand accent line at top */}
        <div className="fixed top-0 inset-x-0 h-1 bg-brand-600 z-10" />
        <Card className="max-w-md w-full border-0 shadow-xl">
          <div className="text-center mb-6">
            <span className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-brand-600 text-white font-black text-xl shadow-lg shadow-brand-600/30 mx-auto mb-3" aria-hidden="true">
              RC
            </span>
            <h1 className="text-2xl font-extrabold text-slate-900">لوحة تحكم المشرفين</h1>
            <p className="text-xs text-slate-500 mt-1 font-medium">الهلال الأحمر المصري — فرع المنيا</p>
          </div>

          {loginError && (
            <div className="bg-danger-50 border border-danger-200 text-danger-700 text-xs font-bold p-3 rounded-xl mb-4 flex items-center gap-2" role="alert">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <Input
              label="اسم المستخدم"
              type="text"
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              required
            />
            <Input
              label="كلمة المرور"
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
            <Button
              type="submit"
              fullWidth
              loading={isLoggingIn}
              className="mt-2"
            >
              تسجيل الدخول
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  // ========== MAIN DASHBOARD ==========
  return (
    <>
      <AdminShell
        title="لوحة إدارة المهمات والتسجيل الذكي"
        subtitle="الهلال الأحمر المصري — المنيا"
        adminName={adminUser?.username}
        onLogout={handleLogout}
      >
        {/* Red Crescent accent line at top */}
        <div className="h-1 bg-brand-600 rounded-full mb-6" />

        {/* === PAGE HEADER with Quick Actions === */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6" id="dashboard">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 leading-tight">المهمات</h1>
            <p className="mt-1 text-sm text-slate-500">
              {missions.length} مهمة مسجلة
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={loadMissionsList}
              className="text-slate-500"
            >
              <RefreshCw className="h-4 w-4" />
              تحديث
            </Button>
            <Button
              size="sm"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus className="h-4 w-4" />
              مهمة جديدة
            </Button>
          </div>
        </div>

        {/* === KPI SECTION === */}
        <div id="stats" className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={<LayoutDashboard className="h-5 w-5" />}
            value={missions.length}
            label="إجمالي المهمات"
            tone="brand"
          />
          <StatCard
            icon={<CheckCircle2 className="h-5 w-5" />}
            value={missions.filter(m => m.status === 'OPEN').length}
            label="المهمات النشطة"
            tone="success"
          />
          <StatCard
            icon={<Users className="h-5 w-5" />}
            value={missions.reduce((acc, m) => acc + (m.capacity || 0), 0)}
            label="إجمالي السعة"
            tone="info"
          />
          <StatCard
            icon={<CalendarDays className="h-5 w-5" />}
            value={missions.filter(m => m.status === 'CLOSED').length}
            label="المهمات المغلقة"
            tone="warning"
          />
        </div>

        {/* === MISSIONS LIST === */}
        <section id="missions" className="mb-8">
          {loadingMissions ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="space-y-3">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </Card>
              ))}
            </div>
          ) : missions.length === 0 ? (
            <EmptyState
              icon={<LayoutDashboard className="h-7 w-7" />}
              title="لا توجد مهمات مسجلة بعد"
              description="ابدأ بإنشاء أول مهمة لجمع المتطوعين"
              action={
                <Button size="sm" onClick={() => setShowCreateModal(true)}>
                  <Plus className="h-4 w-4" />
                  إنشاء أول مهمة
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {missions.map((m) => {
                const isSelected = selectedMission?.id === m.id;
                const isOpen = m.status === 'OPEN';

                return (
                  <div
                    key={m.id}
                    onClick={() => setSelectedMission(m)}
                    className={cn(
                      'bg-white rounded-2xl border shadow-soft p-5 cursor-pointer transition-all duration-150',
                      isSelected
                        ? 'border-brand-600 ring-2 ring-brand-500/20 shadow-card'
                        : 'border-slate-200/70 hover:border-slate-300 hover:shadow-card'
                    )}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedMission(m); } }}
                  >
                    {/* Top row: code + status */}
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <Badge variant="brand" className="font-mono">
                        {m.public_code}
                      </Badge>
                      <StatusBadge status={isOpen ? 'OPEN' : 'CLOSED'} />
                    </div>

                    {/* Title */}
                    <h3 className="text-base font-bold text-slate-900 mb-2 line-clamp-1">{m.title}</h3>

                    {/* Location */}
                    {m.location && (
                      <p className="text-xs text-slate-500 mb-3 flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{m.location}</span>
                      </p>
                    )}

                    {/* Metadata */}
                    <div className="flex items-center gap-3 text-xs text-slate-500 mb-3">
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        {m.capacity}
                      </span>
                      {m.start_at && (
                        <span className="flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {new Date(m.start_at + (m.start_at.endsWith('Z') || m.start_at.includes('+') ? '' : 'Z')).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' })}
                        </span>
                      )}
                    </div>

                    {/* Action row */}
                    <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                      <span className="text-xs font-medium text-slate-500">
                        السعة: <b className="text-slate-700">{m.capacity}</b>
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openControlPanel(m);
                        }}
                        className="text-xs font-bold text-brand-600 hover:text-brand-700 flex items-center gap-1 transition-colors"
                      >
                        <Settings className="h-3.5 w-3.5" />
                        لوحة التحكم
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* === SELECTED MISSION: DETAIL + REGISTRATIONS === */}
        {selectedMission && (
          <section id="registrations">
            {/* Mission Detail Header */}
            <div className="bg-slate-900 rounded-2xl p-5 sm:p-6 text-white mb-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="brand" className="font-mono bg-brand-700 text-white ring-brand-600">
                      {selectedMission.public_code}
                    </Badge>
                    <span className="text-xs text-slate-300 font-medium">
                      السعة: {selectedMission.capacity} متطوع
                    </span>
                  </div>
                  <h2 className="text-xl font-extrabold">{selectedMission.title}</h2>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => openControlPanel(selectedMission)}
                    className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition flex items-center gap-1.5"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    لوحة التحكم
                  </button>
                  <button
                    onClick={() => copyToClipboard(`${window.location.origin}/m/${selectedMission.public_code}`, 'رابط التسجيل')}
                    className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition flex items-center gap-1.5"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    نسخ الرابط
                  </button>
                  <button
                    onClick={() => {
                      const msg = `صباح الخير متطوعينا الكرام\n\nعندنا ${selectedMission.title}\n\nالتسجيل يتم من خلال الرابط التالي:\n${window.location.origin}/m/${selectedMission.public_code}\n\nبرجاء التسجيل بنفسك وعدم التسجيل بالنيابة عن أي متطوع آخر.`;
                      copyToClipboard(msg, 'رسالة الواتساب');
                    }}
                    className="bg-success-600 hover:bg-success-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition flex items-center gap-1.5"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    رسالة الواتساب
                  </button>
                  <a
                    href={getExportCsvUrl(selectedMission.id)}
                    download
                    className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 border border-white/20"
                  >
                    <Download className="h-3.5 w-3.5" />
                    تحميل CSV
                  </a>
                </div>
              </div>
            </div>

            {/* Registrations Header + Filters */}
            <div className="bg-white border border-slate-200/70 border-t-0 rounded-b-2xl p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="success">
                    <CheckCircle2 className="h-3 w-3" />
                    المؤكدين: {regCounts.confirmed} / {selectedMission.capacity}
                  </Badge>
                  <Badge variant="warning">
                    <Clock3 className="h-3 w-3" />
                    قائمة الانتظار: {regCounts.waitlist}
                  </Badge>
                  <Badge variant="neutral">
                    الإجمالي: {regCounts.total}
                  </Badge>
                </div>

                <div className="flex items-center gap-2">
                  <Input
                    type="search"
                    placeholder="بحث بالاسم أو العضوية..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    icon={<Users className="h-4 w-4" />}
                    className="w-full sm:w-56"
                  />
                  <Select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full sm:w-36"
                  >
                    <option value="">كل الحالات</option>
                    <option value="CONFIRMED">المؤكدين فقط</option>
                    <option value="WAITLIST">الانتظار فقط</option>
                    <option value="CANCELLED">الملغيين</option>
                  </Select>
                </div>
              </div>

              {/* Table / Mobile Cards */}
              <div className="overflow-x-auto -mx-4 sm:-mx-5">
                {loadingRegistrations ? (
                  <LoadingState label="جاري جلب المسجلين..." className="py-10" />
                ) : registrations.length === 0 ? (
                  <EmptyState
                    title="لا توجد تسجيلات مطابقة"
                    description="جرّب تغيير البحث أو الفلتر"
                    className="py-10"
                  />
                ) : (
                  <>
                    {/* Desktop Table */}
                    <table className="hidden sm:table w-full text-right text-xs">
                      <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-bold border-b border-slate-100">
                        <tr>
                          <th className="py-3 px-4">#</th>
                          <th className="py-3 px-4">اسم المتطوع</th>
                          <th className="py-3 px-4">رقم العضوية</th>
                          <th className="py-3 px-4">الحالة والمقعد</th>
                          <th className="py-3 px-4">التسجيل الصوتي</th>
                          <th className="py-3 px-4">وقت التسجيل</th>
                          <th className="py-3 px-4 text-center">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {registrations.map((reg) => {
                          const isCancelled = reg.status === 'CANCELLED';
                          return (
                            <React.Fragment key={reg.id}>
                            <tr className="hover:bg-slate-50/80 transition">
                              <td className="py-3.5 px-4 font-mono font-bold text-slate-400">
                                {reg.registration_sequence}
                              </td>
                              <td className="py-3.5 px-4 font-bold text-slate-900">
                                {reg.volunteer_name}
                              </td>
                              <td className="py-3.5 px-4 font-mono font-bold text-slate-700">
                                {reg.member_id}
                              </td>
                              <td className="py-3.5 px-4">
                                {reg.status === 'CONFIRMED' && (
                                  <Badge variant="success" className="font-mono">
                                    مؤكد #{reg.seat_number}
                                  </Badge>
                                )}
                                {reg.status === 'WAITLIST' && (
                                  <Badge variant="warning" className="font-mono">
                                    انتظار #{reg.waitlist_position}
                                  </Badge>
                                )}
                                {isCancelled && (
                                  <Badge variant="neutral">ملغي</Badge>
                                )}
                              </td>
                              <td className="py-3.5 px-4">
                                {audioError && (
                                  <p className="text-danger-600 text-xs font-bold mb-1">{audioError}</p>
                                )}
                                {reg.has_audio_data === 1 || reg.has_audio_data === true ? (
                                  playingAudioId === reg.id && audioUrl ? (
                                    <div className="flex items-center gap-2">
                                      <audio
                                        autoPlay
                                        controls
                                        src={audioUrl}
                                        className="h-8 w-48"
                                        onEnded={() => setPlayingAudioId(null)}
                                      />
                                      <IconButton
                                        label="إيقاف"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setPlayingAudioId(null)}
                                      >
                                        <X className="h-4 w-4" />
                                      </IconButton>
                                    </div>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handlePlayAudio(reg.id)}
                                      className="text-xs"
                                    >
                                      <Play className="h-3.5 w-3.5" />
                                      {playingAudioId === reg.id ? 'جاري التحميل…' : 'استماع'}
                                    </Button>
                                  )
                                ) : (
                                  <span className="text-slate-300 text-xs">—</span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                                {formatEgyptTime(reg.created_at)}
                              </td>
                              <td className="py-3.5 px-4 text-center">
                                <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                  {!isCancelled && reg.status === 'WAITLIST' && (
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      onClick={() => handleMoveStatus(reg, 'CONFIRMED')}
                                      disabled={movingStatus === reg.id}
                                      className="text-[11px] px-2.5 py-1.5"
                                    >
                                      {movingStatus === reg.id ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                      )}
                                      تأكيد
                                    </Button>
                                  )}
                                  {!isCancelled && reg.status === 'CONFIRMED' && (
                                    <Button
                                      variant="warning"
                                      size="sm"
                                      onClick={() => handleMoveStatus(reg, 'WAITLIST')}
                                      disabled={movingStatus === reg.id}
                                      className="text-[11px] px-2.5 py-1.5"
                                    >
                                      {movingStatus === reg.id ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <Clock3 className="h-3.5 w-3.5" />
                                      )}
                                      تحويل للانتظار
                                    </Button>
                                  )}
                                  {!isCancelled && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => confirmCancelRegistration(reg)}
                                      className="text-danger-600 hover:text-danger-700 hover:bg-danger-50 text-[11px]"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                      إلغاء التسجيل
                                    </Button>
                                  )}
                                  {isCancelled && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => confirmRestoreRegistration(reg)}
                                      className="text-success-600 hover:text-success-700 hover:bg-success-50 text-[11px]"
                                    >
                                      <RotateCcw className="h-3 w-3" />
                                      استعادة
                                    </Button>
                                  )}
                                  {/* Step 12: View answers button */}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleToggleAnswers(reg.id)}
                                    className={cn(
                                      'text-[11px]',
                                      expandedRegId === reg.id ? 'text-brand-700 bg-brand-50' : 'text-slate-600 hover:text-brand-700 hover:bg-brand-50'
                                    )}
                                  >
                                    {expandedRegId === reg.id ? 'إخفاء' : '📋 إجابات'}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                            {/* Step 12: Expandable answers row */}
                            {expandedRegId === reg.id && (
                              <tr>
                                <td colSpan={7} className="bg-slate-50 px-4 py-3 border-t border-slate-100">
                                  {loadingAnswers ? (
                                    <p className="text-xs text-slate-400 animate-pulse">جاري تحميل الإجابات...</p>
                                  ) : regAnswers.length > 0 ? (
                                    <div className="space-y-1.5">
                                      <p className="text-[11px] font-bold text-slate-600 mb-2">📋 إجابات الأسئلة:</p>
                                      {regAnswers.map((ans) => (
                                        <div key={ans.id} className="flex items-start gap-2 text-xs">
                                          <span className="text-slate-400 font-mono shrink-0">{ans.question_id.slice(0, 8)}</span>
                                          <span className="text-slate-700">{ans.answer_text}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-[11px] text-slate-400">لا توجد إجابات مسجلة</p>
                                  )}
                                </td>
                              </tr>
                            )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>

                    {/* Mobile Card List */}
                    <div className="sm:hidden divide-y divide-slate-100">
                      {registrations.map((reg) => {
                        const isCancelled = reg.status === 'CANCELLED';
                        return (
                          <div key={reg.id} className="p-4 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-bold text-slate-900 truncate">{reg.volunteer_name}</p>
                              {reg.status === 'CONFIRMED' && (
                                <Badge variant="success" className="shrink-0 font-mono text-[10px]">
                                  مؤكد #{reg.seat_number}
                                </Badge>
                              )}
                              {reg.status === 'WAITLIST' && (
                                <Badge variant="warning" className="shrink-0 font-mono text-[10px]">
                                  انتظار #{reg.waitlist_position}
                                </Badge>
                              )}
                              {isCancelled && <Badge variant="neutral" className="shrink-0 text-[10px]">ملغي</Badge>}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-slate-500">
                              <span className="font-mono">{reg.member_id}</span>
                              <span>{formatEgyptTime(reg.created_at)}</span>
                            </div>
                            <div className="flex items-center gap-2 pt-1 flex-wrap">
                              {(reg.has_audio_data === 1 || reg.has_audio_data === true) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handlePlayAudio(reg.id)}
                                  className="text-xs"
                                >
                                  <Play className="h-3.5 w-3.5" />
                                  استماع
                                </Button>
                              )}
                              {!isCancelled && reg.status === 'WAITLIST' && (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => handleMoveStatus(reg, 'CONFIRMED')}
                                  disabled={movingStatus === reg.id}
                                  className="text-xs"
                                >
                                  {movingStatus === reg.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                  )}
                                  تأكيد
                                </Button>
                              )}
                              {!isCancelled && reg.status === 'CONFIRMED' && (
                                <Button
                                  variant="warning"
                                  size="sm"
                                  onClick={() => handleMoveStatus(reg, 'WAITLIST')}
                                  disabled={movingStatus === reg.id}
                                  className="text-xs"
                                >
                                  {movingStatus === reg.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Clock3 className="h-3.5 w-3.5" />
                                  )}
                                  تحويل للانتظار
                                </Button>
                              )}
                              {!isCancelled && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => confirmCancelRegistration(reg)}
                                  className="text-danger-600 hover:bg-danger-50 text-xs"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  إلغاء
                                </Button>
                              )}
                              {isCancelled && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => confirmRestoreRegistration(reg)}
                                  className="text-success-600 hover:bg-success-50 text-xs"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  استعادة
                                </Button>
                              )}
                              {/* Step 12: View answers button (mobile) */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggleAnswers(reg.id)}
                                className={cn(
                                  'text-xs',
                                  expandedRegId === reg.id ? 'text-brand-700 bg-brand-50' : 'text-slate-600 hover:text-brand-700 hover:bg-brand-50'
                                )}
                              >
                                {expandedRegId === reg.id ? 'إخفاء' : '📋 إجابات'}
                              </Button>
                            </div>
                            {/* Step 12: Expandable answers section (mobile) */}
                            {expandedRegId === reg.id && (
                              <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 mt-2">
                                {loadingAnswers ? (
                                  <p className="text-xs text-slate-400 animate-pulse">جاري تحميل الإجابات...</p>
                                ) : regAnswers.length > 0 ? (
                                  <div className="space-y-1.5">
                                    <p className="text-[11px] font-bold text-slate-600 mb-2">📋 إجابات الأسئلة:</p>
                                    {regAnswers.map((ans) => (
                                      <div key={ans.id} className="flex items-start gap-2 text-xs">
                                        <span className="text-slate-400 font-mono shrink-0">{ans.question_id.slice(0, 8)}</span>
                                        <span className="text-slate-700">{ans.answer_text}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-slate-400">لا توجد إجابات مسجلة</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>
        )}
      </AdminShell>

      {/* ========== CREATE MISSION MODAL ========== */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={closeCreateModal} aria-hidden="true" />
          <div className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[92dvh] overflow-y-auto animate-scale-in">
            {!createModalSuccess ? (
              <div className="p-6">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
                  <h3 className="text-base font-bold text-slate-900">إنشاء مهمة جديدة</h3>
                  <IconButton label="إغلاق" variant="ghost" size="sm" onClick={closeCreateModal}>
                    <X className="h-5 w-5" />
                  </IconButton>
                </div>

                <form onSubmit={handleCreateMission} className="space-y-4">
                  <Input
                    label="عنوان المهمة"
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="مثال: قافلة الأطراف الصناعية بالتعاون مع التضامن"
                    required
                  />

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">وصف المهمة (اختياري)</label>
                    <textarea
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      placeholder="تفاصيل إضافية للمتطوعين..."
                      rows={2}
                      className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                    />
                  </div>

                  <Input
                    label="المكان / نقطة التجمع"
                    type="text"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">تاريخ ووقت البداية</label>
                      <input
                        type="datetime-local"
                        value={newStartDate}
                        onChange={(e) => setNewStartDate(e.target.value)}
                        className="w-full h-11 px-4 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">تاريخ ووقت الانتهاء</label>
                      <input
                        type="datetime-local"
                        value={newEndDate}
                        onChange={(e) => setNewEndDate(e.target.value)}
                        className="w-full h-11 px-4 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="السعة المطلوبة"
                      type="number"
                      min="1"
                      max="1000"
                      value={newCapacity}
                      onChange={(e) => setNewCapacity(parseInt(e.target.value, 10))}
                      required
                    />
                    <Input
                      label="قائمة الانتظار"
                      type="number"
                      min="0"
                      max="1000"
                      value={newWaitingList}
                      onChange={(e) => setNewWaitingList(parseInt(e.target.value, 10) || 0)}
                      hint="0 = لا يوجد قائمة انتظار"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="telegramNotifications"
                      checked={newTelegramNotifications}
                      onChange={(e) => setNewTelegramNotifications(e.target.checked)}
                      className="w-4 h-4 text-brand-600 border-slate-300 rounded focus:ring-brand-500"
                    />
                    <label htmlFor="telegramNotifications" className="text-sm font-semibold text-slate-700 cursor-pointer">
                      تفعيل إشعارات تيليجرام عند التسجيل
                    </label>
                  </div>

                  <div className="pt-2 flex gap-3">
                    <Button type="submit" fullWidth loading={creatingMission}>
                      حفظ ونشر المهمة
                    </Button>
                    <Button type="button" variant="secondary" fullWidth onClick={closeCreateModal}>
                      إلغاء
                    </Button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="p-6 text-center space-y-4">
                <div className="w-14 h-14 bg-success-50 text-success-600 rounded-2xl flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-7 w-7" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">تم إنشاء المهمة بنجاح!</h3>
                <p className="text-sm text-slate-600">كود المهمة: <b className="text-brand-600 font-mono">{createModalSuccess.public_code}</b></p>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-sm text-right space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-700">رابط التسجيل:</span>
                    <button
                      onClick={() => copyToClipboard(createModalSuccess.public_url, 'رابط المهمة')}
                      className="text-brand-600 hover:underline font-bold text-xs flex items-center gap-1"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      نسخ الرابط
                    </button>
                  </div>
                  <input
                    type="text"
                    readOnly
                    value={createModalSuccess.public_url}
                    className="w-full bg-white p-2.5 rounded-lg border border-slate-200 font-mono text-[11px]"
                  />
                </div>

                <div className="bg-success-50 p-4 rounded-xl border border-success-500/30 text-sm text-right space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-success-800">رسالة الواتساب الجاهزة:</span>
                    <button
                      onClick={() => copyToClipboard(createModalSuccess.whatsapp_message, 'رسالة الواتساب')}
                      className="text-success-700 hover:underline font-bold text-xs flex items-center gap-1"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      نسخ الرسالة
                    </button>
                  </div>
                  <textarea
                    readOnly
                    rows={4}
                    value={createModalSuccess.whatsapp_message}
                    className="w-full bg-white p-2.5 rounded-lg border border-success-500/30 text-[11px] leading-relaxed"
                  />
                </div>

                <Button fullWidth variant="secondary" onClick={closeCreateModal}>
                  إغلاق
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========== CANCEL CONFIRM DIALOG ========== */}
      <ConfirmDialog
        open={!!confirmCancel}
        title="إلغاء التسجيل"
        message={`هل أنت متأكد من إلغاء تسجيل المتطوع "${confirmCancel?.volunteer_name}"؟ لا يمكن التراجع عن هذا الإجراء.`}
        confirmLabel="نعم، إلغاء التسجيل"
        cancelLabel="الاحتفاظ بالتسجيل"
        variant="danger"
        loading={cancelling}
        onConfirm={doCancelRegistration}
        onCancel={() => setConfirmCancel(null)}
      />

      {/* ========== RESTORE CONFIRM DIALOG ========== */}
      <ConfirmDialog
        open={!!confirmRestore}
        title="استرجاع التسجيل"
        message={`هل أنت متأكد من استرجاع تسجيل المتطوع "${confirmRestore?.volunteer_name}"؟ سيتم إعادته إلى${confirmRestore?.original_status === 'CONFIRMED' ? ' المقاعد المؤكدة' : ' قائمة الانتظار'} حسب التوفر.`}
        confirmLabel="نعم، استرجاع التسجيل"
        cancelLabel="إلغاء"
        variant="default"
        loading={restoring}
        onConfirm={doRestoreRegistration}
        onCancel={() => setConfirmRestore(null)}
      />

      {/* ========== MISSION CONTROL PANEL ========== */}
      {showControlPanel && controlPanelMission && (
        <MissionControlPanel
          mission={controlPanelMission}
          onClose={closeControlPanel}
          onUpdate={handleControlPanelUpdate}
        />
      )}
    </>
  );
}