# 🛠️ Jira Integration Module — Features & API

This module connects user watchlists with Jira projects via OAuth. It supports OAuth-based linking, watchlist selection, issue creation, and handles temp codes with expiry logic.

---

## ✅ Features

### 1. **OAuth Flow with Jira**
- Generates and stores a temporary code with an expiry time (15 minutes).
- Redirects to Jira for authentication.
- Retrieves the OAuth code and uses it to link the user watchlist.
- Automatically deletes expired codes via a scheduled task.

### 2. **User Watchlist Linking**
- Retrieves all user watchlists for linking.
- Allows selecting one watchlist to associate with a Jira project and webtrigger URL.

### 3. **Jira Issue Creation**
- Accepts summary and description for a Jira issue.
- Retrieves the linked webtrigger URL and project key for the user.
- Makes an HTTP POST request to the webtrigger URL to create the Jira issue.

---

## 🌐 API Endpoints

### `GET /jira/oAuth`
- **Description**: Handles OAuth callback from Jira.
- **Params**:
  - `code` (string): Code received to link.
- **Response**: `200 OK` on success.

- Accepts `code` as query param.
- If code is valid and user is found, redirects to `/jira/user-watchlist?code=...`.
- If code is expired, sends a 410 error.


### `GET /jira/gen-code`
- **Description**: Add the email to the confirmed list to send emails to.
- **Params**:
  - `token` (string): Token received via email link.
- **Response**: `200 OK` on success.
- Generates a 32-character unique alphanumeric code.
- Ensures it doesn't already exist in the DB.


### `POST /jira/link`
- **Description**: Add the email to the confirmed list to send emails to.
- **Params**:
  - `token` (string): Token received via email link.
- **Response**: `200 OK` on success.
- Links a Jira project to a user watchlist.


### `POST /jira/insert-code`
**Description**: Stores the project key and webtrigger URL tied to a temp code.
- **Body**:
  - `code` (string): Temporary unique identifier.
  - `projectKey` (string): Jira project key.
  - `webtrigger_url` (string): Webtrigger endpoint for issue creation.
- **Response**: `200 OK` on success.


### `POST /jira/issue`
**Description**: Sends a new Jira issue to the linked project via webtrigger.
- **Body**:
  - `userID` (string): User ID.
  - `summary` (string): Jira issue summary/title.
  - `description` (string): Jira issue description.
- **Response**: `200 OK` on success or error message if linking is missing.


### `GET /jira/check-link`
**Description**: Checks whether a project key and webtrigger URL are already linked.
- **Query Params**:
  - `projectKey` (string): Jira project key.
  - `webtrigger_url` (string): Webtrigger URL to check.
- **Response**: `200 OK` if not already linked; otherwise returns existing data.