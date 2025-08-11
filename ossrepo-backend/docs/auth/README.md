# Authentication Module

## Overview

The Authentication Module provides GitHub OAuth authentication for the OSS Repository Backend. It supports both Device Flow (recommended for CLI/API) and Web OAuth Flow for web applications.

## Features

- ✅ **GitHub OAuth Device Flow** - Perfect for CLI tools and headless applications
- ✅ **GitHub OAuth Web Flow** - Traditional web application authentication
- ✅ **JWT Token Generation** - Secure session management
- ✅ **User Management** - Automatic user creation/update from GitHub
- ✅ **Protected Route Guards** - Secure API endpoints

## Architecture

```
src/features/auth/
├── auth.module.ts          # Main module configuration
├── auth.controller.ts       # API endpoints
├── auth.service.ts         # Business logic
├── dto/                    # Data transfer objects
│   └── auth.dto.ts        # Request/response schemas
├── guards/                 # Authentication guards
│   ├── jwt-auth.guard.ts  # JWT protection
│   └── github-auth.guard.ts # GitHub OAuth protection
├── strategies/             # Passport strategies
│   ├── github.strategy.ts # GitHub OAuth strategy
│   └── jwt.strategy.ts    # JWT validation strategy
└── services/               # Additional services
    └── device-flow.service.ts # GitHub device flow handling
```

## Quick Start

### 1. Environment Variables

```bash
# Required
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
JWT_SECRET=your_jwt_secret

# Optional
GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback
FRONTEND_URL=http://localhost:4200
```

### 2. GitHub OAuth App Setup

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create new OAuth App
3. Enable "Device Flow" for CLI applications
4. Set callback URL for web applications

### 3. Test Authentication

```bash
# Start server
npm run start:dev

# Open Swagger UI
http://localhost:3000/api
```

## API Endpoints

### Device Flow (Recommended for CLI/API)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/device/code` | Initialize device flow authentication |
| `POST` | `/auth/device/token` | Poll for access token |

### Web OAuth Flow

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/auth/github` | Initiate GitHub OAuth login |
| `GET` | `/auth/github/callback` | OAuth callback handler |

## Authentication Flow

### Device Flow Process

1. **Initialize**: `POST /auth/device/code`
2. **User Auth**: Visit GitHub device verification page
3. **Poll**: `POST /auth/device/token` until authorized
4. **Complete**: Receive JWT token and user info

### Web Flow Process

1. **Redirect**: `GET /auth/github` → GitHub OAuth
2. **Callback**: GitHub redirects to `/auth/github/callback`
3. **Complete**: Receive JWT token and user info

## Usage Examples

### CLI Application

```typescript
import { authenticateWithGitHub } from './auth/examples/cli-auth-example';

const token = await authenticateWithGitHub();
console.log('JWT Token:', token.access_token);
```

### Protected API Routes

```typescript
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Get('protected')
async protectedRoute() {
  return 'This route is protected!';
}
```

### Frontend Integration

```typescript
// Store JWT token
localStorage.setItem('token', response.access_token);

// Use in API calls
const response = await fetch('/api/protected', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  }
});
```

## Security Features

- **JWT Expiration**: Tokens expire in 7 days
- **GitHub OAuth**: Secure third-party authentication
- **Route Protection**: Guards prevent unauthorized access
- **User Validation**: Automatic user verification

## Error Handling

| Status | Error | Description |
|--------|-------|-------------|
| `400` | Bad Request | Invalid request parameters |
| `401` | Unauthorized | Invalid or expired token |
| `403` | Forbidden | Access denied |
| `429` | Too Many Requests | Rate limited |
| `503` | Service Unavailable | GitHub API issues |

## Development

### Adding New Authentication Methods

1. Create new strategy in `strategies/`
2. Add guard in `guards/`
3. Update `auth.module.ts`
4. Add endpoints in `auth.controller.ts`

### Testing

```bash
# Unit tests
npm run test src/features/auth

# E2E tests
npm run test:e2e
```

## Troubleshooting

### Common Issues

1. **"Device flow disabled"**: Enable device flow in GitHub OAuth App
2. **"Invalid client_id"**: Check environment variables
3. **"Column does not exist"**: Run Prisma migrations
4. **"Failed to fetch"**: Check GitHub API connectivity

### Debug Mode

```bash
# Enable debug logging
DEBUG=passport:* npm run start:dev
```

## Contributing

1. Follow NestJS best practices
2. Add proper error handling
3. Include unit tests
4. Update documentation
5. Follow security guidelines

## License

This module is part of the OSS Repository Backend project. 