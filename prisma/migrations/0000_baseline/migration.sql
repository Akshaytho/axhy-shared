-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'COMPANY_ADMIN');

-- CreateEnum
CREATE TYPE "AsnEventType" AS ENUM ('CREATED', 'AUTO_FILLED', 'PINNED', 'ABSENCE_DETECTED', 'REPLACEMENT_SENT', 'REPLACEMENT_ACCEPTED', 'SUPERVISOR_OVERRIDE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssignmentSource" AS ENUM ('MANUAL_PIN', 'AUTO_FILL', 'REPLACEMENT');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'INCOMPLETE', 'REPLACED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('HARD_DELETE_WORKER', 'HARD_DELETE_SITE', 'HARD_DELETE_ASSIGNMENT', 'SAFE_DELETE_WORKER', 'SAFE_DELETE_SITE', 'SAFE_DELETE_ASSIGNMENT', 'GDPR_ANONYMIZE_WORKER', 'GDPR_ANONYMIZE_SITE');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('SICK', 'FAMILY', 'EMERGENCY', 'TRANSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "LifecycleStatus" AS ENUM ('ASSIGNED', 'CHECKED_IN', 'IN_PROGRESS', 'SUBMITTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('WORKER', 'SUPERVISOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "SitePriority" AS ENUM ('HIGH', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "SkillType" AS ENUM ('ALL', 'GENERAL', 'MARBLE_POLISH', 'GLASS_CLEANING', 'WASHROOM', 'PARKING', 'GARDEN');

-- CreateEnum
CREATE TYPE "SwapReason" AS ENUM ('TOO_FAR', 'SITE_ISSUE', 'HEALTH', 'PERSONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "SwapStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'DENIED', 'RESOLVED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "SwapUrgency" AS ENUM ('PLANNED', 'IMMEDIATE');

-- CreateEnum
CREATE TYPE "VerificationOutcome" AS ENUM ('PENDING', 'VERIFIED', 'PARTIAL', 'FLAGGED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WorkerType" AS ENUM ('ASSIGNED', 'FLOATER');

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "targetId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "companyId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "error" TEXT,
    "summary" TEXT,
    "metrics" JSONB,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "timeStart" TEXT NOT NULL,
    "timeEnd" TEXT NOT NULL,
    "days" INTEGER[],
    "skipDates" TIMESTAMP(3)[],
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "date" TIMESTAMP(3),
    "source" "AssignmentSource" NOT NULL DEFAULT 'MANUAL_PIN',
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "reasonLog" JSONB,
    "replacedByAsnId" TEXT,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentEvent" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "eventType" "AsnEventType" NOT NULL,
    "payload" JSONB,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "registrationCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactSubmission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "workerCount" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GpsTrailPoint" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GpsTrailPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "LeaveType" NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "hash" TEXT,
    "gpsLat" DOUBLE PRECISION,
    "gpsLng" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "qrSecret" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "instructions" TEXT,
    "companyId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "requiredWorkers" INTEGER NOT NULL DEFAULT 1,
    "sitePriority" "SitePriority" NOT NULL DEFAULT 'NORMAL',
    "mustCompleteBefore" TEXT,
    "requiredSkills" JSONB,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteVisit" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "checkinAt" TIMESTAMP(3),
    "checkoutAt" TIMESTAMP(3),
    "checkinLat" DOUBLE PRECISION,
    "checkinLng" DOUBLE PRECISION,
    "qrVerified" BOOLEAN NOT NULL DEFAULT false,
    "beforePhotoCount" INTEGER NOT NULL DEFAULT 0,
    "afterPhotoCount" INTEGER NOT NULL DEFAULT 0,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "aiScore" INTEGER,
    "aiReasoning" TEXT,
    "aiModelVersion" TEXT,
    "supervisorNotes" TEXT,
    "earningsPaise" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lifecycleStatus" "LifecycleStatus" NOT NULL DEFAULT 'ASSIGNED',
    "submissionId" TEXT,
    "verificationOutcome" "VerificationOutcome" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "SiteVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusLog" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "changedBy" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromLifecycle" "LifecycleStatus",
    "fromOutcome" "VerificationOutcome",
    "toLifecycle" "LifecycleStatus",
    "toOutcome" "VerificationOutcome",
    "changedByLabel" TEXT,

    CONSTRAINT "StatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwapRequest" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fromSiteId" TEXT NOT NULL,
    "preferredSiteId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "reason" "SwapReason" NOT NULL,
    "note" TEXT,
    "urgency" "SwapUrgency" NOT NULL DEFAULT 'PLANNED',
    "status" "SwapStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvedBy" TEXT,
    "approvalNote" TEXT,
    "resolvedByAgent" BOOLEAN NOT NULL DEFAULT false,
    "resolution" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SwapRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL,
    "companyId" TEXT NOT NULL,
    "deviceId" TEXT,
    "aadhaarHash" TEXT,
    "faceVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workerType" "WorkerType",
    "maxSitesPerDay" INTEGER NOT NULL DEFAULT 3,
    "homeLat" DOUBLE PRECISION,
    "homeLng" DOUBLE PRECISION,
    "skills" "SkillType"[],
    "groupId" TEXT,
    "baseSalaryPaise" INTEGER,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationSnapshot" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "ruleScore" INTEGER NOT NULL,
    "ruleBreakdown" JSONB NOT NULL,
    "aiScore" DOUBLE PRECISION NOT NULL,
    "aiLabel" TEXT NOT NULL,
    "aiReasoning" TEXT NOT NULL,
    "aiFraudProbability" DOUBLE PRECISION NOT NULL,
    "aiModelVersion" TEXT NOT NULL,
    "combinedScore" INTEGER NOT NULL,
    "finalOutcome" "VerificationOutcome" NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_idx" ON "AdminAuditLog"("action" ASC);

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminUserId_idx" ON "AdminAuditLog"("adminUserId" ASC);

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetId_idx" ON "AdminAuditLog"("targetId" ASC);

-- CreateIndex
CREATE INDEX "AdminUser_companyId_idx" ON "AdminUser"("companyId" ASC);

-- CreateIndex
CREATE INDEX "AdminUser_email_idx" ON "AdminUser"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email" ASC);

-- CreateIndex
CREATE INDEX "AgentRun_companyId_agentName_idx" ON "AgentRun"("companyId" ASC, "agentName" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_companyId_agentName_targetDate_key" ON "AgentRun"("companyId" ASC, "agentName" ASC, "targetDate" ASC);

-- CreateIndex
CREATE INDEX "AgentRun_startedAt_idx" ON "AgentRun"("startedAt" ASC);

-- CreateIndex
CREATE INDEX "AgentRun_status_idx" ON "AgentRun"("status" ASC);

-- CreateIndex
CREATE INDEX "Assignment_companyId_date_idx" ON "Assignment"("companyId" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "Assignment_companyId_idx" ON "Assignment"("companyId" ASC);

-- CreateIndex
CREATE INDEX "Assignment_date_idx" ON "Assignment"("date" ASC);

-- CreateIndex
CREATE INDEX "Assignment_siteId_idx" ON "Assignment"("siteId" ASC);

-- CreateIndex
CREATE INDEX "Assignment_workerId_idx" ON "Assignment"("workerId" ASC);

-- CreateIndex
CREATE INDEX "Assignment_workerId_siteId_idx" ON "Assignment"("workerId" ASC, "siteId" ASC);

-- CreateIndex
CREATE INDEX "AssignmentEvent_assignmentId_idx" ON "AssignmentEvent"("assignmentId" ASC);

-- CreateIndex
CREATE INDEX "AssignmentEvent_createdAt_idx" ON "AssignmentEvent"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "AssignmentEvent_eventType_idx" ON "AssignmentEvent"("eventType" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Company_registrationCode_key" ON "Company"("registrationCode" ASC);

-- CreateIndex
CREATE INDEX "Company_slug_idx" ON "Company"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug" ASC);

-- CreateIndex
CREATE INDEX "ContactSubmission_createdAt_idx" ON "ContactSubmission"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "ContactSubmission_email_idx" ON "ContactSubmission"("email" ASC);

-- CreateIndex
CREATE INDEX "GpsTrailPoint_visitId_idx" ON "GpsTrailPoint"("visitId" ASC);

-- CreateIndex
CREATE INDEX "GpsTrailPoint_visitId_recordedAt_idx" ON "GpsTrailPoint"("visitId" ASC, "recordedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "GpsTrailPoint_visitId_recordedAt_lat_lng_key" ON "GpsTrailPoint"("visitId" ASC, "recordedAt" ASC, "lat" ASC, "lng" ASC);

-- CreateIndex
CREATE INDEX "LeaveRequest_companyId_idx" ON "LeaveRequest"("companyId" ASC);

-- CreateIndex
CREATE INDEX "LeaveRequest_date_idx" ON "LeaveRequest"("date" ASC);

-- CreateIndex
CREATE INDEX "LeaveRequest_workerId_date_idx" ON "LeaveRequest"("workerId" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "LeaveRequest_workerId_idx" ON "LeaveRequest"("workerId" ASC);

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId" ASC);

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId" ASC, "isRead" ASC);

-- CreateIndex
CREATE INDEX "Photo_hash_idx" ON "Photo"("hash" ASC);

-- CreateIndex
CREATE INDEX "Photo_sessionId_idx" ON "Photo"("sessionId" ASC);

-- CreateIndex
CREATE INDEX "Photo_visitId_idx" ON "Photo"("visitId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Photo_visitId_r2Key_key" ON "Photo"("visitId" ASC, "r2Key" ASC);

-- CreateIndex
CREATE INDEX "Site_companyId_idx" ON "Site"("companyId" ASC);

-- CreateIndex
CREATE INDEX "SiteVisit_assignmentId_createdAt_idx" ON "SiteVisit"("assignmentId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "SiteVisit_assignmentId_idx" ON "SiteVisit"("assignmentId" ASC);

-- CreateIndex
CREATE INDEX "SiteVisit_lifecycleStatus_verificationOutcome_idx" ON "SiteVisit"("lifecycleStatus" ASC, "verificationOutcome" ASC);

-- CreateIndex
CREATE INDEX "SiteVisit_sessionId_idx" ON "SiteVisit"("sessionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SiteVisit_sessionId_key" ON "SiteVisit"("sessionId" ASC);

-- CreateIndex
CREATE INDEX "SiteVisit_siteId_idx" ON "SiteVisit"("siteId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SiteVisit_submissionId_key" ON "SiteVisit"("submissionId" ASC);

-- CreateIndex
CREATE INDEX "SiteVisit_workerId_createdAt_idx" ON "SiteVisit"("workerId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "SiteVisit_workerId_idx" ON "SiteVisit"("workerId" ASC);

-- CreateIndex
CREATE INDEX "StatusLog_changedBy_idx" ON "StatusLog"("changedBy" ASC);

-- CreateIndex
CREATE INDEX "StatusLog_visitId_createdAt_idx" ON "StatusLog"("visitId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "StatusLog_visitId_idx" ON "StatusLog"("visitId" ASC);

-- CreateIndex
CREATE INDEX "SwapRequest_companyId_idx" ON "SwapRequest"("companyId" ASC);

-- CreateIndex
CREATE INDEX "SwapRequest_date_idx" ON "SwapRequest"("date" ASC);

-- CreateIndex
CREATE INDEX "SwapRequest_fromSiteId_idx" ON "SwapRequest"("fromSiteId" ASC);

-- CreateIndex
CREATE INDEX "SwapRequest_status_idx" ON "SwapRequest"("status" ASC);

-- CreateIndex
CREATE INDEX "SwapRequest_workerId_idx" ON "SwapRequest"("workerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_aadhaarHash_key" ON "User"("aadhaarHash" ASC);

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId" ASC);

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone" ASC);

-- CreateIndex
CREATE INDEX "VerificationSnapshot_createdAt_idx" ON "VerificationSnapshot"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "VerificationSnapshot_finalOutcome_idx" ON "VerificationSnapshot"("finalOutcome" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "VerificationSnapshot_visitId_key" ON "VerificationSnapshot"("visitId" ASC);

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentEvent" ADD CONSTRAINT "AssignmentEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsTrailPoint" ADD CONSTRAINT "GpsTrailPoint_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "SiteVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "SiteVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusLog" ADD CONSTRAINT "StatusLog_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusLog" ADD CONSTRAINT "StatusLog_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "SiteVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapRequest" ADD CONSTRAINT "SwapRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapRequest" ADD CONSTRAINT "SwapRequest_fromSiteId_fkey" FOREIGN KEY ("fromSiteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapRequest" ADD CONSTRAINT "SwapRequest_preferredSiteId_fkey" FOREIGN KEY ("preferredSiteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapRequest" ADD CONSTRAINT "SwapRequest_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationSnapshot" ADD CONSTRAINT "VerificationSnapshot_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "SiteVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

