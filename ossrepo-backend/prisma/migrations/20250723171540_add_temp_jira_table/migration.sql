-- CreateTable
CREATE TABLE "TempJira" (
    "code" TEXT NOT NULL,
    "project_key" TEXT NOT NULL,
    "webtrigger_url" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TempJira_code_key" ON "TempJira"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TempJira_webtrigger_url_project_key_key" ON "TempJira"("webtrigger_url", "project_key");
