-- AlterTable
ALTER TABLE "npm_packages" ADD COLUMN     "has_osvvulnerabilities" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "osv_vulnerabilities" JSONB;
