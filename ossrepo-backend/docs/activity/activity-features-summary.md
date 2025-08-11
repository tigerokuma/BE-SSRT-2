# Activity Module Features Summary

## Overview

The Activity Module is a comprehensive system for tracking, analyzing, and monitoring GitHub repository activity. It provides real-time insights into repository health, contributor patterns, and security vulnerabilities.

## Core Features

### 1. Repository Watchlist Management
- **Add repositories** to user watchlists via GitHub URLs
- **Track repository status** (queued, processing, ready, failed)
- **Remove repositories** from watchlists with automatic cleanup
- **Multi-user support** with individual watchlist configurations

### 2. Activity Tracking & Analysis
- **Commit logging** with full metadata (author, timestamp, changes)
- **Repository statistics** (total commits, average changes, activity patterns)
- **Contributor statistics** (individual patterns, activity times, typical days)
- **Bus factor analysis** (knowledge concentration risk assessment)

### 3. Automated Monitoring Systems

#### Daily Polling
- **Automatic repository checking** for new commits every 24 hours
- **Smart cloning** with depth optimization for efficiency
- **Statistics updates** after new commits are detected
- **Self-scheduling** system that maintains continuous monitoring

#### Weekly Vulnerability Checks
- **GitHub Security Advisories** integration
- **Critical vulnerability detection** and alerting
- **Vulnerability tracking** with detailed metadata
- **User notification** system for security issues

#### Monthly Health Analysis
- **OpenSSF Scorecard** integration for repository health
- **Health metrics tracking** over time
- **Trend analysis** for repository health changes
- **Comprehensive health scoring** (0-10 scale)

### 4. Alert System
- **Configurable thresholds** for different metrics
- **Multiple alert types**:
  - Lines added/deleted anomalies
  - Files changed thresholds
  - High churn detection
  - Unusual author activity
- **User-specific configurations** per repository
- **Detailed alert context** with statistical comparisons

### 5. AI-Powered Analysis
- **Commit summaries** using AI analysis
- **Anomaly detection** for unusual patterns
- **Activity insights** and trend identification
- **Natural language descriptions** of repository activity

## Technical Architecture

### Job Queue System (BullMQ)
- **Repository Setup Jobs**: Initial repository analysis and setup
- **Polling Jobs**: Daily repository monitoring
- **Vulnerability Check Jobs**: Weekly security scanning
- **Health Check Jobs**: Monthly health analysis
- **Priority System**: Setup jobs take precedence over polling

### External Integrations
- **GitHub API**: Repository information and security advisories
- **OpenSSF Scorecard**: Repository health analysis
- **Git operations**: Local cloning for commit analysis
- **AI services**: Commit summarization and anomaly detection