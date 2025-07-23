# User API Endpoints

## Create User
- **URL:** `POST /users`
- **Body:**
  ```json
  {
    "email": "string",
    "name": "string (optional)"
  }
  ```
- **Response:**
  ```json
  {
    "user_id": "string",
    "email": "string",
    "name": "string (optional)",
    "created_at": "ISO date string"
  }
  ```

## Get User by ID
- **URL:** `GET /users/:id`
- **Response:**
  ```json
  {
    "user_id": "string",
    "email": "string",
    "name": "string (optional)",
    "created_at": "ISO date string"
  }
  ```

## Get All Users
- **URL:** `GET /users`
- **Response:**
  ```json
  [
    {
      "user_id": "string",
      "email": "string",
      "name": "string (optional)",
      "created_at": "ISO date string"
    },
    ...
  ]
  ``` 