Insighta Labs+ — Stage 3 Backend & Platform

Overview
This project extends the Profile Intelligence System (Stage 2) into a secure platform with:

- GitHub OAuth (PKCE)
- JWT authentication (access + refresh tokens)
- Role-Based Access Control (RBAC)
- Versioned API (v2)
- CLI integration
- CSV export
- Rate limiting & logging

System Architecture
CLI → Backend (Express) → PostgreSQL

Authentication Flow (GitHub OAuth + PKCE)

1. /api/v2/auth/github/start
2. Generate code_verifier + challenge
3. Redirect to GitHub
4. Callback /api/v2/auth/github/callback
5. Exchange code for token
6. Fetch GitHub user
7. Issue JWT tokens

Token Handling
Access Token: 15 mins (Authorization: Bearer <token>)
Refresh Token: 7 days (/api/v2/auth/refresh)

RBAC
Admin: full access
Analyst: read-only (no CSV export)

API Versioning
All new endpoints under /api/v2/

Pagination Format
Includes page, limit, total, totalPages, hasNextPage, hasPreviousPage

CSV Export
GET /api/v2/profiles/export.csv (admin only)

CLI Usage
insighta login --access-token <token> --refresh-token <token>
insighta me
insighta profiles
insighta export
insighta logout

Credentials stored in ~/.insighta/credentials.json

NLP Approach
Parses queries into structured filters → SQL query builder

Rate Limiting & Logging
100 requests / 15 mins
Morgan logging enabled

Environment Variables
PORT=3000
DATABASE_URL=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_CALLBACK_URL=...
ACCESS_SECRET=...
REFRESH_SECRET=...
ADMIN_GITHUB_USERS=gabrieliyinbor

Summary
Secure, scalable backend with OAuth, JWT, RBAC, CLI integration.
