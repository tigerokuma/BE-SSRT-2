# 🤖 Slack Integration Module — Features & API

This module enables Slack workspace integration, allowing users to authorize the app, list channels, join channels, and send messages. It handles OAuth authentication using Slack's official API.

---

## ✅ Features

### 1. **Slack OAuth Integration**
- Generates a Slack OAuth URL to start the authorization flow.
- Exchanges the authorization code for an access token.
- Stores the token associated with the user for future Slack API calls.

### 2. **List Public Slack Channels**
- Retrieves the list of public Slack channels using the user’s access token.
- Supports filtering out archived channels and limiting results.

### 3. **Join Slack Channel**
- Joins a specified public Slack channel using the saved access token.
- Updates the repository with the newly joined channel.

### 4. **Send Messages to Slack**
- Sends messages to the saved Slack channel using Slack’s `chat.postMessage` API.

---

## 🌐 API Endpoints

### `GET /slack/channels`

**Description**: Retrieves public Slack channels associated with the authorized Slack workspace.
- **Params**: None
- **Response**: Array of channel objects (`[{ id, name, ... }]`)
- **Errors**:
  - `401 Unauthorized` if token is invalid
  - `502 Bad Gateway` if Slack API fails

---

### `POST /slack/join-channel`

**Description**: Joins a specified public Slack channel.
- **Params**:
  - `channel` (string): Channel ID to join
- **Response**: Slack channel object
- **Errors**:
  - `502 Bad Gateway` if join operation fails

---

### `GET /slack/start-oauth`

**Description**: Redirects the user to the Slack OAuth URL to initiate workspace authorization.
- **Params**: None
- **Response**: Redirects to Slack OAuth page
- **Errors**:
  - `500 Internal Server Error` if OAuth URL generation fails

---

### `GET /slack/oauth`

**Description**: Handles Slack OAuth callback by exchanging code for an access token.
- **Params**:
  - `code` (string): Authorization code from Slack
  - `state` (string): Must match the user ID
- **Response**: Redirects to `/api` on success
- **Errors**:
  - `400 Bad Request` if code is missing or invalid
  - `502 Bad Gateway` if token exchange fails


## 🔐 Environment Variables Used

| Variable             | Description                                        |
|----------------------|----------------------------------------------------|
| `SLACK_CLIENT_ID`     | Client ID for the Slack App                        |
| `SLACK_CLIENT_SECRET` | Client secret for the Slack App                    |
| `SLACK_REDIRECT_URL`  | Redirect URI configured in the Slack App settings |