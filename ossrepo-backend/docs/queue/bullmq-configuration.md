# BullMQ Configuration Guide

This guide explains how to configure BullMQ to work with either local or cloud Redis instances.

## Environment Variables

### BullMQ Mode
Set the `BULLMQ_MODE` environment variable to control which Redis instance to use:

- `local` - Use local Redis instance (default)
- `cloud` - Use hosted/cloud Redis instance

### Local Redis Configuration
When `BULLMQ_MODE=local`, use these environment variables:

```bash
BULLMQ_MODE=local
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_PASSWORD=  # Optional for local Redis
```

### Cloud Redis Configuration
When `BULLMQ_MODE=cloud`, use these environment variables:

```bash
BULLMQ_MODE=cloud
REDIS_HOST=your-redis-host.com
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_USERNAME=your-redis-username
```

## Local Redis Setup

### Option 1: Using Docker (Recommended)
```bash
# Start Redis with Docker
docker run -d --name redis -p 6379:6379 redis:alpine

# Or with persistence
docker run -d --name redis -p 6379:6379 -v redis-data:/data redis:alpine redis-server --appendonly yes
```

### Option 2: Using Homebrew (macOS)
```bash
# Install Redis
brew install redis

# Start Redis service
brew services start redis

# Or run manually
redis-server
```

### Option 3: Using apt (Ubuntu/Debian)
```bash
# Install Redis
sudo apt update
sudo apt install redis-server

# Start Redis service
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

### Option 4: Using Chocolatey (Windows)
```bash
# Install Redis
choco install redis-64

# Start Redis service
redis-server
```

## Configuration Differences

### Local Redis Settings
- **Connection**: Direct connection to localhost
- **Authentication**: Usually none required
- **Retries**: More retries for local development
- **Keep-alive**: Enabled for persistent connections
- **Ready check**: Enabled for better error handling

### Cloud Redis Settings
- **Connection**: Remote connection with authentication
- **Authentication**: Username/password required
- **Retries**: Fewer retries to avoid rate limiting
- **Keep-alive**: Disabled for cloud efficiency
- **TLS**: Optional encryption support
- **Ready check**: Disabled for cloud optimization

## Queue Isolation

The configuration ensures that:
- **Local development** uses local Redis and won't interfere with cloud jobs
- **Cloud deployment** uses hosted Redis and processes production jobs
- **No job conflicts** between local and cloud environments

## Monitoring

Both configurations support Bull Board for queue monitoring:
- Local: `http://localhost:3000/admin/queues`
- Cloud: `https://your-domain.com/admin/queues`

## Troubleshooting

### Local Redis Issues
1. Ensure Redis is running: `redis-cli ping`
2. Check port 6379 is available
3. Verify no authentication is required

### Cloud Redis Issues
1. Verify connection credentials
2. Check network connectivity
3. Ensure TLS settings match your provider
4. Check firewall/security group settings

### Common Errors
- **ECONNREFUSED**: Redis not running or wrong host/port
- **NOAUTH**: Authentication required but not provided
- **ETIMEDOUT**: Network connectivity issues
- **WRONGPASS**: Incorrect password
