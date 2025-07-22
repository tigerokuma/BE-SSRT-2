# 🚨 Alert Module

This module handles all logic related to the `alert` feature of the OSS Repository Tracker.

> 📁 **Path:** `src/features/alert`

---

## 🏗️ Architecture Overview

This feature module follows NestJS best practices with a layered architecture:

- **Controllers** - Handle HTTP requests and responses for alert management
- **Services** - Contain business logic for alert processing and notifications
- **Repositories** - Manage data access and persistence for alert configurations
- **DTOs** - Provide type-safe data transfer objects for alert data
- **Entities** - Define alert models and notification structures

---

## 🛠️ Setup Instructions

### 1. Create Module Structure

```
features/alert/
├── controllers/
│   ├── alert.controller.ts
│   └── notification.controller.ts
├── dto/
│   ├── create-alert.dto.ts
│   ├── update-alert.dto.ts
│   ├── query-alert.dto.ts
│   └── notification-config.dto.ts
├── entities/
│   ├── alert.entity.ts
│   ├── alert-rule.entity.ts
│   └── notification.entity.ts
├── repositories/
│   ├── alert.repository.ts
│   └── notification.repository.ts
├── services/
│   ├── alert.service.ts
│   ├── notification.service.ts
│   └── alert-processor.service.ts
└── alert.module.ts
```

### 2. Register Module in AppModule

Add your module to the main application module:

```typescript
// src/app.module.ts
import { AlertModule } from './features/alert/alert.module';

@Module({
  imports: [
    // ... other modules
    AlertModule,
  ],
})
export class AppModule {}
```

### 3. Define Module Configuration

```typescript
// src/features/alert/alert.module.ts
import { Module } from '@nestjs/common';
import { AlertController } from './controllers/alert.controllers';
import { NotificationController } from './controllers/notification.controllers';
import { AlertService } from './services/alert.service';
import { NotificationService } from './services/notification.service';
import { AlertProcessorService } from './services/alert-processor.service';
import { AlertRepository } from './repositories/alert.repository';
import { NotificationRepository } from './repositories/notification.repository';

@Module({
  controllers: [AlertController, NotificationController],
  providers: [
    AlertService,
    NotificationService,
    AlertProcessorService,
    AlertRepository,
    NotificationRepository,
  ],
  exports: [AlertService, NotificationService],
})
export class AlertModule {}
```

### 4. Implement REST Endpoints

```typescript
// src/features/alert/controllers/alert.controllers.ts
@Controller('alerts')
export class AlertController {
  constructor(private readonly alertService: AlertService) {}

  @Get()
  findAll(@Query() queryDto: QueryAlertDto) {
    return this.alertService.findAll(queryDto);
  }

  @Post()
  create(@Body() createAlertDto: CreateAlertDto) {
    return this.alertService.create(createAlertDto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.alertService.findOne(id);
  }

  @Patch(':id/enable')
  enable(@Param('id') id: string) {
    return this.alertService.enable(id);
  }

  @Patch(':id/disable')
  disable(@Param('id') id: string) {
    return this.alertService.disable(id);
  }

  @Post(':id/test')
  testAlert(@Param('id') id: string) {
    return this.alertService.testAlert(id);
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
# Get all alerts
curl http://localhost:3000/alerts

# Create new alert
curl -X POST http://localhost:3000/alerts \
  -H "Content-Type: application/json" \
  -d '{"name": "High Activity Alert", "type": "activity_spike", "threshold": 100}'

# Enable an alert
curl -X PATCH http://localhost:3000/alerts/alert-123/enable

# Test an alert
curl -X POST http://localhost:3000/alerts/alert-123/test

# Get notifications
curl http://localhost:3000/notifications?status=unread
```

### Unit Tests

Run tests for this module:

```bash
npm test -- --testPathPattern=alert
```

---

## 📝 Development Guidelines

### Code Conventions

- **Dependency Injection**: Use constructor injection for services
  ```typescript
  constructor(private readonly alertService: AlertService) {}
  ```

- **Separation of Concerns**: Keep controllers thin, logic belongs in services
- **Data Access**: No direct database calls in controllers
- **Validation**: Use DTOs with class-validator decorators
- **Error Handling**: Implement proper exception handling

### Alert Types

Consider supporting these common alert types:
- `activity_spike` - Unusual activity increases
- `security_vulnerability` - Security issues detected
- `dependency_update` - New dependency versions
- `performance_degradation` - Performance issues
- `error_rate_increase` - Error rate thresholds
- `repository_changes` - Repository modifications
- `collaboration_events` - Team activity changes

### Notification Channels

Support multiple notification delivery methods:
- Email notifications
- Slack/Discord webhooks
- SMS alerts (critical only)
- In-app notifications
- Browser push notifications

### Implementation Strategy

1. **Start with Mock Data**: Begin with hardcoded alert configurations
2. **Define Schema**: Create DTOs and entities for different alert types
3. **Build Incrementally**: Implement one alert type at a time
4. **Add Processing**: Implement alert evaluation logic
5. **Add Notifications**: Connect notification channels
6. **Add Database**: Connect to actual data store once schema is stable

---

## ✅ Development Checklist

- [ ] `alert.module.ts` created and configured
- [ ] Module registered in `AppModule`
- [ ] Alert controller created with CRUD endpoints
- [ ] Notification controller created
- [ ] Alert service created with business logic
- [ ] Notification service implemented
- [ ] Alert processor service for rule evaluation
- [ ] Repositories created for data access
- [ ] DTOs defined for different alert types
- [ ] Entity models created for alerts and notifications
- [ ] Alert rule engine implemented
- [ ] Notification delivery system created
- [ ] Alert testing endpoints implemented
- [ ] Basic error handling implemented
- [ ] Unit tests written
- [ ] API endpoints tested manually
- [ ] Documentation updated

---
