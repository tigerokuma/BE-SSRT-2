-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "description" TEXT,
ADD COLUMN     "homepage" TEXT,
ADD COLUMN     "keywords" TEXT[],
ADD COLUMN     "license" TEXT,
ADD COLUMN     "maintainers" TEXT[],
ADD COLUMN     "npm_url" TEXT,
ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "version" TEXT;
