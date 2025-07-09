# 🧩 Graph Module

This module handles all logic related to the `graph` feature of the OSS Repository Tracker.

> 📁 **Path:** `src/features/graph`

---

## 🏗️ Architecture Overview

This feature module follows NestJS best practices with a layered architecture:

- **Controllers** - Handle HTTP requests and responses
- **Services** - Contain business logic and orchestration
- **Repositories** - Manage data access and persistence
- **DTOs** - Provide type-safe data transfer objects
- **Entities** - Define data models and structures

---

## 🛠️ Setup Instructions

### 1. Create Module Structure

```
features/graph/
├── controllers/
│   └── graph.controller.ts
├── dto/
│   ├── create-graph.dto.ts
│   ├── update-graph.dto.ts
│   └── query-graph.dto.ts
├── entities/
│   └── graph.entity.ts
├── repositories/
│   └── graph.repository.ts
├── services/
│   └── graph.service.ts
└── graph.module.ts
```

### 2. Register Module in AppModule

Add your module to the main application module:

```typescript
// src/app.module.ts
import { GraphModule } from './features/graph/graph.module';

@Module({
  imports: [
    // ... other modules
    GraphModule,
  ],
})
export class AppModule {}
```

### 3. Define Module Configuration

```typescript
// src/features/graph/graph.module.ts
import { Module } from '@nestjs/common';
import { GraphController } from './controllers/graph.controllers';
import { GraphService } from './services/graph.service';
import { GraphRepository } from './repositories/graph.repository';

@Module({
  controllers: [GraphController],
  providers: [GraphService, GraphRepository],
  exports: [GraphService],
})
export class GraphModule {}
```

### 4. Implement REST Endpoints

```typescript
// src/features/graph/controllers/graph.controllers.ts
@Controller('graph')
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  @Get()
  findAll() {
    return this.graphService.findAll();
  }

  @Post()
  create(@Body() createGraphDto: CreateGraphDto) {
    return this.graphService.create(createGraphDto);
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
# Get all graph data
curl http://localhost:3000/graph

# Create new graph data
curl -X POST http://localhost:3000/graph \
  -H "Content-Type: application/json" \
  -d '{"name": "example", "data": {}}'
```

### Unit Tests

Run tests for this module:

```bash
npm test -- --testPathPattern=graph
```

---

## 📝 Development Guidelines

### Code Conventions

- **Dependency Injection**: Use constructor injection for services
  ```typescript
  constructor(private readonly graphService: GraphService) {}
  ```

- **Separation of Concerns**: Keep controllers thin, logic belongs in services
- **Data Access**: No direct database calls in controllers
- **Validation**: Use DTOs with class-validator decorators
- **Error Handling**: Implement proper exception handling

### Implementation Strategy

1. **Start with Mock Data**: Begin with hardcoded responses in services
2. **Define Schema**: Create DTOs and entities first
3. **Build Incrementally**: Implement one endpoint at a time
4. **Add Database**: Connect to actual data store once schema is stable

---

## ✅ Development Checklist

- [ ] `graph.module.ts` created and configured
- [ ] Module registered in `AppModule`
- [ ] Controller created with basic endpoints
- [ ] Service created with business logic
- [ ] Repository created for data access
- [ ] DTOs defined for request/response validation
- [ ] Entity models created
- [ ] Basic error handling implemented
- [ ] Unit tests written
- [ ] API endpoints tested manually
- [ ] Documentation updated

---

