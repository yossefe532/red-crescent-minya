import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  Pencil,
  Settings,
  MapPin,
  CalendarDays,
  Clock3,
  Lock,
  LockOpen,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Mic,
  X,
} from 'lucide-react';
import { Mission, updateMission, toggleMissionRegistration, updateMissionDetails, authHeaders } from '../api/admin';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import StatusBadge from '@/components/ui/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

interface Props {
  mission: Mission;
  onClose: () => void;
  onUpdate: () => void;
}

const TABS = [
  { id: 'overview' as const, label: 'نظرة عامة', icon: BarChart3 },
  { id: 'edit' as const, label: 'تعديل التفاصيل', icon: Pencil },
  { id: 'settings' as const, label: 'إعدادات', icon: Settings },
];

export function MissionControlPanel({ mission, onClose, onUpdate }: Props) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [activeTab, setActiveTab] = useState<'overview' | 'edit' | 'settings'>('overview');

  // === ALL ORIGINAL STATE — UNTOUCHED ===
  const [localMission, setLocalMission] = useState<Mission>(mission);

  useEffect(() => {
    setLocalMission(mission);
  }, [mission]);

  const [editTitle, setEditTitle] = useState(localMission.title);
  const [editDescription, setEditDescription] = useState(localMission.description || '');
  const [editLocation, setEditLocation] = useState(localMission.location || '');
  const [editCapacity, setEditCapacity] = useState(localMission.capacity);
  const [editStartDate, setEditStartDate] = useState(localMission.start_at.slice(0, 16));
  const [editEndDate, setEditEndDate] = useState(localMission.end_at.slice(0, 16));

  const [isSaving, setIsSaving] = useState(false);

  // === NEW: Confirm dialogs ===
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Calculate registration status
  const now = new Date();
  const regOpenAt = localMission.registration_open_at ? new Date(localMission.registration_open_at) : null;
  const regCloseAt = localMission.registration_close_at ? new Date(localMission.registration_close_at) : null;
  const isRegOpen = localMission.status === 'OPEN' &&
                    regOpenAt && regOpenAt <= now &&
                    (!regCloseAt || regCloseAt > now);

  // Optimistic update helper
  const optimisticUpdate = (updates: Partial<Mission>) => {
    setLocalMission(prev => ({ ...prev, ...updates }));
  };

  // Handle toggle registration - OPTIMISTIC
  const handleToggleRegistration = async () => {
    const newRegOpen = !isRegOpen;
    optimisticUpdate({
      registration_close_at: newRegOpen ? null : new Date().toISOString(),
      registration_open_at: newRegOpen ? new Date().toISOString() : localMission.registration_open_at,
      status: newRegOpen ? 'OPEN' : 'CLOSED'
    });

    toastSuccess(newRegOpen ? 'تم فتح التسجيل' : 'تم إغلاق التسجيل مؤقتاً');
    onUpdate();

    try {
      await toggleMissionRegistration(localMission.id, newRegOpen);
    } catch (err: any) {
      optimisticUpdate({
        registration_close_at: isRegOpen ? null : new Date().toISOString(),
        registration_open_at: isRegOpen ? new Date().toISOString() : localMission.registration_open_at,
        status: isRegOpen ? 'OPEN' : 'CLOSED'
      });
      toastError(err.message || 'فشل تغيير حالة التسجيل');
    }
  };

  // Handle save mission details - OPTIMISTIC
  const handleSaveDetails = async () => {
    if (!editTitle.trim()) {
      toastError('عنوان المهمة مطلوب');
      return;
    }
    if (editCapacity < 1 || editCapacity > 1000) {
      toastError('السعة يجب أن تكون بين 1 و 1000');
      return;
    }

    const updates = {
      title: editTitle.trim(),
      description: editDescription.trim() || null,
      location: editLocation.trim() || null,
      capacity: editCapacity,
      start_at: new Date(editStartDate).toISOString(),
      end_at: new Date(editEndDate).toISOString(),
    };
    optimisticUpdate(updates);
    toastSuccess('تم حفظ التعديلات');
    onUpdate();

    try {
      await updateMissionDetails(localMission.id, updates);
    } catch (err: any) {
      optimisticUpdate({
        title: localMission.title,
        description: localMission.description,
        location: localMission.location,
        capacity: localMission.capacity,
        start_at: localMission.start_at,
        end_at: localMission.end_at,
      });
      setEditTitle(localMission.title);
      setEditDescription(localMission.description || '');
      setEditLocation(localMission.location || '');
      setEditCapacity(localMission.capacity);
      setEditStartDate(localMission.start_at.slice(0, 16));
      setEditEndDate(localMission.end_at.slice(0, 16));
      toastError(err.message || 'فشل حفظ التعديلات');
    }
  };

  // Handle close mission permanently
  const handleCloseMission = async () => {
    setShowCloseConfirm(false);
    optimisticUpdate({
      status: 'CLOSED',
      registration_close_at: new Date().toISOString()
    });
    toastSuccess('تم إغلاق المهمة');
    onUpdate();

    try {
      await fetch(`/api/admin/missions/${localMission.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
    } catch (err: any) {
      optimisticUpdate({
        status: 'OPEN',
        registration_close_at: null
      });
      toastError(err.message || 'فشل إغلاق المهمة');
    }
  };

  // Handle delete mission permanently
  const handleDeleteMission = async () => {
    setShowDeleteConfirm(false);
    try {
      setIsSaving(true);
      const res = await fetch(`/api/admin/missions/${localMission.id}`, {
        method: 'DELETE',
        headers: { ...authHeaders() },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || 'فشل حذف المهمة');
      }
      toastSuccess('تم حذف المهمة');
      onClose();
      onUpdate();
    } catch (err: any) {
      toastError(err.message || 'فشل حذف المهمة');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Modal open={true} onClose={onClose} size="lg">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-100 -mx-5 px-5 -mt-5 pt-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="brand" className="font-mono">{mission.public_code}</Badge>
              <StatusBadge status={mission.status} />
            </div>
            <h2 className="text-lg font-bold text-slate-900">{mission.title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">لوحة التحكم الكاملة في المهمة</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 -mx-5 px-5 mt-3">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 py-2.5 px-4 text-sm font-semibold transition-colors border-b-2 -mb-[1px]',
                  active
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="py-4 max-h-[55vh] overflow-y-auto">

          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/70">
                  <p className="text-xs text-slate-500 font-semibold mb-1">السعة المطلوبة</p>
                  <p className="text-3xl font-extrabold text-slate-900">{localMission.capacity}</p>
                  <p className="text-xs text-slate-500 mt-1">متطوع</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/70">
                  <p className="text-xs text-slate-500 font-semibold mb-1">حالة التسجيل</p>
                  <p className={cn('text-lg font-extrabold', isRegOpen ? 'text-success-600' : 'text-danger-600')}>
                    {isRegOpen ? (
                      <span className="flex items-center gap-1.5"><LockOpen className="h-5 w-5" /> مفتوح</span>
                    ) : (
                      <span className="flex items-center gap-1.5"><Lock className="h-5 w-5" /> مغلق</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {isRegOpen ? 'يمكن التسجيل الآن' : 'التسجيل متوقف'}
                  </p>
                </div>
              </div>

              <div className="bg-info-50 border border-info-500/30 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1.5 text-info-700">
                  <MapPin className="h-4 w-4" />
                  <span className="text-xs font-bold">المكان</span>
                </div>
                <p className="text-sm text-info-900 font-semibold">{localMission.location || 'غير محدد'}</p>
              </div>

              {localMission.description && (
                <div className="bg-warning-50 border border-warning-500/30 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1.5 text-warning-700">
                    <Pencil className="h-4 w-4" />
                    <span className="text-xs font-bold">الوصف</span>
                  </div>
                  <p className="text-sm text-warning-900 leading-relaxed">{localMission.description}</p>
                </div>
              )}

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2 text-slate-700">
                  <CalendarDays className="h-4 w-4" />
                  <span className="text-xs font-bold">التوقيت</span>
                </div>
                <div className="space-y-1.5 text-xs text-slate-700">
                  <div className="flex justify-between">
                    <span className="font-medium">بداية المهمة:</span>
                    <span className="font-bold">{new Date(localMission.start_at).toLocaleString('ar-EG')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">نهاية المهمة:</span>
                    <span className="font-bold">{new Date(localMission.end_at).toLocaleString('ar-EG')}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2 text-slate-700">
                  <Mic className="h-4 w-4" />
                  <span className="text-xs font-bold">عبارة التأكيد الصوتي</span>
                </div>
                <p className="text-sm text-slate-900 font-semibold bg-white px-3 py-2 rounded-lg border border-slate-200">
                  "{localMission.confirmation_phrase}"
                </p>
              </div>
            </div>
          )}

          {/* EDIT TAB */}
          {activeTab === 'edit' && (
            <div className="space-y-4">
              <Input
                label="عنوان المهمة"
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="مثال: قافلة طبية - قرية النور"
                required
              />

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">الوصف</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm leading-relaxed focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  placeholder="وصف مختصر للمهمة..."
                />
              </div>

              <Input
                label="المكان"
                type="text"
                value={editLocation}
                onChange={(e) => setEditLocation(e.target.value)}
                placeholder="مثال: مقر الهلال الأحمر بالمنيا"
                icon={<MapPin className="h-4 w-4" />}
              />

              <Input
                label="عدد المتطوعين المطلوب"
                type="number"
                min="1"
                max="1000"
                value={editCapacity}
                onChange={(e) => setEditCapacity(parseInt(e.target.value) || 1)}
                required
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">بداية المهمة</label>
                  <input
                    type="datetime-local"
                    value={editStartDate}
                    onChange={(e) => setEditStartDate(e.target.value)}
                    className="w-full h-11 px-4 rounded-xl border border-slate-300 text-sm font-semibold focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">نهاية المهمة</label>
                  <input
                    type="datetime-local"
                    value={editEndDate}
                    onChange={(e) => setEditEndDate(e.target.value)}
                    className="w-full h-11 px-4 rounded-xl border border-slate-300 text-sm font-semibold focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  />
                </div>
              </div>

              <Button fullWidth onClick={handleSaveDetails}>
                <CheckCircle2 className="h-4 w-4" />
                حفظ التعديلات
              </Button>
            </div>
          )}

          {/* SETTINGS TAB */}
          {activeTab === 'settings' && (
            <div className="space-y-4">
              {/* Toggle Registration */}
              <Card>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 mb-1">التحكم في التسجيل</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      {isRegOpen
                        ? 'التسجيل مفتوح حالياً. يمكنك إغلاقه مؤقتاً لإيقاف استقبال تسجيلات جديدة.'
                        : 'التسجيل مغلق حالياً. يمكنك فتحه للسماح باستقبال تسجيلات جديدة.'}
                    </p>
                  </div>
                  <span className={cn(
                    'flex items-center justify-center h-11 w-11 rounded-xl shrink-0',
                    isRegOpen ? 'bg-success-50 text-success-600' : 'bg-danger-50 text-danger-600'
                  )}>
                    {isRegOpen ? <LockOpen className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                  </span>
                </div>
                <Button
                  fullWidth
                  variant={isRegOpen ? 'danger' : 'primary'}
                  onClick={handleToggleRegistration}
                >
                  {isRegOpen ? (
                    <><Lock className="h-4 w-4" /> إغلاق التسجيل مؤقتاً</>
                  ) : (
                    <><LockOpen className="h-4 w-4" /> فتح التسجيل</>
                  )}
                </Button>
              </Card>

              {/* Close Mission Permanently */}
              <Card className="border-warning-500/30">
                <div className="flex items-start gap-3 mb-3">
                  <span className="flex items-center justify-center h-10 w-10 rounded-lg bg-warning-50 text-warning-600 shrink-0">
                    <AlertTriangle className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 mb-1">إغلاق المهمة نهائياً</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      إغلاق المهمة بشكل نهائي سيمنع أي تسجيلات جديدة ويحول حالتها إلى CLOSED.
                      هذا الإجراء لا يمكن التراجع عنه بسهولة.
                    </p>
                  </div>
                </div>
                <Button
                  fullWidth
                  variant="danger"
                  onClick={() => setShowCloseConfirm(true)}
                  disabled={localMission.status === 'CLOSED'}
                >
                  {localMission.status === 'CLOSED' ? (
                    <><CheckCircle2 className="h-4 w-4" /> المهمة مغلقة بالفعل</>
                  ) : (
                    <><Lock className="h-4 w-4" /> إغلاق المهمة نهائياً</>
                  )}
                </Button>
              </Card>

              {/* Delete Mission */}
              <Card className="border-danger-500/30">
                <div className="flex items-start gap-3 mb-3">
                  <span className="flex items-center justify-center h-10 w-10 rounded-lg bg-danger-50 text-danger-600 shrink-0">
                    <Trash2 className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 mb-1">حذف المهمة نهائياً</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      حذف المهمة بشكل كامل مع جميع التسجيلات والبيانات المرتبطة بها.
                      هذا الإجراء لا يمكن التراجع عنه.
                    </p>
                  </div>
                </div>
                <Button
                  fullWidth
                  variant="danger"
                  onClick={() => setShowDeleteConfirm(true)}
                  loading={isSaving}
                >
                  <Trash2 className="h-4 w-4" />
                  حذف المهمة نهائياً
                </Button>
              </Card>

              {/* System Info */}
              <Card>
                <h3 className="text-sm font-bold text-slate-900 mb-2">معلومات النظام</h3>
                <div className="space-y-1.5 text-xs text-slate-600">
                  <div className="flex justify-between">
                    <span>تاريخ الإنشاء:</span>
                    <span className="font-mono font-bold">{new Date(localMission.created_at).toLocaleString('ar-EG')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>معرّف المهمة:</span>
                    <span className="font-mono text-[10px] text-slate-400">{mission.id}</span>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      </Modal>

      {/* Close Mission Confirm */}
      <ConfirmDialog
        open={showCloseConfirm}
        title="إغلاق المهمة نهائياً"
        message="هل أنت متأكد من إغلاق المهمة نهائياً؟ لن يتمكن أحد من التسجيل بعد الإغلاق. لا يمكن التراجع عن هذا الإجراء."
        confirmLabel="نعم، إغلاق المهمة"
        cancelLabel="إلغاء"
        variant="warning"
        onConfirm={handleCloseMission}
        onCancel={() => setShowCloseConfirm(false)}
      />

      {/* Delete Mission Confirm */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="حذف المهمة نهائياً"
        message="هل أنت متأكد من حذف المهمة نهائياً؟ سيتم حذف جميع التسجيلات والبيانات المرتبطة بها. هذا الإجراء لا يمكن التراجع عنه!"
        confirmLabel="نعم، حذف المهمة"
        cancelLabel="إلغاء"
        variant="danger"
        loading={isSaving}
        onConfirm={handleDeleteMission}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}

export default MissionControlPanel;