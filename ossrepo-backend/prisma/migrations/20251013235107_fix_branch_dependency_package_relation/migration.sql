-- DropForeignKey
ALTER TABLE "public"."branch_dependencies" DROP CONSTRAINT "branch_dependencies_package_id_fkey";

-- AddForeignKey
ALTER TABLE "public"."branch_dependencies" ADD CONSTRAINT "branch_dependencies_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."Packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
