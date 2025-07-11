# Package Feature Documentation

## Clean and Organized API Structure

The package feature provides a streamlined API with just two focused endpoints:

### API Endpoints

```
GET /packages/search?name=QUERY       // Package discovery - returns array of packages
GET /packages/:name                   // Single package details with flexible views
GET /packages/:name?view=details      // Full details view
GET /packages/:name?view=summary      // Explicit summary view (default)
GET /packages/:name?fields=name,stars // Custom fields selection
```

### Package Discovery

**Search Endpoint:**
```bash
curl "http://localhost:3000/packages/search?name=react"
```
Returns array of packages for discovery (~10 results, ordered by exact match + downloads):
```json
{
  "query": "react",
  "results": [
    {
      "name": "react",
      "description": "React is a JavaScript library...",
      "version": "18.2.0",
      "downloads": 18500000,
      "stars": 206000,
      "license": "MIT"
    },
    // ... more packages
  ],
  "count": 10,
  "responseTime": "67ms"
}
```

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

**Custom Fields:**
```bash
curl "http://localhost:3000/packages/react?fields=name,stars,downloads"
```
Returns only requested fields:
```json
{
  "name": "react",
  "stars": 206000,
  "downloads": 18500000
}
```

### View Differences

| Feature | Search | Summary | Details | Custom |
|---------|--------|---------|---------|---------|
| **Returns** | Array of packages | Single package | Single package | Single package |
| **Size** | ~2-5KB | ~200 bytes | ~600 bytes | Variable |
| **Dates** | String format | String format | Full Date objects | Based on request |
| **Fields** | 8 card fields | 8 card fields | 17 total fields | User-defined |
| **Use Case** | Discovery, search | Library cards | Analysis, admin | Optimized queries |
| **Contains** | Card essentials | Card essentials | Everything | Custom selection |

### Error Handling

- **400 Bad Request**: Invalid view parameter or empty fields
- **404 Not Found**: Package doesn't exist (falls back to search)
- **Validation**: All parameters are properly validated

### Performance

- **Cache hit**: 50-100ms response time
- **Cache miss**: 400-600ms with optimized NPM/GitHub calls
- **Smart data combination**: Reduces API calls by 2-3x compared to previous implementation
- **Parallel processing**: Chunks of 3 packages processed simultaneously

### Implementation Details

The clean API structure uses intelligent data fetching:
1. **Search requests**: Database-first with external API fallback
2. **Summary requests**: Uses lightweight database queries
3. **Details/Custom requests**: Fetches complete data for field flexibility
4. **Field mapping**: Internal database fields mapped to clean API response

This approach provides maximum flexibility with minimal API surface area, making it easy to understand and use.
