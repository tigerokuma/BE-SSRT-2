# 🚀 Scalable Repository Activity Monitoring Architecture

## Overview

This document outlines the scalable architecture for adding repositories to the watchlist with background processing of health metrics and commit history.

## 🏗️ Architecture Components

### 1. **Job Queue System (Bull/BullMQ)**
- **Purpose**: Handle long-running tasks asynchronously
- **Queues**: 
  - `repository-setup`: Main queue for repository processing
  - `health-analysis`: Dedicated queue for health checks
  - `commit-backfill`: Queue for commit history processing

### 2. **Background Processing Flow**

```
User Request → Immediate Response → Queue Job → Background Processing → Status Updates
```

#### Step-by-Step Process:

1. **User adds repository to watchlist**
   - Creates basic watchlist entry with `status: 'processing'`
   - Returns immediate response to user
   - Queues background job

2. **Background job processes repository**
   - Clones repository (shallow clone for efficiency)
   - Backfills commit history (last year, up to 1000 commits)
   - Runs initial health analysis (Scorecard)
   - Updates status to `'ready'` or `'failed'`

3. **User can check status**
   - Poll status endpoint to see processing progress
   - Get detailed information about processing results

### 3. **Database Schema Updates**

```sql
-- Added to Watchlist table
ALTER TABLE watchlist ADD COLUMN status VARCHAR(20) DEFAULT 'processing';
ALTER TABLE watchlist ADD COLUMN processing_started_at TIMESTAMP;
ALTER TABLE watchlist ADD COLUMN processing_completed_at TIMESTAMP;
ALTER TABLE watchlist ADD COLUMN last_error TEXT;
```

**Status Values:**
- `'processing'`: Background job is running
- `'ready'`: Repository setup completed successfully
- `'failed'`: Processing failed (with error details)

## 🔧 Implementation Details

### Job Configuration
```typescript
{
  attempts: 3,                    // Retry failed jobs up to 3 times
  backoff: {
    type: 'exponential',          // Exponential backoff
    delay: 2000,                  // Start with 2 second delay
  },
  removeOnComplete: 100,          // Keep last 100 completed jobs
  removeOnFail: 50,               // Keep last 50 failed jobs
}
```

### Error Handling
- Jobs automatically retry on failure
- Failed jobs are logged with error details
- Watchlist status is updated to reflect failures
- Manual retry capability for failed jobs

### Resource Management
- **Git Operations**: Shallow clones, automatic cleanup
- **Health Analysis**: Cached results, incremental updates
- **Memory**: Jobs are processed one at a time to avoid memory issues

## 📊 Performance Benefits

### Before (Synchronous)
- User waits 5-20 minutes for response
- Blocks server resources during processing
- No retry mechanism for failures
- Poor user experience

### After (Asynchronous)
- User gets immediate response (< 1 second)
- Background processing doesn't block server
- Automatic retries with exponential backoff
- Status tracking and progress monitoring
- Scalable to handle multiple repositories simultaneously

## 🚀 Usage Examples

### Adding Repository to Watchlist
```bash
curl -X POST http://localhost:3000/activity/user-watchlist-added \
  -H "Content-Type: application/json" \
  -d '{
    "repo_url": "https://github.com/facebook/react",
    "added_by": "user123",
    "alerts": { ... },
    "notes": "Monitoring React for security updates"
  }'
```

**Response:**
```json
{
  "message": "Repository added to watchlist. Background processing will begin shortly.",
  "watchlist_id": "watchlist_facebook_react_1234567890",
  "status": "processing"
}
```

### Checking Processing Status
```bash
curl http://localhost:3000/activity/watchlist/watchlist_facebook_react_1234567890/status
```

**Response:**
```json
{
  "watchlist_id": "watchlist_facebook_react_1234567890",
  "status": "ready",
  "processing_started_at": "2025-07-15T03:16:02.000Z",
  "processing_completed_at": "2025-07-15T03:18:45.000Z",
  "package": { ... },
  "user_watchlists": [ ... ]
}
```

## 🔄 Monitoring and Maintenance

### Job Queue Monitoring
- Monitor queue lengths and processing times
- Set up alerts for failed jobs
- Clean up old completed/failed jobs

### Repository Cleanup
- Automatic cleanup of cloned repositories after processing
- Periodic cleanup of old temporary files
- Handle Windows file locking issues gracefully

### Health Analysis Optimization
- Cache Scorecard results for 24-48 hours
- Only run analysis on new commits
- Parallel processing for multiple repositories

## 🛠️ Setup Requirements

### Dependencies
```bash
pnpm add @nestjs/bull bull
```

### Environment Variables
```env
# Redis for job queue
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# GitHub API
GITHUB_TOKEN=your_github_token
GITHUB_API_BASE_URL=https://api.github.com

# Git operations
GIT_CLONE_DIR=./temp-repos

# Scorecard (optional)
SCORECARD_PATH=scorecard
```

### Redis Setup
The job queue requires Redis. For development:
```bash
# Install Redis (Windows with WSL or Docker)
docker run -d -p 6379:6379 redis:alpine
```

## 🎯 Future Enhancements

1. **Real-time Status Updates**: WebSocket notifications for job progress
2. **Batch Processing**: Process multiple repositories in parallel
3. **Advanced Caching**: Redis cache for health analysis results
4. **Metrics Dashboard**: Monitor queue performance and repository health
5. **Scheduled Health Checks**: Periodic re-analysis of repositories
6. **Alert System**: Notify users when processing completes or fails

## 🔍 Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   - Ensure Redis is running on specified host/port
   - Check firewall settings

2. **Git Clone Timeout**
   - Increase timeout in job configuration
   - Check network connectivity to GitHub

3. **Scorecard Not Found**
   - Install Scorecard: `go install github.com/ossf/scorecard/v4/cmd/scorecard@latest`
   - Set `SCORECARD_PATH` environment variable

4. **File Permission Errors (Windows)**
   - The system handles Windows file locking automatically
   - Failed cleanups will retry on next run

### Debug Mode
Enable debug logging by setting log level to 'debug' in your NestJS configuration. 