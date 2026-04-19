/**
 * Domain entity shapes used by both repos. NOT Prisma models — these are the
 * lean DTOs that cross the wire.
 */

import type { VisitState } from "../state-machines/visit";
import type { WorkerState } from "../state-machines/worker";
import type { SiteState } from "../state-machines/site";

export interface WorkerDTO {
  id: string;
  name: string;
  phoneMasked: string;
  state: WorkerState;
  companyId: string;
}

export interface SiteDTO {
  id: string;
  name: string;
  state: SiteState;
  geofence: {
    lat: number;
    lng: number;
    radiusM: number;
  };
  graceMinutes: number;
  companyId: string;
}

export interface VisitDTO {
  id: string;
  assignmentId: string;
  siteId: string;
  workerId: string;
  lifecycleStatus: VisitState;
  scheduledStart: string;
  scheduledEnd: string;
  postComplaintReviewed: boolean;
  companyId: string;
}
