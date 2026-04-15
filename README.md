# Profile Intelligence Service

A Node.js + Express + PostgreSQL backend for the Stage 1 Backend Assessment.

It accepts a name, enriches it using 3 public APIs, stores the processed result, prevents duplicates, and exposes clean REST endpoints for retrieval, filtering, and deletion.

## Features

- Integrates with:
  - Genderize
  - Agify
  - Nationalize
- Stores processed profile data in PostgreSQL
- Uses UUID v7 for IDs
- Uses UTC ISO 8601 timestamps
- Handles idempotency for repeated names
- Supports filtering by `gender`, `country_id`, and `age_group`
- Returns consistent JSON response structures
- Enables CORS with `Access-Control-Allow-Origin: *`

## Tech Stack

- Node.js
- Express
- PostgreSQL
- Axios
- UUID v7

## Project Structure

```text
profile-intelligence-service/
├── package.json
├── .env.example
├── README.md
├── sql/
│   └── schema.sql
├── scripts/
│   └── init-db.js
└── src/
    ├── db.js
    ├── profileService.js
    ├── server.js
    └── utils.js
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create your environment file

Copy `.env.example` to `.env` and update the database URL.

```bash
cp .env.example .env
```

Example:

```env
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/profile_intelligence
```

### 3. Create your PostgreSQL database

Example:

```sql
CREATE DATABASE profile_intelligence;
```

### 4. Initialize the schema

```bash
npm run db:init
```

### 5. Start the app

Development:

```bash
npm run dev
```

Production:

```bash
npm start
```

The API will run on:

```text
http://localhost:3000
```

## API Endpoints

### POST /api/profiles

Create a new profile from a name.

Request:

```json
{
  "name": "ella"
}
```

#### Success (201)

```json
{
  "status": "success",
  "data": {
    "id": "018f0f26-d251-7f77-b1c8-25c3f3d8806b",
    "name": "ella",
    "gender": "female",
    "gender_probability": 0.99,
    "sample_size": 1234,
    "age": 46,
    "age_group": "adult",
    "country_id": "NG",
    "country_probability": 0.85,
    "created_at": "2026-04-01T12:00:00.000Z"
  }
}
```

#### Idempotent success (200)

```json
{
  "status": "success",
  "message": "Profile already exists",
  "data": {
    "id": "018f0f26-d251-7f77-b1c8-25c3f3d8806b",
    "name": "ella",
    "gender": "female",
    "gender_probability": 0.99,
    "sample_size": 1234,
    "age": 46,
    "age_group": "adult",
    "country_id": "NG",
    "country_probability": 0.85,
    "created_at": "2026-04-01T12:00:00.000Z"
  }
}
```

### GET /api/profiles/:id

#### Success (200)

```json
{
  "status": "success",
  "data": {
    "id": "018f0f26-d251-7f77-b1c8-25c3f3d8806b",
    "name": "ella",
    "gender": "female",
    "gender_probability": 0.99,
    "sample_size": 1234,
    "age": 46,
    "age_group": "adult",
    "country_id": "NG",
    "country_probability": 0.85,
    "created_at": "2026-04-01T12:00:00.000Z"
  }
}
```

### GET /api/profiles

Optional query parameters:

- `gender`
- `country_id`
- `age_group`

Example:

```text
/api/profiles?gender=male&country_id=NG
```

#### Success (200)

```json
{
  "status": "success",
  "count": 2,
  "data": [
    {
      "id": "id-1",
      "name": "emmanuel",
      "gender": "male",
      "age": 25,
      "age_group": "adult",
      "country_id": "NG"
    },
    {
      "id": "id-2",
      "name": "sarah",
      "gender": "female",
      "age": 28,
      "age_group": "adult",
      "country_id": "US"
    }
  ]
}
```

### DELETE /api/profiles/:id

#### Success (204)

No content returned.

## Validation and Error Handling

All errors follow this structure:

```json
{
  "status": "error",
  "message": "<error message>"
}
```

### Implemented cases

- `400 Bad Request` → missing or empty name
- `422 Unprocessable Entity` → invalid type for `name`
- `404 Not Found` → profile not found
- `502 Bad Gateway` → invalid external API response
- `500 Internal Server Error` → unexpected server failure

### External API invalid-response rules

- Genderize returns `gender: null` or `count: 0` → 502
- Agify returns `age: null` → 502
- Nationalize returns no country data → 502

## Deployment Notes

Use a platform accepted by the task, such as:

- Railway
- Heroku
- AWS
- PXXL App
- Vercel (only if you adapt it properly for serverless or proxy use)

Render is not accepted in the task brief.

## Submission Checklist

- Public GitHub repository link
- Public API base URL
- Live endpoints available during grading

## Quick Test Commands

Create a profile:

```bash
curl -X POST http://localhost:3000/api/profiles \
  -H "Content-Type: application/json" \
  -d '{"name":"ella"}'
```

List profiles:

```bash
curl http://localhost:3000/api/profiles
```

Get one profile:

```bash
curl http://localhost:3000/api/profiles/<profile-id>
```

Delete one profile:

```bash
curl -X DELETE http://localhost:3000/api/profiles/<profile-id>
```


## Railway Deployment (Recommended)

1. Push this folder to a public GitHub repository.
2. Create a new Railway project and deploy from GitHub.
3. Add a PostgreSQL service in the same Railway project.
4. In your app service Variables tab, add a reference variable:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

5. Set `NODE_ENV=production`.
6. Redeploy the app service.
7. Open the generated Railway domain and test:

```text
GET /health
POST /api/profiles
GET /api/profiles
```

### Notes

- The app listens on `0.0.0.0:$PORT` for cloud deployment compatibility.
- Railway can use the `npm start` command automatically, but `railway.json` is included for clarity.
- If you prefer Docker deployment, a `Dockerfile` is included.
