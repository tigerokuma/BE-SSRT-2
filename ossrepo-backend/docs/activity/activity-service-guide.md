# Activity Service Interaction Guide

This guide provides information on how to interact with the Activity Service's core production endpoints.

## Overview

The Activity Service is responsible for:
- Managing repository watchlists
- Tracking repository activity and commits
- Monitoring for alerts and anomalies
- Running automated health and vulnerability checks

## Core API Endpoints

### Watchlist Management

#### Add Repository to Watchlist
```http
POST /activity/user-watchlist-added
Content-Type: application/json

{
  "repo_url": "https://github.com/owner/repo",
  "added_by": "user123"
}
```

**Response:**
```json
{
  "success": true,
  "watchlistId": "watchlist_owner_repo_1234567890",
  "message": "Repository added to watchlist successfully"
}
```

#### Update Alert Settings
```http
PUT /activity/user-watchlist-alerts/{userWatchlistId}
Content-Type: application/json

{
  "alerts": {
    "lines_added_deleted": {
      "enabled": true,
      "contributor_variance": 2.5,
      "repository_variance": 3,
      "hardcoded_threshold": 1000
    }
  }
}
```

#### Remove Repository from Watchlist
```http
DELETE /activity/user-watchlist/{userWatchlistId}
```

**Response:**
```json
{
  "message": "Repository removed from watchlist successfully"
}
```

#### Get Watchlist Status
```http
GET /activity/watchlist/{watchlistId}/status
```

### Commit Analysis

#### Generate AI Commit Summary
```http
POST /activity/watchlist/{watchlistId}/commit-summary
Content-Type: application/json

{
  "commitCount": 10
}
```

**Response:**
```json
{
  "summary": "Recent commits show active development on the authentication system...",
  "commitCount": 10,
  "dateRange": "2024-01-01 to 2024-01-15",
  "totalLinesAdded": 1250,
  "totalLinesDeleted": 450,
  "totalFilesChanged": 25,
  "authors": ["john.doe@example.com", "jane.smith@example.com"],
  "generatedAt": "2024-01-15T10:30:00Z"
}
```

#### Get Recent Commits
```http
GET /activity/watchlist/{watchlistId}/commits?limit=50
```

**Response:**
```json
{
  "watchlist_id": "watchlist_owner_repo_1234567890",
  "commits": [
    {
      "id": "commit_123",
      "message": "feat: add new authentication system",
      "author": "John Doe",
      "time": "2 hours ago",
      "avatar": "/placeholder-user.jpg",
      "initials": "JD",
      "linesAdded": 150,
      "linesDeleted": 25,
      "filesChanged": 8,
      "isSuspicious": false,
      "sha": "abc123..."
    }
  ],
  "total_count": 50,
  "repository_name": "owner/repo"
}
```

### Alerts and Monitoring

#### Get User Alerts
```http
GET /activity/alerts/{userWatchlistId}
```

**Response:**
```json
{
  "alerts": [
    {
      "id": "alert_123",
      "user_watchlist_id": "user_watchlist_123",
      "watchlist_id": "watchlist_owner_repo_1234567890",
      "commit_sha": "abc123...",
      "contributor": "john.doe@example.com",
      "metric": "lines_added_deleted",
      "value": 1500,
      "alert_level": "high",
      "threshold_type": "hardcoded_threshold",
      "threshold_value": 1000,
      "description": "Total lines changed (1500) exceeds hardcoded threshold (1000)",
      "details_json": {
        "linesAdded": 1200,
        "linesDeleted": 300,
        "filesChanged": ["src/auth.js", "src/permissions.js"],
        "commitMessage": "feat: major refactor",
        "contributor": "john.doe@example.com"
      },
      "created_at": "2024-01-15T09:45:00Z",
      "acknowledged_at": null,
      "resolved_at": null
    }
  ],
  "count": 1,
  "userWatchlistId": "user_watchlist_123"
}
```

#### Acknowledge Alert
```http
PATCH /activity/alerts/{alertId}/acknowledge
```

**Response:**
```json
{
  "success": true,
  "message": "Alert acknowledged successfully"
}
```

#### Resolve Alert
```http
PATCH /activity/alerts/{alertId}/resolve
```

**Response:**
```json
{
  "success": true,
  "message": "Alert resolved successfully"
}
```

## Data Structures

### AddToWatchlistDto
```typescript
interface AddToWatchlistDto {
  repo_url: string;        // GitHub repository URL
  added_by: string;        // User ID adding the repository
}
```

### CommitSummaryDto
```typescript
interface CommitSummaryDto {
  commitCount?: number;    // Number of commits to analyze (default: 10)
}
```

### Alert Configuration
```typescript
interface AlertConfig {
  lines_added_deleted?: {
    enabled: boolean;
    contributor_variance?: number;
    repository_variance?: number;
    hardcoded_threshold?: number;
  };
  files_changed?: {
    enabled: boolean;
    contributor_variance?: number;
    repository_variance?: number;
    hardcoded_threshold?: number;
  };
  suspicious_author_timestamps?: {
    enabled: boolean;
  };
  new_vulnerabilities_detected?: {
    enabled: boolean;
  };
  health_score_decreases?: {
    enabled: boolean;
    minimum_health_change?: number;
  };
  ai_powered_anomaly_detection?: {
    enabled: boolean;
  };
}
```

## Usage Examples

### Frontend Integration

#### Adding a Repository to Watchlist
```typescript
async function addToWatchlist(repoUrl: string, userId: string) {
  try {
    const response = await fetch('/activity/user-watchlist-added', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repo_url: repoUrl,
        added_by: userId
      })
    });

    const result = await response.json();
    
    if (result.success) {
      console.log(`Repository added: ${result.watchlistId}`);
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    console.error('Failed to add repository:', error);
  }
}
```

#### Getting Recent Commits
```typescript
async function getRecentCommits(watchlistId: string, limit = 50) {
  try {
    const response = await fetch(`/activity/watchlist/${watchlistId}/commits?limit=${limit}`);
    const data = await response.json();
    
    // Update UI with commits
    data.commits.forEach(commit => {
      displayCommit(commit);
    });
  } catch (error) {
    console.error('Failed to fetch commits:', error);
  }
}
```

#### Monitoring for Alerts
```typescript
async function checkForAlerts(userWatchlistId: string) {
  try {
    const response = await fetch(`/activity/alerts/${userWatchlistId}`);
    const { alerts } = await response.json();
    
    if (alerts.length > 0) {
      showAlertNotification(alerts[0]);
    }
  } catch (error) {
    console.error('Failed to check alerts:', error);
  }
}

async function acknowledgeAlert(alertId: string) {
  try {
    await fetch(`/activity/alerts/${alertId}/acknowledge`, {
      method: 'PATCH'
    });
    console.log('Alert acknowledged');
  } catch (error) {
    console.error('Failed to acknowledge alert:', error);
  }
}
```

## Error Handling

### Common Error Responses

#### 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "Invalid repository URL format",
  "error": "Bad Request"
}
```

#### 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Watchlist not found",
  "error": "Not Found"
}
```

#### 500 Internal Server Error
```json
{
  "statusCode": 500,
  "message": "Failed to process request",
  "error": "Internal Server Error"
}
```

## Best Practices

1. **Validate repository URLs** before sending to the API
2. **Handle rate limiting** by implementing appropriate delays between requests
3. **Cache frequently accessed data** like commit summaries
4. **Implement proper error handling** for all API calls
5. **Monitor alert acknowledgments** to avoid duplicate notifications

For more detailed information about the Activity Service architecture and features, refer to the main README.md file in the activity module.
