/**
 * Shared concurrency primitives for the transition helpers.
 *
 * Two independent race hazards the helpers must handle:
 *
 * 1. **Phantom transitions**: At Postgres's default READ COMMITTED isolation
 *    level, N parallel transactions all see the same `from` state. Each
 *    happily UPDATEs the row to `to`. All N succeed and all N write distinct
 *    events (different idempotency keys). The STATE ends up at `to` (correct)
 *    but N redundant events were written for what was logically ONE transition.
 *
 *    Fix: use `updateMany` with BOTH `id` and `lifecycleState = from` in the
 *    WHERE. Only the first-committing transaction matches the from-state;
 *    the rest get count = 0. When we see count = 0, re-read and return
 *    "no-op" (same-state replay) or re-evaluate.
 *
 * 2. **Duplicate-key collision**: Two tx fire the SAME idempotency key in
 *    parallel. Both pass the helper's `findUnique({idempotencyKey})` guard
 *    (neither has committed yet). Both try to INSERT. Postgres serialises
 *    them: the first commits, the second fails with P2002 on the unique
 *    partial index.
 *
 *    Fix: catch P2002 on the event insert, re-fetch by idempotencyKey, and
 *    return as "duplicate".
 *
 * These helpers centralise the detection so each transition helper can
 * wrap its own mutation cleanly. The actual retry loop lives in each
 * helper because the shape of "retry" differs per machine (visit has
 * restoration flags to re-evaluate, etc.).
 */

/**
 * Prisma emits errors with a `.code` string when the request is structurally
 * valid but Postgres rejects it. We match on the code rather than the error
 * class name so this works across Prisma 5 / 6 / future engines without
 * importing the Prisma client here (which would create a circular dep
 * between axhy-shared and the consumer repo's generated client).
 */
function prismaCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function isUniqueConstraintError(err: unknown): boolean {
  return prismaCode(err) === "P2002";
}
