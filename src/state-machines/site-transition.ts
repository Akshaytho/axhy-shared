/**
 * transitionSite() — the ONLY sanctioned path to mutate Site.lifecycleState.
 *
 * Mandatory metadata rules:
 *   - CANCELLED_EARLY | CANCELLED_PROBATION | TERMINATED | LOST_SITE:
 *     payload.cancellationReason (non-empty string)
 *   - PAUSED: payload.pauseReason
 *   - CHURNING: payload.churnReason
 *   - RENEWAL_WINDOW: payload.renewalDate (ISO string)
 *   - CONTRACT_EXPANDED: payload.expansionDetails (non-empty string)
 *
 * All transitions require a structured reason in the event payload; the
 * required fields above additionally enforce named keys.
 */

import { SiteState, SITE_TRANSITIONS } from "./site";
import {
  SiteInvalidTransitionError,
  SiteNotFoundError,
  MissingSiteLifecycleMetadataError,
} from "./lifecycle-errors-v9";
import { MissingIdempotencyKeyError } from "./visit-errors";

// ─── Actor ──────────────────────────────────────────────────────────────────

export enum SiteLifecycleActorType {
  COMPANY_ADMIN = "COMPANY_ADMIN",
  SUPER_ADMIN = "SUPER_ADMIN",
  SYSTEM = "SYSTEM",
  CLIENT = "CLIENT",
}

export interface SiteLifecycleActor {
  type: SiteLifecycleActorType;
  id: string | null;
}

// ─── Tx interface ───────────────────────────────────────────────────────────

interface SiteRow {
  id: string;
  lifecycleState: string | null;
}

interface SiteLifecycleEventRow {
  id: string;
  idempotencyKey: string | null;
  siteId: string;
  eventType: string;
  payload: unknown;
  actorType: string;
  actorId: string | null;
  createdAt: Date | string;
}

export interface SiteDelegate {
  findUnique(args: {
    where: { id: string };
    select?: Record<string, boolean>;
  }): Promise<SiteRow | null>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<SiteRow>;
}

export interface SiteLifecycleEventDelegate {
  findUnique(args: {
    where: { idempotencyKey: string };
  }): Promise<SiteLifecycleEventRow | null>;
  create(args: {
    data: Record<string, unknown>;
  }): Promise<SiteLifecycleEventRow>;
}

export interface SiteTxClient {
  site: SiteDelegate;
  siteLifecycleEvent: SiteLifecycleEventDelegate;
}

// ─── Input / result ─────────────────────────────────────────────────────────

export interface TransitionSiteInput {
  siteId: string;
  to: SiteState;
  actor: SiteLifecycleActor;
  reason: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}

export type TransitionSiteStatus = "transitioned" | "duplicate" | "no-op";

export interface TransitionSiteResult {
  status: TransitionSiteStatus;
  fromState: SiteState;
  toState: SiteState;
  eventId: string;
}

export const SITE_STATE_TRANSITION_EVENT_TYPE = "STATE_TRANSITION" as const;

// ─── Core ───────────────────────────────────────────────────────────────────

export async function transitionSite(
  tx: SiteTxClient,
  input: TransitionSiteInput,
): Promise<TransitionSiteResult> {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
    throw new MissingIdempotencyKeyError();
  }

  const existing = await tx.siteLifecycleEvent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    const payload = (existing.payload ?? {}) as Record<string, unknown>;
    return {
      status: "duplicate",
      fromState: payload.from as SiteState,
      toState: payload.to as SiteState,
      eventId: existing.id,
    };
  }

  const row = await tx.site.findUnique({
    where: { id: input.siteId },
    select: { id: true, lifecycleState: true },
  });
  if (!row) {
    throw new SiteNotFoundError(input.siteId);
  }

  const from = (row.lifecycleState ?? SiteState.PROSPECT) as SiteState;

  if (from === input.to) {
    return { status: "no-op", fromState: from, toState: input.to, eventId: "" };
  }

  const allowed = SITE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(input.to)) {
    throw new SiteInvalidTransitionError(from, input.to, allowed);
  }

  const payload = input.payload ?? {};
  validateSiteLifecycleMetadata(input.to, payload);

  await tx.site.update({
    where: { id: input.siteId },
    data: { lifecycleState: input.to },
  });

  const event = await tx.siteLifecycleEvent.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      siteId: input.siteId,
      eventType: SITE_STATE_TRANSITION_EVENT_TYPE,
      payload: {
        from,
        to: input.to,
        reason: input.reason,
        ...payload,
      },
      actorType: input.actor.type,
      actorId: input.actor.id,
    },
  });

  return {
    status: "transitioned",
    fromState: from,
    toState: input.to,
    eventId: event.id,
  };
}

function validateSiteLifecycleMetadata(
  to: SiteState,
  payload: Record<string, unknown>,
): void {
  const requireStr = (key: string, desc: string): void => {
    const v = payload[key];
    if (typeof v !== "string" || v.trim().length === 0) {
      throw new MissingSiteLifecycleMetadataError(`non-empty payload.${key} (${desc})`);
    }
  };

  switch (to) {
    case SiteState.CANCELLED_EARLY:
    case SiteState.CANCELLED_PROBATION:
    case SiteState.TERMINATED:
    case SiteState.LOST_SITE:
      requireStr("cancellationReason", "why the client relationship is ending");
      break;
    case SiteState.PAUSED:
      requireStr("pauseReason", "why cleaning is temporarily paused");
      break;
    case SiteState.CHURNING:
      requireStr("churnReason", "signal (e.g. complaint surge, payment delay)");
      break;
    case SiteState.RENEWAL_WINDOW:
      requireStr("renewalDate", "ISO date when current contract expires");
      break;
    case SiteState.CONTRACT_EXPANDED:
      requireStr("expansionDetails", "what expanded (more sites, frequency, scope)");
      break;
    default:
      break;
  }
}
