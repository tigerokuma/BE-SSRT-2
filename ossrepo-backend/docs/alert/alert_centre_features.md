# Alert Centre API - Features & Endpoints

This module provides alert-related functionality, including retrieval of individual alerts and alerts tied to a specific user.

---

## 📦 Features

### ✅ Fetch Individual Alerts
- Retrieve alert details using a specific `alert_id`.

### ✅ Fetch User-Triggered Alerts
- Fetch all triggered alerts associated with a user's watchlist, ordered by newest first.

---

## 🧭 Endpoints

### `GET /alert_centre/alert/:alert_id`
- **Description**: Get a list of alerts that match a given `alert_id`.
- **Params**:
  - `alert_id` (string): The ID of the alert to retrieve.
- **Response**: JSON array of alerts matching the ID.

### `GET /alert_centre/user/:suer_id`
- **Description**: Get a list of alerts that match a given `user_id` ordered by newest first.
- **Params**:
  - `user_id` (string): The ID of the user's alert.
- **Response**: JSON array of alerts matching the ID.

