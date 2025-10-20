-- AlterTable
ALTER TABLE "public"."projects" ADD COLUMN     "health_alerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "license_alerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "vulnerability_alerts" BOOLEAN NOT NULL DEFAULT true;
