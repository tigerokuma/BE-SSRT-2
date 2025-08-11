# Authentication Quick Reference

## 🚀 Quick Start

```bash
# 1. Set environment variables
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
JWT_SECRET=your_jwt_secret

# 2. Start server
npm run start:dev

# 3. Test via Swagger
http://localhost:3000/api
```

## 🔑 Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/device/code` | `POST` | Start device flow |
| `/auth/device/token` | `POST` | Get JWT token |
| `/auth/github` | `GET` | Web OAuth flow |
| `/auth/github/callback` | `GET` | OAuth callback |

## 🛡️ Protecting Routes

```typescript
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Get('protected')
async protectedRoute() {
  return 'Protected content';
}
```

## 🔐 JWT Token Usage

```typescript
// Frontend
const token = localStorage.getItem('jwt_token');

// API calls
fetch('/api/protected', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

## 📝 Environment Variables

```bash
# Required
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
JWT_SECRET=your_jwt_secret

# Optional (Development)
GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback
FRONTEND_URL=http://localhost:4200

# Production Examples:
# GITHUB_CALLBACK_URL=https://yourdomain.com/auth/github/callback
# GITHUB_CALLBACK_URL=http://192.168.1.100:3000/auth/github/callback
# GITHUB_CALLBACK_URL=https://yourdomain.com:8080/auth/github/callback
```

## 🧪 Testing

### Device Flow Test
```bash
# 1. POST /auth/device/code
{
  "client_id": "your_client_id",
  "scope": "read:user user:email"
}

# 2. Visit GitHub verification page
# 3. POST /auth/device/token
{
  "client_id": "your_client_id",
  "device_code": "from_step_1",
  "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
}
```

## 🚨 Common Errors

| Error | Solution |
|-------|----------|
| `Device flow disabled` | Enable in GitHub OAuth App |
| `Invalid client_id` | Check environment variables |
| `Column does not exist` | Run Prisma migrations |
| `JWT_SECRET must be configured` | Add to .env file |

## 🔧 Useful Commands

```bash
# Check migration status
npx prisma migrate status

# Run migrations
npx prisma migrate dev --name add_github_auth_fields

# Generate Prisma client
npx prisma generate

# View database
npx prisma studio
```

## 📚 Full Documentation

- [Main README](./README.md)
- [API Endpoints](./endpoints.md)
- [Setup Guide](./setup.md)
- [Quick Reference](./quick-reference.md) ← You are here 