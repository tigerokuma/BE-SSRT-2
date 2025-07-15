# 🔍 Repository Activity Monitoring Features

This document outlines the comprehensive alert system for monitoring repository activity and detecting suspicious or unusual patterns.

## 🚨 Alert Types

### 1. Lines Added/Deleted
**Description**: Detects sudden spikes in lines added or removed by a contributor, beyond their typical averages (e.g., large refactors, big deletions).

**Thresholds**:
- `contributor_variance`: Decimal value (e.g., 2.0, 3.6) representing standard deviations from contributor's normal
- `repository_variance`: Decimal value representing standard deviations from repository's normal

**Example**: If a contributor typically adds 50-100 lines per commit but suddenly adds 500 lines, this would trigger an alert.

### 2. Files Changed
**Description**: Detects commits touching an unusually high number of files, or different file types than usual for that contributor.

**Thresholds**:
- `contributor_variance`: Decimal value representing standard deviations from contributor's normal file change patterns
- `repository_variance`: Decimal value representing standard deviations from repository's normal file change patterns

**Example**: A contributor who usually changes 1-3 files suddenly changes 20+ files in a single commit.

### 3. High Churn
**Description**: Detects rapid sequences of changes to the same files in short periods, which can indicate instability or rushed development.

**Thresholds**:
- `multiplier`: Decimal value representing multiplier from typical daily norm (e.g., 2.5x normal churn rate)

**Example**: If a file is typically changed once per day but gets modified 5 times in 2 hours.

### 4. Ancestry Breaks (History Rewrites)
**Description**: Detection of force pushes or history rewrites that overwrite previously known commits (e.g., squash merges, rebases).

**Thresholds**:
- `enabled`: Boolean (true/false) - whether to alert on history rewrites

**Example**: Force pushes, rebases, or squash merges that rewrite commit history.

### 5. Unusual Author Activity
**Description**: Detects when a user who normally contributes at specific times suddenly commits at unusual hours or days.

**Thresholds**:
- `percentage_outside_range`: Integer percentage (e.g., 80) representing how far outside their typical time range to trigger alerts

**Example**: A contributor who usually commits at 5pm on weekdays suddenly commits at 2am on Monday.

## ⚙️ Alert Configuration

### Alert Levels
- **Mild Alert**: Slightly outside normal bounds (e.g., 2 standard deviations)
- **Critical Alert**: Strong deviation from norms (e.g., 3+ standard deviations or absolute thresholds)

### Alert Settings
- Each alert type has its own `enabled` field to enable/disable that specific alert
- Users can selectively enable only the alerts they care about
- Disabled alerts will not trigger notifications regardless of activity

## 📊 Threshold Examples

```json
{
  "lines_added_deleted": {
    "enabled": true,
    "contributor_variance": 2.5,
    "repository_variance": 3.0
  },
  "files_changed": {
    "enabled": true,
    "contributor_variance": 2.0,
    "repository_variance": 2.5
  },
  "high_churn": {
    "enabled": false,
    "multiplier": 2.5
  },
  "ancestry_breaks": {
    "enabled": true
  },
  "unusual_author_activity": {
    "enabled": true,
    "percentage_outside_range": 80
  }
}
```

## 🎯 Use Cases

1. **Security Monitoring**: Detect potential account compromises or malicious activity
2. **Code Quality**: Identify rushed development or large refactors that might need review
3. **Team Productivity**: Monitor for unusual work patterns that might indicate issues
4. **Repository Health**: Track changes that might impact project stability

## 🔧 Implementation Notes

- All thresholds are configurable per user and per repository
- Alerts can be sent via email, Slack, or other notification channels
- Historical data is used to establish baseline patterns for each contributor
- Machine learning models can be used to improve detection accuracy over time 