import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Mission, updateMission, toggleMissionRegistration, updateMissionDetails } from '../api/admin';

interface Props {
  mission: Mission;
  onClose: () => void;
  onUpdate: () => void;
}

export function MissionControlPanel({ mission, onClose, onUpdate }: Props) {
  const [activeTab, setActiveTab] = useState<'overview' | 'edit' | 'settings'>('overview');
  
  // Edit form state
  const [editTitle, setEditTitle] = useState(mission.title);
  const [editDescription, setEditDescription] = useState(mission.description || '');
  const [editLocation, setEditLocation] = useState(mission.location || '');
  const [editCapacity, setEditCapacity] = useState(mission.capacity);
  const [editStartDate, setEditStartDate] = useState(mission.start_at.slice(0, 16));
  const [editEndDate, setEditEndDate] = useState(mission.end_at.slice(0, 16));
  
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Calculate registration status
  const now = new Date();
  const regOpenAt = mission.registration_open_at ? new Date(mission.registration_open_at) : null;
  const regCloseAt = mission.registration_close_at ? new Date(mission.registration_close_at) : null;
  const isRegOpen = mission.status === 'OPEN' && 
                    regOpenAt && regOpenAt <= now && 
                    (!regCloseAt || regCloseAt > now);

  // Handle toggle registration
  const handleToggleRegistration = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await toggleMissionRegistration(mission.id, !isRegOpen);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      await onUpdate();
    } catch (err: any) {
      setSaveError(err.message || 'فشل تغيير حالة التسجيل');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle save mission details
  const handleSaveDetails = async () => {
    if (!editTitle.trim()) {
      setSaveError('عنوان المهمة مطلوب');
      return;
    }
    if (editCapacity < 1 || editCapacity > 1000) {
      setSaveError('السعة يجب أن تكون بين 1 و 1000');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      await updateMissionDetails(mission.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        location: editLocation.trim() || null,
        capacity: editCapacity,
        start_at: new Date(editStartDate).toISOString(),
        end_at: new Date(editEndDate).toISOString(),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      await onUpdate();
    } catch (err: any) {
      setSaveError(err.message || 'فشل حفظ التعديلات');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle close mission permanently
  const handleCloseMission = async () => {
    if (!confirm('هل أنت متأكد من إغلاق المهمة نهائياً؟ لن يتمكن أحد من التسجيل بعد الإغلاق.')) {
      return;
    }
    
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateMission(mission.id, { status: 'CLOSED' });
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 2000);
      await onUpdate();
    } catch (err: any) {
      setSaveError(err.message || 'فشل إغلاق المهمة');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden border-2 border-slate-200">
        {/* Header */}
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6 flex items-center justify-between border-b-4 border-red-600">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-xs font-bold bg-red-600 px-3 py-1 rounded-lg shadow-lg">
                {mission.public_code}
              </span>
              <span className={`text-xs font-bold px-2.5 py-0.5 rounded-md ${
                mission.status === 'OPEN' ? 'bg-emerald-500' : 
                mission.status === 'CLOSED' ? 'bg-slate-500' : 
                'bg-amber-500'
              }`}>
                {mission.status}
              </span>
            </div>
            <h2 className="text-xl font-black">{mission.title}</h2>
            <p className="text-xs text-slate-300 mt-1">لوحة التحكم الكاملة في المهمة</p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-xl flex items-center justify-center text-2xl transition"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex-1 py-3 px-4 text-sm font-bold transition ${
              activeTab === 'overview'
                ? 'bg-white text-red-600 border-b-2 border-red-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            📊 نظرة عامة
          </button>
          <button
            onClick={() => setActiveTab('edit')}
            className={`flex-1 py-3 px-4 text-sm font-bold transition ${
              activeTab === 'edit'
                ? 'bg-white text-red-600 border-b-2 border-red-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ✏️ تعديل التفاصيل
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 py-3 px-4 text-sm font-bold transition ${
              activeTab === 'settings'
                ? 'bg-white text-red-600 border-b-2 border-red-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ⚙️ إعدادات
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {/* Success/Error Messages */}
          {saveSuccess && (
            <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center gap-2 text-sm font-bold animate-fadeIn">
              ✓ تم الحفظ بنجاح
            </div>
          )}
          {saveError && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl flex items-center gap-2 text-sm font-bold animate-fadeIn">
              ⚠️ {saveError}
            </div>
          )}

          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                  <div className="text-xs text-slate-500 font-bold mb-1">السعة المطلوبة</div>
                  <div className="text-3xl font-black text-slate-900">{mission.capacity}</div>
                  <div className="text-xs text-slate-600 mt-1">متطوع</div>
                </div>
                
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                  <div className="text-xs text-slate-500 font-bold mb-1">حالة التسجيل</div>
                  <div className={`text-lg font-black ${isRegOpen ? 'text-emerald-600' : 'text-red-600'}`}>
                    {isRegOpen ? '🟢 مفتوح' : '🔴 مغلق'}
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    {isRegOpen ? 'يمكن التسجيل الآن' : 'التسجيل متوقف'}
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                <div className="text-xs text-blue-700 font-bold mb-2">📍 المكان</div>
                <div className="text-sm text-blue-900 font-semibold">{mission.location || 'غير محدد'}</div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <div className="text-xs text-amber-700 font-bold mb-2">📝 الوصف</div>
                <div className="text-sm text-amber-900 leading-relaxed">
                  {mission.description || 'لا يوجد وصف'}
                </div>
              </div>

              <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4">
                <div className="text-xs text-purple-700 font-bold mb-2">🗓️ التوقيت</div>
                <div className="space-y-1.5 text-xs text-purple-900">
                  <div className="flex justify-between">
                    <span className="font-medium">بداية المهمة:</span>
                    <span className="font-bold">{new Date(mission.start_at).toLocaleString('ar-EG')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">نهاية المهمة:</span>
                    <span className="font-bold">{new Date(mission.end_at).toLocaleString('ar-EG')}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                <div className="text-xs text-slate-700 font-bold mb-2">🎤 عبارة التأكيد الصوتي</div>
                <div className="text-sm text-slate-900 font-semibold bg-white px-3 py-2 rounded-lg border border-slate-200">
                  "{mission.confirmation_phrase}"
                </div>
              </div>
            </div>
          )}

          {/* EDIT TAB */}
          {activeTab === 'edit' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">عنوان المهمة *</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm font-semibold focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  placeholder="مثال: قافلة طبية - قرية النور"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">الوصف</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm leading-relaxed focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  placeholder="وصف مختصر للمهمة..."
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">المكان</label>
                <input
                  type="text"
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm font-semibold focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  placeholder="مثال: مقر الهلال الأحمر بالمنيا"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">عدد المتطوعين المطلوب *</label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={editCapacity}
                  onChange={(e) => setEditCapacity(parseInt(e.target.value) || 1)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm font-bold focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">بداية المهمة *</label>
                  <input
                    type="datetime-local"
                    value={editStartDate}
                    onChange={(e) => setEditStartDate(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 text-xs font-semibold focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">نهاية المهمة *</label>
                  <input
                    type="datetime-local"
                    value={editEndDate}
                    onChange={(e) => setEditEndDate(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 text-xs font-semibold focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  />
                </div>
              </div>

              <button
                onClick={handleSaveDetails}
                disabled={isSaving}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-bold py-3 px-6 rounded-2xl transition shadow-lg"
              >
                {isSaving ? 'جاري الحفظ...' : '✓ حفظ التعديلات'}
              </button>
            </div>
          )}

          {/* SETTINGS TAB */}
          {activeTab === 'settings' && (
            <div className="space-y-4">
              <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-black text-slate-900 mb-1">التحكم في التسجيل</h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {isRegOpen 
                        ? 'التسجيل مفتوح حالياً. يمكنك إغلاقه مؤقتاً لإيقاف استقبال تسجيلات جديدة.'
                        : 'التسجيل مغلق حالياً. يمكنك فتحه للسماح باستقبال تسجيلات جديدة.'}
                    </p>
                  </div>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${
                    isRegOpen ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'
                  }`}>
                    {isRegOpen ? '🟢' : '🔴'}
                  </div>
                </div>
                <button
                  onClick={handleToggleRegistration}
                  disabled={isSaving}
                  className={`w-full font-bold py-3 px-6 rounded-xl transition shadow-md ${
                    isRegOpen
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  } disabled:bg-slate-400`}
                >
                  {isSaving ? 'جاري التحديث...' : isRegOpen ? '🔒 إغلاق التسجيل مؤقتاً' : '🔓 فتح التسجيل'}
                </button>
              </div>

              <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-5">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 bg-amber-200 rounded-lg flex items-center justify-center text-xl flex-shrink-0">
                    ⚠️
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-amber-900 mb-1">إغلاق المهمة نهائياً</h3>
                    <p className="text-xs text-amber-800 leading-relaxed">
                      إغلاق المهمة بشكل نهائي سيمنع أي تسجيلات جديدة ويحول حالتها إلى CLOSED. 
                      هذا الإجراء لا يمكن التراجع عنه بسهولة.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleCloseMission}
                  disabled={isSaving || mission.status === 'CLOSED'}
                  className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-slate-400 text-white font-bold py-3 px-6 rounded-xl transition shadow-md"
                >
                  {mission.status === 'CLOSED' ? '✓ المهمة مغلقة بالفعل' : '🚫 إغلاق المهمة نهائياً'}
                </button>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
                <h3 className="text-sm font-black text-slate-900 mb-2">معلومات النظام</h3>
                <div className="space-y-1.5 text-xs text-slate-700">
                  <div className="flex justify-between">
                    <span>تاريخ الإنشاء:</span>
                    <span className="font-mono font-bold">{new Date(mission.created_at).toLocaleString('ar-EG')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>معرّف المهمة:</span>
                    <span className="font-mono text-[10px] text-slate-500">{mission.id}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 p-4 flex justify-end">
          <button
            onClick={onClose}
            className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold py-2 px-6 rounded-xl transition text-sm"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
