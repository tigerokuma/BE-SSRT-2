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
 