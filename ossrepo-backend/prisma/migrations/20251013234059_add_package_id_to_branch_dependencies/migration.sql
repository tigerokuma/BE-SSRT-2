-- AlterTable
ALTER TABLE "public"."branch_dependencies" ADD COLUMN     "package_id" TEXT;

-- CreateIndex
CREATE INDEX "branch_dependencies_package_id_idx" ON "public"."branch_dependencies"("package_id");

-- AddForeignKey
ALTER TABLE "public"."branch_dependencies" ADD CONSTRAINT "branch_dependencies_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."Package"("package_id") ON DELETE SET NULL ON UPDATE CASCADE;
