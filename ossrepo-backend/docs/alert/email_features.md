
# Features Documentation

## Base Route: `/email`

---

### 1. **POST `/email/send-confirmation`**

**Description:**  
Send a confirmation email to a user.

**Request Body:**  
```json
{
  "user_id": "string"   // Required: the ID of the user to send confirmation email to
}
```

**Response:**  
```json
{
  "success": true,
  "message": "Confirmation email sent"
}
```

**Errors:**  
- 400 Bad Request if `user_id` missing  
- 502 Bad Gateway if email sending fails

---

### 2. **GET `/email/check-confirmation/:user_id`**

**Description:**  
Check if the user’s email is confirmed.

**URL Parameters:**  
- `user_id` (string, required): ID of the user.

**Response:**  
```json
{
  "email_confirmed": true | false | null
}
```

**Errors:**  
- 400 Bad Request if `user_id` missing  
- 502 Bad Gateway if check fails

---

### 3. **GET `/email/email-time/:user_id`**

**Description:**  
Retrieve the email timing info for the user.

**URL Parameters:**  
- `user_id` (string, required): ID of the user.

**Response:**  
```json
{
  "id": "string",
  "last_email_time": "Date string",
  "next_email_time": "Date string",
  "wait_value": "DAY" | "WEEK" | "MONTH" | "YEAR",
  "wait_unit": number
}
```

**Errors:**  
- 400 Bad Request if `user_id` missing  
- 502 Bad Gateway if retrieval fails

---

### 4. **GET `/email/confirm-email?token=xxx`**

**Description:**  
Confirm a user’s email using a token.

**Query Parameters:**  
- `token` (string, required): Confirmation token.

**Response:**  
- **No content (void)** on success.

**Errors:**  
- 400 Bad Request if `token` missing  
- 502 Bad Gateway if confirmation fails

---

### 5. **POST `/email/add-time`**

**Description:**  
Add or update a user’s email timing info.

**Request Body:**  
```json
{
  "id": "string",               // Required
  "first_email_time": "Date",  // Required
  "wait_value": "DAY" | "WEEK" | "MONTH" | "YEAR",  // Required
  "wait_unit": "number"           // Required, minimum 1
}
```

**Response:**  
Returns the updated or created email timing object (shape matches EmailTime).

**Errors:**  
- 400 Bad Request if required fields missing  
- 502 Bad Gateway if update fails

---


### 6. **GET `/email/get-email/:user_id`**

**Description:**  
Retrieve the email address of a user.

**URL Parameters:**  
- `user_id` (string, required): ID of the user.

**Response:**  
```json
{
  "email": "user@example.com"
}
```

---

**Errors:**  
- 400 Bad Request if `token` missing  
- 502 Bad Gateway if confirmation fails

---

# DTOs Summary

| DTO Name        | Fields                                         | Validation                                   |
|-----------------|------------------------------------------------|----------------------------------------------|
| `User`          | `user_id: string`                              | Required, non-empty string                    |
| `EmailTimeInput`| `id: string`, `first_email_time: Date`, `wait_value: enum`, `wait_unit: number` | All required, `wait_unit` ≥ 1                  |
| `EmailTime`     | `id: string`, `last_email_time: Date`, `next_email_time: Date`, `wait_value: enum`, `wait_unit: number` | -                                            |
| `ConfirmTokenInsert` | `user_id: string`, `token: string`, `expires_at: Date` | -                                            |
| `UpdateEmailTime`| `user_id: string`, `next_email_time: Date`   | -                                            |
| `GetAlertsSince` | `user_id: string`, `last_email_time: Date`   | -                                            |

---

# Service Behavior Summary

- **sendConfirmation(user_id)**:  
  Generates a confirmation token, stores it, and emails the confirmation link to the user.

- **checkConfirmation(user_id)**:  
  Returns whether the user’s email is confirmed.

- **getUserEmailTime(user_id)**:  
  Retrieves the user’s email timing info.

- **confirmEmail(token)**:  
  Validates token, marks user email confirmed, deletes token.

- **addEmailTime(emailTimeInput)**:  
  Adds or updates email timing info for the user.

- **getEmailAddress(user_id)**:  
  Retrieves the email address of the user.

- **sendTimedEmails (cron every 3 minutes)**:  
  Checks users whose `next_email_time` is due, fetches top 10 alerts, sends alert emails, and updates next email time.