# Authentication API Endpoints

## Overview

This document details all authentication endpoints, request/response schemas, and usage examples.

## Base URL

```
http://localhost:3000/auth
```

## Device Flow Endpoints

### 1. Initialize Device Flow

**Endpoint:** `POST /auth/device/code`

**Description:** Starts the GitHub OAuth device flow authentication process.

**Request Body:**
```json
{
  "client_id": "string",
  "scope": "string (optional)"
}
```

**Response (200):**
```json
{
  "device_code": "string",
  "user_code": "string",
  "verification_uri": "string",
  "expires_in": "number",
  "interval": "number"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/auth/device/code \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "Ov23liNn7Z7UjWRti4lV",
    "scope": "read:user user:email"
  }'
```

**Response Example:**
```json
{
  "device_code": "9dbeaeb34ca7975ad61d8b368b50366e75d5ab51",
  "user_code": "B253-6136",
  "verification_uri": "https://github.com/login/device",
  "expires_in": 899,
  "interval": 5
}
```

### 2. Poll for Device Token

**Endpoint:** `POST /auth/device/token`

**Description:** Polls GitHub for the access token after user authorization.

**Request Body:**
```json
{
  "client_id": "string",
  "device_code": "string",
  "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
}
```

**Response (200) - Success:**
```json
{
  "user": {
    "user_id": "string",
    "email": "string",
    "name": "string",
    "github_username": "string"
  },
  "access_token": "string"
}
```

**Response (202) - Authorization Pending:**
```json
{
  "error": "authorization_pending",
  "error_description": "Authorization is pending. Please complete the verification."
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/auth/device/token \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "Ov23liNn7Z7UjWRti4lV",
    "device_code": "9dbeaeb34ca7975ad61d8b368b50366e75d5ab51",
    "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
  }'
```

## Web OAuth Flow Endpoints

### 3. Initiate GitHub OAuth

**Endpoint:** `GET /auth/github`

**Description:** Redirects user to GitHub OAuth authorization page.

**Response:** Redirects to GitHub OAuth page

**Usage:** Open in browser or follow redirect

### 4. GitHub OAuth Callback

**Endpoint:** `GET /auth/github/callback`

**Description:** Handles the OAuth callback from GitHub.

**Response:** Redirects to frontend with JWT token

**Query Parameters:**
- `code`: Authorization code from GitHub
- `state`: OAuth state parameter

## Error Responses

### Common Error Codes

| Status | Error Code | Description |
|--------|------------|-------------|
| `400` | `invalid_scope` | Invalid GitHub OAuth scope |
| `400` | `incorrect_device_code` | Invalid device code |
| `400` | `unsupported_grant_type` | Invalid grant type |
| `401` | `incorrect_client_credentials` | Invalid client ID/secret |
| `403` | `access_denied` | User denied authorization |
| `410` | `expired_token` | Device code expired |
| `429` | `slow_down` | Rate limited, increase polling interval |
| `503` | `service_unavailable` | GitHub API unavailable |

### Error Response Format

```json
{
  "statusCode": 400,
  "message": "Invalid device code."
}
```

## Rate Limiting

- **Device Code Generation**: No specific limits
- **Token Polling**: Respect the `interval` value from device code response
- **GitHub API**: Subject to GitHub's rate limiting policies

## Scopes

### Supported GitHub Scopes

| Scope | Description | Required |
|-------|-------------|----------|
| `read:user` | Read user profile information | ✅ Yes |
| `user:email` | Read user email addresses | ✅ Yes |
| `read:org` | Read organization information | ❌ No |
| `repo` | Full repository access | ❌ No |

### Recommended Scope

```json
{
  "scope": "read:user user:email"
}
```

## Authentication Flow Examples

### Complete Device Flow

```typescript
// 1. Get device code
const deviceResponse = await fetch('/auth/device/code', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client_id: 'your_client_id',
    scope: 'read:user user:email'
  })
});

const { device_code, user_code, verification_uri } = await deviceResponse.json();

// 2. Show user instructions
console.log(`Visit: ${verification_uri}`);
console.log(`Enter code: ${user_code}`);

// 3. Poll for token
const pollToken = async () => {
  const tokenResponse = await fetch('/auth/device/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: 'your_client_id',
      device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  });

  if (tokenResponse.status === 200) {
    const { access_token } = await tokenResponse.json();
    return access_token;
  } else if (tokenResponse.status === 202) {
    // Still waiting, poll again after interval
    await new Promise(resolve => setTimeout(resolve, 5000));
    return pollToken();
  }
};

const token = await pollToken();
```

### Using JWT Token

```typescript
// Store token
localStorage.setItem('jwt_token', token);

// Use in API calls
const response = await fetch('/api/protected-route', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('jwt_token')}`
  }
});
```

## Testing

### Swagger UI

1. Start your server: `npm run start:dev`
2. Open: `http://localhost:3000/api`
3. Navigate to the `auth` section
4. Use "Try it out" for each endpoint

### Postman/Insomnia

Import these endpoints into your API testing tool:

```json
{
  "info": {
    "name": "Auth API",
    "description": "Authentication endpoints"
  },
  "item": [
    {
      "name": "Device Flow",
      "item": [
        {
          "name": "Initialize Device Flow",
          "request": {
            "method": "POST",
            "url": "http://localhost:3000/auth/device/code",
            "body": {
              "mode": "raw",
              "raw": "{\n  \"client_id\": \"your_client_id\",\n  \"scope\": \"read:user user:email\"\n}",
              "options": {
                "raw": {
                  "language": "json"
                }
              }
            }
          }
        },
        {
          "name": "Poll for Token",
          "request": {
            "method": "POST",
            "url": "http://localhost:3000/auth/device/token",
            "body": {
              "mode": "raw",
              "raw": "{\n  \"client_id\": \"your_client_id\",\n  \"device_code\": \"your_device_code\",\n  \"grant_type\": \"urn:ietf:params:oauth:grant-type:device_code\"\n}",
              "options": {
                "raw": {
                  "language": "json"
                }
              }
            }
          }
        }
      ]
    }
  ]
}
```

## Security Considerations

1. **HTTPS Only**: Use HTTPS in production
2. **Token Storage**: Store JWT tokens securely
3. **Scope Limitation**: Request minimal required scopes
4. **Rate Limiting**: Respect polling intervals
5. **Error Handling**: Don't expose sensitive error details 