/*
  Warnings:

  - A unique constraint covering the columns `[package_name]` on the table `Package` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Package_repo_url_key";

-- CreateIndex
CREATE UNIQUE INDEX "Package_package_name_key" ON "Package"("package_name");
