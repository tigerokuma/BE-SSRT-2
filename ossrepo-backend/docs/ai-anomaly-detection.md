# AI-Powered Anomaly Detection

This document explains the AI-powered anomaly detection feature that uses the Gemma2:2b model to analyze commits for suspicious activity.

## Overview

The AI anomaly detection feature automatically analyzes each commit processed during daily polling to identify potentially suspicious or anomalous activity. It uses a local Gemma2:2b model via Ollama to provide intelligent analysis based on:

- Commit characteristics (size, files changed, message content)
- Contributor history and patterns
- Repository context and averages
- Multiple suspicious indicators

## Features

### Alert Categories

The AI anomaly detection adds a new alert category to the user's watchlist configuration:

```json
{
  "ai_powered_anomaly_detection": {
    "enabled": true
  }
}
```

### Analysis Criteria

The AI model analyzes commits for:

1. **Unusually large changes** - Many files or lines changed
2. **Suspicious commit messages** - Concerning content or patterns
3. **Deviations from contributor history** - Changes outside normal patterns
4. **Unusual timing** - Commits outside typical hours
5. **Repository context** - Changes much larger than repository average
6. **File type patterns** - Suspicious file combinations or types

### Risk Levels

The AI assigns risk levels to detected anomalies:

- **Low** - Minor suspicious patterns
- **Moderate** - Concerning but not critical
- **High** - Significant suspicious activity
- **Critical** - Highly suspicious or dangerous changes

## Setup

### Prerequisites

1. **Ollama Installation**: Follow the [AI Summary Setup Guide](../ai-summary-setup.md) to install Ollama
2. **Gemma2:2b Model**: The system will automatically download the model on first use
3. **Database Schema**: Ensure the AlertTriggered table exists (from main branch)

### Configuration

The AI anomaly detection is automatically enabled when:
- Ollama is running
- Gemma2:2b model is available
- User has enabled the feature in their watchlist alerts

## Usage

### Enabling for a Watchlist

When adding a repository to the watchlist, include the AI anomaly detection in the alerts configuration:

```json
{
  "alerts": {
    "ai_powered_anomaly_detection": {
      "enabled": true
    }
  }
}
```

### Testing the Feature

Test the AI anomaly detection:

```bash
GET /activity/ai-anomaly-detection/test?owner=facebook&repo=react
```

This endpoint:
- Tests the AI model connection
- Analyzes a test commit with suspicious characteristics
- Returns detailed analysis results

### Example Response

```json
{
  "success": true,
  "testCommit": {
    "sha": "test123456789",
    "author": "Test User",
    "message": "WIP: massive refactor - removing all security checks",
    "linesChanged": 2300,
    "filesChanged": 4
  },
  "analysis": {
    "isAnomalous": true,
    "confidence": 0.85,
    "reasoning": "Large commit with suspicious message about removing security checks",
    "riskLevel": "high",
    "suspiciousFactors": [
      "Very large commit (>1000 lines)",
      "Suspicious commit message",
      "Security-related files changed"
    ]
  },
  "message": "🚨 AI detected suspicious activity in test commit (confidence: 85.0%)"
}
```

## Integration with Polling

The AI anomaly detection is automatically integrated into the daily polling process:

1. **Commit Processing**: Each new commit is analyzed with full context
2. **Statistics Integration**: Uses contributor and repository statistics
3. **Alert Creation**: Creates AlertTriggered records for detected anomalies
4. **Fallback Detection**: Uses heuristic-based detection if AI is unavailable

### Commit Data Collected

For each commit, the system collects:

- **Basic Info**: SHA, author, email, message, date
- **Change Statistics**: Lines added/deleted, files changed
- **Contributor Context**: Historical patterns and statistics
- **Repository Context**: Overall repository averages and patterns

## Alert Details

When an anomaly is detected, an alert is created with:

- **Metric**: `ai_powered_anomaly_detection`
- **Threshold Type**: `ai_analysis`
- **Value**: AI confidence score (0.0-1.0)
- **Description**: Detailed reasoning and suspicious factors
- **Risk Level**: AI-assigned risk level
- **Details**: Full commit and analysis context

## Fallback Behavior

If the AI model is unavailable, the system falls back to heuristic-based detection:

- **Large Commits**: >500 lines (moderate), >1000 lines (high)
- **Many Files**: >20 files (moderate), >50 files (high)
- **Contributor Deviation**: Changes outside 2 standard deviations
- **Confidence**: Fixed at 0.7 for fallback detections

## Performance Considerations

- **Model Loading**: First analysis may be slower as the model loads
- **Memory Usage**: Gemma2:2b requires ~4GB RAM
- **Processing Time**: ~5-15 seconds per commit analysis
- **Batch Processing**: Multiple commits are processed sequentially

## Troubleshooting

### Common Issues

1. **Model Not Available**
   ```
   ❌ AI model (Gemma2:2b) is not available
   ```
   - Ensure Ollama is running: `ollama serve`
   - Download the model: `ollama pull gemma2:2b`

2. **Slow Performance**
   - Close other applications to free RAM
   - Consider using a smaller model variant
   - First analysis is slower due to model loading

3. **False Positives**
   - The AI model may flag legitimate large commits
   - Review and adjust confidence thresholds
   - Use fallback detection for more conservative results

### Testing

Test the complete pipeline:

```bash
# 1. Test AI model connection
GET /activity/ai-anomaly-detection/test?owner=test&repo=test

# 2. Add repository with AI alerts enabled
POST /activity/user-watchlist-added
{
  "repo_url": "https://github.com/owner/repo",
  "added_by": "user123",
  "alerts": {
    "ai_powered_anomaly_detection": {
      "enabled": true
    }
  }
}

# 3. Trigger polling to test with real commits
POST /activity/trigger-polling

# 4. Check for alerts
GET /activity/alerts/{userWatchlistId}
```

## Security Considerations

- **Local Processing**: All AI analysis is done locally
- **No External APIs**: No data sent to external services
- **Privacy**: Commit data stays within your system
- **Model Security**: Uses open-source Gemma2:2b model

## Future Enhancements

- **Custom Model Training**: Fine-tune models for specific repositories
- **Advanced Patterns**: Detect more sophisticated attack patterns
- **Integration**: Connect with other security tools
- **Batch Analysis**: Process multiple commits simultaneously
- **Learning**: Improve detection based on user feedback 