# 🔄 Activity Module Documentation

This module handles all logic related to the `activity` feature of the OSS Repository Tracker.

> 📁 **Path:** `src/features/activity`

---

## 🏗️ Architecture Overview

This feature module follows NestJS best practices with a layered architecture:

- **Controllers** - Handle HTTP requests and responses for activity tracking
- **Services** - Contain business logic for activity management and aggregation
- **Repositories** - Manage data access and persistence for activity records
- **DTOs** - Provide type-safe data transfer objects for activity data
- **Entities** - Define activity models and event structures

---

## 🛠️ Setup Instructions

### 1. Create Module Structure

```
features/activity/
├── controllers/
│   └── activity.controller.ts
├── dto/
│   ├── create-activity.dto.ts
│   ├── update-activity.dto.ts
│   ├── query-activity.dto.ts
│   └── activity-filter.dto.ts
├── entities/
│   ├── activity.entity.ts
│   └── activity-event.entity.ts
├── repositories/
│   └── activity.repository.ts
├── services/
│   ├── activity.service.ts
│   └── activity-aggregation.service.ts
└── activity.module.ts
```

### 2. Register Module in AppModule

Add your module to the main application module:

```typescript
// src/app.module.ts
import { ActivityModule } from './features/activity/activity.module';

@Module({
  imports: [
    // ... other modules
    ActivityModule,
  ],
})
export class AppModule {}
```

### 3. Define Module Configuration

```typescript
// src/features/activity/activity.module.ts
import { Module } from '@nestjs/common';
import { ActivityController } from './controllers/activity.controllers';
import { ActivityService } from './services/activity.service';
import { ActivityAggregationService } from './services/activity-aggregation.service';
import { ActivityRepository } from './repositories/activity.repository';

@Module({
  controllers: [ActivityController],
  providers: [ActivityService, ActivityAggregationService, ActivityRepository],
  exports: [ActivityService],
})
export class ActivityModule {}
```

### 4. Implement REST Endpoints

```typescript
// src/features/activity/controllers/activity.controllers.ts
@Controller('activities')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get()
  findAll(@Query() queryDto: QueryActivityDto) {
    return this.activityService.findAll(queryDto);
  }

  @Get('stats')
  getActivityStats(@Query() filterDto: ActivityFilterDto) {
    return this.activityService.getActivityStats(filterDto);
  }

  @Post()
  create(@Body() createActivityDto: CreateActivityDto) {
    return this.activityService.create(createActivityDto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.activityService.findOne(id);
  }
}
```

---

## 📊 Repository and Contributor Statistics

The activity module now includes comprehensive repository and contributor statistics tracking. This feature automatically calculates and stores detailed analytics about repository activity and individual contributor patterns.

### Database Schema

Two new tables have been added to track statistics:

#### `contributor_stats` Table
- **watchlist_id**: Reference to the watchlist
- **author_email**: Contributor's email address (unique per watchlist)
- **author_name**: Contributor's display name
- **total_commits**: Total number of commits by this contributor
- **avg_lines_added**: Average lines added per commit
- **avg_lines_deleted**: Average lines deleted per commit
- **avg_files_changed**: Average files changed per commit
- **commit_time_histogram**: JSON object showing commit frequency by hour
- **last_commit_date**: Date of the contributor's most recent commit
- **stddev_lines_added**: Standard deviation of lines added
- **stddev_lines_deleted**: Standard deviation of lines deleted
- **stddev_files_changed**: Standard deviation of files changed
- **typical_days_active**: JSON array of days when contributor is most active

#### `repo_stats` Table
- **watchlist_id**: Reference to the watchlist (unique)
- **total_commits**: Total number of commits in the repository
- **avg_lines_added**: Average lines added per commit across all contributors
- **avg_lines_deleted**: Average lines deleted per commit across all contributors
- **avg_files_changed**: Average files changed per commit across all contributors
- **commit_time_histogram**: JSON object showing overall commit frequency by hour
- **typical_days_active**: JSON object showing commit frequency by day of week
- **last_updated**: Timestamp of last statistics update

### Automatic Calculation

Statistics are automatically calculated during the repository setup process:

1. **Commit Logging**: When commits are logged to the database
2. **Stats Calculation**: Repository and contributor statistics are calculated
3. **Data Storage**: Results are stored in the respective tables
4. **Real-time Updates**: Statistics are updated whenever new commits are processed

### Implementation Details

#### GitManagerService Methods
- `updateContributorStats(watchlistId)`: Calculates and stores contributor statistics
- `updateRepoStats(watchlistId)`: Calculates and stores repository statistics
- `ensureStatsExist(watchlistId)`: Checks if stats exist and calculates them if missing

#### Integration Points
- **Repository Setup Processor**: Automatically calls stats calculation after commit logging
- **Activity Controller**: Provides API endpoints for accessing statistics
- **Database**: Uses Prisma for type-safe database operations

### Usage Examples

#### Accessing Contributor Stats
```typescript
// Get all contributors for a watchlist
const contributorStats = await this.prisma.contributorStats.findMany({
  where: { watchlist_id: watchlistId },
  orderBy: { total_commits: 'desc' }
});

// Get top contributor
const topContributor = contributorStats[0];
console.log(`Top contributor: ${topContributor.author_name} with ${topContributor.total_commits} commits`);
```

#### Accessing Repository Stats
```typescript
// Get repository statistics
const repoStats = await this.prisma.repoStats.findUnique({
  where: { watchlist_id: watchlistId }
});

console.log(`Repository has ${repoStats.total_commits} total commits`);
console.log(`Average lines added per commit: ${repoStats.avg_lines_added}`);
```

### Benefits

1. **Performance Insights**: Understand repository activity patterns
2. **Contributor Analysis**: Identify key contributors and their patterns
3. **Anomaly Detection**: Detect unusual commit patterns
4. **Trend Analysis**: Track changes in repository activity over time
5. **Risk Assessment**: Identify repositories with high bus factor risk

---

## 🧪 Testing

### Development Server

Start the development server:

```bash
npm run start:dev
```

### API Testing

Test your endpoints using curl or your preferred API client:

```bash
# Get all activities
curl http://localhost:3000/activities

# Get activity statistics
curl http://localhost:3000/activities/stats?period=week

# Create new activity
curl -X POST http://localhost:3000/activities \
  -H "Content-Type: application/json" \
  -d '{"type": "commit", "repositoryId": "repo-123", "userId": "user-456"}'

# Get specific activity
curl http://localhost:3000/activities/activity-id-123
```

### Unit Tests

Run tests for this module:

```bash
npm test -- --testPathPattern=activity
```

---

## 📝 Development Guidelines

### Code Conventions

- **Dependency Injection**: Use constructor injection for services
  ```typescript
  constructor(private readonly activityService: ActivityService) {}
  ```

- **Separation of Concerns**: Keep controllers thin, logic belongs in services
- **Data Access**: No direct database calls in controllers
- **Validation**: Use DTOs with class-validator decorators
- **Error Handling**: Implement proper exception handling

### Activity Types

Consider supporting these common activity types:
- `commit` - Code commits
- `pull_request` - PR creation/updates
- `issue` - Issue creation/updates
- `star` - Repository starring
- `fork` - Repository forking
- `watch` - Repository watching
- `release` - Version releases

### Implementation Strategy

1. **Start with Mock Data**: Begin with hardcoded activity records
2. **Define Schema**: Create DTOs and entities for different activity types
3. **Build Incrementally**: Implement one activity type at a time
4. **Add Aggregation**: Implement statistics and trending features
5. **Add Database**: Connect to actual data store once schema is stable

---

## 🚨 User Alerting System

The activity module now includes a comprehensive alerting system that monitors commits against user-defined thresholds and creates alerts when conditions are met.

### Alert Types

The system supports multiple types of alerts based on the actual alert configuration schema:

#### **Commit-Based Alerts**
- **Lines Added/Deleted**: Total lines changed in a commit
- **Files Changed**: Number of files modified in a commit
- **Suspicious Author Timestamps**: Commits outside contributor's typical time patterns
- **AI-Powered Anomaly Detection**: AI analysis of commit patterns for suspicious activity

#### **System Alerts**
- **New Vulnerabilities Detected**: When new critical vulnerabilities are found in the repository
- **Health Score Decreases**: When repository health score decreases significantly

#### **Threshold Types**
- **Hardcoded Threshold**: Fixed numeric threshold (e.g., > 1000 lines)
- **Contributor Variance**: Exceeds contributor's average + N standard deviations
- **Repository Variance**: Exceeds repository average by N multiplier

### User Configuration

Users can configure alerts by setting the `alerts` field in the `UserWatchlist` table as a JSON string:

```json
{
  "lines_added_deleted": {
    "enabled": true,
    "contributor_variance": 2.5,
    "repository_variance": 3.0,
    "hardcoded_threshold": 1000
  },
  "files_changed": {
    "enabled": true,
    "contributor_variance": 2.0,
    "repository_variance": 2.5,
    "hardcoded_threshold": 20
  },
  "suspicious_author_timestamps": {
    "enabled": true
  },
  "new_vulnerabilities_detected": {
    "enabled": true
  },
  "health_score_decreases": {
    "enabled": true,
    "minimum_health_change": 1.0
  },
  "ai_powered_anomaly_detection": {
    "enabled": true
  }
}
```

### Alert Processing

1. **Commit Detection**: When new commits are found during polling
2. **User Discovery**: Find all users watching the repository
3. **Threshold Checking**: Compare commit metrics against each user's thresholds
4. **Alert Creation**: Create `AlertTriggered` records for exceeded thresholds
5. **Notification**: Store detailed alert information for user review

### Alert Data Structure

Each alert includes:
- **Commit Information**: SHA, author, message, date, metrics
- **Threshold Context**: What threshold was exceeded and how
- **Statistical Context**: Repository and contributor averages for comparison
- **Alert Metadata**: Level, type, description, timestamps

---

## 🔄 Repository Polling System

The activity module now includes a comprehensive polling system that automatically checks repositories for new commits and updates statistics.

### Architecture

- **Daily Polling Job**: BullMQ job with delay that runs once daily to queue individual repository polling jobs
- **Individual Poll Jobs**: Process each repository in the watchlist
- **Smart Depth Adjustment**: Efficiently clones repositories with just enough depth to find the previous commit
- **Priority System**: Setup jobs take priority over polling jobs
- **Self-Scheduling**: Each daily polling job schedules the next one for tomorrow at midnight

### How It Works

1. **Initialization**: When the application starts, it schedules the first daily polling job for the next midnight
2. **Daily Trigger**: A BullMQ job with delay triggers daily polling at midnight
3. **Priority Check**: The system checks for active setup jobs first (they take priority)
4. **Repository Discovery**: Finds all repositories with `status: 'ready'` in the watchlist
5. **Job Queuing**: Queues individual polling jobs for each repository
6. **Next Schedule**: Schedules the next daily polling job for tomorrow at midnight
7. **Commit Detection**: Uses `git ls-remote` to get the latest commit SHA
8. **Smart Cloning**: Clones with increasing depth (2, 4, 8, 16, 32, 64, 128, 256, 512, 1024) until the previous commit is found
9. **Commit Logging**: Logs all new commits to the database
10. **Statistics Update**: Updates contributor and repository statistics
11. **Cleanup**: Removes temporary repository clones

### BullMQ Jobs

#### `polling` Queue
- **`daily-poll`**: Daily polling trigger job
  - Parameters: None
  - Delay: Scheduled for next midnight
  - Retries: 1 (no retry if fails)
  - Self-scheduling: Schedules next daily poll after completion

- **`poll-repo`**: Individual repository polling job
  - Parameters: `watchlistId`, `owner`, `repo`, `branch`
  - Priority: 1 (lower than setup jobs)
  - Retries: 3 with exponential backoff

### Database Updates

The polling system updates:
- `watchlist.latest_commit_sha`: Latest commit SHA for each repository
- `logs`: New commit records with full metadata
- `contributor_stats`: Updated contributor statistics
- `repo_stats`: Updated repository statistics
- `alert_triggered`: New alert records when thresholds are exceeded

### Error Handling

- **GitHub CLI Failures**: Logs warning and skips repository
- **Clone Failures**: Tries increasing depths, logs error if all fail
- **Statistics Failures**: Logs error but doesn't fail the entire process
- **Database Failures**: Throws error to trigger job retry

---

## 🔒 Weekly Vulnerability Checking System

The activity module now includes a comprehensive vulnerability checking system that automatically monitors repositories for new critical vulnerabilities and creates alerts.

### Architecture

- **Weekly Vulnerability Check Job**: BullMQ job with delay that runs once weekly to check all repositories for new vulnerabilities
- **GitHub Security Advisories**: Uses GitHub's Security Advisories API to fetch vulnerability data
- **Alert System**: Creates alerts in the `alert_triggered` table when new critical vulnerabilities are detected
- **Self-Scheduling**: Each weekly vulnerability check job schedules the next one for next week

### How It Works

1. **Initialization**: When the application starts, it schedules the first weekly vulnerability check job for next week
2. **Weekly Trigger**: A BullMQ job with delay triggers vulnerability checking weekly
3. **Repository Discovery**: Finds all repositories with `status: 'ready'` in the watchlist
4. **Vulnerability Fetching**: For each repository, fetches latest vulnerabilities from GitHub Security Advisories API
5. **Comparison**: Compares new vulnerability count with previously stored count
6. **Alert Creation**: If new critical vulnerabilities are found, creates alerts for all users watching the repository
7. **Database Update**: Stores new vulnerability data in the database
8. **Next Schedule**: Schedules the next weekly vulnerability check job for next week

### BullMQ Jobs

#### `vulnerability-check` Queue
- **`weekly-vulnerability-check`**: Weekly vulnerability check trigger job
  - Parameters: None
  - Delay: Scheduled for next week
  - Retries: 1 (no retry if fails)
  - Self-scheduling: Schedules next weekly check after completion

- **`check-single-repository`**: Individual repository vulnerability check job
  - Parameters: `watchlistId`
  - Retries: 3 with exponential backoff

### Database Updates

The vulnerability checking system updates:
- `vulnerabilities`: New vulnerability records with full metadata
- `vulnerability_summaries`: Updated vulnerability summary statistics
- `alert_triggered`: New alert records when critical vulnerabilities are detected

### Alert Details

When a critical vulnerability is detected, the system creates alerts with:
- **Alert Level**: `critical`
- **Metric**: `critical_vulnerability_detected`
- **Contributor**: `security-system`
- **Commit SHA**: `vulnerability-check` (special identifier)
- **Description**: Includes vulnerability title and repository name
- **Details**: Full vulnerability information including CVE ID, description, affected versions, etc.

### Error Handling

- **GitHub API Failures**: Logs warning and skips repository
- **Database Failures**: Logs error but doesn't fail the entire process
- **Rate Limiting**: Includes delays between API calls to avoid rate limiting

### Configuration

The system uses the same GitHub token (`GITHUB_TOKEN`) as other GitHub API operations for authentication.

---

## 🏥 Monthly Health Checking System

The activity module now includes a comprehensive health checking system that automatically analyzes repository health using Scorecard every 2 months.

### Architecture

- **Monthly Health Check Job**: BullMQ job with delay that runs every 2 months to check all repositories for health
- **Scorecard Integration**: Uses OpenSSF Scorecard CLI to analyze repository health metrics
- **Health Data Storage**: Stores health analysis results in the `health_data` table
- **Self-Scheduling**: Each monthly health check job schedules the next one for 2 months later

### How It Works

1. **Initialization**: When manually triggered, it schedules the first monthly health check job for 2 months from now
2. **Monthly Trigger**: A BullMQ job with delay triggers health checking every 2 months
3. **Repository Discovery**: Finds all repositories with `status: 'ready'` in the watchlist
4. **Health Analysis**: For each repository, runs Scorecard analysis on the latest commit
5. **Data Storage**: Stores health metrics and overall health score in the database
6. **Next Schedule**: Schedules the next monthly health check job for 2 months later

### BullMQ Jobs

#### `health-check` Queue
- **`monthly-health-check`**: Monthly health check trigger job
  - Parameters: None
  - Delay: Scheduled for 2 months from now
  - Retries: 1 (no retry if fails)
  - Self-scheduling: Schedules next monthly check after completion

- **`check-single-repository-health`**: Individual repository health check job
  - Parameters: `watchlistId`
  - Retries: 3 with exponential backoff

### Database Updates

The health checking system updates:
- `health_data`: New health analysis records with Scorecard metrics and overall health score

### Health Metrics

The system analyzes and stores:
- **Overall Health Score**: 0-10 scale based on Scorecard results
- **Scorecard Metrics**: Detailed check results including:
  - Security checks (SAST, Code Review, etc.)
  - Maintenance checks (CI/CD, Dependencies, etc.)
  - License checks
  - Documentation checks
- **Commit Information**: SHA and date of analyzed commit
- **Analysis Metadata**: Timestamp and source information

### Error Handling

- **Scorecard Failures**: Logs warning and skips repository
- **Database Failures**: Logs error but doesn't fail the entire process
- **Rate Limiting**: Includes delays between repositories to avoid overwhelming the system

### Configuration

The system uses the Scorecard CLI path configured via `SCORECARD_PATH` environment variable.

---
