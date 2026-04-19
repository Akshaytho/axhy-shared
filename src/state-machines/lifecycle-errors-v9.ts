/**
 * Sprint 9 error classes (AssignmentConfig + Site lifecycle machines).
 * Kept in a separate module from lifecycle-errors.ts (Sprint 8) so the
 * barrel export doesn't grow into a single 300-line file.
 */

import type { AssignmentConfigState } from "./assignment-config";
import type { SiteState } from "./site";

// ─── AssignmentConfig ───────────────────────────────────────────────────────

export class AssignmentConfigInvalidTransitionError extends Error {
  readonly code = "ASSIGNMENT_CONFIG_INVALID_TRANSITION";
  constructor(
    public readonly from: AssignmentConfigState,
    public readonly to: AssignmentConfigState,
    public readonly allowed: readonly AssignmentConfigState[],
  ) {
    const allowedText = allowed.length ? allowed.join(", ") : "(terminal)";
    super(
      `Invalid assignment config transition: ${from} → ${to}. Allowed from ${from}: ${allowedText}`,
    );
    this.name = "AssignmentConfigInvalidTransitionError";
  }
}

export class AssignmentConfigNotFoundError extends Error {
  readonly code = "ASSIGNMENT_CONFIG_NOT_FOUND";
  constructor(public readonly assignmentId: string) {
    super(`Assignment ${assignmentId} not found`);
    this.name = "AssignmentConfigNotFoundError";
  }
}

export class MissingAssignmentConfigMetadataError extends Error {
  readonly code = "MISSING_ASSIGNMENT_CONFIG_METADATA";
  constructor(missing: string) {
    super(`Assignment config transition requires ${missing}`);
    this.name = "MissingAssignmentConfigMetadataError";
  }
}

// ─── Site ───────────────────────────────────────────────────────────────────

export class SiteInvalidTransitionError extends Error {
  readonly code = "SITE_INVALID_TRANSITION";
  constructor(
    public readonly from: SiteState,
    public readonly to: SiteState,
    public readonly allowed: readonly SiteState[],
  ) {
    const allowedText = allowed.length ? allowed.join(", ") : "(terminal)";
    super(
      `Invalid site lifecycle transition: ${from} → ${to}. Allowed from ${from}: ${allowedText}`,
    );
    this.name = "SiteInvalidTransitionError";
  }
}

export class SiteNotFoundError extends Error {
  readonly code = "SITE_NOT_FOUND";
  constructor(public readonly siteId: string) {
    super(`Site ${siteId} not found`);
    this.name = "SiteNotFoundError";
  }
}

export class MissingSiteLifecycleMetadataError extends Error {
  readonly code = "MISSING_SITE_LIFECYCLE_METADATA";
  constructor(missing: string) {
    super(`Site lifecycle transition requires ${missing}`);
    this.name = "MissingSiteLifecycleMetadataError";
  }
}
