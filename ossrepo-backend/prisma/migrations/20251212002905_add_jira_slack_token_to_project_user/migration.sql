-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "jira_access_token" TEXT,
ADD COLUMN     "jira_refresh_token" TEXT,
ADD COLUMN     "slack_access_token" TEXT,
ADD COLUMN     "slack_refresh_token" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "jira_access_token" TEXT,
ADD COLUMN     "jira_refresh_token" TEXT,
ADD COLUMN     "slack_access_token" TEXT,
ADD COLUMN     "slack_refresh_token" TEXT;

-- CreateTable
CREATE TABLE "project_jira" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "webtrigger_url" TEXT NOT NULL,
    "project_key" TEXT,
    "cloud_id" TEXT,

    CONSTRAINT "project_jira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_slack" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "slack_token" TEXT NOT NULL,
    "slack_channel" TEXT,

    CONSTRAINT "project_slack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_jira_project_id_key" ON "project_jira"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_slack_project_id_key" ON "project_slack"("project_id");

-- AddForeignKey
ALTER TABLE "project_jira" ADD CONSTRAINT "project_jira_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_slack" ADD CONSTRAINT "project_slack_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
