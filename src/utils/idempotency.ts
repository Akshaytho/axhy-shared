/**
 * Idempotency key builders — deterministic keys for cross-service replay safety.
 *
 * Rules:
 *  - Keys are deterministic given the input tuple (same action → same key).
 *  - Workers generating actions on device use clientActionId so retries collapse.
 *  - Server-side timer events use scheduledFor timestamp so reruns collapse.
 *  - Admin actions use the admin actor id + intent + target id.
 */

export interface IdempotencyKeyParts {
  /** Machine or domain, e.g. "visit", "leave", "swap" */
  domain: string;
  /** Target entity id, e.g. visit id, leave request id */
  targetId: string;
  /** Semantic action name, e.g. "checkin", "checkout", "dispatch-replacement" */
  action: string;
  /** Deterministic disambiguator — e.g. clientActionId, scheduledFor, admin decision id */
  disambiguator: string;
}

export function buildIdempotencyKey(parts: IdempotencyKeyParts): string {
  const domain = parts.domain.replace(/[^a-zA-Z0-9_-]/g, "_");
  const target = parts.targetId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const action = parts.action.replace(/[^a-zA-Z0-9_-]/g, "_");
  const disambig = parts.disambiguator.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  return `${domain}:${target}:${action}:${disambig}`;
}

/** Convenience: worker-side action key from a client-generated action id. */
export function buildWorkerActionKey(
  visitId: string,
  action: "checkin" | "checkout" | "photo-upload" | "notification-ack",
  clientActionId: string,
): string {
  return buildIdempotencyKey({
    domain: "visit",
    targetId: visitId,
    action,
    disambiguator: clientActionId,
  });
}

/** Convenience: timer-fired action key from scheduled-for timestamp. */
export function buildTimerKey(
  visitId: string,
  action: "check-no-show" | "uncovered-timeout" | "send-notification",
  scheduledForIso: string,
): string {
  return buildIdempotencyKey({
    domain: "visit",
    targetId: visitId,
    action,
    disambiguator: scheduledForIso,
  });
}

/** Convenience: admin decision key from admin id and their decision id. */
export function buildAdminActionKey(
  targetId: string,
  action: string,
  adminId: string,
  decisionId: string,
): string {
  return buildIdempotencyKey({
    domain: "admin",
    targetId,
    action,
    disambiguator: `${adminId}.${decisionId}`,
  });
}
