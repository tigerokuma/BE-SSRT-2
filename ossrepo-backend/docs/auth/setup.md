# Authentication Setup Guide

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL database
- GitHub account
- Basic knowledge of OAuth 2.0

## Step 1: Environment Configuration

### Create `.env` File

Create a `.env` file in your project root:

```bash
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/database_name"

# GitHub OAuth App
GITHUB_CLIENT_ID="your_github_client_id"
GITHUB_CLIENT_SECRET="your_github_client_secret"
GITHUB_CALLBACK_URL="http://localhost:3000/auth/github/callback"

# JWT Configuration
JWT_SECRET="your_jwt_secret_key"

# Frontend URL (optional)
FRONTEND_URL="http://localhost:4200"

# ⚠️  IMPORTANT: Update these URLs for production deployment!
# Production Example:
# GITHUB_CALLBACK_URL="https://yourdomain.com/auth/github/callback"
# FRONTEND_URL="https://yourdomain.com"
```

### Generate JWT Secret

```bash
# Option 1: Using Node.js
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Option 2: Using OpenSSL
openssl rand -hex 64

# Option 3: Online generator
# Visit: https://generate-secret.vercel.app/64
```

## Step 2: GitHub OAuth App Setup

### 1. Create GitHub OAuth App

1. Go to [GitHub Settings > Developer Settings](https://github.com/settings/developers)
2. Click "OAuth Apps" → "New OAuth App"
3. Fill in the form:

```
Application name: Your App Name
Homepage URL: http://localhost:3000
Application description: Your app description
Authorization callback URL: http://localhost:3000/auth/github/callback
```

### 2. Enable Device Flow

1. After creating the app, click on it
2. Look for "Device flow" section
3. **Check the box to enable device flow**
4. Click "Update application"

### 3. Get Credentials

Copy these values to your `.env` file:
- **Client ID**: `Ov23liNn7Z7UjWRti4lV` (example)
- **Client Secret**: `abc123def456...` (your actual secret)

## Step 3: Database Setup

### 1. Install Dependencies

```bash
npm install @nestjs/jwt @nestjs/passport passport passport-github2 passport-jwt
npm install -D @types/passport-github2 @types/passport-jwt
```

### 2. Run Prisma Migrations

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev --name add_github_auth_fields

# Verify migration status
npx prisma migrate status
```

### 3. Verify Database Schema

Your `users` table should now have these additional columns:

```sql
-- New GitHub OAuth fields
github_id         VARCHAR UNIQUE,
github_username   VARCHAR,
access_token      VARCHAR,
refresh_token     VARCHAR,
last_login        TIMESTAMP
```

## Step 4: Module Integration

### 1. Import AuthModule

Ensure `AuthModule` is imported in your `app.module.ts`:

```typescript
import { AuthModule } from './features/auth/auth.module';

@Module({
  imports: [
    // ... other modules
    AuthModule,
  ],
})
export class AppModule {}
```

### 2. Verify Module Structure

Your auth module should have this structure:

```
src/features/auth/
├── auth.module.ts
├── auth.controller.ts
├── auth.service.ts
├── dto/
│   └── auth.dto.ts
├── guards/
│   ├── jwt-auth.guard.ts
│   └── github-auth.guard.ts
├── strategies/
│   ├── github.strategy.ts
│   └── jwt.strategy.ts
└── services/
    └── device-flow.service.ts
```

## Step 5: Testing Setup

### 1. Start Development Server

```bash
npm run start:dev
```

### 2. Access Swagger Documentation

Open your browser and navigate to:
```
http://localhost:3000/api
```

### 3. Test Authentication Endpoints

1. **Device Flow** (Recommended for testing):
   - `POST /auth/device/code`
   - `POST /auth/device/token`

2. **Web OAuth Flow**:
   - `GET /auth/github`
   - `GET /auth/github/callback`

## Step 6: Production Configuration

### 1. Update Environment Variables

```bash
# Production .env
DATABASE_URL="postgresql://prod_user:prod_password@prod_host:5432/prod_db"
GITHUB_CLIENT_ID="your_production_client_id"
GITHUB_CLIENT_SECRET="your_production_client_secret"
GITHUB_CALLBACK_URL="https://yourdomain.com/auth/github/callback"
JWT_SECRET="your_production_jwt_secret"
FRONTEND_URL="https://yourdomain.com"
```

### 2. URL Configuration Examples

#### For Domain-Based Deployment:
```bash
GITHUB_CALLBACK_URL="https://myapp.com/auth/github/callback"
FRONTEND_URL="https://myapp.com"
```

#### For IP-Based Deployment:
```bash
GITHUB_CALLBACK_URL="http://192.168.1.100:3000/auth/github/callback"
FRONTEND_URL="http://192.168.1.100:4200"
```

#### For Port-Based Deployment:
```bash
GITHUB_CALLBACK_URL="http://yourdomain.com:8080/auth/github/callback"
FRONTEND_URL="http://yourdomain.com:3000"
```

### 3. Important Production Notes

- **HTTPS Required**: GitHub OAuth requires HTTPS for production
- **Port Configuration**: If using custom ports, include them in the URLs
- **IP vs Domain**: You can use either IP addresses or domain names
- **Callback URL**: Must exactly match what's configured in GitHub OAuth App

### 2. GitHub OAuth App Production Settings

1. Update your GitHub OAuth App:
   - **Homepage URL**: `https://yourdomain.com`
   - **Authorization callback URL**: `https://yourdomain.com/auth/github/callback`

2. **Important**: GitHub OAuth Apps can't have both localhost and production URLs simultaneously

### 3. Security Considerations

```bash
# Use strong JWT secret
JWT_SECRET="very-long-random-string-at-least-64-characters"

# Enable HTTPS only
# Set secure cookies
# Implement rate limiting
# Add CORS configuration
```

## Troubleshooting

### Common Issues

#### 1. "Device flow disabled"

**Solution**: Enable device flow in your GitHub OAuth App settings

#### 2. "Invalid client_id"

**Solution**: Check your `GITHUB_CLIENT_ID` in `.env` file

#### 3. "Column does not exist"

**Solution**: Run Prisma migrations:
```bash
npx prisma migrate dev --name add_github_auth_fields
```

#### 4. "Failed to initiate device flow"

**Solution**: Check GitHub API connectivity and OAuth App configuration

#### 5. "JWT_SECRET must be configured"

**Solution**: Add `JWT_SECRET` to your `.env` file

### Debug Mode

```bash
# Enable detailed logging
DEBUG=passport:* npm run start:dev

# Check Prisma queries
DEBUG=prisma:query npm run start:dev
```

### Environment Variable Validation

Create a validation script:

```typescript
// src/config/env.validation.ts
import { plainToClass } from 'class-transformer';
import { IsString, IsNotEmpty, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  GITHUB_CLIENT_ID: string;

  @IsString()
  @IsNotEmpty()
  GITHUB_CLIENT_SECRET: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToClass(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}
```

## Next Steps

After successful setup:

1. **Test Authentication Flow** using Swagger UI
2. **Implement Protected Routes** using `@UseGuards(JwtAuthGuard)`
3. **Add User Management** endpoints
4. **Implement Token Refresh** logic
5. **Add Logout** functionality
6. **Set up Monitoring** and logging

## Support

If you encounter issues:

1. Check the [Troubleshooting](#troubleshooting) section
2. Verify your environment variables
3. Check GitHub OAuth App settings
4. Review Prisma migration status
5. Check server logs for detailed error messages 