/**
 * useLiveChanges — Phase 7: Change detection for live mission data.
 *
 * Compares previous/current snapshots from the Phase 6 live poller
 * and fires structured change events that the UI can react to.
 *
 * Key rules:
 * - Initial load (first poll) is silent — no notifications
 * - Changes are detected by comparing roster IDs, not names
 * - Server state is authoritative — this hook only observes diffs
 */
import { useEffect, useRef, useState } from 'react';
import type { Mission, LiveRosterEntry } from '../api/public';

// ── Change Event Types ──

export interface RegistrationEvent {
  type: 'registered' | 'cancelled' | 'promoted';
  name: string;
  registrationId: string;
  timestamp: number;
}

export interface CountChangeEvent {
  type: 'count_change';
  confirmed: number;
  waitlist: number;
  available: number;
  timestamp: number;
}

export interface MissionFullEvent {
  type: 'mission_full';
  timestamp: number;
}

export type LiveChangeEvent = RegistrationEvent | CountChangeEvent | MissionFullEvent;

// ── Hook Interface ──

interface UseLiveChangesOptions {
  registrations: LiveRosterEntry[];
  mission: Mission | null;
  version: number;
  onRegistered?: (event: RegistrationEvent) => void;
  onCancelled?: (event: RegistrationEvent) => void;
  onPromoted?: (event: RegistrationEvent) => void;
  onCountChange?: (event: CountChangeEvent) => void;
  onMissionFull?: (event: MissionFullEvent) => void;
}

interface UseLiveChangesResult {
  /** IDs of roster entries that arrived after initial load (for animation) */
  newEntryIds: Set<string>;
  /** Recent activity events (last 5, newest first) */
  recentEvents: RegistrationEvent[];
}

const MAX_RECENT_EVENTS = 5;
const NEW_ENTRY_HIGHLIGHT_MS = 8000;

export function useLiveChanges({
  registrations,
  mission,
  version,
  onRegistered,
  onCancelled,
  onPromoted,
  onCountChange,
  onMissionFull,
}: UseLiveChangesOptions): UseLiveChangesResult {
  // Previous state snapshots
  const prevRegistrationsRef = useRef<LiveRosterEntry[]>([]);
  const prevMissionRef = useRef<Mission | null>(null);
  const initializedRef = useRef(false);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // New entry IDs (ref for fast mutation, state snapshot for React rendering)
  const newEntryIdsRef = useRef<Set<string>>(new Set());
  const [newEntryIdsSnapshot, setNewEntryIdsSnapshot] = useState<Set<string>>(new Set());
  const [recentEvents, setRecentEvents] = useState<RegistrationEvent[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cleanupTimerRef.current) clearTimeout(cleanupTimerRef.current);
    };
  }, []);

  // Core diff detection — runs on each poll update
  useEffect(() => {
    if (version <= 0) return; // Still on initial load

    if (!initializedRef.current) {
      // First update after initial load — mark as initialized, store current state
      initializedRef.current = true;
      prevRegistrationsRef.current = [...registrations];
      prevMissionRef.current = mission ? { ...mission } : null;
      return;
    }

    const prevRegs = prevRegistrationsRef.current;
    const prevIds = new Set(prevRegs.map((r) => r.id));
    const currIds = new Set(registrations.map((r) => r.id));
    const now = Date.now();

    // Collect all registration events (new, cancelled, promoted)
    const allEvents: RegistrationEvent[] = [];

    // ── New registrations ──
    const newlyRegistered: string[] = [];
    for (const reg of registrations) {
      if (!prevIds.has(reg.id)) {
        newlyRegistered.push(reg.id);
        newEntryIdsRef.current.add(reg.id);
        const event: RegistrationEvent = {
          type: 'registered',
          name: reg.name,
          registrationId: reg.id,
          timestamp: now,
        };
        allEvents.push(event);
        onRegistered?.(event);
      }
    }

    // ── Cancellations (removed from roster) ──
    const prevRegMap = new Map(prevRegs.map((r) => [r.id, r]));
    for (const prevId of prevIds) {
      if (!currIds.has(prevId)) {
        const prev = prevRegMap.get(prevId)!;
        const event: RegistrationEvent = {
          type: 'cancelled',
          name: prev.name,
          registrationId: prevId,
          timestamp: now,
        };
        allEvents.push(event);
        onCancelled?.(event);
      }
    }

    // ── Promotions (status changed from WAITLIST → CONFIRMED) ──
    for (const reg of registrations) {
      if (prevIds.has(reg.id)) {
        const prev = prevRegMap.get(reg.id);
        if (prev && prev.status === 'WAITLIST' && reg.status === 'CONFIRMED') {
          const event: RegistrationEvent = {
            type: 'promoted',
            name: reg.name,
            registrationId: reg.id,
            timestamp: now,
          };
          allEvents.push(event);
          onPromoted?.(event);
        }
      }
    }

    // ── Count change ──
    if (mission && prevMissionRef.current) {
      const prevMission = prevMissionRef.current;
      if (
        mission.confirmed !== prevMission.confirmed ||
        mission.waitlist !== prevMission.waitlist ||
        mission.available !== prevMission.available
      ) {
        onCountChange?.({
          type: 'count_change',
          confirmed: mission.confirmed,
          waitlist: mission.waitlist,
          available: mission.available,
          timestamp: now,
        });
      }

      // ── Mission full ──
      if (mission.is_completely_full && !prevMission.is_completely_full) {
        onMissionFull?.({
          type: 'mission_full',
          timestamp: now,
        });
      }
    }

    // ── Track recent events (all registration-related events) ──
    if (allEvents.length > 0) {
      setRecentEvents((prev) => [...allEvents, ...prev].slice(0, MAX_RECENT_EVENTS));
    }

    // ── Update previous state ──
    prevRegistrationsRef.current = [...registrations];
    prevMissionRef.current = mission ? { ...mission } : null;

    // ── Clear new entry IDs after delay ──
    if (cleanupTimerRef.current) clearTimeout(cleanupTimerRef.current);
    cleanupTimerRef.current = setTimeout(() => {
      newEntryIdsRef.current.clear();
      setNewEntryIdsSnapshot(new Set());
    }, NEW_ENTRY_HIGHLIGHT_MS);

    // Update snapshot for React rendering
    setNewEntryIdsSnapshot(new Set(newEntryIdsRef.current));
  }, [registrations, mission, version]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    newEntryIds: newEntryIdsSnapshot,
    recentEvents,
  };
}
