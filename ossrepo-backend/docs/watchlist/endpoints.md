# Watchlist API Endpoints

## Get Watchlist
- **URL:** `GET /watchlist?user_id=string`
- **Response:**
  ```json
  [
    {
      "id": "string",
      "user_id": "string",
      "watchlist_id": "string",
      "notes": "string (optional)",
      "alerts": "enabled | disabled",
      "created_at": "ISO date string",
      "added_at": "ISO date string",
      "watchlist": {
        "watchlist_id": "string",
        "package": {
          "package_id": "string",
          "package_name": "string"
        }
      }
    },
    ...
  ]
  ```

## Add to Watchlist
- **URL:** `POST /watchlist`
- **Body:**
  ```json
  {
    "user_id": "string",
    "name": "string", // package name
    "note": "string (optional)",
    "alertsEnabled": true
  }
  ```
- **Response:**
  ```json
  {
    "id": "string",
    "user_id": "string",
    "watchlist_id": "string",
    "notes": "string (optional)",
    "alerts": "enabled | disabled",
    "created_at": "ISO date string",
    "added_at": "ISO date string",
    "watchlist": {
      "watchlist_id": "string",
      "package": {
        "package_id": "string",
        "package_name": "string"
      }
    }
  }
  ```

## Update Watchlist Item
- **URL:** `PATCH /watchlist/:id`
- **Body:**
  ```json
  {
    "user_id": "string",
    "note": "string (optional)",
    "alertsEnabled": true
  }
  ```
- **Response:**
  ```json
  {
    "id": "string",
    "user_id": "string",
    "watchlist_id": "string",
    "notes": "string (optional)",
    "alerts": "enabled | disabled",
    "created_at": "ISO date string",
    "added_at": "ISO date string"
  }
  ```

## Delete Watchlist Item
- **URL:** `DELETE /watchlist/:id`
- **Body:**
  ```json
  {
    "user_id": "string"
  }
  ```
- **Response:**
  ```json
  {
    "id": "string",
    "user_id": "string",
    "watchlist_id": "string",
    "notes": "string (optional)",
    "alerts": "enabled | disabled",
    "created_at": "ISO date string",
    "added_at": "ISO date string"
  }
  ``` 