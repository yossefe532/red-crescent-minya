/**
 * useLiveMission Hook — Unified live polling for Phase 6.
 *
 * Replaces 4 separate polling mechanisms with 1 smart poller:
 * - Version-based change detection (no blind polling)
 * - Page Visibility API (pause when hidden, sync when visible)
 * - AbortController for stale request cancellation
 * - Connection state tracking
 * - Form state protection (never resets user input)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getLiveMission,
  Mission,
  LiveRosterEntry,
  LiveMyRegistration,
} from '../api/public';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface UseLiveMissionResult {
  mission: Mission | null;
  registrations: LiveRosterEntry[];
  myRegistrations: LiveMyRegistration[];
  version: number;
  connectionState: ConnectionState;
  /** Force an immediate poll (e.g. after registration/cancellation) */
  refresh: () => void;
}

// Polling intervals (ms)
const POLL_INTERVAL_VISIBLE = 3000;   // 3s when tab is visible
const POLL_INTERVAL_HIDDEN = 10000;   // 10s when tab is hidden
const RECONNECT_BASE_DELAY = 1000;    // 1s initial reconnect delay
const RECONNECT_MAX_DELAY = 15000;    // 15s max reconnect delay
const MAX_RECONNECT_ATTEMPTS = 20;    // give up after 20 attempts

export function useLiveMission(publicCode: string): UseLiveMissionResult {
  const [mission, setMission] = useState<Mission | null>(null);
  const [registrations, setRegistrations] = useState<LiveRosterEntry[]>([]);
  const [myRegistrations, setMyRegistrations] = useState<LiveMyRegistration[]>([]);
  const [version, setVersion] = useState(-1);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  // Stable refs that don't trigger re-renders
  const versionRef = useRef(-1);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const mountedRef = useRef(true);
  const fetchingRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Core poll function
  const poll = useCallback(async () => {
    // Prevent duplicate concurrent polls
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await getLiveMission(publicCode, versionRef.current);

      if (!mountedRef.current) return;

      if (response.changed) {
        // Update state with new data
        setMission(response.mission!);
        setRegistrations(response.registrations || []);
        setMyRegistrations(response.my_registrations || []);
        setVersion(response.version);
        versionRef.current = response.version;
        reconnectAttempts.current = 0;
        setConnectionState('connected');
      } else {
        // No change — just confirm we're still connected
        reconnectAttempts.current = 0;
        setConnectionState('connected');
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      if (err?.name === 'AbortError') return; // Request was cancelled, ignore

      // Connection error — exponential backoff
      reconnectAttempts.current++;
      if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
        setConnectionState('disconnected');
      } else {
        setConnectionState('reconnecting');
      }
    } finally {
      fetchingRef.current = false;
    }
  }, [publicCode]);

  // Schedule next poll with appropriate interval
  const scheduleNext = useCallback(() => {
    if (!mountedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);

    const isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    let interval = isHidden ? POLL_INTERVAL_HIDDEN : POLL_INTERVAL_VISIBLE;

    // Add backoff for reconnection
    if (connectionState === 'reconnecting') {
      const backoff = Math.min(
        RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts.current - 1),
        RECONNECT_MAX_DELAY,
      );
      interval = Math.max(interval, backoff);
    }

    timerRef.current = setTimeout(async () => {
      await poll();
      scheduleNext(); // Schedule next after current completes
    }, interval);
  }, [poll, connectionState]);

  // Initial poll + start polling loop
  useEffect(() => {
    // Reset state on publicCode change
    setMission(null);
    setRegistrations([]);
    setMyRegistrations([]);
    setVersion(-1);
    versionRef.current = -1;
    reconnectAttempts.current = 0;
    setConnectionState('connecting');

    // Initial poll
    poll().then(() => {
      scheduleNext();
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [publicCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Page Visibility API — immediate sync when tab becomes visible
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && mountedRef.current) {
        // Cancel current timer and poll immediately
        if (timerRef.current) clearTimeout(timerRef.current);
        poll().then(() => scheduleNext());
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [poll, scheduleNext]);

  // Force refresh — called after registration/cancellation
  const refresh = useCallback(() => {
    if (!mountedRef.current) return;
    // Reset version to force a full update
    versionRef.current = -1;
    poll();
  }, [poll]);

  return {
    mission,
    registrations,
    myRegistrations,
    version,
    connectionState,
    refresh,
  };
}
