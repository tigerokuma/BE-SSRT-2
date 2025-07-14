# Package Feature Documentation

## Clean and Organized API Structure

The package feature provides a streamlined API with just two focused endpoints:

### API Endpoints

```
GET /packages/search?name=QUERY       // Package discovery - returns array of packages
GET /packages/:name                   // Single package details (default: summary view)
GET /packages/:name?view=details      // Full details view
GET /packages/:name?view=summary      // Explicit summary view
```

### Package Discovery with Exact Match Prioritization

**Search Endpoint:**
```bash
curl "http://localhost:3000/packages/search?name=react"
```
Returns array of packages for discovery (~10 results, **exact matches prioritized first**):
```json
{
  "query": "react",
  "results": [
    {
      "name": "react",
      "description": "The library for web and native user interfaces.",
      "keywords": ["declarative", "frontend", "javascript", "library", "react", "ui"],
      "downloads": 41641689,
      "maintainers": ["facebook"],
      "last_updated": "2025-07-14",
      "version": "19.1.0",
      "license": "MIT"
    },
    {
      "name": "@types/react",
      "description": "The repository for high quality TypeScript type definitions.",
      "downloads": 41157089,
      "version": "19.1.8"
    },
    // ... more related packages
  ],
  "count": 4,
  "responseTime": "2692ms"
}
```

### Smart Search Flow Logic

The search implements intelligent exact match detection:

1. **Database Check First**: Query local database for exact and partial matches
2. **Exact Match Detection**: Check if any result exactly matches the search query (`react` = `react`)
3. **Freshness Validation**: Verify if exact match data is fresh (< 12 hours old)
4. **Smart Decision Making**:
   - ✅ **Fresh exact match found**: Return immediately with related packages
   - ⚠️ **Stale exact match**: Refresh from external APIs  
   - ❌ **No exact match**: Search NPM/GitHub APIs to find the main package

```
🚀 Search Flow Example:
User searches "react" 
→ Database has: react-is, react-router, react-smooth (partial matches)
→ No exact "react" match found
→ Call NPM API to get main "react" package
→ Combine with existing partial matches
→ Sort with exact match first
→ Return: [react, @types/react, react-router, react-smooth]
```

### Background Optimization

- **Background Refresh**: Stale partial matches are refreshed in background
- **Smart Caching**: Popular packages are kept fresh automatically
- **API Rate Limiting**: External calls are optimized and batched

### Single Package Details

**Default Summary View:**
```bash
curl "http://localhost:3000/packages/react"
```
Returns minimal fields optimized for library cards (~200 bytes):
```json
{
  "name": "react",
  "description": "React is a JavaScript library for building user interfaces",
  "keywords": ["react", "javascript", "ui", "library"],
  "downloads": 18500000,
  "maintainers": ["fb", "react-bot"],
  "last_updated": "2025-02-06",
  "version": "18.2.0",
  "license": "MIT"
}
```

**Details View:**
```bash
curl "http://localhost:3000/packages/react?view=details"
```
Returns complete metadata for analysis (~600 bytes):
```json
{
  "name": "react",
  "description": "React is a JavaScript library for building user interfaces",
  "keywords": ["react", "javascript", "ui", "library"],
  "downloads": 18500000,
  "maintainers": ["fb", "react-bot"],
  "last_updated": "2025-02-06T04:15:15.000Z",
  "version": "18.2.0",
  "license": "MIT",
  "package_id": "abc-123",
  "published": "2022-06-14",
  "published_at": "2022-06-14T10:15:30.000Z",
  "stars": 206000,
  "forks": 46000,
  "repo_url": "https://github.com/facebook/react",
  "repo_name": "facebook/react",
  "contributors": 1500,
  "risk_score": 85,
  "npm_url": "https://npm.im/react",
  "homepage": "https://reactjs.org"
}
```

### View Differences

| Feature | Search | Summary | Details |
|---------|--------|---------|---------|
| **Returns** | Array of packages | Single package | Single package |
| **Size** | ~2-5KB | ~200 bytes | ~600 bytes |
| **Dates** | String format | String format | Full Date objects |
| **Fields** | 8 card fields | 8 card fields | 16 total fields |
| **Use Case** | Discovery, search | Library cards | Analysis, admin |
| **Contains** | Card essentials | Card essentials | Everything |

### Error Handling

- **400 Bad Request**: Invalid view parameter or empty fields
- **404 Not Found**: Package doesn't exist (falls back to search)
- **Validation**: All parameters are properly validated

### Performance

- **Cache hit (exact match)**: 50-100ms response time
- **Cache miss (external APIs)**: 2-3 seconds with NPM/GitHub enrichment
- **Smart data combination**: Reduces API calls by 2-3x compared to previous implementation
- **Parallel processing**: Chunks of 3 packages processed simultaneously
- **Exact match prioritization**: Ensures main packages appear first, not just related ones

### Implementation Details

The clean API structure uses separate DTOs for clarity:
1. **PackageCardDto**: 8 essential fields for library cards
2. **PackageDetailsDto**: Extends PackageCardDto with 8 additional fields  
3. **Search requests**: **NEW** - Exact match detection with external API fallback
4. **Summary requests**: Returns PackageCardDto with lightweight queries
5. **Details requests**: Returns PackageDetailsDto with complete data

#### Search Strategy Evolution

**Previous Flow** (Problem):
```
Search "react" → Return any DB matches → Never find main package
```

**New Flow** (Fixed):
```
Search "react" → Check for exact match → If missing, call external APIs → Prioritize exact match first
```

This approach provides maximum clarity with minimal complexity, while ensuring **exact matches are always prioritized** over partial matches.

### Real-World Examples

**Search "lodash"**:
- Database: Empty or partial matches only
- Result: Calls NPM API → Returns main `lodash` package first
- Response time: ~2.7 seconds (cache miss)

**Search "react-router"**:  
- Database: Fresh exact match exists
- Result: Returns immediately with related packages
- Response time: ~50ms (cache hit)

### Duplicate Detection

The system includes intelligent duplicate detection:
- Deduplicates by `package_id` to prevent duplicates in results
- Logs warnings when duplicates are detected
- Ensures clean, unique result sets
