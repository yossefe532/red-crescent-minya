import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Undo2,
  Wifi,
  WifiOff,
  Activity,
  User,
} from 'lucide-react';
import {
  getMission,
  lookupQuickProfile,
  saveQuickProfile,
  submitRegistration,
  submitTemporaryRegistration,
  selfCancelRegistration,
  selfRestoreRegistration,
  Mission,
  RegistrationResult,
  LiveRosterEntry,
  LiveMyRegistration,
} from '../api/public';
import { useLiveMission, ConnectionState } from '../hooks/useLiveMission';
import { useLiveChanges } from '../hooks/useLiveChanges';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/ui/StatusBadge';
import LoadingState from '@/components/ui/LoadingState';
import ErrorState from '@/components/ui/ErrorState';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';
import { formatEgyptTime, formatEgyptDateTime, formatEgyptTimePrecise, isRecent } from '@/lib/timezone';

export function MissionRegistration() {
  const { code } = useParams<{ code: string }>();
  const { success: toastSuccess, error: toastError, live: toastLive } = useToast();

  // ── Phase 6: Unified live hook replaces 4 separate polling mechanisms ──
  const {
    mission: liveMission,
    registrations: liveRegistrations,
    myRegistrations: liveMyRegistrations,
    version: liveVersion,
    connectionState,
    refresh: refreshLive,
  } = useLiveMission(code || '');

  // ── Phase 7: Change detection + live notifications ──
  const [countPulseKey, setCountPulseKey] = useState(0);

  const handleRegistered = useCallback(
    (evt: { name: string }) => {
      toastLive(`${evt.name} انضم إلى المهمة الآن`);
    },
    [toastLive]
  );

  const handleCancelled = useCallback(
    (evt: { name: string }) => {
      toastLive(`${evt.name} ألغى تسجيله`);
    },
    [toastLive]
  );

  const handlePromoted = useCallback(
    (evt: { name: string }) => {
      toastLive(`تم ترقية ${evt.name} من قائمة الانتظار`);
    },
    [toastLive]
  );

  const handleMissionFull = useCallback(() => {
    toastLive('اكتمل العدد — المهمة مكتملة');
  }, [toastLive]);

  const { newEntryIds, recentEvents } = useLiveChanges({
    registrations: liveRegistrations,
    mission: liveMission,
    version: liveVersion,
    onRegistered: handleRegistered,
    onCancelled: handleCancelled,
    onPromoted: handlePromoted,
    onMissionFull: handleMissionFull,
  });

  // Count pulse animation — trigger when confirmed count changes
  const prevConfirmedRef = useRef(liveMission?.confirmed);
  useEffect(() => {
    if (liveMission && prevConfirmedRef.current !== undefined && liveMission.confirmed !== prevConfirmedRef.current) {
      setCountPulseKey((k) => k + 1);
    }
    prevConfirmedRef.current = liveMission?.confirmed;
  }, [liveMission?.confirmed]);

  // Local mission state for initial load + error handling
  const [loadingMission, setLoadingMission] = useState(true);
  const [missionError, setMissionError] = useState<string | null>(null);
  const [initialMission, setInitialMission] = useState<Mission | null>(null);

  // Use live mission data when available, fall back to initial
  const mission = liveMission || initialMission;

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

  // ── Self-cancel state ──
  const [cancellingMyRegId, setCancellingMyRegId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  // ── Self-restore state ──
  const [restoringMyRegId, setRestoringMyRegId] = useState<string | null>(null);

  const [mode, setMode] = useState<'normal' | 'temp' | 'quick-save'>('normal');

  // ── Requirements & Questions state ──
  const [requirementAccepted, setRequirementAccepted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // 1. Initial mission fetch (for loading/error states)
  useEffect(() => {
    if (!code) return;
    const fetchInitial = async () => {
      try {
        const data = await getMission(code);
        setInitialMission(data);
        setLoadingMission(false);
      } catch (err: any) {
        setMissionError(err.message || 'المهمة غير موجودة أو تم إلغاؤها');
        setLoadingMission(false);
      }
    };
    fetchInitial();
  }, [code]);

  // Self-cancel handler (uses hook's refresh to update live data)
  const doSelfCancel = async (regId: string) => {
    setCancellingMyRegId(regId);
    try {
      const result = await selfCancelRegistration(regId);
      toastSuccess(result.message || 'تم إلغاء التسجيل بنجاح');
      setConfirmCancelId(null);
      refreshLive(); // Force immediate refresh after cancellation
    } catch (err: any) {
      toastError(err.message || 'فشل إلغاء التسجيل');
    } finally {
      setCancellingMyRegId(null);
    }
  };

  // Self-restore handler (undo cancellation)
  const doSelfRestore = async (regId: string) => {
    setRestoringMyRegId(regId);
    try {
      const result = await selfRestoreRegistration(regId);
      toastSuccess(result.message || 'تم استعادة التسجيل بنجاح');
      refreshLive(); // Force immediate refresh after restore
    } catch (err: any) {
      toastError(err.message || 'فشل استعادة التسجيل');
    } finally {
      setRestoringMyRegId(null);
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

    // ── Step 7: Validate requirements acceptance ──
    const reqs = mission?.requirements || [];
    const hasRequiredReq = reqs.some((r) => r.requires_acceptance === 1);
    if (hasRequiredReq && !requirementAccepted) {
      setSubmitError('يجب الموافقة على شروط المهمة لإتمام التسجيل');
      return;
    }

    // ── Step 8: Validate required questions ──
    const questions = mission?.questions || [];
    for (const q of questions) {
      if (q.required === 1) {
        const val = answers[q.id] || '';
        if (!val.trim()) {
          setSubmitError(`السؤال "${q.question_text}" إجابة مطلوبة`);
          return;
        }
      }
    }

    if (mode === 'temp') {
      setIsSubmitting(true);
      try {
        const res = await submitTemporaryRegistration({ mission_public_code: mission?.public_code || '', name: name.trim(), phone: phone.trim() });
        setResult(res);
        setSuccessMode('result');
        refreshLive(); // Force immediate refresh after registration
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
      // ── Step 7-8: Submit requirements acceptance + answers ──
      formData.append('requirement_accepted', requirementAccepted ? 'true' : 'false');
      const answersPayload = Object.entries(answers)
        .filter(([_, v]) => v && v.trim())
        .map(([question_id, answer_text]) => ({ question_id, answer_text }));
      if (answersPayload.length > 0) {
        formData.append('answers', JSON.stringify(answersPayload));
      }
      const res = await submitRegistration(formData);
      setResult(res);
      setSuccessMode('result');
      refreshLive(); // Force immediate refresh after registration
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
    // Canonical UTC → Africa/Cairo display. Handles ISO and legacy SQL-UTC strings.
    // Precise variant: always HH:mm:ss.SSS so the exact registration instant is visible.
    return formatEgyptTimePrecise(isoStr);
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

          {/* Roster remains visible even when full — Phase 6 spec #7 */}
          {liveRegistrations.length > 0 && (
            <div className="mt-4 text-right">
              <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5 justify-center">
                <Circle className="h-1.5 w-1.5 fill-success-500 text-success-500 animate-pulse" />
                المسجلون ({liveRegistrations.length})
              </h4>
              <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50">
                {liveRegistrations.map((reg, idx) => (
                  <div key={reg.id} className={cn('roster-row flex items-center gap-2 px-3 py-2 border-b border-slate-100 last:border-b-0 text-right')}>
                    <span className="text-[10px] font-mono font-bold text-slate-400 w-5 text-center shrink-0">{idx + 1}</span>
                    <span className="text-xs font-bold text-slate-800 flex-1 truncate">{reg.name}</span>
                    {reg.member_id && (
                      <span className="text-[10px] font-mono text-slate-500 shrink-0">#{reg.member_id}</span>
                    )}
                    <span className="text-[10px] font-mono tabular-nums text-slate-500 shrink-0 dir-ltr" dir="ltr">{formatEgyptTimePrecise(reg.created_at)}</span>
                    <StatusBadge status={reg.status} className="!text-[9px] !px-1 !py-0 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* My registrations remain visible for self-cancel */}
          {liveMyRegistrations.length > 0 && (
            <div className="mt-4 text-right">
              <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5 justify-center">
                <UserRound className="h-3 w-3 text-brand-600" />
                تسجيلاتك
              </h4>
              {liveMyRegistrations.filter(r => r.status !== 'CANCELLED').map((reg) => (
                <div key={reg.id} className="flex items-center justify-between gap-2 bg-white rounded-xl border border-slate-200 p-3 mb-2">
                  <div className="flex-1 text-right">
                    <StatusBadge status={reg.status} className="!text-[10px] !px-1.5 !py-0.5" />
                    {reg.status === 'CONFIRMED' && reg.seat_number && (
                      <span className="text-[10px] text-success-600 font-mono mr-2">#{reg.seat_number}</span>
                    )}
                    {reg.status === 'WAITLIST' && reg.waitlist_position && (
                      <span className="text-[10px] text-warning-600 font-mono mr-2">#{reg.waitlist_position}</span>
                    )}
                  </div>
                  {(reg.status === 'CONFIRMED' || reg.status === 'WAITLIST') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmCancelId(reg.id)}
                      className="text-danger-600 hover:text-danger-700 hover:bg-danger-50 shrink-0"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span className="text-[10px]">إلغاء</span>
                    </Button>
                  )}
                  {confirmCancelId === reg.id && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="danger" size="sm" loading={cancellingMyRegId === reg.id} onClick={() => doSelfCancel(reg.id)}>تأكيد</Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmCancelId(null)}>لا</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="pt-4 border-t border-slate-100 mt-4">
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
                setRequirementAccepted(false); setAnswers({});
              }}>
                تسجيل لمتطوع آخر
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
              <span key={countPulseKey} className={cn('text-xs font-semibold text-slate-600', countPulseKey > 0 && 'count-pulse')}>
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

        {/* LIVE REGISTRATIONS TABLE — Phase 6 Roster */}
        {liveRegistrations.length > 0 && (
          <Card padding={false}>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Circle className="h-2 w-2 fill-success-500 text-success-500 animate-pulse" />
                المسجلون
                <span key={countPulseKey} className={cn('text-xs font-normal text-slate-400', countPulseKey > 0 && 'count-pulse')}>({liveRegistrations.length})</span>
              </h3>
              <div className="flex items-center gap-2">
                {/* Connection state indicator */}
                {connectionState === 'reconnecting' && (
                  <span className="text-[10px] text-warning-600 font-medium flex items-center gap-1 animate-pulse">
                    <WifiOff className="h-3 w-3" />
                    جاري إعادة الاتصال...
                  </span>
                )}
                {connectionState === 'connected' && (
                  <span className="text-[10px] text-success-600 font-medium flex items-center gap-1">
                    <Wifi className="h-3 w-3" />
                    مباشر
                  </span>
                )}
              </div>
            </div>
            {/* Latest registration metadata — automatically updated from live data, no extra API call */}
            {liveRegistrations.length > 0 && (
              <p className="text-[11px] text-slate-400 mb-2 px-1 flex items-center gap-1.5">
                <Clock3 className="h-3 w-3" />
                آخر تسجيل: {liveRegistrations[0].name} — {formatDateTime(liveRegistrations[0].created_at)}
              </p>
            )}
            {/* ── Phase 7: Live Activity Strip ── */}
            {recentEvents.length > 0 && (
              <div className="px-4 py-2.5 border-b border-slate-100 bg-brand-50/30">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Activity className="h-3 w-3 text-brand-500" />
                  <span className="text-[10px] font-bold text-brand-700">آخر التسجيلات الآن</span>
                </div>
                <div className="space-y-1">
                  {recentEvents.slice(0, 3).map((evt, i) => (
                    <div key={`${evt.registrationId}-${evt.timestamp}`} className="flex items-center gap-2 text-[10px]">
                      <span className={cn(
                        'h-1.5 w-1.5 rounded-full shrink-0',
                        evt.type === 'registered' && 'bg-success-500',
                        evt.type === 'cancelled' && 'bg-danger-400',
                        evt.type === 'promoted' && 'bg-warning-500',
                      )} />
                      <span className="text-slate-600 font-medium">
                        {evt.type === 'registered' && `${evt.name} — الآن`}
                        {evt.type === 'cancelled' && `${evt.name} — ألغى`}
                        {evt.type === 'promoted' && `${evt.name} — تمت الترقية`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto max-h-64 overflow-y-auto">
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
                    <tr key={reg.id} className={cn(newEntryIds.has(reg.id) ? 'roster-row-new' : 'roster-row', idx === 0 && 'bg-success-50/50')}>
                      <td className="py-1.5 px-2 font-mono font-bold text-slate-400">{idx + 1}</td>
                      <td className="py-1.5 px-2 font-bold text-slate-900">{reg.name}</td>
                      <td className="py-1.5 px-2 font-mono text-slate-700">{reg.member_id}</td>
                      <td className="py-1.5 px-2">
                        <StatusBadge status={reg.status} className="!text-[10px] !px-1.5 !py-0.5" />
                      </td>
                      <td className="py-1.5 px-2 font-mono text-slate-700">
                        {reg.status === 'CONFIRMED' ? `#${reg.seat_number}` : `#${reg.waitlist_position}`}
                      </td>
                      <td className="py-1.5 px-2 font-mono text-slate-500">
                        {newEntryIds.has(reg.id) ? <span className="live-now">الآن</span> : isRecent(reg.created_at) ? <span className="live-now">الآن</span> : formatDateTime(reg.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile compact list */}
            <div className="sm:hidden max-h-64 overflow-y-auto">
              {liveRegistrations.map((reg, idx) => (
                <div key={reg.id} className={cn(newEntryIds.has(reg.id) ? 'roster-row-new' : 'roster-row', 'flex items-center gap-3 px-4 py-2.5 border-b border-slate-50 last:border-b-0', idx === 0 && 'bg-success-50/30')}>
                  <span className="text-xs font-mono font-bold text-slate-400 w-6 text-center shrink-0">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">{reg.name}</p>
                    <p className="text-[10px] text-slate-500">
                      {reg.member_id && <span className="font-mono">{reg.member_id}</span>}
                      {reg.status === 'CONFIRMED' && reg.seat_number && <span className="font-mono text-success-600"> • #{reg.seat_number}</span>}
                      {reg.status === 'WAITLIST' && reg.waitlist_position && <span className="font-mono text-warning-600"> • #{reg.waitlist_position}</span>}
                      <span className="font-mono text-slate-400"> • {newEntryIds.has(reg.id) || isRecent(reg.created_at) ? <span className="live-now">الآن</span> : formatDateTime(reg.created_at)}</span>
                    </p>
                  </div>
                  <StatusBadge status={reg.status} className="!text-[9px] !px-1 !py-0 shrink-0" />
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ========== MY REGISTRATIONS (Self-Cancel) ========== */}
        {liveMyRegistrations.length > 0 && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <UserRound className="h-4 w-4 text-brand-600" />
              <h3 className="text-base font-bold text-slate-900">تسجيلاتك</h3>
              <span className="text-xs text-slate-400 font-medium">({liveMyRegistrations.length})</span>
            </div>
            <div className="space-y-3">
              {liveMyRegistrations.map((reg) => {
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
                        {/* Volunteer identity — required when one browser owns multiple registrations */}
                        {reg.name && (
                          <p className="text-sm font-bold text-slate-900 mb-0.5 flex items-center gap-1.5">
                            <UserRound className="h-3.5 w-3.5 text-brand-600" />
                            {reg.name}
                          </p>
                        )}
                        {reg.member_id != null && reg.member_id !== '' && (
                          <p className="text-[11px] text-slate-500 mb-1 flex items-center gap-1.5 font-mono">
                            <Hash className="h-3 w-3 text-slate-400" />
                            العضوية: {reg.member_id}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <StatusBadge status={reg.status} className="!text-[10px] !px-1.5 !py-0.5" />
                          {reg.status === 'CONFIRMED' && reg.seat_number && <span className="text-xs text-success-700 font-medium">مؤكد — مقعد <span className="font-mono font-bold">#{reg.seat_number}</span></span>}
                          {reg.status === 'WAITLIST' && reg.waitlist_position && <span className="text-xs text-warning-700 font-medium">انتظار — رقم <span className="font-mono font-bold">#{reg.waitlist_position}</span></span>}
                          {reg.status === 'PENDING' && <span className="text-xs text-slate-500 font-medium">قيد المعالجة</span>}
                        </div>
                        <div className="text-xs text-slate-500 space-y-0.5">
                          <p className="flex items-center gap-1.5">
                            <Clock3 className="h-3 w-3 text-slate-400" />
                            سُجّل: <span className="font-mono text-slate-700">{formatDateTime(reg.created_at)}</span>
                          </p>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={restoringMyRegId === reg.id}
                          onClick={() => doSelfRestore(reg.id)}
                          className="text-success-600 hover:text-success-700 hover:bg-success-50 shrink-0"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          <span className="text-xs">التراجع عن الإلغاء</span>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* ========== REQUIREMENTS & ACCEPTANCE ========== */}
        {mission.requirements && mission.requirements.length > 0 && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 className="h-4 w-4 text-brand-600" />
              <h3 className="text-base font-bold text-slate-900">متطلبات المهمة</h3>
            </div>
            <div className="space-y-3">
              {mission.requirements.map((req) => (
                <div key={req.id} className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <p className="text-sm text-slate-800 font-medium mb-2">{req.text}</p>
                  <p className="text-[10px] text-slate-500 mb-2">
                    النوع: {
                      req.type === 'declaration' ? 'تصريح' :
                      req.type === 'file' ? 'مستند' :
                      req.type === 'medical_check' ? 'فحص طبي' : req.type
                    }
                  </p>
                  {req.requires_acceptance === 1 && (
                    <label className="flex items-start gap-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={requirementAccepted}
                        onChange={(e) => setRequirementAccepted(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="text-xs text-slate-700 font-medium group-hover:text-slate-900">
                        أوافق على هذا الشرط
                      </span>
                    </label>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ========== QUESTIONS ========== */}
        {mission.questions && mission.questions.length > 0 && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <User className="h-4 w-4 text-brand-600" />
              <h3 className="text-base font-bold text-slate-900">أسئلة المهمة</h3>
            </div>
            <div className="space-y-4">
              {mission.questions
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((q) => {
                  const parsedOptions: string[] = (() => {
                    try { return JSON.parse(q.options || '[]'); } catch { return []; }
                  })();
                  const isMulti = q.question_type === 'MULTIPLE_CHOICE';
                  const currentVal = answers[q.id] || '';
                  const multiSelected = isMulti
                    ? currentVal ? currentVal.split(',').map(s => s.trim()).filter(Boolean) : []
                    : [];

                  return (
                    <div key={q.id} className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                      <label className="block text-sm text-slate-800 font-medium mb-1">
                        {q.question_text}
                        {q.required === 1 && <span className="text-danger-500 mr-1">*</span>}
                      </label>
                      <p className="text-[10px] text-slate-400 mb-3">
                        {q.required === 1 ? 'مطلوب' : 'اختياري'}
                      </p>

                      {/* SINGLE_CHOICE — radio */}
                      {q.question_type === 'SINGLE_CHOICE' && parsedOptions.length > 0 && (
                        <div className="space-y-2">
                          {parsedOptions.map((opt) => (
                            <label key={opt} className="flex items-center gap-2.5 cursor-pointer group">
                              <input
                                type="radio"
                                name={`q-${q.id}`}
                                checked={currentVal === opt}
                                onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                                className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                              />
                              <span className="text-xs text-slate-700 group-hover:text-slate-900">{opt}</span>
                            </label>
                          ))}
                        </div>
                      )}

                      {/* YES_NO — radio */}
                      {q.question_type === 'YES_NO' && (
                        <div className="flex gap-4">
                          {['نعم', 'لا'].map((opt) => (
                            <label key={opt} className="flex items-center gap-2 cursor-pointer group">
                              <input
                                type="radio"
                                name={`q-${q.id}`}
                                checked={currentVal === opt}
                                onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                                className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                              />
                              <span className="text-xs text-slate-700 group-hover:text-slate-900">{opt}</span>
                            </label>
                          ))}
                        </div>
                      )}

                      {/* MULTIPLE_CHOICE — checkboxes */}
                      {q.question_type === 'MULTIPLE_CHOICE' && parsedOptions.length > 0 && (
                        <div className="space-y-2">
                          {parsedOptions.map((opt) => (
                            <label key={opt} className="flex items-center gap-2.5 cursor-pointer group">
                              <input
                                type="checkbox"
                                checked={multiSelected.includes(opt)}
                                onChange={() => {
                                  const updated = multiSelected.includes(opt)
                                    ? multiSelected.filter((o) => o !== opt)
                                    : [...multiSelected, opt];
                                  setAnswers((prev) => ({ ...prev, [q.id]: updated.join(', ') }));
                                }}
                                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                              />
                              <span className="text-xs text-slate-700 group-hover:text-slate-900">{opt}</span>
                            </label>
                          ))}
                        </div>
                      )}

                      {/* TEXT — textarea */}
                      {q.question_type === 'TEXT' && (
                        <textarea
                          value={currentVal}
                          onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                          placeholder="اكتب إجابتك هنا..."
                          rows={3}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition"
                        />
                      )}
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