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
  "responseTime": "1850ms"
}
```

### Smart Search Flow Logic

The search implements a "fast response & background enrichment" strategy for optimal perceived performance.

1.  **Database Check**: First, the local database is checked for a fresh, fully cached version of the package. If found, it's returned immediately.
2.  **Fast NPM Search**: If no fresh data is in the cache, the system queries the NPM API, which is very fast.
3.  **Immediate Partial Response**: A response is sent to the user **immediately** using only the data from NPM. This provides a fast result for the user.
4.  **Background GitHub Enrichment**: In the background (without making the user wait), a separate process fetches expensive repository details from GitHub (stars, forks, contributors, etc.).
5.  **Asynchronous Caching**: The background process combines the NPM and GitHub data and saves the fully enriched package to the database for future requests.

```\
🚀 Search Flow Example (Cache Miss):
User searches "react"
→ Database has no fresh "react" data
→ Call NPM API to get basic package info
→ Return partial data for "react" to user immediately (< 2s)
→ In background: Call GitHub API for stars, forks etc.
→ In background: Save full "react" package to DB
→ Next search for "react" is now a fast cache hit (< 100ms)
```

### Background Optimization

- **Fast-Lane NPM Response**: The initial search response is powered exclusively by NPM data for maximum speed.
- **Background GitHub Enrichment**: Slower GitHub API calls (for stars, forks, etc.) are performed in a background job after the initial response has been sent.
- **Asynchronous Caching**: Fully enriched data is saved to the database asynchronously, without blocking the user.
- **Stale Data Refresh**: Existing stale data in the database is automatically refreshed in the background.

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

- **Initial Response (Cache Miss)**: Under 2 seconds (uses fast NPM data only).
- **Full Enrichment (Background Task)**: 2-8 seconds. This runs asynchronously and does not block the user response.
- **Cached Response (Cache Hit)**: 50-100ms (serves complete, enriched data from the database).
- **True Parallel Processing**: Each package in a search result is enriched and cached in its own parallel process, removing sequential bottlenecks.

### Implementation Details

The clean API structure uses separate DTOs for clarity:
1. **PackageCardDto**: 8 essential fields for library cards
2. **PackageDetailsDto**: Extends PackageCardDto with 8 additional fields
3. **Search requests**: **NEW** - Returns an immediate partial response from NPM, then enriches and caches in the background.
4. **Summary requests**: Returns PackageCardDto with lightweight queries
5. **Details requests**: Returns PackageDetailsDto with complete data

#### Search Strategy Evolution

**Previous Flow** (Problem):
```
Search "react" → Wait for NPM API → Wait for GitHub API → Return full data
(User waits for everything)
```

**New Flow** (Fixed):
```
Search "react" → Get NPM data → **Return partial data now** → Get GitHub data in background
(User gets a fast initial response)
```

This approach provides maximum clarity with minimal complexity, while ensuring **exact matches are always prioritized** over partial matches.

### Real-World Examples

**Search "lodash"**:
- Database: Empty or partial matches only
- Result: Calls NPM, returns partial data immediately. Enriches in background.
- Response time: ~1.5 seconds (initial response), ~5 seconds (background enrichment)

**Search "react-router"**:
- Database: Fresh exact match exists
- Result: Returns immediately with related packages
- Response time: ~50ms (cache hit)

### Duplicate Detection

The system includes intelligent duplicate detection:
- Deduplicates by `package_name` to prevent duplicates in results
- Logs warnings when duplicates are detected
- Ensures clean, unique result sets
