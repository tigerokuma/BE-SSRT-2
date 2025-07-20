# 🔄 Activity Module

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
import { ActivityController } from './controllers/activity.controller';
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
// src/features/activity/controllers/activity.controller.ts
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

### API Endpoints

#### Get Contributor Statistics
```bash
GET /activity/watchlist/{watchlistId}/contributor-stats
```

Returns detailed statistics for all contributors in a watchlist, ordered by total commits.

#### Get Repository Statistics
```bash
GET /activity/watchlist/{watchlistId}/repo-stats
```

Returns overall repository statistics including averages and patterns.

#### Manually Trigger Stats Calculation
```bash
POST /activity/watchlist/{watchlistId}/calculate-stats
```

Manually triggers the calculation of statistics for a watchlist (useful for existing repositories).

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

## ✅ Development Checklist

- [ ] `activity.module.ts` created and configured
- [ ] Module registered in `AppModule`
- [ ] Controller created with CRUD endpoints
- [ ] Service created with business logic
- [ ] Repository created for data access
- [ ] DTOs defined for different activity types
- [ ] Entity models created for activities and events
- [ ] Activity aggregation service implemented
- [ ] Activity filtering and querying implemented
- [ ] Statistics endpoints created
- [ ] Basic error handling implemented
- [ ] Unit tests written
- [ ] API endpoints tested manually
- [ ] Documentation updated

---
 