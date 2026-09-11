import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { 
  getMission, 
  lookupQuickProfile, 
  saveQuickProfile,
  submitRegistration, 
  submitTemporaryRegistration,
  Mission, 
  RegistrationResult 
} from '../api/public';

interface LiveVolunteer {
  id: string;
  name: string;
  member_id: string;
  status: string;
  seat_number: number | null;
  waitlist_position: number | null;
  created_at: string;
}

export function MissionRegistration() {
  const { code } = useParams<{ code: string }>();

  const [mission, setMission] = useState<Mission | null>(null);
  const [loadingMission, setLoadingMission] = useState(true);
  const [missionError, setMissionError] = useState<string | null>(null);

  // Live registration table state
  const [liveRegistrations, setLiveRegistrations] = useState<LiveVolunteer[]>([]);

  // Form mode: 'normal' | 'temp' | 'quick-save'
  const [mode, setMode] = useState<'normal' | 'temp' | 'quick-save'>('normal');

  // Form fields
  const [memberId, setMemberId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [memberFound, setMemberFound] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);

  // Audio recording
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'recorded'>('idle');
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Submission
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<RegistrationResult | null>(null);

  // Success screen mode
  const [successMode, setSuccessMode] = useState<'result' | 'quick-save' | 'quick-save-success'>('result');
  const [completed, setCompleted] = useState(false);

  // 1. Fetch Mission Info (with polling every 6s)
  const fetchMissionData = async (isInitial = false) => {
    if (!code) return;
    try {
      const data = await getMission(code);
      setMission(data);
      if (isInitial) setLoadingMission(false);
    } catch (err: any) {
      if (isInitial) {
        setMissionError(err.message || 'المهمة غير موجودة أو تم إلغاؤها');
        setLoadingMission(false);
      }
    }
  };

  useEffect(() => {
    fetchMissionData(true);
    const interval = setInterval(() => fetchMissionData(false), 6000);
    return () => clearInterval(interval);
  }, [code]);

  // 2. Live registrations polling every 3 seconds
  const fetchLiveRegistrations = async () => {
    if (!code) return;
    try {
      const res = await fetch(`/api/missions/${code}/registrations-live`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setLiveRegistrations(data.data || []);
        }
      }
    } catch {
      // silently ignore live feed errors
    }
  };

  useEffect(() => {
    fetchLiveRegistrations();
    const interval = setInterval(fetchLiveRegistrations, 3000);
    return () => clearInterval(interval);
  }, [code]);

  // 3. Member ID Quick Profile Lookup debounce
  useEffect(() => {
    const trimmed = memberId.trim();
    if (trimmed.length < 1 || mode === 'temp') {
      setMemberFound(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLookingUp(true);
      try {
        const res = await lookupQuickProfile(trimmed);
        if (res.found && res.name && res.phone) {
          setName(res.name);
          setPhone(res.phone);
          setMemberFound(true);
        } else {
          setMemberFound(false);
        }
      } catch {
        setMemberFound(false);
      } finally {
        setIsLookingUp(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [memberId, mode]);

  // 4. Audio Recording Handling
  const startRecording = async () => {
    setMicError(null);
    setAudioBlob(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setRecordingState('recorded');
      };

      recorder.start(250);
      setRecordingState('recording');
      setRecordingTime(0);

      // Start duration counter (max 10s)
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        setRecordingTime(elapsed);
        if (elapsed >= 10) {
          stopRecording();
        }
      }, 100);
    } catch (err: any) {
      console.error('Microphone error:', err);
      setMicError('تعذر الوصول للمايكروفون. برجاء السماح بالوصول للمايكروفون من إعدادات المتصفح.');
      setRecordingState('idle');
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const resetRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingState('idle');
    setRecordingTime(0);
    setMicError(null);
  };

  // 5. Form Submission - Normal Registration
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (mode === 'normal') {
      if (!memberId.trim()) {
        setSubmitError('برجاء إدخال رقم العضوية');
        return;
      }
    }
    if (!name.trim()) {
      setSubmitError('برجاء إدخال الاسم');
      return;
    }
    if (!phone.trim() || !/^01[0125][0-9]{8}$/.test(phone.trim())) {
      setSubmitError('برجاء إدخال رقم تليفون صحيح (11 رقم يبدأ بـ 01)');
      return;
    }

    if (mode === 'temp') {
      // Temporary registration without audio
      setIsSubmitting(true);
      try {
        const res = await submitTemporaryRegistration({
          mission_public_code: mission?.public_code || '',
          name: name.trim(),
          phone: phone.trim(),
        });
        setResult(res);
        setSuccessMode('result');
      } catch (err: any) {
        setSubmitError(err.message || 'حدث خطأ أثناء التسجيل المؤقت');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Normal registration requires audio
    if (!audioBlob || recordingTime < 1.5) {
      setSubmitError('برجاء تسجيل عبارة التأكيد بصوتك لمدة لا تقل عن ثانيتين.');
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('mission_public_code', mission?.public_code || '');
      formData.append('member_id', memberId.trim());
      formData.append('name', name.trim());
      formData.append('phone', phone.trim());
      formData.append('phrase', mission?.confirmation_phrase || '');
      formData.append('duration_ms', Math.round(recordingTime * 1000).toString());
      formData.append('audio', audioBlob, `recording_${memberId.trim()}.webm`);

      const res = await submitRegistration(formData);
      setResult(res);
      setSuccessMode('result');
    } catch (err: any) {
      setSubmitError(err.message || 'حدث خطأ أثناء إتمام التسجيل. برجاء المحاولة مجدداً.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 6. Quick Save Profile
  const handleQuickSave = async () => {
    if (!memberId.trim() || !name.trim() || !phone.trim()) {
      setSubmitError('برجاء إدخال رقم العضوية والاسم ورقم التليفون');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await saveQuickProfile({
        member_id: memberId.trim(),
        name: name.trim(),
        phone: phone.trim(),
      });
      // Show success message by changing mode
      setSuccessMode('quick-save-success');
    } catch (err: any) {
      setSubmitError(err.message || 'حدث خطأ أثناء حفظ البيانات');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Format Dates
  const formatDateTime = (isoStr?: string) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  if (loadingMission) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600 font-medium">جاري تحميل بيانات المهمة...</p>
        </div>
      </div>
    );
  }

  if (missionError || !mission) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-md w-full text-center border border-red-100">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
            ⚠️
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">تعذر العثور على المهمة</h2>
          <p className="text-slate-600 mb-6">{missionError || 'رابط المهمة غير صحيح أو انتهت صلاحيته.'}</p>
        </div>
      </div>
    );
  }

  // MISSION CLOSED OR FULL SCREEN
  if (!mission.registration_open || mission.status !== 'OPEN') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-md w-full text-center border border-amber-200">
          <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl font-bold">
            🔒
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">لقد اكتملت هذه المهمة</h2>
          <p className="text-slate-600 mb-4">
            {mission.is_full 
              ? 'تم استكمال العدد المطلوب من المتطوعين (بما في ذلك قائمة الانتظار).'
              : 'تم إغلاق باب التسجيل لهذه المهمة.'}
          </p>
          
          <div className="mt-6 pt-6 border-t border-slate-200">
            <button
              onClick={() => setMode('quick-save')}
              className="text-sm text-blue-600 hover:text-blue-700 font-bold underline"
            >
              هل أنت مسجل من قبل؟ احفظ بياناتك للمرة القادمة
            </button>
          </div>

          {mode === 'quick-save' && (
            <div className="mt-6 p-4 bg-blue-50 rounded-2xl border border-blue-200 text-right">
              <h3 className="text-sm font-bold text-slate-800 mb-3">احفظ بياناتك للتسجيل السريع في المرات القادمة</h3>
              <div className="space-y-3">
                <input
                  type="text"
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  placeholder="رقم العضوية"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="الاسم الكامل"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="رقم التليفون (01xxxxxxxxx)"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
                {submitError && (
                  <p className="text-xs text-red-600 font-medium">{submitError}</p>
                )}
                <button
                  onClick={handleQuickSave}
                  disabled={isSubmitting}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition"
                >
                  {isSubmitting ? 'جاري الحفظ...' : 'حفظ بياناتي'}
                </button>
              </div>
            </div>
          )}

          {successMode === 'quick-save' && (
            <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800">
              ✓ تم حفظ بياناتك بنجاح! في المرة القادمة أدخل رقم عضويتك فقط وستملأ بياناتك تلقائياً.
            </div>
          )}
        </div>
      </div>
    );
  }

  // SUCCESS RESULT SCREEN
  if (result && successMode === 'result') {
    const isConfirmed = result.status === 'CONFIRMED';

    return (
      <div className="min-h-screen bg-slate-100 py-8 px-4 flex items-center justify-center">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden max-w-md w-full border border-slate-200 animate-fadeIn">
          {/* Header Banner */}
          <div className={`p-6 text-center text-white ${isConfirmed ? 'bg-emerald-600' : 'bg-amber-600'}`}>
            <div className="w-16 h-16 bg-white/20 backdrop-blur rounded-full flex items-center justify-center mx-auto mb-3 text-3xl">
              {isConfirmed ? '✓' : '⏳'}
            </div>
            <h1 className="text-2xl font-extrabold mb-1">
              {isConfirmed ? 'تم تأكيد تسجيلك بنجاح!' : 'تمت إضافتك لقائمة الانتظار'}
            </h1>
            <p className="text-white/90 text-sm font-medium">الهلال الأحمر المصري — فرع المنيا</p>
          </div>

          <div className="p-6 space-y-6">
            {/* Main Result Card */}
            <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 text-center">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                {isConfirmed ? 'رقم المقعد المخصص' : 'موقعك في قائمة الانتظار'}
              </span>
              <div className="text-4xl font-black text-slate-900 mb-2">
                {isConfirmed ? `#${result.seat_number}` : `#${result.waitlist_position}`}
              </div>
              <div className="text-xs text-slate-500 font-mono">
                كود التسجيل: <span className="font-bold text-slate-700">{result.registration_id}</span>
              </div>
            </div>

            {/* Volunteer & Mission Details */}
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-500">اسم المتطوع:</span>
                <span className="font-bold text-slate-800">{result.name}</span>
              </div>
              {result.member_id && (
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">رقم العضوية:</span>
                  <span className="font-mono font-bold text-slate-800">{result.member_id}</span>
                </div>
              )}
              {result.phone && (
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">رقم التليفون:</span>
                  <span className="font-mono font-bold text-slate-800">{result.phone}</span>
                </div>
              )}
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-500">المهمة:</span>
                <span className="font-bold text-slate-800">{mission.title}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-500">كود المهمة:</span>
                <span className="font-mono font-bold text-red-600">{mission.public_code}</span>
              </div>
            </div>

            {/* Note */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-800 leading-relaxed">
              {isConfirmed
                ? '📌 برجاء الالتزام بالموعد المحدد والحضور بالزي الرسمي للهلال الأحمر. في حال الاعتذار برجاء إبلاغ المشرف مسبقاً لإتاحة المقعد لمتطوع آخر.'
                : 'ℹ️ في حال اعتذار أي متطوع مسجل، سيتم ترقيتك تلقائياً وبترتيب الأسبقية المسجل.'}
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                onClick={() => {
                  setResult(null);
                  setSuccessMode('result');
                  setMemberId('');
                  setName('');
                  setPhone('');
                  setAudioBlob(null);
                  setAudioUrl(null);
                  setRecordingState('idle');
                  setMode('normal');
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-2xl transition shadow-md"
              >
                🙋 تسجيل لمتطوع آخر (بجواري)
              </button>

              <button
                onClick={() => setSuccessMode('quick-save')}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-3 px-6 rounded-2xl transition"
              >
                ⚡ سجّل المرة الجاية بطريقة أسرع
              </button>

              <button
                onClick={() => setCompleted(true)}
                className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 px-6 rounded-2xl transition shadow-md"
              >
                تم
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // QUICK SAVE PROFILE SCREEN
  if (successMode === 'quick-save') {
    return (
      <div className="min-h-screen bg-slate-100 py-8 px-4 flex items-center justify-center">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-md w-full border border-slate-200">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3 text-3xl">
              ⚡
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">سجّل المرة الجاية بسرعة!</h2>
            <p className="text-sm text-slate-600">
              احفظ بياناتك الآن، وفي المرة القادمة اكتب رقم عضويتك فقط وبياناتك هتتملى تلقائياً
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">رقم العضوية</label>
              <input
                type="text"
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                placeholder="مثال: 1025"
                className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">الاسم الكامل</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="الاسم الثلاثي أو الرباعي"
                className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">رقم التليفون</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01xxxxxxxxx"
                className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm font-semibold"
              />
            </div>

            {submitError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-medium p-3 rounded-xl">
                {submitError}
              </div>
            )}

            <button
              onClick={handleQuickSave}
              disabled={isSubmitting}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-2xl transition shadow-md"
            >
              {isSubmitting ? 'جاري الحفظ...' : '✓ حفظ بياناتي'}
            </button>

            <button
              onClick={() => {
                setSuccessMode('result');
                setMode('normal');
              }}
              className="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium py-2 px-4 rounded-xl text-sm transition"
            >
              رجوع
            </button>
          </div>
        </div>
      </div>
    );
  }

  // QUICK SAVE SUCCESS SCREEN
  if (successMode === 'quick-save-success') {
    return (
      <div className="min-h-screen bg-slate-100 py-8 px-4 flex items-center justify-center">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-md w-full border border-slate-200 animate-fadeIn">
          <div className="text-center">
            <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4 text-4xl">
              ✓
            </div>
            <h2 className="text-2xl font-extrabold text-slate-900 mb-2">تم حفظ بياناتك بنجاح!</h2>
            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              في المرة القادمة، اكتب رقم عضويتك <span className="font-bold text-emerald-600">"{memberId}"</span> فقط وهنملى بياناتك تلقائياً
            </p>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-xs text-blue-800 text-right">
              <p className="font-bold mb-1">📝 البيانات المحفوظة:</p>
              <p>• رقم العضوية: <span className="font-mono font-bold">{memberId}</span></p>
              <p>• الاسم: <span className="font-bold">{name}</span></p>
              <p>• التليفون: <span className="font-mono font-bold">{phone}</span></p>
            </div>

            <button
              onClick={() => setCompleted(true)}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-2xl transition shadow-md"
            >
              تم
            </button>
          </div>
        </div>
      </div>
    );
  }

  // COMPLETED / THANK YOU SCREEN
  if (completed) {
    return (
      <div className="min-h-screen bg-slate-100 py-8 px-4 flex items-center justify-center">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-md w-full border border-slate-200 animate-fadeIn text-center">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4 text-4xl">
            🙏
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900 mb-2">شكراً لتسجيلك</h2>
          <p className="text-sm text-slate-600 mb-4 leading-relaxed">
            تم تسجيلك بنجاح في المهمة.<br />
            يمكنك إغلاق هذه الصفحة الآن.
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-800 text-right">
            <p>💡 يمكنك إغلاق التبويب أو العودة للصفحة السابقة.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-4">
      <div className="max-w-lg mx-auto space-y-5">
        {/* Brand Header */}
        <div className="bg-white rounded-3xl shadow-sm border border-slate-200/80 p-5 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="w-4 h-4 rounded-full bg-red-600 inline-block"></span>
            <h2 className="text-lg font-bold text-slate-900">الهلال الأحمر المصري — فرع المنيا</h2>
          </div>
          <p className="text-xs text-slate-500 font-medium">نظام التسجيل الذكي للمهمات والقوافل</p>
        </div>

        {/* Mission Card */}
        <div className="bg-white rounded-3xl shadow-sm border border-slate-200/80 p-6">
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="px-3 py-1 bg-red-50 text-red-600 font-mono text-xs font-bold rounded-full border border-red-100">
              {mission.public_code}
            </span>
            <div className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${mission.available > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}></span>
              <span className="text-xs font-bold text-slate-700">
                {mission.available > 0 ? `${mission.available} مكان متاح من ${mission.capacity}` : 'المقاعد مكتملة (انتظار)'}
              </span>
            </div>
          </div>

          <h1 className="text-xl font-extrabold text-slate-900 mb-2">{mission.title}</h1>
          {mission.description && (
            <p className="text-sm text-slate-600 leading-relaxed mb-4">{mission.description}</p>
          )}

          <div className="bg-slate-50 rounded-2xl p-3.5 space-y-2 text-xs text-slate-700 border border-slate-200/60">
            {mission.location && (
              <div className="flex items-center gap-2">
                <span className="text-slate-400">📍</span>
                <span>{mission.location}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-slate-400">📅</span>
              <span>{formatDateTime(mission.start_at)}</span>
            </div>
          </div>
        </div>

        {/* LIVE REGISTRATION TABLE */}
        {liveRegistrations.length > 0 && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200/80 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                التسجيلات الحية
                <span className="text-xs font-normal text-slate-400">({liveRegistrations.length})</span>
              </h3>
              <span className="text-[10px] text-slate-400 font-medium">تحديث تلقائي كل 3 ثواني</span>
            </div>
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-right text-[11px]">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-bold border-b border-slate-100 sticky top-0">
                  <tr>
                    <th className="py-2 px-2">#</th>
                    <th className="py-2 px-2">الاسم</th>
                    <th className="py-2 px-2 font-mono">العضوية</th>
                    <th className="py-2 px-2">الحالة</th>
                    <th className="py-2 px-2">المقعد</th>
                    <th className="py-2 px-2">وقت التسجيل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {liveRegistrations.map((reg, idx) => (
                    <tr key={reg.id} className={idx === 0 ? 'bg-emerald-50/50' : ''}>
                      <td className="py-1.5 px-2 font-mono font-bold text-slate-400">{idx + 1}</td>
                      <td className="py-1.5 px-2 font-bold text-slate-900">{reg.name}</td>
                      <td className="py-1.5 px-2 font-mono text-slate-700">{reg.member_id}</td>
                      <td className="py-1.5 px-2">
                        <span className={`px-1.5 py-0.5 rounded-full font-bold text-[10px] ${
                          reg.status === 'CONFIRMED' ? 'bg-emerald-100 text-emerald-800' :
                          reg.status === 'WAITLIST' ? 'bg-amber-100 text-amber-800' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {reg.status === 'CONFIRMED' ? 'مؤكد' : reg.status === 'WAITLIST' ? 'انتظار' : 'ملغي'}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 font-mono text-slate-700">
                        {reg.status === 'CONFIRMED' ? `#${reg.seat_number}` : `#${reg.waitlist_position}`}
                      </td>
                      <td className="py-1.5 px-2 text-slate-500 font-mono">{formatDateTime(reg.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Registration Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-3xl shadow-sm border border-slate-200/80 p-6 space-y-6">
          <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
            بيانات المتطوع والتأكيد
          </h3>

          {submitError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-medium p-3.5 rounded-xl leading-relaxed">
              ⚠️ {submitError}
            </div>
          )}

          {/* Mode Toggle */}
          {mode === 'normal' && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
              <p className="text-xs text-amber-800 mb-2">ماعندكش رقم عضوية حالياً؟</p>
              <button
                type="button"
                onClick={() => setMode('temp')}
                className="text-xs font-bold text-amber-700 hover:text-amber-900 underline"
              >
                👉 سجّل مؤقتاً بالاسم والتليفون فقط
              </button>
            </div>
          )}

          {mode === 'temp' && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
              <p className="text-xs text-blue-800 mb-2 font-bold">تسجيل مؤقت (بدون رقم عضوية)</p>
              <p className="text-[11px] text-blue-700 mb-2">سيتم تسجيلك مؤقتاً لحين استلام رقم عضويتك الرسمي</p>
              <button
                type="button"
                onClick={() => setMode('normal')}
                className="text-xs font-bold text-blue-700 hover:text-blue-900 underline"
              >
                رجوع للتسجيل العادي
              </button>
            </div>
          )}

          {/* STEP 1: Volunteer Info */}
          <div className="space-y-4">
            {mode === 'normal' && (
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-bold text-slate-700">رقم العضوية (Member ID)</label>
                  {isLookingUp && <span className="text-[11px] text-slate-400 animate-pulse">جاري البحث...</span>}
                  {memberFound && <span className="text-[11px] font-bold text-emerald-600">بياناتك محفوظة ✓</span>}
                </div>
                <input
                  type="text"
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  placeholder="مثال: 1 أو 102583"
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 transition"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">الاسم الثلاثي / الرباعي</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                readOnly={memberFound}
                placeholder="اكتب اسمك الكامل"
                className={`w-full px-4 py-3 rounded-xl border text-sm font-semibold transition ${
                  memberFound
                    ? 'bg-slate-100 border-slate-200 text-slate-700 cursor-not-allowed'
                    : 'bg-white border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500'
                }`}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                رقم التليفون (إجباري للتواصل وقت المهمة) 📱
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                readOnly={memberFound}
                placeholder="01xxxxxxxxx"
                className={`w-full px-4 py-3 rounded-xl border text-sm font-semibold transition ${
                  memberFound
                    ? 'bg-slate-100 border-slate-200 text-slate-700 cursor-not-allowed'
                    : 'bg-white border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500'
                }`}
                required
              />
              <p className="text-[10px] text-slate-500 mt-1">
                * رقم صحيح من 11 رقم يبدأ بـ 010 / 011 / 012 / 015
              </p>
            </div>
          </div>

          {/* STEP 2: Mandatory Voice Recording (skip for temp mode) */}
          {mode === 'normal' && (
            <div className="pt-2 border-t border-slate-100 space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800">التأكيد الصوتي الإلزامي 🎙️</label>
                <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                  مطلوب
                </span>
              </div>

              {/* Confirmation Phrase Card */}
              <div className="bg-red-50/70 border border-red-200/80 rounded-2xl p-4 text-center">
                <span className="text-[11px] font-semibold text-red-600 block mb-1">
                  اقرأ العبارة التالية بصوت واضح عند التسجيل:
                </span>
                <p className="text-sm font-extrabold text-slate-900">
                  "{mission.confirmation_phrase || `أؤكد مشاركتي في مهمة ${mission.public_code}`}"
                </p>
              </div>

              {micError && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-3 rounded-xl">
                  {micError}
                </div>
              )}

              {/* Recorder Controls */}
              <div className="flex flex-col items-center justify-center p-4 bg-slate-50 rounded-2xl border border-slate-200/70 space-y-3">
                {recordingState === 'idle' && (
                  <button
                    type="button"
                    onClick={startRecording}
                    className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-bold px-6 py-3 rounded-2xl shadow-md transition active:scale-95"
                  >
                    <span className="text-lg">🎙️</span>
                    <span>بدء التسجيل الصوتي</span>
                  </button>
                )}

                {recordingState === 'recording' && (
                  <div className="flex flex-col items-center space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 bg-red-600 rounded-full animate-ping"></span>
                      <span className="font-mono text-base font-bold text-red-600">
                        00:0{Math.floor(recordingTime)} / 00:10
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-6 py-2.5 rounded-2xl shadow transition"
                    >
                      ⏹️ إيقاف وحفظ التسجيل
                    </button>
                  </div>
                )}

                {recordingState === 'recorded' && (
                  <div className="w-full flex flex-col items-center space-y-3">
                    <div className="flex items-center justify-between w-full text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3.5 py-2 rounded-xl">
                      <span>✓ تم تسجيل الصوت بنجاح ({recordingTime.toFixed(1)} ثانية)</span>
                      <button
                        type="button"
                        onClick={resetRecording}
                        className="text-red-600 hover:underline font-bold"
                      >
                        إعادة التسجيل 🔄
                      </button>
                    </div>
                    {audioUrl && (
                      <audio controls src={audioUrl} className="w-full h-10 rounded-lg" />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || (mode === 'normal' && (!audioBlob || recordingTime < 1.5))}
            className={`w-full py-4 px-6 rounded-2xl text-base font-extrabold text-white transition shadow-lg ${
              isSubmitting || (mode === 'normal' && (!audioBlob || recordingTime < 1.5))
                ? 'bg-slate-400 cursor-not-allowed shadow-none'
                : 'bg-red-600 hover:bg-red-700 active:scale-[0.98]'
            }`}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                <span>جاري تأكيد التسجيل...</span>
              </span>
            ) : mode === 'temp' ? (
              'تسجيل مؤقت (بدون تأكيد صوتي) 🚀'
            ) : (
              'تأكيد التسجيل في المهمة 🚀'
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="text-center text-[11px] text-slate-400 py-3">
          جمعية الهلال الأحمر المصري — فرع المنيا &copy; {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}
