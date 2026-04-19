/**
 * API request/response types shared between the admin server and the mobile app.
 * These are the contracts. If the server adds a field, both sides bump together.
 */

import type { VisitState } from "../state-machines/visit";

// ─────────────────────────────────────────────────────────────────────────────
// /api/worker/checkin
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkerCheckinRequest {
  visitId: string;
  gpsLat: number;
  gpsLng: number;
  gpsAccuracy: number;
  deviceId: string;
  clientTimestamp: string; // ISO
  clientActionId: string; // client-generated UUID for idempotency
}

export type WorkerCheckinResponse =
  | { ok: true; lifecycleStatus: VisitState; minutesLate: number; wasLateAfterNoShow: boolean }
  | { ok: false; reason: "WRONG_SITE"; detectedSiteId: string | null; expectedSiteId: string }
  | {
      ok: false;
      reason: "OUTSIDE_GEOFENCE";
      distanceMeters: number;
      geofenceRadiusM: number;
    }
  | { ok: false; reason: "INVALID_STATE"; currentState: VisitState; expected: VisitState[] }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "UNAUTHORIZED" };

// ─────────────────────────────────────────────────────────────────────────────
// /api/worker/checkout
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkerCheckoutRequest {
  visitId: string;
  gpsLat: number;
  gpsLng: number;
  gpsAccuracy: number;
  deviceId: string;
  clientTimestamp: string;
  clientActionId: string;
}

export type WorkerCheckoutResponse =
  | { ok: true; lifecycleStatus: VisitState }
  | { ok: false; reason: "PHOTOS_INCOMPLETE"; uploaded: number; required: number }
  | { ok: false; reason: "INVALID_STATE"; currentState: VisitState; expected: VisitState[] }
  | { ok: false; reason: "NOT_FOUND" };

// ─────────────────────────────────────────────────────────────────────────────
// /api/worker/photo-upload (multipart, metadata shape here)
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkerPhotoUploadMetadata {
  visitId: string;
  photoKind: "BEFORE" | "AFTER" | "ISSUE";
  gpsLat?: number;
  gpsLng?: number;
  deviceId: string;
  clientActionId: string;
  clientTimestamp: string;
}

export type WorkerPhotoUploadResponse =
  | {
      ok: true;
      photoId: string;
      lifecycleStatus: VisitState; // may be IN_PROGRESS if this is first photo
    }
  | { ok: false; reason: "SIZE_EXCEEDED"; maxBytes: number }
  | { ok: false; reason: "INVALID_STATE"; currentState: VisitState }
  | { ok: false; reason: "NOT_FOUND" };

// ─────────────────────────────────────────────────────────────────────────────
// /api/worker/notification-ack (soft signal, never blocks)
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkerNotificationAckRequest {
  visitId: string;
  notifiedAt: string;
  ackedAt: string;
  deviceId: string;
  ackKind: "OPENED_PUSH" | "FOREGROUNDED" | "READ_IN_APP";
}

export interface WorkerNotificationAckResponse {
  ok: true;
  recorded: true;
}

// ─────────────────────────────────────────────────────────────────────────────
// /api/worker/my-visits
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkerMyVisitsResponse {
  visits: Array<{
    id: string;
    siteId: string;
    siteName: string;
    lifecycleStatus: VisitState;
    scheduledStart: string;
    scheduledEnd: string;
    graceMinutes: number;
    geofence: {
      lat: number;
      lng: number;
      radiusM: number;
    };
    photoRequirements: {
      before: number;
      after: number;
    };
  }>;
  serverTime: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin endpoints (mobile app does not see these, but server types go here)
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminRequestReplacementRequest {
  visitId: string;
  reason: string;
  adminDecisionId: string;
}

export interface AdminDispatchReplacementRequest {
  visitId: string;
  replacementWorkerId: string;
  reason: string;
  adminDecisionId: string;
}

export interface AdminReviewVisitRequest {
  visitId: string;
  decision: "CLEAR_PARTIAL" | "WAIVE_FLAGGED" | "REJECT_FLAGGED";
  notes: string;
  rejectionReason?: string; // required for REJECT_FLAGGED
  rejectionDetail?: string; // required for REJECT_FLAGGED
  fraudCaseId?: string; // required when rejectionReason=FRAUD
  adminDecisionId: string;
}
