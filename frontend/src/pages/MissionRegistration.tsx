import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  HeartPulse,
  MapPin,
  CalendarDays,
  Clock3,
  Mic,
  MicOff,
  Play,
  Circle,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Zap,
  Loader2,
  RefreshCw,
  ChevronLeft,
  UserRound,
  Phone,
  Hash,
  Trash2,
} from 'lucide-react';
import {
  getMission,
  lookupQuickProfile,
  saveQuickProfile,
  submitRegistration,
  submitTemporaryRegistration,
  getMyRegistrations,
  selfCancelRegistration,
  Mission,
  RegistrationResult,
  MyRegistration,
} from '../api/public';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/ui/StatusBadge';
import LoadingState from '@/components/ui/LoadingState';
import ErrorState from '@/components/ui/ErrorState';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';

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
  const { success: toastSuccess, error: toastError } = useToast();

  const [mission, setMission] = useState<Mission | null>(null);
  const [loadingMission, setLoadingMission] = useState(true);
  const [missionError, setMissionError] = useState<string | null>(null);

  const [liveRegistrations, setLiveRegistrations] = useState<LiveVolunteer[]>([]);
  const [mode, setMode] = useState<'normal' | 'temp' | 'quick-save'>('normal');

  const [memberId, setMemberId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [memberFound, setMemberFound] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);

  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'recorded'>('idle');
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [successMode, setSuccessMode] = useState<'result' | 'quick-save' | 'quick-save-success'>('result');
  const [completed, setCompleted] = useState(false);

  // Self-cancel state
  const [myRegistrations, setMyRegistrations] = useState<MyRegistration[]>([]);
  const [cancellingMyRegId, setCancellingMyRegId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  // 1. Fetch Mission Info
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
    const interval = setInterval(() => fetchMissionData(false), 3000);
    return () => clearInterval(interval);
  }, [code]);

  // 1b. Status polling
  const lastStatusRef = useRef<string>('');
  useEffect(() => {
    if (!code) return;
    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/missions/${code}/status`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.success) return;
        const s = data.data;
        const fingerprint = `${s.status}|${s.is_completely_full}|${s.confirmed}|${s.waitlist}|${s.registration_open}`;
        if (fingerprint !== lastStatusRef.current) {
          lastStatusRef.current = fingerprint;
          setMission((prev: any) => prev ? {
            ...prev,
            status: s.status,
            confirmed: s.confirmed,
            waitlist: s.waitlist,
            is_full: s.is_full,
            is_completely_full: s.is_completely_full,
            registration_open: s.registration_open,
          } : prev);
        }
      } catch {}
    };
    pollStatus();
    const interval = setInterval(pollStatus, 1000);
    return () => clearInterval(interval);
  }, [code]);

  // 2. Live registrations polling
  const fetchLiveRegistrations = async () => {
    if (!code) return;
    try {
      const res = await fetch(`/api/missions/${code}/registrations-live`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) setLiveRegistrations(data.data || []);
      }
    } catch {}
  };

  useEffect(() => {
    fetchLiveRegistrations();
    const interval = setInterval(fetchLiveRegistrations, 3000);
    return () => clearInterval(interval);
  }, [code]);

  // 2b. My Registrations polling (ownership-based self-cancel)
  const fetchMyRegistrations = async () => {
    if (!code) return;
    try {
      const regs = await getMyRegistrations(code);
      setMyRegistrations(regs);
    } catch {}
  };

  useEffect(() => {
    fetchMyRegistrations();
    const interval = setInterval(fetchMyRegistrations, 3000);
    return () => clearInterval(interval);
  }, [code]);

  // Self-cancel handler
  const doSelfCancel = async (regId: string) => {
    setCancellingMyRegId(regId);
    try {
      const result = await selfCancelRegistration(regId);
      toastSuccess(result.message || 'تم إلغاء التسجيل بنجاح');
      setConfirmCancelId(null);
      fetchMyRegistrations();
    } catch (err: any) {
      toastError(err.message || 'فشل إلغاء التسجيل');
    } finally {
      setCancellingMyRegId(null);
    }
  };

  // 3. Quick Profile Lookup debounce
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

  // 4. Audio Recording
  const startRecording = async () => {
    setMicError(null);
    setAudioBlob(null);
    if (audioUrl) { URL.revokeObjectURL(audioUrl); setAudioUrl(null); }
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setRecordingState('recorded');
      };
      recorder.start(250);
      setRecordingState('recording');
      setRecordingTime(0);
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        setRecordingTime(elapsed);
        if (elapsed >= 10) stopRecording();
      }, 100);
    } catch (err: any) {
      console.error('Microphone error:', err);
      setMicError('تعذر الوصول للمايكروفون. برجاء السماح بالوصول من إعدادات المتصفح.');
      setRecordingState('idle');
    }
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.stop();
  };

  const resetRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null); setAudioUrl(null); setRecordingState('idle'); setRecordingTime(0); setMicError(null);
  };

  // 5. Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (mode === 'normal' && !memberId.trim()) { setSubmitError('برجاء إدخال رقم العضوية'); return; }
    if (!name.trim()) { setSubmitError('برجاء إدخال الاسم'); return; }
    if (!phone.trim() || !/^01[0125][0-9]{8}$/.test(phone.trim())) { setSubmitError('برجاء إدخال رقم تليفون صحيح (11 رقم يبدأ بـ 01)'); return; }

    if (mode === 'temp') {
      setIsSubmitting(true);
      try {
        const res = await submitTemporaryRegistration({ mission_public_code: mission?.public_code || '', name: name.trim(), phone: phone.trim() });
        setResult(res);
        setSuccessMode('result');
      } catch (err: any) { setSubmitError(err.message || 'حدث خطأ أثناء التسجيل المؤقت'); } finally { setIsSubmitting(false); }
      return;
    }

    if (!audioBlob || recordingTime < 1.5) { setSubmitError('برجاء تسجيل عبارة التأكيد بصوتك لمدة لا تقل عن ثانيتين.'); return; }
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
    } catch (err: any) { setSubmitError(err.message || 'حدث خطأ أثناء إتمام التسجيل.'); } finally { setIsSubmitting(false); }
  };

  // 6. Quick Save
  const handleQuickSave = async () => {
    if (!memberId.trim() || !name.trim() || !phone.trim()) { setSubmitError('برجاء إدخال رقم العضوية والاسم ورقم التليفون'); return; }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await saveQuickProfile({ member_id: memberId.trim(), name: name.trim(), phone: phone.trim() });
      setSuccessMode('quick-save-success');
    } catch (err: any) { setSubmitError(err.message || 'حدث خطأ أثناء حفظ البيانات'); } finally { setIsSubmitting(false); }
  };

  const formatDateTime = (isoStr?: string) => {
    if (!isoStr) return '';
    return new Date(isoStr).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // ===== LOADING =====
  if (loadingMission) {
    return (
      <div className="min-h-dvh bg-slate-50 flex items-center justify-center p-4">
        <LoadingState label="جاري تحميل بيانات المهمة..." />
      </div>
    );
  }

  // ===== ERROR =====
  if (missionError || !mission) {
    return (
      <div className="min-h-dvh bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center">
          <ErrorState
            title="تعذر العثور على المهمة"
            message={missionError || 'رابط المهمة غير صحيح أو انتهت صلاحيته.'}
          />
        </Card>
      </div>
    );
  }

  // ===== CLOSED / FULL =====
  if (!mission.registration_open || mission.status !== 'OPEN') {
    return (
      <div className="min-h-dvh bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center">
          <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-warning-50 text-warning-600 mx-auto mb-4">
            <Lock className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 mb-2">
            {mission.is_completely_full ? 'لقد اكتملت هذه المهمة' : 'تم إغلاق التسجيل'}
          </h2>
          <p className="text-sm text-slate-500 mb-4">
            {mission.is_completely_full
              ? `تم استكمال العدد المطلوب: ${mission.confirmed} مؤكّد${mission.waitlist ? ` + ${mission.waitlist} انتظار` : ''}`
              : mission.is_full
                ? 'تم استكمال العدد الأساسي.'
                : 'تم إغلاق باب التسجيل لهذه المهمة.'}
          </p>

          <div className="pt-4 border-t border-slate-100">
            <button
              onClick={() => setMode('quick-save')}
              className="text-sm text-brand-600 hover:text-brand-700 font-bold underline"
            >
              هل أنت مسجل من قبل؟ احفظ بياناتك للمرة القادمة
            </button>
          </div>

          {mode === 'quick-save' && (
            <div className="mt-5 p-4 bg-brand-50 rounded-xl border border-brand-200 text-right">
              <h3 className="text-sm font-bold text-slate-800 mb-3">احفظ بياناتك للتسجيل السريع</h3>
              <div className="space-y-3">
                <Input type="text" value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder="رقم العضوية" icon={<Hash className="h-4 w-4" />} />
                <Input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم الكامل" icon={<UserRound className="h-4 w-4" />} />
                <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="رقم التليفون (01xxxxxxxxx)" icon={<Phone className="h-4 w-4" />} />
                {submitError && <p className="text-xs text-danger-600 font-medium">{submitError}</p>}
                <Button fullWidth loading={isSubmitting} onClick={handleQuickSave}>حفظ بياناتي</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    );
  }

  // ===== SUCCESS RESULT =====
  if (result && successMode === 'result') {
    const isConfirmed = result.status === 'CONFIRMED';
    return (
      <div className="min-h-dvh bg-slate-100 py-8 px-4 flex items-center justify-center">
        <Card className="max-w-md w-full overflow-hidden !p-0">
          <div className={cn('p-6 text-center text-white', isConfirmed ? 'bg-success-600' : 'bg-warning-600')}>
            <div className="w-16 h-16 bg-white/20 backdrop-blur rounded-full flex items-center justify-center mx-auto mb-3">
              {isConfirmed ? <CheckCircle2 className="h-8 w-8" /> : <Clock3 className="h-8 w-8" />}
            </div>
            <h1 className="text-xl font-extrabold mb-1">
              {isConfirmed ? 'تم تأكيد تسجيلك بنجاح!' : 'تمت إضافتك لقائمة الانتظار'}
            </h1>
            <p className="text-white/90 text-sm font-medium">الهلال الأحمر المصري — فرع المنيا</p>
          </div>

          <div className="p-6 space-y-5">
            <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 text-center">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                {isConfirmed ? 'رقم المقعد المخصص' : 'موقعك في قائمة الانتظار'}
              </span>
              <div className="text-4xl font-extrabold text-slate-900 mb-2">
                {isConfirmed ? `#${result.seat_number}` : `#${result.waitlist_position}`}
              </div>
              <Badge variant="neutral" className="font-mono">كود التسجيل: {result.registration_id}</Badge>
            </div>

            <div className="space-y-2 text-sm">
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
              <div className="flex justify-between py-2">
                <span className="text-slate-500">كود المهمة:</span>
                <Badge variant="brand" className="font-mono">{mission.public_code}</Badge>
              </div>
            </div>

            <div className={cn('rounded-xl p-4 text-xs leading-relaxed', isConfirmed ? 'bg-brand-50 text-brand-800 border border-brand-200' : 'bg-info-50 text-info-800 border border-info-200')}>
              {isConfirmed
                ? 'برجاء الالتزام بالموعد المحدد والحضور بالزي الرسمي للهلال الأحمر. في حال الاعتذار برجاء إبلاغ المشرف مسبقاً.'
                : 'في حال اعتذار أي متطوع مسجل، سيتم ترقيتك تلقائياً وبترتيب الأسبقية المسجل.'}
            </div>

            <div className="space-y-2">
              <Button fullWidth onClick={() => {
                setResult(null); setSuccessMode('result'); setMemberId(''); setName(''); setPhone('');
                setAudioBlob(null); setAudioUrl(null); setRecordingState('idle'); setMode('normal');
              }}>
                تسجيل لمتطوع آخر
              </Button>
              <Button fullWidth variant="secondary" onClick={() => setSuccessMode('quick-save')}>
                <Zap className="h-4 w-4" />
                سجّل المرة الجاية بطريقة أسرع
              </Button>
              <Button fullWidth variant="ghost" onClick={() => setCompleted(true)}>
                تم
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // ===== QUICK SAVE PROFILE SCREEN =====
  if (successMode === 'quick-save') {
    return (
      <div className="min-h-dvh bg-slate-100 py-8 px-4 flex items-center justify-center">
        <Card className="max-w-md w-full">
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-brand-50 text-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Zap className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-extrabold text-slate-900 mb-1">سجّل المرة الجاية بسرعة!</h2>
            <p className="text-sm text-slate-500">احفظ بياناتك الآن، وفي المرة القادمة اكتب رقم عضويتك فقط</p>
          </div>

          <div className="space-y-4">
            <Input label="رقم العضوية" type="text" value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder="مثال: 1025" icon={<Hash className="h-4 w-4" />} />
            <Input label="الاسم الكامل" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم الثلاثي أو الرباعي" icon={<UserRound className="h-4 w-4" />} />
            <Input label="رقم التليفون" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" icon={<Phone className="h-4 w-4" />} />
            {submitError && <div className="bg-danger-50 border border-danger-200 text-danger-700 text-xs font-medium p-3 rounded-xl">{submitError}</div>}
            <Button fullWidth loading={isSubmitting} onClick={handleQuickSave}>
              <CheckCircle2 className="h-4 w-4" />
              حفظ بياناتي
            </Button>
            <Button fullWidth variant="ghost" onClick={() => { setSuccessMode('result'); setMode('normal'); }}>
              <ChevronLeft className="h-4 w-4" />
              رجوع
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ===== QUICK SAVE SUCCESS =====
  if (successMode === 'quick-save-success') {
    return (
      <div className="min-h-dvh bg-slate-100 py-8 px-4 flex items-center justify-center">
        <Card className="max-w-md w-full text-center">
          <div className="w-16 h-16 bg-success-50 text-success-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 mb-2">تم حفظ بياناتك بنجاح!</h2>
          <p className="text-sm text-slate-500 mb-5 leading-relaxed">
            في المرة القادمة، اكتب رقم عضويتك <b className="text-success-600">"{memberId}"</b> فقط وهنملى بياناتك تلقائياً
          </p>
          <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 mb-5 text-xs text-brand-800 text-right">
            <p className="font-bold mb-1">البيانات المحفوظة:</p>
            <p>رقم العضوية: <span className="font-mono font-bold">{memberId}</span></p>
            <p>الاسم: <b>{name}</b></p>
            <p>التليفون: <span className="font-mono font-bold">{phone}</span></p>
          </div>
          <Button fullWidth onClick={() => setCompleted(true)}>
            تم
          </Button>
        </Card>
      </div>
    );
  }

  // ===== COMPLETED / THANK YOU =====
  if (completed) {
    return (
      <div className="min-h-dvh bg-slate-100 py-8 px-4 flex items-center justify-center">
        <Card className="max-w-md w-full text-center">
          <div className="w-16 h-16 bg-success-50 text-success-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <HeartPulse className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 mb-2">شكراً لتسجيلك</h2>
          <p className="text-sm text-slate-500 mb-4 leading-relaxed">
            تم تسجيلك بنجاح في المهمة. يمكنك إغلاق هذه الصفحة الآن.
          </p>
          <div className="bg-info-50 border border-info-200 rounded-xl p-4 text-xs text-info-800 text-right">
            يمكنك إغلاق التبويب أو العودة للصفحة السابقة.
          </div>
        </Card>
      </div>
    );
  }

  // ===== MAIN REGISTRATION FORM =====
  return (
    <div className="min-h-dvh bg-slate-50 py-6 px-4">
      <div className="max-w-lg mx-auto space-y-4">
        {/* Brand Header */}
        <div className="bg-white rounded-2xl shadow-soft border border-slate-200/70 p-5 text-center">
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <span className="flex items-center justify-center h-9 w-9 rounded-xl bg-brand-600 text-white shadow-sm shadow-brand-600/30" aria-hidden="true">
              <HeartPulse className="h-5 w-5" />
            </span>
            <h2 className="text-base font-bold text-slate-900">الهلال الأحمر المصري — فرع المنيا</h2>
          </div>
          <p className="text-xs text-slate-500 font-medium">نظام التسجيل الذكي للمهمات والقوافل</p>
        </div>

        {/* Mission Card */}
        <Card>
          <div className="flex items-center justify-between gap-2 mb-3">
            <Badge variant="brand" className="font-mono">{mission.public_code}</Badge>
            <div className="flex items-center gap-1.5">
              <Circle className={cn('h-2.5 w-2.5 fill-current', mission.available > 0 ? 'text-success-500' : 'text-warning-500')} />
              <span className="text-xs font-semibold text-slate-600">
                {mission.available > 0 ? `${mission.available} مكان متاح من ${mission.capacity}` : 'المقاعد مكتملة (انتظار)'}
              </span>
            </div>
          </div>
          <h1 className="text-lg font-extrabold text-slate-900 mb-2">{mission.title}</h1>
          {mission.description && <p className="text-sm text-slate-600 leading-relaxed mb-4">{mission.description}</p>}
          <div className="bg-slate-50 rounded-xl p-3.5 space-y-2 text-xs text-slate-700 border border-slate-200/60">
            {mission.location && (
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span>{mission.location}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <CalendarDays className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span>{formatDateTime(mission.start_at)}</span>
            </div>
          </div>
        </Card>

        {/* LIVE REGISTRATIONS TABLE */}
        {liveRegistrations.length > 0 && (
          <Card padding={false}>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Circle className="h-2 w-2 fill-success-500 text-success-500 animate-pulse" />
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
                    <th className="py-2 px-2">الوقت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {liveRegistrations.map((reg, idx) => (
                    <tr key={reg.id} className={idx === 0 ? 'bg-success-50/50' : ''}>
                      <td className="py-1.5 px-2 font-mono font-bold text-slate-400">{idx + 1}</td>
                      <td className="py-1.5 px-2 font-bold text-slate-900">{reg.name}</td>
                      <td className="py-1.5 px-2 font-mono text-slate-700">{reg.member_id}</td>
                      <td className="py-1.5 px-2">
                        <StatusBadge status={reg.status} className="!text-[10px] !px-1.5 !py-0.5" />
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
          </Card>
        )}

        {/* ========== MY REGISTRATIONS (Self-Cancel) ========== */}
        {myRegistrations.length > 0 && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <UserRound className="h-4 w-4 text-brand-600" />
              <h3 className="text-base font-bold text-slate-900">تسجيلاتك</h3>
              <span className="text-xs text-slate-400 font-medium">({myRegistrations.length})</span>
            </div>
            <div className="space-y-3">
              {myRegistrations.map((reg) => {
                const isActive = reg.status === 'CONFIRMED' || reg.status === 'WAITLIST';
                const isCancelled = reg.status === 'CANCELLED';
                const isCancelling = cancellingMyRegId === reg.id;
                const showConfirm = confirmCancelId === reg.id;
                return (
                  <div
                    key={reg.id}
                    className={cn(
                      'rounded-xl border p-4 transition-colors',
                      isCancelled ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-white border-slate-200'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-bold text-slate-900">{reg.name}</span>
                          <StatusBadge status={reg.status} className="!text-[10px] !px-1.5 !py-0.5" />
                        </div>
                        <div className="text-xs text-slate-500 space-y-0.5">
                          {reg.member_id && <p>رقم العضوية: <span className="font-mono font-bold">{reg.member_id}</span></p>}
                          {reg.status === 'CONFIRMED' && reg.seat_number && <p>رقم المقعد: <span className="font-mono font-bold text-success-600">#{reg.seat_number}</span></p>}
                          {reg.status === 'WAITLIST' && reg.waitlist_position && <p>موقع في الانتظار: <span className="font-mono font-bold text-warning-600">#{reg.waitlist_position}</span></p>}
                          <p>تاريخ التسجيل: <span className="font-mono">{new Date(reg.created_at).toLocaleString('ar-EG')}</span></p>
                        </div>
                      </div>
                      {isActive && !showConfirm && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmCancelId(reg.id)}
                          className="text-danger-600 hover:text-danger-700 hover:bg-danger-50 shrink-0"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="text-xs">إلغاء</span>
                        </Button>
                      )}
                      {isActive && showConfirm && (
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            variant="danger"
                            size="sm"
                            loading={isCancelling}
                            onClick={() => doSelfCancel(reg.id)}
                          >
                            تأكيد الإلغاء
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmCancelId(null)}
                            disabled={isCancelling}
                          >
                            لا
                          </Button>
                        </div>
                      )}
                      {isCancelled && (
                        <span className="text-xs text-slate-400 font-medium">ملغى</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Registration Form */}
        <Card>
          <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3 mb-4">
            بيانات المتطوع والتأكيد
          </h3>

          {submitError && (
            <div className="bg-danger-50 border border-danger-200 text-danger-700 text-xs font-medium p-3.5 rounded-xl mb-4 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Mode Toggle */}
          {mode === 'normal' && (
            <div className="bg-warning-50 border border-warning-200 rounded-xl p-3 text-center mb-4">
              <p className="text-xs text-warning-800 mb-1">ماعندكش رقم عضوية حالياً؟</p>
              <button type="button" onClick={() => setMode('temp')} className="text-xs font-bold text-warning-700 hover:text-warning-900 underline">
                سجّل مؤقتاً بالاسم والتليفون فقط
              </button>
            </div>
          )}

          {mode === 'temp' && (
            <div className="bg-brand-50 border border-brand-200 rounded-xl p-3 text-center mb-4">
              <p className="text-xs text-brand-800 mb-1 font-bold">تسجيل مؤقت (بدون رقم عضوية)</p>
              <p className="text-[11px] text-brand-700 mb-1">سيتم تسجيلك مؤقتاً لحين استلام رقم عضويتك الرسمي</p>
              <button type="button" onClick={() => setMode('normal')} className="text-xs font-bold text-brand-700 hover:text-brand-900 underline">رجوع للتسجيل العادي</button>
            </div>
          )}

          {/* Form fields */}
          <div className="space-y-4">
            {mode === 'normal' && (
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-bold text-slate-700">رقم العضوية (Member ID)</label>
                  {isLookingUp && <span className="text-[11px] text-slate-400 animate-pulse flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> جاري البحث...</span>}
                  {memberFound && <span className="text-[11px] font-bold text-success-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> بياناتك محفوظة</span>}
                </div>
                <Input
                  type="text"
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  placeholder="مثال: 1 أو 102583"
                  icon={<Hash className="h-4 w-4" />}
                  required
                />
              </div>
            )}

            <Input
              label="الاسم الثلاثي / الرباعي"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              readOnly={memberFound}
              placeholder="اكتب اسمك الكامل"
              icon={<UserRound className="h-4 w-4" />}
              className={memberFound ? '[&_input]:bg-slate-100 [&_input]:border-slate-200 [&_input]:text-slate-700 [&_input]:cursor-not-allowed' : ''}
              required
            />

            <div>
              <Input
                label="رقم التليفون (إجباري للتواصل وقت المهمة)"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                readOnly={memberFound}
                placeholder="01xxxxxxxxx"
                icon={<Phone className="h-4 w-4" />}
                className={memberFound ? '[&_input]:bg-slate-100 [&_input]:border-slate-200 [&_input]:text-slate-700 [&_input]:cursor-not-allowed' : ''}
                required
              />
              <p className="text-[10px] text-slate-500 mt-1">رقم صحيح من 11 رقم يبدأ بـ 010 / 011 / 012 / 015</p>
            </div>
          </div>

          {/* Voice Recording */}
          {mode === 'normal' && (
            <div className="pt-4 border-t border-slate-100 space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Mic className="h-3.5 w-3.5" />
                  التأكيد الصوتي الإلزامي
                </label>
                <Badge variant="danger" className="!text-[10px]">مطلوب</Badge>
              </div>

              <div className="bg-brand-50/70 border border-brand-200/80 rounded-xl p-4 text-center">
                <span className="text-[11px] font-semibold text-brand-600 block mb-1">اقرأ العبارة التالية بصوت واضح عند التسجيل:</span>
                <p className="text-sm font-extrabold text-slate-900">
                  "{mission.confirmation_phrase || `أؤكد مشاركتي في مهمة ${mission.public_code}`}"
                </p>
              </div>

              {micError && (
                <div className="bg-warning-50 border border-warning-200 text-warning-800 text-xs p-3 rounded-xl flex items-start gap-2">
                  <MicOff className="h-4 w-4 shrink-0 mt-0.5" />
                  {micError}
                </div>
              )}

              <div className="flex flex-col items-center justify-center p-4 bg-slate-50 rounded-xl border border-slate-200/70 space-y-3">
                {recordingState === 'idle' && (
                  <Button onClick={startRecording} variant="primary">
                    <Mic className="h-4 w-4" />
                    بدء التسجيل الصوتي
                  </Button>
                )}

                {recordingState === 'recording' && (
                  <div className="flex flex-col items-center space-y-3">
                    <div className="flex items-center gap-2">
                      <Circle className="h-3.5 w-3.5 text-danger-600 fill-danger-600 animate-pulse" />
                      <span className="font-mono text-base font-bold text-danger-600">
                        00:{String(Math.floor(recordingTime)).padStart(2, '0')} / 00:10
                      </span>
                    </div>
                    <Button variant="danger" onClick={stopRecording}>
                      <Circle className="h-4 w-4" />
                      إيقاف وحفظ التسجيل
                    </Button>
                  </div>
                )}

                {recordingState === 'recorded' && (
                  <div className="w-full flex flex-col items-center space-y-3">
                    <div className="flex items-center justify-between w-full text-xs font-bold text-success-700 bg-success-50 border border-success-200 px-3.5 py-2 rounded-xl">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4" />
                        تم تسجيل الصوت بنجاح ({recordingTime.toFixed(1)} ثانية)
                      </span>
                      <button type="button" onClick={resetRecording} className="text-danger-600 hover:underline font-bold flex items-center gap-1">
                        <RefreshCw className="h-3 w-3" />
                        إعادة التسجيل
                      </button>
                    </div>
                    {audioUrl && <audio controls src={audioUrl} className="w-full h-10 rounded-lg" />}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Submit Button */}
          <div className="pt-4">
            <Button
              fullWidth
              size="lg"
              type="submit"
              loading={isSubmitting}
              disabled={!isSubmitting && (mode === 'normal' && (!audioBlob || recordingTime < 1.5))}
              onClick={handleSubmit}
              className="!text-base !font-extrabold"
            >
              {isSubmitting ? 'جاري تأكيد التسجيل...' : mode === 'temp' ? 'تسجيل مؤقت (بدون تأكيد صوتي)' : 'تأكيد التسجيل في المهمة'}
            </Button>
          </div>
        </Card>

        {/* Footer */}
        <div className="text-center text-[11px] text-slate-400 py-3">
          جمعية الهلال الأحمر المصري — فرع المنيا © {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}

export default MissionRegistration;