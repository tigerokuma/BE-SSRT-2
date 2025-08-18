
# Features Documentation

## Base Route: `/jira`

---

### 1. **GET `/jira/oAuth/:user_id?code=xxx`**

**Description:**  
Link a Jira project for a user using OAuth authorization code.

**URL Parameters:**  
- `user_id` (string, required): User ID.

**Query Parameters:**  
- `code` (string, required): Jira OAuth authorization code.

**Response:**  
```json
{
  "id": "string"  // same as user_id
}
```

**Errors:**  
- 400 Bad Request if `code` missing  
- 502 Bad Gateway if linking fails

---

### 2. **GET `/jira/gen-code`**

**Description:**  
Generate a unique Jira integration code.

**Response:**  
```json
"string"  // generated unique code
```

**Errors:**  
- 500 Internal Server Error if generation fails

---

### 3. **POST `/jira/insert-code`**

**Description:**  
Insert temporary Jira info (code, project key, webtrigger URL).

**Request Body:**  
```json
{
  "code": "string",
  "project_key": "string",
  "webtrigger_url": "string"
}
```

**Response:**  
- Returns result of insert operation (DB upsert).

**Errors:**  
- 502 Bad Gateway if insertion fails

---

### 4. **POST `/jira/create-issue`**

**Description:**  
Create a Jira issue via stored Jira project webtrigger URL.

**Request Body:**  
```json
{
  "user_id": "string",
  "summary": "string",
  "description": "string"
}
```

**Response:**  
- Returns the response from the Jira webtrigger POST request (issue creation result).

**Errors:**  
- 502 Bad Gateway if creation fails

---

### 5. **GET `/jira/user-info/:user_id`**

**Description:**  
Fetch Jira user info (project key).

**URL Parameters:**  
- `user_id` (string, required): User ID.

**Response:**  
```json
{
  "project_key": "string"
}
```

**Errors:**  
- 401 Unauthorized if Jira credentials invalid  
- 502 Bad Gateway if fetching fails

---

### 6. **POST `/jira/check-link`**

**Description:**  
Check if a Jira project link exists.

**URL Parameters:**  
- `user_watchlist_id` (string, required): User Watchlist ID.

**Response:**  
```json
"user_id" | null
```
- Returns user_id if link exists, otherwise null.

**Errors:**  
- 502 Bad Gateway if check fails

---

### 7. **Get `/jira/check-link/:user_watchlist_id`**

**Description:**  
Check if Jira info exists for a given user watchlist.

**Response:**  
```json
{
  "success": true,
  "data": {
    "project_key": "string",
    "webtrigger_url": "string"
  }
}
// or if not found
{
  "success": false,
  "message": "No Jira info found for this watchlist"
}
```
- Returns data if link exists, otherwise null.

**Errors:**  
- 502 Bad Gateway if check fails

---

# DTOs Summary

| DTO Name    | Fields                                  | Validation                      |
|-------------|-----------------------------------------|--------------------------------|
| `JiraInsert`| `user_id: string`, `webtrigger_url: string`, `project_key: string` | -                              |
| `JiraIssue` | `user_watchlist_id: string`, `summary: string`, `description: string`         | Required, non-empty strings    |
| `CheckJira` | `project_key: string`, `webtrigger_url: string`                     | Required, non-empty strings    |
| `TempJiraInfo` | `code: string`, `project_key: string`, `webtrigger_url: string`   | Required, non-empty strings    |
| `TempJiraInsert` | `code: string`, `project_key: string`, `webtrigger_url: string`, `expires_at: Date` | -                          |
| `LinkJira`  | `user_id: string`, `code: string`                                   | Required, non-empty strings    |

---

# Service Behavior Summary

- **addTempUrl(temp_jira_info)**:  
  Adds temporary Jira info with 15-minute expiry after checking for duplicates.

- **checkTempJiraInfo(code)**:  
  Checks if a temporary Jira code exists in DB.

- **linkProject(link_jira)**:  
  Links a Jira project for a user using a valid temporary code.

- **createIssue(jira_issue)**:  
  Posts a Jira issue to the user’s stored Jira project webhook.

- **generateCode(length)**:  
  Generates a unique random code not already in DB.

- **getUserInfo(user_id)**:  
  Retrieves Jira project key info for a user.

- **linkExists(checkJira)**:  
  Checks if a Jira link exists for the given project key and webhook URL.

- **checkJiraUserWatch(user_watchlist_id)**:  
  Returns Jira info associated with a user watchlist.

- **Cron job every 15 minutes:**  
  Cleans up expired temporary Jira codes.
