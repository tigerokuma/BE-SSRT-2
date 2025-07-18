🚀 REPOSITORY SETUP
[x] Initial Repository Analysis - COMPLETED
  - Clone/fetch repository
  - Fetch commits via GitHub API or local git
  - Run Scorecard health analysis
  - Calculate bus factor and risk assessment
  - Log commits and health metrics

🚀 POLLING & EVENT DETECTION
[ ] Implement Polling Queue
 Create polling_schedule table:

repo_id

next_poll_time

poll_interval_minutes

 Cron job every few minutes:

Query all repos where next_poll_time <= now() LIMIT N

For each repo:

Call git ls-remote {repo_url} to get latest SHA of refs/heads/{mainBranch}

Compare SHA to latest stored in DB

If new:

Enqueue repo into Health Metrics Pipeline

Update next_poll_time

🚀 GIT OPERATIONS
[ ] Efficient Clone on Update
 When new commits detected:

Use:

bash
Copy
Edit
git clone --depth={n} --branch={mainBranch} {repo_url}
where {n} = number of commits since last SHA (from GitHub API or estimate)

 Alternative:

Perform git fetch

Run:

lua
Copy
Edit
git log {previousSHA}..origin/{mainBranch} --pretty=format:...
to get list of commits since last check

🚀 LOG NORMALIZATION
[ ] Store Normalized Commits
For each fetched commit:

Save:

SHA

Author

Email

Date

Message

Files changed

Lines added

Lines deleted

Update contributor statistics table

🚀 HEALTH METRICS PIPELINE
[ ] Run Scorecard
Use:

Docker image:

lua
Copy
Edit
docker run gcr.io/openssf/scorecard:stable --repo={repo_url}
Store:

Scorecard metrics for each run

Timestamps for trend tracking

🚀 ADDITIONAL REPOSITORY ANALYTICS
✨ Activity Score & File Churn
[ ] Compute Activity Score
Calculate overall repository activity level (0-100) based on:
- Commit frequency over time
- Number of active contributors
- Lines of code changed
- File modification patterns

[ ] File Churn Analysis
Track file modification patterns:
- Files with most commits (hotspot files)
- Lines added/deleted per file
- Churn rate over time
- Top N most active files

✨ Activity Heatmaps
[ ] Generate Time-Based Activity Heatmaps
Create heatmaps showing:
- Commit activity by day of week and hour
- File modification patterns over time
- Contributor work patterns
- Peak activity periods

✨ AI-Powered Repository Summary
[x] Implement AI Summary Generation - COMPLETED
Generate 2-3 sentence repository overview using:
- Recent commit activity
- Health scores and bus factor
- Repository description and metadata
- File churn and activity patterns
- Contributor statistics
Uses local Mistral 7B model via Ollama for cost-free, private processing

✨ Language & Code Size Metrics
[ ] Integrate cloc
Tool:

cloc

Usage:

Copy
Edit
cloc {repo_path}
Store:

Language breakdown

Total files

Total LOC

✨ Code Hotspots / Churn
[ ] Compute File Churn
Use:

lua
Copy
Edit
git log --name-only --pretty=format:
Count:

How often each file changed

Store:

Top N hotspot files

✨ Contributor Insights
[ ] Contributor Statistics Table
Table:

markdown
Copy
Edit
contributor_stats
  - contributor_id
  - repo_id
  - total_commits
  - avg_lines_added
  - avg_lines_deleted
  - avg_files_changed
  - typical_commit_times (histogram or avg)
Each new commit:

Update contributor’s stats

Compute deltas vs prior averages

✨ Anomaly Detection
[ ] Implement Anomaly Alerts
Check:

Commits outside normal hours for contributor

High churn vs contributor baseline

Excessive deletions

Sudden spikes in files changed

Approach:

Calculate z-scores:

ini
Copy
Edit
z = (value - mean) / stddev
Alert:

Mild = > 2σ

Critical = > 3σ

Track alerts in:

markdown
Copy
Edit
alerts table
  - repo_id
  - contributor_id
  - timestamp
  - metric_type
  - severity
  - message
✨ Heatmap of Activity
[ ] Generate Heatmap Data
Bucket commits by:

Day of week

Hour of day

Save:

markdown
Copy
Edit
activity_heatmap
  - repo_id
  - day_of_week
  - hour_of_day
  - commit_count
✨ AI-Powered Weekly Summaries
[ ] Weekly AI Summaries
Aggregate:

New commits

Major authors

Notable file changes

Detected anomalies

Health score deltas

Summarize using:

OpenAI API

sql
Copy
Edit
system: You are a technical summary generator...
user: Here’s the data from this week...
Save summary text per week

✨ Additional Integrations
[ ] Integrate Gitleaks (Optional)
Detect secrets in commits

Tool:

Gitleaks

Usage:

bash
Copy
Edit
gitleaks detect --source={repo_path}
🚀 FRONTEND VISUALIZATION
[ ] New Dashboards
Health metrics graphs over time

Hotspot files list

Anomaly alerts list

Contributor charts

AI-generated summaries

Heatmap of activity

✨ Other Nice-To-Haves
[x] Track “truck factor” (bus factor) - COMPLETED