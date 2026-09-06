import React, { useState, useEffect } from 'react';
import { 
  loginAdmin, 
  logoutAdmin, 
  listMissions, 
  createMission, 
  updateMission,
  getMissionRegistrations,
  cancelRegistration,
  getAudioPlaybackUrl,
  getExportCsvUrl,
  Mission, 
  Registration, 
  AdminUser,
  MissionCreateResponse 
} from '../api/admin';

export function AdminDashboard() {
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [loginUsername, setLoginUsername] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Missions state
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loadingMissions, setLoadingMissions] = useState(false);
  const [selectedMission, setSelectedMission] = useState<Mission | null>(null);

  // Create mission modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newLocation, setNewLocation] = useState('مقر الهلال الأحمر بالمنيا');
  const [newCapacity, setNewCapacity] = useState(10);
  const [newStartDate, setNewStartDate] = useState('');
  const [newEndDate, setNewEndDate] = useState('');
  const [creatingMission, setCreatingMission] = useState(false);
  const [createModalSuccess, setCreateModalSuccess] = useState<MissionCreateResponse | null>(null);

  // Registrations table state
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [regCounts, setRegCounts] = useState({ confirmed: 0, waitlist: 0, cancelled: 0, total: 0 });
  const [loadingRegistrations, setLoadingRegistrations] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [cancelFeedback, setCancelFeedback] = useState<string | null>(null);

  // Audio player state
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Check login / load missions
  const loadMissionsList = async () => {
    setLoadingMissions(true);
    try {
      const data = await listMissions();
      setMissions(data.missions);
      if (!adminUser) {
        setAdminUser({ admin_id: 'active', username: 'admin', display_name: 'مدير النظام' });
      }
    } catch {
      setAdminUser(null);
    } finally {
      setLoadingMissions(false);
    }
  };

  useEffect(() => {
    loadMissionsList();
  }, []);

  // Load registrations when selected mission or filters change
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
    }
  }, [selectedMission, filterStatus, searchQuery]);

  // Handle Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const user = await loginAdmin(loginUsername, loginPassword);
      setAdminUser(user);
      await loadMissionsList();
    } catch (err: any) {
      setLoginError(err.message || 'بيانات تسجيل الدخول غير صحيحة');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    await logoutAdmin();
    setAdminUser(null);
    setMissions([]);
    setSelectedMission(null);
  };

  // Handle Create Mission
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
      });

      setCreateModalSuccess(created);
      await loadMissionsList();
    } catch (err: any) {
      alert(err.message || 'فشل إنشاء المهمة');
    } finally {
      setCreatingMission(false);
    }
  };

  // Reset Create Modal
  const closeCreateModal = () => {
    setShowCreateModal(false);
    setCreateModalSuccess(null);
    setNewTitle('');
    setNewDescription('');
    setNewCapacity(10);
  };

  // Handle Cancel Registration
  const handleCancelRegistration = async (reg: Registration) => {
    if (!confirm(`هل أنت متأكد من إلغاء تسجيل المتطوع "${reg.volunteer_name}"؟`)) {
      return;
    }
    try {
      const res = await cancelRegistration(reg.id);
      setCancelFeedback(res.message);
      setTimeout(() => setCancelFeedback(null), 6000);
      if (selectedMission) {
        await loadRegistrations(selectedMission.id);
        await loadMissionsList();
      }
    } catch (err: any) {
      alert(err.message || 'فشل إلغاء التسجيل');
    }
  };

  // Handle Toggle Mission Status (OPEN / CLOSED)
  const handleToggleStatus = async (mission: Mission) => {
    const nextStatus = mission.status === 'OPEN' ? 'CLOSED' : 'OPEN';
    try {
      await updateMission(mission.id, { status: nextStatus });
      await loadMissionsList();
      if (selectedMission && selectedMission.id === mission.id) {
        setSelectedMission({ ...selectedMission, status: nextStatus });
      }
    } catch (err: any) {
      alert(err.message || 'فشل تغيير حالة المهمة');
    }
  };

  // Copy helper
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 3000);
  };

  // 1. LOGIN SCREEN
  if (!adminUser) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full border border-slate-800">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-red-600 text-white rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-red-600/30 font-black text-2xl">
              RC
            </div>
            <h1 className="text-2xl font-black text-slate-900">لوحة تحكم المشرفين</h1>
            <p className="text-xs text-slate-500 mt-1 font-medium">الهلال الأحمر المصري — فرع المنيا</p>
          </div>

          {loginError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold p-3 rounded-xl mb-4">
              ⚠️ {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">اسم المستخدم</label>
              <input
                type="text"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-red-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">كلمة المرور</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-red-500"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl transition shadow-md mt-2 disabled:opacity-50"
            >
              {isLoggingIn ? 'جاري الدخول...' : 'تسجيل الدخول'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-xl bg-red-600 text-white flex items-center justify-center font-bold text-sm shadow">
              RC
            </span>
            <div>
              <h1 className="text-base font-extrabold text-slate-900 leading-tight">الهلال الأحمر المصري — المنيا</h1>
              <p className="text-[11px] text-slate-500 font-medium">لوحة إدارة المهمات والتسجيل الذكي</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow transition flex items-center gap-1.5"
            >
              <span>+</span>
              <span>مهمة جديدة</span>
            </button>
            <button
              onClick={handleLogout}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3.5 py-2.5 rounded-xl transition"
            >
              خروج
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Toast / Notification */}
        {copiedText && (
          <div className="fixed bottom-6 left-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-xl text-xs font-bold animate-bounce flex items-center gap-2">
            <span>✓</span>
            <span>تم نسخ {copiedText} بنجاح</span>
          </div>
        )}

        {cancelFeedback && (
          <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 p-4 rounded-2xl text-xs font-bold shadow-sm flex items-center gap-2">
            <span>🎉</span>
            <span>{cancelFeedback}</span>
          </div>
        )}

        {/* Active Missions Grid */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-black text-slate-900">المهمات الحالية ({missions.length})</h2>
            <button
              onClick={loadMissionsList}
              className="text-xs font-bold text-slate-500 hover:text-red-600 flex items-center gap-1"
            >
              <span>تحديث</span>
              <span>🔄</span>
            </button>
          </div>

          {loadingMissions ? (
            <div className="bg-white rounded-3xl p-12 text-center text-slate-400 font-medium">
              جاري تحميل المهمات...
            </div>
          ) : missions.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-200">
              <p className="text-slate-500 font-bold mb-3">لا توجد مهمات مسجلة بعد</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="bg-red-600 text-white text-xs font-bold px-4 py-2 rounded-xl"
              >
                + إنشاء أول مهمة
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {missions.map((m) => {
                const isSelected = selectedMission?.id === m.id;
                const isOpen = m.status === 'OPEN';

                return (
                  <div
                    key={m.id}
                    onClick={() => setSelectedMission(m)}
                    className={`bg-white rounded-3xl p-5 border transition cursor-pointer relative shadow-sm hover:shadow-md ${
                      isSelected
                        ? 'border-red-600 ring-2 ring-red-500/20'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-mono text-xs font-black text-red-600 bg-red-50 px-2.5 py-1 rounded-lg border border-red-100">
                        {m.public_code}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                          isOpen ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {isOpen ? 'مفتوحة للتسجيل' : 'مغلقة'}
                      </span>
                    </div>

                    <h3 className="text-base font-extrabold text-slate-900 mb-1.5 line-clamp-1">{m.title}</h3>
                    {m.location && (
                      <p className="text-xs text-slate-500 mb-3 flex items-center gap-1">
                        <span>📍</span>
                        <span className="truncate">{m.location}</span>
                      </p>
                    )}

                    <div className="flex items-center justify-between text-xs pt-3 border-t border-slate-100">
                      <span className="text-slate-600 font-medium">السعة: <b className="text-slate-900">{m.capacity}</b></span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleStatus(m);
                        }}
                        className="text-[11px] font-bold text-slate-500 hover:text-slate-800 underline"
                      >
                        {isOpen ? 'إغلاق التسجيل' : 'فتح التسجيل'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Mission Details & Registrations */}
        {selectedMission && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden animate-fadeIn">
            {/* Mission Detail Header */}
            <div className="p-6 bg-slate-900 text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-mono text-xs font-bold bg-red-600 px-2.5 py-0.5 rounded-md">
                    {selectedMission.public_code}
                  </span>
                  <span className="text-xs text-slate-300 font-medium">
                    السعة المطلوبة: {selectedMission.capacity} متطوع
                  </span>
                </div>
                <h2 className="text-xl font-black">{selectedMission.title}</h2>
              </div>

              {/* Action Buttons for Mission */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() =>
                    copyToClipboard(
                      `${window.location.origin}/m/${selectedMission.public_code}`,
                      'رابط التسجيل'
                    )
                  }
                  className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition flex items-center gap-1"
                >
                  <span>🔗</span>
                  <span>نسخ الرابط</span>
                </button>
                <button
                  onClick={() => {
                    const msg = `صباح الخير متطوعينا الكرام\n\nعندنا ${selectedMission.title}\n\nالتسجيل يتم من خلال الرابط التالي:\n${window.location.origin}/m/${selectedMission.public_code}\n\nبرجاء التسجيل بنفسك وعدم التسجيل بالنيابة عن أي متطوع آخر.`;
                    copyToClipboard(msg, 'رسالة الواتساب');
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition flex items-center gap-1 shadow"
                >
                  <span>📋</span>
                  <span>رسالة الواتساب</span>
                </button>
                <a
                  href={getExportCsvUrl(selectedMission.id)}
                  download
                  className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition flex items-center gap-1 border border-slate-700"
                >
                  <span>📥</span>
                  <span>تحميل CSV</span>
                </a>
              </div>
            </div>

            {/* Registrations Header & Stats */}
            <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="bg-emerald-50 text-emerald-800 px-3.5 py-1.5 rounded-xl text-xs font-bold border border-emerald-100">
                  المؤكدين: {regCounts.confirmed} / {selectedMission.capacity}
                </div>
                <div className="bg-amber-50 text-amber-800 px-3.5 py-1.5 rounded-xl text-xs font-bold border border-amber-100">
                  قائمة الانتظار: {regCounts.waitlist}
                </div>
                <div className="bg-slate-100 text-slate-600 px-3.5 py-1.5 rounded-xl text-xs font-bold">
                  الإجمالي: {regCounts.total}
                </div>
              </div>

              {/* Filters & Search */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="بحث بالاسم أو العضوية..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-xl border border-slate-300 font-semibold focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-xl border border-slate-300 font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">كل الحالات</option>
                  <option value="CONFIRMED">المؤكدين فقط</option>
                  <option value="WAITLIST">الانتظار فقط</option>
                  <option value="CANCELLED">الملغيين</option>
                </select>
              </div>
            </div>

            {/* Registrations Table */}
            <div className="overflow-x-auto">
              {loadingRegistrations ? (
                <div className="p-12 text-center text-slate-400 font-medium">جاري جلب المسجلين...</div>
              ) : registrations.length === 0 ? (
                <div className="p-12 text-center text-slate-400 font-medium">
                  لا توجد تسجيلات مطابقة للبحث أو المهمة فارغة
                </div>
              ) : (
                <table className="w-full text-right text-xs">
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
                      const isConfirmed = reg.status === 'CONFIRMED';
                      const isWaitlist = reg.status === 'WAITLIST';
                      const isCancelled = reg.status === 'CANCELLED';

                      return (
                        <tr key={reg.id} className="hover:bg-slate-50/80 transition">
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
                            {isConfirmed && (
                              <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full font-bold">
                                <span>مؤكد</span>
                                <span className="font-mono">#{reg.seat_number}</span>
                              </span>
                            )}
                            {isWaitlist && (
                              <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-full font-bold">
                                <span>انتظار</span>
                                <span className="font-mono">#{reg.waitlist_position}</span>
                              </span>
                            )}
                            {isCancelled && (
                              <span className="inline-flex items-center bg-slate-100 text-slate-500 px-2.5 py-0.5 rounded-full font-bold">
                                ملغي
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            {playingAudioId === reg.id ? (
                              <div className="flex items-center gap-2">
                                <audio
                                  autoPlay
                                  controls
                                  src={getAudioPlaybackUrl(reg.id)}
                                  className="h-8 w-48"
                                  onEnded={() => setPlayingAudioId(null)}
                                />
                                <button
                                  onClick={() => setPlayingAudioId(null)}
                                  className="text-slate-400 hover:text-slate-600 text-xs"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setPlayingAudioId(reg.id)}
                                className="inline-flex items-center gap-1 text-slate-700 hover:text-red-600 bg-slate-100 hover:bg-red-50 px-2.5 py-1 rounded-lg transition font-bold"
                              >
                                <span>▶</span>
                                <span>استماع</span>
                              </button>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                            {new Date(reg.created_at).toLocaleTimeString('ar-EG', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            {!isCancelled && (
                              <button
                                onClick={() => handleCancelRegistration(reg)}
                                className="text-red-600 hover:text-red-800 text-[11px] font-bold px-2 py-1 rounded hover:bg-red-50 transition"
                              >
                                إلغاء التسجيل
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </main>

      {/* CREATE MISSION MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full p-6 border border-slate-100 animate-scaleUp">
            {!createModalSuccess ? (
              <>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
                  <h3 className="text-base font-black text-slate-900">إنشاء مهمة جديدة</h3>
                  <button onClick={closeCreateModal} className="text-slate-400 hover:text-slate-600">
                    ✕
                  </button>
                </div>

                <form onSubmit={handleCreateMission} className="space-y-3.5 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">عنوان المهمة</label>
                    <input
                      type="text"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="مثال: قافلة الأطراف الصناعية بالتعاون مع التضامن"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold focus:outline-none focus:ring-2 focus:ring-red-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">وصف المهمة (اختياري)</label>
                    <textarea
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      placeholder="تفاصيل إضافية للمتطوعين..."
                      rows={2}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">المكان / نقطة التجمع</label>
                    <input
                      type="text"
                      value={newLocation}
                      onChange={(e) => setNewLocation(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">تاريخ ووقت البداية</label>
                      <input
                        type="datetime-local"
                        value={newStartDate}
                        onChange={(e) => setNewStartDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">تاريخ ووقت الانتهاء</label>
                      <input
                        type="datetime-local"
                        value={newEndDate}
                        onChange={(e) => setNewEndDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">السعة المطلوبة (عدد المتطوعين)</label>
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={newCapacity}
                      onChange={(e) => setNewCapacity(parseInt(e.target.value, 10))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold focus:outline-none focus:ring-2 focus:ring-red-500"
                      required
                    />
                  </div>

                  <div className="pt-2 flex gap-2">
                    <button
                      type="submit"
                      disabled={creatingMission}
                      className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-xl transition shadow"
                    >
                      {creatingMission ? 'جاري الإنشاء...' : 'حفظ ونشر المهمة'}
                    </button>
                    <button
                      type="button"
                      onClick={closeCreateModal}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2.5 rounded-xl"
                    >
                      إلغاء
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="text-center space-y-4">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-xl font-bold">
                  ✓
                </div>
                <h3 className="text-base font-black text-slate-900">تم إنشاء المهمة بنجاح!</h3>
                <p className="text-xs text-slate-600">كود المهمة: <b className="text-red-600 font-mono">{createModalSuccess.public_code}</b></p>

                {/* Copy Link */}
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 text-xs text-right space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-700">رابط التسجيل:</span>
                    <button
                      onClick={() => copyToClipboard(createModalSuccess.public_url, 'رابط المهمة')}
                      className="text-red-600 hover:underline font-bold"
                    >
                      نسخ الرابط 📋
                    </button>
                  </div>
                  <input
                    type="text"
                    readOnly
                    value={createModalSuccess.public_url}
                    className="w-full bg-white p-2 rounded-lg border border-slate-200 font-mono text-[11px]"
                  />
                </div>

                {/* Copy WhatsApp */}
                <div className="bg-emerald-50 p-3 rounded-2xl border border-emerald-200 text-xs text-right space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-emerald-800">رسالة الواتساب الجاهزة:</span>
                    <button
                      onClick={() => copyToClipboard(createModalSuccess.whatsapp_message, 'رسالة الواتساب')}
                      className="text-emerald-700 hover:underline font-bold"
                    >
                      نسخ الرسالة 📋
                    </button>
                  </div>
                  <textarea
                    readOnly
                    rows={4}
                    value={createModalSuccess.whatsapp_message}
                    className="w-full bg-white p-2 rounded-lg border border-emerald-200 text-[11px] leading-relaxed"
                  />
                </div>

                <button
                  onClick={closeCreateModal}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-3 rounded-xl transition"
                >
                  إغلاق
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
