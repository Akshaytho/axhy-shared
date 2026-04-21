/**
 * Assignment overlap guard — Sprint 10 hardening.
 *
 * Detects double-booking when creating or updating an Assignment (the
 * recurring schedule slot). Prevents a worker from being assigned to two
 * sites with overlapping time windows on overlapping day sets.
 *
 * Call from admin + backend BEFORE writing the new/updated assignment row
 * so the reservation is validated atomically (inside the same tx).
 *
 * The function only considers assignments whose lifecycleState actively
 * reserves time: ACTIVE, PAUSED, WORKER_ON_LEAVE, SITE_PAUSED. Terminal
 * states (INACTIVE, DISCARDED) and intermediate attention states
 * (WORKER_DEPARTED, REASSIGNMENT_NEEDED) don't hold the worker's slot.
 */

import { AssignmentConfigState } from "./assignment-config";

// ─── Pure helpers (no DB dependency) ────────────────────────────────────────

/**
 * "HH:MM" → minutes-since-midnight. Same encoding Assignment.timeStart uses.
 * Invalid input returns NaN; callers should validate at API boundary.
 */
export function parseTimeToMinutes(hhmm: string): number {
  // Strict 24h clock: 00-23 hours, 00-59 minutes. Rejects "24:00" etc.
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return NaN;
  return Number.parseInt(m[1], 10) * 60 + Number.parseInt(m[2], 10);
}

export interface TimeWindow {
  timeStart: string; // "HH:MM"
  timeEnd: string;   // "HH:MM"
}

/**
 * Strict overlap — [aStart, aEnd) vs [bStart, bEnd). Back-to-back slots
 * (aEnd === bStart) do NOT overlap. Returns false if either window is
 * malformed (fail-safe — caller should validate first).
 */
export function hasTimeOverlap(a: TimeWindow, b: TimeWindow): boolean {
  const aStart = parseTimeToMinutes(a.timeStart);
  const aEnd = parseTimeToMinutes(a.timeEnd);
  const bStart = parseTimeToMinutes(b.timeStart);
  const bEnd = parseTimeToMinutes(b.timeEnd);
  if (Number.isNaN(aStart) || Number.isNaN(aEnd) || Number.isNaN(bStart) || Number.isNaN(bEnd)) {
    return false;
  }
  if (aEnd <= aStart || bEnd <= bStart) return false;
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Share at least one day. `days` follows the project convention of
 * weekday integers 0-6 (Sun=0..Sat=6) matching Prisma Int[] storage.
 */
export function hasDayOverlap(a: { days: readonly number[] }, b: { days: readonly number[] }): boolean {
  if (a.days.length === 0 || b.days.length === 0) return false;
  const bSet = new Set(b.days);
  return a.days.some((d) => bSet.has(d));
}

// ─── DB-backed guard ────────────────────────────────────────────────────────

/** Subset of assignments tx we need for the overlap query. */
export interface AssignmentOverlapQueryClient {
  assignment: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    }): Promise<
      Array<{
        id: string;
        siteId: string;
        days: number[];
        timeStart: string;
        timeEnd: string;
        oneOffDates?: Date[];
      }>
    >;
  };
}

export interface AssignmentOverlapInput {
  workerId: string;
  days: readonly number[];
  timeStart: string;
  timeEnd: string;
  /**
   * One-off dates for ONE_OFF source assignments. When provided, the overlap
   * check unions these dates with the weekday expansion of days[] to detect
   * conflicts against both recurring and other one-off assignments.
   */
  oneOffDates?: Date[];
  /** When updating an existing assignment, exclude it from the self-overlap check. */
  excludeAssignmentId?: string;
}

/**
 * States that actively reserve the worker's time. Kept in sync with the
 * AssignmentConfig machine semantics — if a new state reserves time, add
 * it here. If a state doesn't reserve (e.g. INACTIVE is terminal), omit.
 */
export const RESERVED_TIME_STATES: readonly AssignmentConfigState[] = [
  AssignmentConfigState.ACTIVE,
  AssignmentConfigState.PAUSED,
  AssignmentConfigState.WORKER_ON_LEAVE,
  AssignmentConfigState.SITE_PAUSED,
];

export class AssignmentOverlapError extends Error {
  readonly code = "ASSIGNMENT_OVERLAP";
  constructor(
    public readonly workerId: string,
    public readonly conflictingAssignmentId: string,
    public readonly conflictingSiteId: string,
  ) {
    super(
      `Worker ${workerId} already has overlapping assignment ${conflictingAssignmentId} at site ${conflictingSiteId}`,
    );
    this.name = "AssignmentOverlapError";
  }
}

// ─── One-off date helpers ─────────────────────────────────────────────────────

/**
 * Returns the ISO YYYY-MM-DD string for a Date, using its UTC components.
 * We store one-off dates as midnight UTC (no time component matters for
 * calendar-day comparison), so UTC day extraction is correct.
 */
function isoDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Given a recurring assignment with a days[] pattern, check whether any of
 * the supplied one-off dates falls on one of those weekdays.
 * Uses UTC weekday (0=Sun..6=Sat) — callers store oneOffDates as UTC midnight.
 */
function oneOffDatesIntersectDays(oneOffDates: Date[], days: readonly number[]): boolean {
  if (oneOffDates.length === 0 || days.length === 0) return false;
  const daySet = new Set(days);
  return oneOffDates.some((d) => daySet.has(d.getUTCDay()));
}

/**
 * Check if two arrays of one-off dates share at least one calendar day.
 * Comparison uses ISO YYYY-MM-DD strings to avoid time-zone drift.
 */
function oneOffDatesIntersect(aDates: Date[], bDates: Date[]): boolean {
  if (aDates.length === 0 || bDates.length === 0) return false;
  const aSet = new Set(aDates.map(isoDateString));
  return bDates.some((d) => aSet.has(isoDateString(d)));
}

/**
 * Throws AssignmentOverlapError if any existing non-terminal assignment
 * for the given worker overlaps by both day AND time. Legacy rows with
 * null lifecycleState also count — pre-backfill ACTIVE rows still reserve
 * time, so we include them by querying `lifecycleState: null` alongside
 * the reserved states. Backfill → remove null branch.
 *
 * Extended in Sprint 4 to handle ONE_OFF assignments:
 *   - If the new assignment has oneOffDates, compare those dates against
 *     each existing assignment's days[] (weekday expansion) AND oneOffDates.
 *   - If an existing assignment has oneOffDates, compare those against
 *     the new assignment's days[] weekday expansion AND its oneOffDates.
 *   - Time overlap check always runs when date overlap is detected.
 *
 * Typically called inside the same tx as the assignment create/update so
 * a concurrent insert can't slip past the read-check.
 */
export async function assertNoAssignmentOverlap(
  tx: AssignmentOverlapQueryClient,
  input: AssignmentOverlapInput,
): Promise<void> {
  const existing = await tx.assignment.findMany({
    where: {
      workerId: input.workerId,
      ...(input.excludeAssignmentId ? { id: { not: input.excludeAssignmentId } } : {}),
      OR: [
        { lifecycleState: { in: RESERVED_TIME_STATES as unknown as string[] } },
        // Legacy rows pre-backfill — treat null as ACTIVE per the default
        // the transition helper uses. Post-backfill, this branch becomes dead.
        { lifecycleState: null, isActive: true },
      ],
    },
    select: { id: true, siteId: true, days: true, timeStart: true, timeEnd: true, oneOffDates: true },
  });

  const inputOneOffDates = input.oneOffDates ?? [];
  const inputDays = input.days;
  const inputWindow = { timeStart: input.timeStart, timeEnd: input.timeEnd };

  for (const e of existing) {
    const existingOneOffDates = e.oneOffDates ?? [];

    // Determine whether the date sets overlap (either direction):
    //   1. new recurring vs existing recurring: hasDayOverlap
    //   2. new one-off vs existing recurring: check if any new date falls on existing weekday
    //   3. new recurring vs existing one-off: check if any existing date falls on new weekday
    //   4. new one-off vs existing one-off: shared calendar date
    let datesOverlap = false;

    const existingWindow = { timeStart: e.timeStart, timeEnd: e.timeEnd };

    if (inputOneOffDates.length > 0 && existingOneOffDates.length > 0) {
      // Both are one-off: check shared calendar dates
      datesOverlap = oneOffDatesIntersect(inputOneOffDates, existingOneOffDates);
    } else if (inputOneOffDates.length > 0 && e.days.length > 0) {
      // New is one-off, existing is recurring: does any new date fall on existing weekday?
      datesOverlap = oneOffDatesIntersectDays(inputOneOffDates, e.days);
    } else if (inputDays.length > 0 && existingOneOffDates.length > 0) {
      // New is recurring, existing is one-off: does any existing date fall on new weekday?
      datesOverlap = oneOffDatesIntersectDays(existingOneOffDates, inputDays);
    } else {
      // Both use days[]: standard weekday intersection
      datesOverlap = hasDayOverlap(e, { days: inputDays });
    }

    if (datesOverlap && hasTimeOverlap(existingWindow, inputWindow)) {
      throw new AssignmentOverlapError(input.workerId, e.id, e.siteId);
    }
  }
}
