import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getMission, lookupMemberId, submitRegistration, Mission, RegistrationResult } from '../api/public';

export function MissionRegistration() {
  const { code } = useParams<{ code: string }>();

  const [mission, setMission] = useState<Mission | null>(null);
  const [loadingMission, setLoadingMission] = useState(true);
  const [missionError, setMissionError] = useState<string | null>(null);

  // Form fields
  const [memberId, setMemberId] = useState('');
  const [name, setName] = useState('');
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

  // 2. Member ID Lookup debounce
  useEffect(() => {
    const trimmed = memberId.trim();
    if (trimmed.length < 2) {
      setMemberFound(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLookingUp(true);
      try {
        const res = await lookupMemberId(trimmed);
        if (res.found && res.name) {
          setName(res.name);
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
  }, [memberId]);

  // 3. Audio Recording Handling
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
      const options = { mimeType: 'audio/webm' };
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

  // 4. Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!memberId.trim()) {
      setSubmitError('برجاء إدخال رقم العضوية');
      return;
    }
    if (!name.trim()) {
      setSubmitError('برجاء إدخال الاسم');
      return;
    }
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
      formData.append('phrase', mission?.confirmation_phrase || '');
      formData.append('duration_ms', Math.round(recordingTime * 1000).toString());
      formData.append('audio', audioBlob, `recording_${memberId.trim()}.webm`);

      const res = await submitRegistration(formData);
      setResult(res);
    } catch (err: any) {
      setSubmitError(err.message || 'حدث خطأ أثناء إتمام التسجيل. برجاء المحاولة مجدداً.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Format Dates
  const formatDateTime = (isoStr?: string) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleString('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
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
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center border border-red-100">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
            ⚠️
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">تعذر العثور على المهمة</h2>
          <p className="text-slate-600 mb-6">{missionError || 'رابط المهمة غير صحيح أو انتهت صلاحيته.'}</p>
          <Link to="/" className="inline-block bg-slate-800 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-slate-900 transition">
            العودة للرئيسية
          </Link>
        </div>
      </div>
    );
  }

  // SUCCESS RESULT SCREEN
  if (result) {
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
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-500">رقم العضوية:</span>
                <span className="font-mono font-bold text-slate-800">{result.member_id}</span>
              </div>
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

            <button
              onClick={() => window.location.reload()}
              className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 px-6 rounded-2xl transition shadow-md"
            >
              تم
            </button>
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

          {/* STEP 1: Volunteer Info */}
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-bold text-slate-700">رقم العضوية (Member ID)</label>
                {isLookingUp && <span className="text-[11px] text-slate-400 animate-pulse">جاري البحث...</span>}
                {memberFound && <span className="text-[11px] font-bold text-emerald-600">عضو مسجل ✓</span>}
              </div>
              <input
                type="text"
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                placeholder="مثال: 102583"
                className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 transition"
                required
              />
            </div>

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
          </div>

          {/* STEP 2: Mandatory Voice Recording */}
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

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || !audioBlob || recordingTime < 1.5}
            className={`w-full py-4 px-6 rounded-2xl text-base font-extrabold text-white transition shadow-lg ${
              isSubmitting || !audioBlob || recordingTime < 1.5
                ? 'bg-slate-400 cursor-not-allowed shadow-none'
                : 'bg-red-600 hover:bg-red-700 active:scale-[0.98]'
            }`}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                <span>جاري تأكيد التسجيل...</span>
              </span>
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
