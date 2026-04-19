/**
 * Generic state-machine transition validator + assertion helpers.
 * Each domain's state file provides a typed wrapper around these.
 */

export class InvalidTransitionError extends Error {
  readonly code = "INVALID_TRANSITION";
  readonly from: string;
  readonly to: string;
  readonly machine: string;
  constructor(machine: string, from: string, to: string, allowed: readonly string[]) {
    const allowedText = allowed.length ? allowed.join(", ") : "(terminal)";
    super(
      `Invalid ${machine} transition: ${from} → ${to}. Allowed from ${from}: ${allowedText}`,
    );
    this.name = "InvalidTransitionError";
    this.machine = machine;
    this.from = from;
    this.to = to;
  }
}

/**
 * Generic check: is `to` a valid transition from `from` according to the map?
 * Self-transitions are always invalid.
 */
export function canTransitionGeneric<S extends string>(
  transitions: Readonly<Record<S, readonly S[]>>,
  from: S,
  to: S,
): boolean {
  if (from === to) return false;
  return transitions[from]?.includes(to) ?? false;
}

/**
 * Generic assertion: throw InvalidTransitionError if the transition is not allowed.
 */
export function assertTransitionGeneric<S extends string>(
  machine: string,
  transitions: Readonly<Record<S, readonly S[]>>,
  from: S,
  to: S,
): void {
  if (!canTransitionGeneric(transitions, from, to)) {
    throw new InvalidTransitionError(
      machine,
      from,
      to,
      transitions[from] ?? [],
    );
  }
}
