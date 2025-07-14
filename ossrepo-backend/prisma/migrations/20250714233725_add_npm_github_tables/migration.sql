-- CreateTable
CREATE TABLE "npm_packages" (
    "package_name" TEXT NOT NULL,
    "description" TEXT,
    "version" TEXT,
    "downloads" INTEGER,
    "keywords" TEXT[],
    "license" TEXT,
    "npm_url" TEXT,
    "homepage" TEXT,
    "published_at" TIMESTAMP(3),
    "last_updated" TIMESTAMP(3),
    "maintainers" TEXT[],
    "risk_score" DOUBLE PRECISION,
    "repo_url" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "npm_packages_pkey" PRIMARY KEY ("package_name")
);

-- CreateTable
CREATE TABLE "github_repositories" (
    "repo_url" TEXT NOT NULL,
    "repo_name" TEXT,
    "owner" TEXT,
    "stars" INTEGER,
    "forks" INTEGER,
    "contributors" INTEGER,
    "topics" TEXT[],
    "pushed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "default_branch" TEXT,
    "language" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_repositories_pkey" PRIMARY KEY ("repo_url")
);

-- AddForeignKey
ALTER TABLE "npm_packages" ADD CONSTRAINT "npm_packages_repo_url_fkey" FOREIGN KEY ("repo_url") REFERENCES "github_repositories"("repo_url") ON DELETE SET NULL ON UPDATE CASCADE;
