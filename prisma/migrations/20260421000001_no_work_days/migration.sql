-- CreateEnum
CREATE TYPE "NoWorkDayScope" AS ENUM ('COMPANY', 'SITE', 'WORKERS');

-- CreateTable
CREATE TABLE "NoWorkDay" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date"      DATE NOT NULL,
    "scope"     "NoWorkDayScope" NOT NULL,
    "siteId"    TEXT,
    "workerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "name"      TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoWorkDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NoWorkDay_companyId_date_scope_siteId_key"
  ON "NoWorkDay"("companyId", "date", "scope", "siteId");

-- CreateIndex
CREATE INDEX "NoWorkDay_companyId_date_idx"
  ON "NoWorkDay"("companyId", "date");

-- AddForeignKey
ALTER TABLE "NoWorkDay"
  ADD CONSTRAINT "NoWorkDay_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoWorkDay"
  ADD CONSTRAINT "NoWorkDay_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
