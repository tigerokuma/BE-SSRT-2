# Team Guide: Creating Endpoints with Prisma

Here's a **step-by-step guide** for your team to create new endpoints using the architecture you've set up.

## 🏗️ Current Setup (Already Done)

✅ **Database**: PostgreSQL connected via Prisma  
✅ **Prisma Service**: Available globally in all modules  
✅ **Architecture**: Controller → Service → Repository → Database

## 📝 Step-by-Step: Creating a New Endpoint

### **Step 1: Define what you want to build**

Example: *"I want to create an endpoint to get user's watchlist items"*

- **HTTP Method**: `GET`
- **URL**: `/api/watchlist`
- **Response**: List of watchlist items with repository info

### **Step 2: Start with the DTO (Data Transfer Object)**

Define your request/response structure:

```typescript:src/features/watchlist/dto/watchlist.dto.ts
// Add to existing file
export class GetWatchlistResponse {
  id: string;
  notes?: string;
  added_at: Date;
  repository: {
    package_name: string;
    repo_url: string;
    stars?: number;
    risk_score?: number;
  };
}
```

### **Step 3: Implement Repository (Database Layer)**

Add method to handle database operations:

```typescript:src/features/watchlist/repositories/watchlist.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class WatchlistRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Add this method
  async getUserWatchlist(userId: string) {
    return this.prisma.userWatchlist.findMany({
      where: { user_id: userId },
      include: {
        watchlist: {
          include: {
            metadata: true, // Include repository info
          },
        },
      },
      orderBy: { added_at: 'desc' },
    });
  }
}
```

### **Step 4: Implement Service (Business Logic Layer)**

Add business logic and data transformation:

```typescript:src/features/watchlist/services/watchlist.service.ts
import { Injectable } from '@nestjs/common';
import { WatchlistRepository } from '../repositories/watchlist.repository';
import { GetWatchlistResponse } from '../dto/watchlist.dto';

@Injectable()
export class WatchlistService {
  constructor(private readonly watchlistRepository: WatchlistRepository) {}

  // Add this method
  async getUserWatchlist(userId: string): Promise<GetWatchlistResponse[]> {
    const rawData = await this.watchlistRepository.getUserWatchlist(userId);
    
    // Transform database result to DTO
    return rawData.map(item => ({
      id: item.id,
      notes: item.notes,
      added_at: item.added_at,
      repository: {
        package_name: item.watchlist.metadata.package_name,
        repo_url: item.watchlist.metadata.repo_url,
        stars: item.watchlist.metadata.stars,
        risk_score: item.watchlist.metadata.risk_score,
      },
    }));
  }
}
```

### **Step 5: Implement Controller (HTTP Layer)**

Add the HTTP endpoint:

```typescript:src/features/watchlist/controllers/watchlist.controller.ts
import { Controller, Get, Request } from '@nestjs/common';
import { WatchlistService } from '../services/watchlist.service';

@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  // Add this endpoint
  @Get()
  async getWatchlist(@Request() req) {
    // TODO: Get user ID from authentication
    const userId = req.user?.id || 'temp-user-id';
    return this.watchlistService.getUserWatchlist(userId);
  }
}
```

### **Step 6: Test the Endpoint**

```bash
# Start the server
npm run start:dev

# Test with curl or Postman
curl http://localhost:3000/watchlist

# or just go and go to your endpoint to check the status
 http://localhost:3000/api

```

## 🔄 **The Flow Summary**

```
HTTP Request → Controller → Service → Repository → Prisma → Database
    ↓             ↓          ↓           ↓          ↓
  Validation   Business   Data Access   ORM    PostgreSQL
   (DTO)       Logic      Layer       Client
```

## 🛠️ **Common Patterns for Team**

### **Pattern 1: Create Operation**
```typescript
// Repository
async createItem(data: CreateItemDto) {
  return this.prisma.tableName.create({ data });
}

// Service  
async createItem(data: CreateItemDto) {
  const result = await this.repository.createItem(data);
  return { message: 'Created successfully', data: result };
}

// Controller
@Post()
async createItem(@Body() data: CreateItemDto) {
  return this.service.createItem(data);
}
```

### **Pattern 2: Update Operation**
```typescript
// Repository
async updateItem(id: string, data: UpdateItemDto) {
  return this.prisma.tableName.update({ where: { id }, data });
}

// Service
async updateItem(id: string, data: UpdateItemDto) {
  const result = await this.repository.updateItem(id, data);
  return { message: 'Updated successfully', data: result };
}

// Controller
@Patch(':id')
async updateItem(@Param('id') id: string, @Body() data: UpdateItemDto) {
  return this.service.updateItem(id, data);
}
```

### **Pattern 3: Delete Operation**
```typescript
// Repository
async deleteItem(id: string) {
  return this.prisma.tableName.delete({ where: { id } });
}

// Service
async deleteItem(id: string) {
  await this.repository.deleteItem(id);
  return { message: 'Deleted successfully' };
}

// Controller
@Delete(':id')
async deleteItem(@Param('id') id: string) {
  return this.service.deleteItem(id);
}
```

## 📋 **Quick Checklist for Team Members**

When creating a new endpoint:

- [ ] **DTO**: Define request/response structure
- [ ] **Repository**: Add database method using `this.prisma`
- [ ] **Service**: Add business logic and data transformation  
- [ ] **Controller**: Add HTTP endpoint with proper decorators
- [ ] **Test**: Use Postman/curl to verify it works

## 🎯 **Key Tips for Team**

1. **Always inject PrismaService in repositories** - it's available globally
2. **Use DTOs** for type safety and validation
3. **Keep business logic in services**, not repositories
4. **Transform data in services**, return clean DTOs from controllers
5. **Use Prisma's `include`** to get related data in one query
6. **Follow the existing patterns** in the codebase

This way everyone on your team can consistently create endpoints following the same architecture!