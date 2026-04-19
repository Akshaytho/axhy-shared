/**
 * Shared error classes for the Sprint 8 lifecycle transition helpers
 * (SwapRequest / Worker / Device). Mirrors visit-errors.ts for the visit
 * machine — each error carries a stable `.code` so callers can branch on it
 * without string-matching.
 */

import type { SwapRequestState } from "./swap-request";
import type { WorkerState } from "./worker";
import type { DeviceState } from "./device";

// ─── SwapRequest ────────────────────────────────────────────────────────────

export class SwapRequestInvalidTransitionError extends Error {
  readonly code = "SWAP_REQUEST_INVALID_TRANSITION";
  constructor(
    public readonly from: SwapRequestState,
    public readonly to: SwapRequestState,
    public readonly allowed: readonly SwapRequestState[],
  ) {
    const allowedText = allowed.length ? allowed.join(", ") : "(terminal)";
    super(
      `Invalid swap request transition: ${from} → ${to}. Allowed from ${from}: ${allowedText}`,
    );
    this.name = "SwapRequestInvalidTransitionError";
  }
}

export class SwapRequestNotFoundError extends Error {
  readonly code = "SWAP_REQUEST_NOT_FOUND";
  constructor(public readonly swapRequestId: string) {
    super(`SwapRequest ${swapRequestId} not found`);
    this.name = "SwapRequestNotFoundError";
  }
}

export class MissingSwapAdminDecisionError extends Error {
  readonly code = "MISSING_SWAP_ADMIN_DECISION";
  constructor(missing: string) {
    super(`Admin approval transition requires ${missing}`);
    this.name = "MissingSwapAdminDecisionError";
  }
}

// ─── Worker lifecycle ───────────────────────────────────────────────────────

export class WorkerInvalidTransitionError extends Error {
  readonly code = "WORKER_INVALID_TRANSITION";
  constructor(
    public readonly from: WorkerState,
    public readonly to: WorkerState,
    public readonly allowed: readonly WorkerState[],
  ) {
    const allowedText = allowed.length ? allowed.join(", ") : "(terminal)";
    super(
      `Invalid worker lifecycle transition: ${from} → ${to}. Allowed from ${from}: ${allowedText}`,
    );
    this.name = "WorkerInvalidTransitionError";
  }
}

export class WorkerNotFoundError extends Error {
  readonly code = "WORKER_NOT_FOUND";
  constructor(public readonly userId: string) {
    super(`Worker (user) ${userId} not found`);
    this.name = "WorkerNotFoundError";
  }
}

export class MissingWorkerDecisionMetadataError extends Error {
  readonly code = "MISSING_WORKER_DECISION_METADATA";
  constructor(missing: string) {
    super(`Worker lifecycle transition requires ${missing}`);
    this.name = "MissingWorkerDecisionMetadataError";
  }
}

// ─── Device lifecycle ───────────────────────────────────────────────────────

export class DeviceInvalidTransitionError extends Error {
  readonly code = "DEVICE_INVALID_TRANSITION";
  constructor(
    public readonly from: DeviceState,
    public readonly to: DeviceState,
    public readonly allowed: readonly DeviceState[],
  ) {
    const allowedText = allowed.length ? allowed.join(", ") : "(terminal)";
    super(
      `Invalid device lifecycle transition: ${from} → ${to}. Allowed from ${from}: ${allowedText}`,
    );
    this.name = "DeviceInvalidTransitionError";
  }
}

export class DeviceOwnerNotFoundError extends Error {
  readonly code = "DEVICE_OWNER_NOT_FOUND";
  constructor(public readonly userId: string) {
    super(`Device owner (user) ${userId} not found`);
    this.name = "DeviceOwnerNotFoundError";
  }
}
