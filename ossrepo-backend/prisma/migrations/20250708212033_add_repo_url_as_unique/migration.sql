/*
  Warnings:

  - The primary key for the `Package` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `repo_id` on the `Package` table. All the data in the column will be lost.
  - You are about to drop the column `repo_id` on the `Watchlist` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[repo_url]` on the table `Package` will be added. If there are existing duplicate values, this will fail.
  - The required column `package_id` was added to the `Package` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `package_id` to the `Watchlist` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Watchlist" DROP CONSTRAINT "Watchlist_repo_id_fkey";

-- AlterTable
ALTER TABLE "Package" DROP CONSTRAINT "Package_pkey",
DROP COLUMN "repo_id",
ADD COLUMN     "package_id" TEXT NOT NULL,
ADD CONSTRAINT "Package_pkey" PRIMARY KEY ("package_id");

-- AlterTable
ALTER TABLE "Watchlist" DROP COLUMN "repo_id",
ADD COLUMN     "package_id" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Package_repo_url_key" ON "Package"("repo_url");

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "Package"("package_id") ON DELETE RESTRICT ON UPDATE CASCADE;
