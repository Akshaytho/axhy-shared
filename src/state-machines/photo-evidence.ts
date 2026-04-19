/**
 * Photo Evidence state machine. Individual photo lifecycle within a visit.
 * Owner: axhy-v2-b2b (capture+upload) + axhy-admin (review).
 */

export enum PhotoState {
  QUEUED = "QUEUED",
  UPLOADING = "UPLOADING",
  UPLOADED = "UPLOADED",
  UPLOAD_FAILED = "UPLOAD_FAILED",
  MANUAL_FALLBACK = "MANUAL_FALLBACK",
  HASH_CHECK = "HASH_CHECK",
  CLEAN = "CLEAN",
  DUPLICATE_FLAG = "DUPLICATE_FLAG",
  AI_REVIEW = "AI_REVIEW",
  ACCEPTED = "ACCEPTED",
  LOW_QUALITY = "LOW_QUALITY",
  REJECTED_CONTENT = "REJECTED_CONTENT",
  RETAKE_REQUESTED = "RETAKE_REQUESTED",
  FRAUD_REVIEW = "FRAUD_REVIEW",
  CONFIRMED_FRAUD = "CONFIRMED_FRAUD",
  CLEARED = "CLEARED",
  REJECTED_SIZE = "REJECTED_SIZE",
  ABANDONED = "ABANDONED",
  ARCHIVED = "ARCHIVED",
}

export const PHOTO_TRANSITIONS: Readonly<Record<PhotoState, readonly PhotoState[]>> = {
  [PhotoState.QUEUED]: [PhotoState.UPLOADING, PhotoState.UPLOAD_FAILED],
  [PhotoState.UPLOADING]: [
    PhotoState.UPLOADED,
    PhotoState.UPLOAD_FAILED,
    PhotoState.REJECTED_SIZE,
  ],
  [PhotoState.UPLOAD_FAILED]: [PhotoState.UPLOADING, PhotoState.MANUAL_FALLBACK],
  [PhotoState.MANUAL_FALLBACK]: [PhotoState.UPLOADED, PhotoState.ABANDONED],
  [PhotoState.UPLOADED]: [PhotoState.HASH_CHECK],
  [PhotoState.HASH_CHECK]: [PhotoState.CLEAN, PhotoState.DUPLICATE_FLAG],
  [PhotoState.CLEAN]: [PhotoState.AI_REVIEW],
  [PhotoState.DUPLICATE_FLAG]: [PhotoState.FRAUD_REVIEW],
  [PhotoState.AI_REVIEW]: [
    PhotoState.ACCEPTED,
    PhotoState.LOW_QUALITY,
    PhotoState.REJECTED_CONTENT,
  ],
  [PhotoState.LOW_QUALITY]: [PhotoState.RETAKE_REQUESTED],
  [PhotoState.RETAKE_REQUESTED]: [PhotoState.QUEUED],
  [PhotoState.FRAUD_REVIEW]: [PhotoState.CONFIRMED_FRAUD, PhotoState.CLEARED],
  [PhotoState.CLEARED]: [PhotoState.AI_REVIEW],
  [PhotoState.ACCEPTED]: [PhotoState.ARCHIVED],
  [PhotoState.REJECTED_CONTENT]: [],
  [PhotoState.REJECTED_SIZE]: [],
  [PhotoState.CONFIRMED_FRAUD]: [],
  [PhotoState.ABANDONED]: [],
  [PhotoState.ARCHIVED]: [],
};

export function canTransitionPhoto(from: PhotoState, to: PhotoState): boolean {
  if (from === to) return false;
  return PHOTO_TRANSITIONS[from]?.includes(to) ?? false;
}
