# 📧 Email Module — Features & API

This module enables email confirmation and scheduled alert email notifications for users, using MailerSend. It supports email confirmation, time-based email scheduling, and alert digest generation.

---

## ✅ Features

### 1. **Email Confirmation Flow**
- Generate a unique confirmation token and email it to the user.
- Store confirmation tokens with expiry metadata.
- Verify and confirm user emails when they click the confirmation link.
- Periodically clean up expired confirmation tokens.

### 2. **Email Notification Scheduling**
- Users can register their email frequency preferences (e.g., every week or month).
- Emails are automatically sent out with top 10 recent alerts since the last sent time.
- Alerts are ranked and displayed in order of severity (critical > moderate > mild).
- After sending, the system updates the next email send time.

### 3. **Alert Digest Emails**
- Aggregates security alerts for a user since the last email.
- Alerts are fetched from associated watchlists.
- Only the top 10 alerts are included in the email content.

### 4. **Scheduled Tasks**
- `checkEmailTime()` (every 3 mins): Sends digest emails when scheduled.
- `cleanupExpiredData()` (every 15 mins): Deletes expired confirmation tokens.

---

# 🌐 API Endpoints

### POST `/email/send-confirmation`

- **Description**: Send an email confirmation to the associated user.
- **Body**:
  - `user_id` (string): The ID of the user to associate a sent email to.

### GET `/email/confirm-email?token=string`

- **Description**: Add the email to the confirmed list to send emails to.
- **Params**:
  - `token` (string): Token received via email link.
- **Response**: `200 OK` on success.

### Post `/email/add-time`

- **Description**: Add the email to the confirmed list to send emails to.
- **Body**:
  - `id` (string): The user_id.
  - `wait_unit` (string): Frequency unit count.
  - `wait_value` (string): `DAY` \| `WEEK` \| `MONTH` \| `YEAR`.
  - `first_email_time` (string): Start time for the first email.

- **Response**: `200 OK` on success.

# 🔐 Environment Variables Used

| Variable            | Description                              |
| ------------------- | ---------------------------------------- |
| `EMAIL_API_KEY`     | MailerSend API key                        |
| `FROM_EMAIL`        | Sender email address (e.g., noreply@...) |
| `EMAIL_CONFIRM_URL` | Base URL for email confirmation links     |