
# Features Documentation

## Base Route: `/slack`

---

### 1. **GET `/slack/slack-channel/:user_id`**

**Description:**  
Get the Slack channel information for a user.

**URL Parameters:**  
- `user_id` (string, required): User ID.

**Response:**  
```json
{
  "name": "string"  // Slack channel name
}
```

**Errors:**  
- 400 Bad Request if `user_id` missing  
- 502 Bad Gateway if fetching Slack channel fails

---

### 2. **POST `/slack/send-message`**

**Description:**  
Send a message to the user's Slack channel.

**Request Body:**  
```json
{
  "user_id": "string",
  "message": "string"
}
```

**Response:**  
```json
{
  "success": true,
  "message": "Message sent to Slack successfully"
}
```

**Errors:**  
- 400 Bad Request if message body missing  
- 502 Bad Gateway if sending message fails

---

### 3. **GET `/slack/channels/:user_id`**

**Description:**  
List public Slack channels for the user.

**URL Parameters:**  
- `user_id` (string, required): User ID.

**Response:**  
```json
{
  "channels": [ /* array of channel objects */ ]
}
```

**Errors:**  
- 400 Bad Request if `user_id` missing  
- 401 Unauthorized if Slack credentials invalid  
- 502 Bad Gateway if fetching Slack channels fails

---

### 4. **POST `/slack/join-channel`**

**Description:**  
Join a user to a Slack channel.

**Request Body:**  
```json
{
  "user_id": "string",
  "channel": "string"
}
```

**Response:**  
```json
{
  "channel": { /* Slack API channel object */ }
}
```

**Errors:**  
- 400 Bad Request if body missing  
- 502 Bad Gateway if Slack API error

---

### 5. **GET `/slack/start-oauth/:user_id`**

**Description:**  
Redirect user to Slack OAuth URL to authorize app.

**URL Parameters:**  
- `user_id` (string, required): User ID.

**Response:**  
- Redirects to Slack OAuth URL.

**Errors:**  
- 400 Bad Request if `user_id` missing  
- 500 Internal Server Error if URL generation fails

---

### 6. **GET `/slack/oauth`**

**Description:**  
Handle Slack OAuth callback, exchange code for access token.

**Query Parameters:**  
- `code` (string, required): Slack OAuth code  
- `state` (string, required): User ID (used as state)

**Response:**  
```json
{
  "success": true
}
```

**Errors:**  
- 400 Bad Request if code missing or invalid  
- 502 Bad Gateway if token exchange fails

---

# DTOs Summary

| DTO Name         | Fields                           | Validation                       |
|------------------|---------------------------------|---------------------------------|
| `SlackOauthConnect` | `code: string`, `state: string` | Required, non-empty strings      |
| `SlackInsert`    | `user_id: string`, `token: string`, `channel?: string` | Required for user_id and token  |
| `UserMessage`    | `user_id: string`, `message: string` | Required, non-empty strings      |
| `UserChannel`    | `user_id: string`, `channel: string` | Required, non-empty strings      |

---

# Service Behavior Summary

- **exchangeCodeForToken(slackOauthConnect)**:  
  Exchanges Slack OAuth code for access token and stores it linked to user.

- **getChannels(user_id)**:  
  Fetches list of public Slack channels for the user.

- **getOAuthUrl(user_id)**:  
  Generates Slack OAuth URL with required scopes and user state.

- **joinChannel(userChannel)**:  
  Makes the user join the specified Slack channel and updates DB.

- **getSlackChannel(user_id)**:  
  Gets the Slack channel info (name) linked to the user.

- **sendMessage(userMessage)**:  
  Sends a text message to the user's linked Slack channel.
