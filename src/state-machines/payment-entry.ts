/**
 * Payment / Payroll Entry state machine. Per-worker per-pay-period entry.
 * Owner: axhy-admin (v2+ feature, drafted in v1, implemented in v2).
 */

export enum PaymentEntryState {
  ACCRUING = "ACCRUING",
  PERIOD_CLOSED = "PERIOD_CLOSED",
  CALCULATING = "CALCULATING",
  CALCULATED = "CALCULATED",
  CALCULATION_ERROR = "CALCULATION_ERROR",
  PENDING_APPROVAL = "PENDING_APPROVAL",
  APPROVED = "APPROVED",
  ADJUSTED = "ADJUSTED",
  UNDER_DISPUTE = "UNDER_DISPUTE",
  HELD = "HELD",
  RESOLVED_PAID = "RESOLVED_PAID",
  RESOLVED_REDUCED = "RESOLVED_REDUCED",
  DISBURSING = "DISBURSING",
  DISBURSEMENT_FAILED = "DISBURSEMENT_FAILED",
  PAID = "PAID",
  RECONCILED = "RECONCILED",
  FORFEITED = "FORFEITED",
}

export const PAYMENT_ENTRY_TRANSITIONS: Readonly<
  Record<PaymentEntryState, readonly PaymentEntryState[]>
> = {
  [PaymentEntryState.ACCRUING]: [PaymentEntryState.PERIOD_CLOSED],
  [PaymentEntryState.PERIOD_CLOSED]: [PaymentEntryState.CALCULATING],
  [PaymentEntryState.CALCULATING]: [
    PaymentEntryState.CALCULATED,
    PaymentEntryState.CALCULATION_ERROR,
  ],
  [PaymentEntryState.CALCULATION_ERROR]: [PaymentEntryState.CALCULATING],
  [PaymentEntryState.CALCULATED]: [PaymentEntryState.PENDING_APPROVAL],
  [PaymentEntryState.PENDING_APPROVAL]: [
    PaymentEntryState.APPROVED,
    PaymentEntryState.UNDER_DISPUTE,
    PaymentEntryState.ADJUSTED,
  ],
  [PaymentEntryState.ADJUSTED]: [PaymentEntryState.APPROVED],
  [PaymentEntryState.UNDER_DISPUTE]: [
    PaymentEntryState.RESOLVED_PAID,
    PaymentEntryState.RESOLVED_REDUCED,
    PaymentEntryState.HELD,
  ],
  [PaymentEntryState.HELD]: [PaymentEntryState.UNDER_DISPUTE, PaymentEntryState.FORFEITED],
  [PaymentEntryState.APPROVED]: [PaymentEntryState.DISBURSING],
  [PaymentEntryState.RESOLVED_PAID]: [PaymentEntryState.DISBURSING],
  [PaymentEntryState.RESOLVED_REDUCED]: [PaymentEntryState.DISBURSING],
  [PaymentEntryState.DISBURSING]: [
    PaymentEntryState.PAID,
    PaymentEntryState.DISBURSEMENT_FAILED,
  ],
  [PaymentEntryState.DISBURSEMENT_FAILED]: [
    PaymentEntryState.DISBURSING,
    PaymentEntryState.HELD,
  ],
  [PaymentEntryState.PAID]: [PaymentEntryState.RECONCILED],
  [PaymentEntryState.RECONCILED]: [],
  [PaymentEntryState.FORFEITED]: [],
};

export function canTransitionPaymentEntry(
  from: PaymentEntryState,
  to: PaymentEntryState,
): boolean {
  if (from === to) return false;
  return PAYMENT_ENTRY_TRANSITIONS[from]?.includes(to) ?? false;
}
