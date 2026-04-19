/**
 * Event payload types for all 14 state machines.
 * Every state transition writes one AssignmentEvent-style row; these are the
 * structured payloads that envelope carries.
 */

import type { VisitState, RejectionReason, VisitActorType } from "../state-machines/visit";

/** Common envelope on every state-transition event. */
export interface EventEnvelope {
  eventType: string;
  idempotencyKey: string;
  from: string | null;
  to: string;
  actor: {
    type: VisitActorType | string;
    id: string | null;
  };
  reason: string;
  timestamp: string; // ISO 8601
  companyId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Visit transition payloads (T-01..T-26)
// ─────────────────────────────────────────────────────────────────────────────

export interface ScheduledPayload {
  assignmentConfigId: string;
  generatedForDate: string; // YYYY-MM-DD IST
  generatorRunId: string;
}

export interface NotifiedPayload {
  deliveryResults: {
    push?: { ok: boolean; messageId?: string; error?: string };
    sms?: { ok: boolean; messageId?: string; error?: string };
  };
  scheduledNoShowDeadline: string;
}

export interface CheckedInPayload {
  gpsLat: number;
  gpsLng: number;
  gpsAccuracy: number;
  deviceId: string;
  minutesLate: number;
  wasLateAfterNoShow: boolean;
}

export interface NoShowSuspectedPayload {
  detectedAtMinutesAfterStart: number;
  gracePeriodUsed: number;
  lastKnownActivity?: {
    type: "LOCATION_PING" | "NOTIFICATION_READ" | "NONE";
    timestamp?: string;
  };
}

export interface ReplacementRequestedPayload {
  trigger: "ADMIN_CLICK" | "AUTO_FROM_NO_SHOW" | "LEAVE_CASCADE";
  candidatesFound: number;
  topCandidateId: string | null;
  topCandidateFitScore: number | null;
  uncoverDeadline: string;
}

export interface HandoffReplacedPayload {
  newVisitId: string;
  newAssignmentId: string;
  replacementWorkerId: string;
  replacementWorkerName: string;
  selectionReason: string;
  fitScore: number;
  shadowDecisionMatched: boolean | null;
}

export interface UncoveredPayload {
  attemptsMade: number;
  rejectionReasons: string[];
  clientNotified: boolean;
  finalAttemptTimestamp: string;
}

export interface InProgressPayload {
  firstPhotoId: string;
  firstPhotoUploadedAt: string;
  minutesSinceCheckin: number;
}

export interface SubmittedPayload {
  photoCount: number;
  requiredPhotoCount: number;
  totalDurationMinutes: number;
  checkoutGpsLat: number;
  checkoutGpsLng: number;
}

export interface AIVerificationPayload {
  aiScore: number;
  provider: "OPENAI_GPT4O" | "RULE_BASED_FALLBACK" | "CUSTOM_MODEL";
  providerLatencyMs: number;
  breakdownByPhoto: Array<{
    photoId: string;
    qualityScore: number;
    issues: string[];
  }>;
  fraudSignalsFired: string[];
  provisional: boolean;
}

export interface AutoFinalizePayload {
  finalizedAt: string;
  payrollEnabled: true;
}

export interface PartialApprovedPayload {
  adminNotes: string;
  payrollAdjustment: {
    type: "FULL" | "REDUCED";
    reducedToPercent?: number;
  };
  reviewDurationMinutes: number;
}

export interface FlaggedWaivedPayload {
  waiveReason: string;
  waiveReasonCategory:
    | "LIGHTING_ISSUE"
    | "CLIENT_CONFIRMED_WORK"
    | "SUPERVISOR_VOUCHED"
    | "DEVICE_ISSUE"
    | "OTHER";
  payrollAdjustment: {
    type: "FULL" | "REDUCED" | "NONE";
    reducedToPercent?: number;
  };
  requiresFollowUp: boolean;
}

export interface RejectedFromFlaggedPayload {
  rejectionReason: RejectionReason;
  rejectionDetail: string;
  fraudCaseId?: string;
  payrollHold: true;
  workerActionTriggered: {
    type: "NONE" | "COACHING_NOTE" | "WARNING" | "INVESTIGATION";
    referenceId?: string;
  };
}

export interface CancelledPayload {
  cancelReason:
    | "ADMIN_MANUAL"
    | "LEAVE_APPROVAL_CASCADE"
    | "SITE_PAUSED_CASCADE"
    | "WORKER_DEPARTED_CASCADE"
    | "CONTRACT_TERMINATED";
  triggerEntityId?: string;
  clientNotified: boolean;
}

export interface PostComplaintReviewEntryPayload {
  complaintId: string;
  complaintCategory: string;
  complaintSeverity: "LOW" | "MEDIUM" | "HIGH";
  priorCompletionState:
    | "COMPLETED_VERIFIED"
    | "COMPLETED_PARTIAL_APPROVED"
    | "COMPLETED_FLAGGED_WAIVED";
  originalCompletedAt: string;
  reviewDeadline: string;
}

export interface PostReviewRejectedPayload {
  complaintId: string;
  priorCompletionState: string;
  clawbackAmount?: number;
  clientRemediation: {
    type: "RECLEAN_SCHEDULED" | "REFUND_ISSUED" | "CREDIT_APPLIED" | "NO_REMEDIATION";
    detail: string;
  };
  fragilityImpact: number;
}

/**
 * Post-complaint-review dismissal restoration payload (T-23/24/25).
 * Carries the originally-preserved completion state and the review outcome.
 */
export interface ComplaintReviewOutcome {
  complaintId: string;
  reviewStartedAt: string;
  reviewCompletedAt: string;
  reviewedBy: {
    userId: string;
    userName: string;
    role: "ADMIN" | "SUPERVISOR";
  };
  reviewDurationMinutes: number;
  outcome: "DISMISSED" | "UPHELD" | "PARTIAL_UPHELD";
  restorationMode: boolean;
  wasReviewed: true;
  originalCompletionState: VisitState;
  originalCompletedAt: string;
  evidence: {
    originalVisitEvidence: string[];
    newEvidence: string[];
    clientTestimony: string | null;
    workerTestimony: string | null;
  };
  reasoning: {
    summary: string;
    detailedFindings: string;
    factorsConsidered: string[];
  };
  clientCommunication: {
    notified: boolean;
    notificationMethod: "EMAIL" | "WHATSAPP" | "PHONE" | "IN_APP";
    clientResponseRecorded: string | null;
    satisfactionSignal: "ACKNOWLEDGED" | "UNHAPPY_STILL" | "NO_RESPONSE";
  };
  cascadeEffects: {
    workerCoachingTriggered: boolean;
    siteAtRiskFlagRaised: boolean;
    fragilityDelta: number;
    contractRenewalRiskFlagged: boolean;
  };
  remediation?: {
    type: "RECLEAN" | "REFUND" | "CREDIT" | "NONE";
    amount?: number;
    scheduledFor?: string;
  };
}
