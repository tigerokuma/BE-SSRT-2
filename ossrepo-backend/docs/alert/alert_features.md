# 🚨 Alert Centre – Features Summary

The **Alert Centre** service helps teams manage, distribute, and escalate alerts across channels like **email**, **Slack**, and **Jira**. It provides APIs for creating, updating, and delivering alerts from internal systems.  

---

## 📦 Core Features

### 1️⃣ Alert Management

**Purpose:** Manage the full lifecycle of alerts created by internal systems or integrations.

- Create new alerts via API
- Retrieve alerts with filters (status, date, priority)
- Update alert statuses (e.g., resolved, escalated)

---

### 2️⃣ Email Capture & Confirmation Flow

**Purpose:** Onboard users or teams for email notifications.

- Add email addresses with custom notification frequency
- Generate and send confirmation emails with secure tokenized links
- Activate email subscriptions via confirmation

---

### 3️⃣ Email Notifications

**Purpose:** Deliver alerts directly to subscribed email recipients.

- Send custom alert emails for ad-hoc notifications
- Dispatch predefined alert templates
- Email scheduling

---

### 4️⃣ Slack Integration

**Purpose:** Post alerts to Slack channels for team visibility.

- Register and configure a Slack app
- Link Slack workspaces to the Alert Centre server
- Post alert messages to Slack channels
- Mention specific users or groups in messages

---

### 5️⃣ Jira Integration

**Purpose:** Track alerts as Jira tickets for issue management.

- Register and configure a Jira app
- Link Jira projects to the Alert Centre server
- Create Jira tickets directly from alerts
- Sync Jira ticket status back to alerts

---



## 🛠 API Endpoints Summary

| Feature              | Purpose                              | Endpoint                          |
|----------------------|--------------------------------------|------------------------------------|
| Create Alert         | Add a new alert to the system        | `POST /alert_centre/alert`        |
| Update Alert         | Modify status or details of an alert | `PATCH /alert_centre/alert/:id`   |
| Retrieve Alerts      | List current or past alerts          | `GET /alert_centre/alert`         |
| Delete Alert         | Delete an allert in the system       | `DELETE /alert_centre/alert`      |
| Add Email            | Subscribe a user/team for notifications | `POST /email/addEmail`         |
| Get slack token      | Adds token for connecting to slack   | `POST /slack/oauth`               |
| Select slack channel | Adds slack channel name to the system| `POST /jira/connect`              |
| Get Jira url         | Adds weburl for connecting to jira   | `POST /jira/connect`              |
| Create Jira Ticket   | Turn alerts into Jira issues         | `POST /jira/issue`                |

---

## ✅ Implementation Status

| Feature                        | Status   |
|--------------------------------|----------|
| Alert Management               | ⬜ Pending|
| Email Capture & Confirmation   | ⬜ Pending|
| Email Notifications            | ⬜ Pending|
| Slack Integration              | ⬜ Pending|
| Jira Integration               | ⬜ Pending|
