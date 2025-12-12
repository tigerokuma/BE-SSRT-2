-- AlterTable
ALTER TABLE "public"."projects" ADD COLUMN "github_app_installation_id" TEXT,
ADD COLUMN "github_actions_enabled" BOOLEAN NOT NULL DEFAULT true;

