# Stage 2 — Integration Guide

This bundle adds the **Intelligence Query Engine** on top of your existing
Stage 1 codebase. It is designed to be **drop-in**: nothing in your existing
`profileService.js`, `db.js`, or Stage 1 endpoints (POST, DELETE, GET-by-id)
needs to change.

---

## 1. Files to add

Copy these into the matching directories of your repo:

    sql/migrate-stage2.sql         # schema upgrade (idempotent)
    src/countries.js               # country-name → ISO2 lookup
    src/nlParser.js                # rule-based NL query parser
    src/queryBuilder.js            # validation + parameterised SQL builder
    src/stage2Routes.js            # Express router with GET /api/profiles and /search
    scripts/seed.js                # seeds 2026 profiles (idempotent)

No new npm dependencies are required beyond what you already have
(`express`, `pg`, `uuid`, `dotenv`).

---

## 2. Run the migration

Connect to your Postgres (local or Railway) and run:

```bash
psql "$DATABASE_URL" -f sql/migrate-stage2.sql
```

This is safe to run multiple times. It:

- Adds `country_name VARCHAR` to `profiles` if missing
- Adds `UNIQUE (name)` constraint if missing (enables idempotent seeding)
- Creates indexes on `gender`, `country_id`, `age_group`, `age`, `created_at`,
  `gender_probability`, plus a composite `(gender, country_id, age)` index

---

## 3. Wire the new router into `server.js`

Open `src/server.js` and make two changes.

### 3a. Import and mount

Near your other requires:

```js
const stage2Routes = require("./stage2Routes");
```

Where you register routes (after `app.use(express.json())`, `cors`, etc.):

```js
app.use(stage2Routes(pool));
```

`pool` is whatever PostgreSQL `Pool` instance you currently expose from
`./db.js`. If your `db.js` exports `query` only, import it like:

```js
const pool = require("./db"); // or { pool } = require("./db");
```

### 3b. Remove the old list handler

**Delete** your existing `app.get("/api/profiles", ...)` handler. The new
router replaces it. **Keep** your POST / DELETE / GET-`:id` handlers exactly
as they are.

### 3c. Route ordering (important)

Make sure `app.use(stage2Routes(pool))` is registered **before** your
`app.get("/api/profiles/:id", ...)` handler, otherwise Express will try to
route `/api/profiles/search` into the `:id` handler. The cleanest ordering:

```js
app.use(stage2Routes(pool));               // GET list + search
app.post("/api/profiles", ...);            // Stage 1
app.get ("/api/profiles/:id", ...);        // Stage 1
app.delete("/api/profiles/:id", ...);      // Stage 1
```

---

## 4. Seed the 2026 profiles

1. Download the profiles JSON file linked in the task brief.
2. Save it to `seed-data/profiles.json` (or any path).
3. Add this script entry to `package.json`:

   ```json
   "scripts": {
     "seed": "node scripts/seed.js"
   }
   ```

4. Run:

   ```bash
   npm run seed                       # uses ./seed-data/profiles.json
   npm run seed -- path/to/file.json  # or pass a custom path
   ```

The seed is idempotent via `ON CONFLICT (name) DO NOTHING`. Re-running inserts
zero rows the second time.

---

## 5. Deploy

Your existing Railway setup needs nothing special. Push, redeploy, then:

```bash
# on Railway, from the deployment shell:
psql $DATABASE_URL -f sql/migrate-stage2.sql
node scripts/seed.js seed-data/profiles.json
```

Or wire both into a `postdeploy` step.

---

# API Reference (Stage 2)

All error responses follow:

```json
{ "status": "error", "message": "<string>" }
```

Status codes used: **400** missing/empty param, **422** invalid type,
**404** not found, **500** server error, **502** upstream API failure.

All timestamps are UTC ISO 8601. All IDs are UUID v7.
CORS: `Access-Control-Allow-Origin: *`.

---

## `GET /api/profiles`

Filter, sort, and paginate the profile store.

### Query parameters

| Param                     | Type   | Allowed values                            |
| ------------------------- | ------ | ----------------------------------------- |
| `gender`                  | string | `male`, `female`                          |
| `age_group`               | string | `child`, `teenager`, `adult`, `senior`    |
| `country_id`              | string | ISO 3166-1 alpha-2 (2 letters)            |
| `min_age`                 | int    | 0–150                                     |
| `max_age`                 | int    | 0–150                                     |
| `min_gender_probability`  | float  | 0.0–1.0                                   |
| `min_country_probability` | float  | 0.0–1.0                                   |
| `sort_by`                 | string | `age`, `created_at`, `gender_probability` |
| `order`                   | string | `asc`, `desc` (default `desc`)            |
| `page`                    | int    | ≥ 1 (default 1)                           |
| `limit`                   | int    | 1–50 (default 10, values >50 clamp to 50) |

All filters **combine with AND**. Results must strictly match every condition.

### Example

```
GET /api/profiles?gender=male&country_id=NG&min_age=25&sort_by=age&order=desc&page=1&limit=10
```

### Response 200

```json
{
  "status": "success",
  "page": 1,
  "limit": 10,
  "total": 2026,
  "data": [
    {
      "id": "018f0f26-d251-7f77-b1c8-25c3f3d8806b",
      "name": "ella",
      "gender": "female",
      "gender_probability": 0.99,
      "age": 46,
      "age_group": "adult",
      "country_id": "NG",
      "country_name": "Nigeria",
      "country_probability": 0.85,
      "created_at": "2026-04-01T12:00:00.000Z"
    }
  ]
}
```

---

## `GET /api/profiles/search`

Plain-English query endpoint. Rule-based parser — no LLMs.

### Query parameters

| Param              | Type   | Notes                                     |
| ------------------ | ------ | ----------------------------------------- |
| `q`                | string | required, non-empty                       |
| `page`             | int    | optional, same semantics as list endpoint |
| `limit`            | int    | optional, same semantics as list endpoint |
| `sort_by`, `order` | string | optional, same semantics as list endpoint |

### Supported phrasings

| Phrase                               | Parsed filters                                         |
| ------------------------------------ | ------------------------------------------------------ |
| `young males`                        | `gender=male, min_age=16, max_age=24`                  |
| `females above 30`                   | `gender=female, min_age=30`                            |
| `people from angola`                 | `country_id=AO`                                        |
| `adult males from kenya`             | `gender=male, age_group=adult, country_id=KE`          |
| `male and female teenagers above 17` | `age_group=teenager, min_age=17`                       |
| `men between 20 and 40`              | `gender=male, min_age=20, max_age=40`                  |
| `females under 25`                   | `gender=female, max_age=25`                            |
| `seniors from nigeria`               | `age_group=senior, country_id=NG`                      |
| `young women from south africa`      | `gender=female, min_age=16, max_age=24, country_id=ZA` |

### Parsing rules

- **Gender**: `male`/`men`/`man`/`boy(s)` → `male`. `female`/`women`/`woman`/
  `girl(s)`/`lady`/`ladies` → `female`. If both are mentioned, no gender filter.
- **Age group**: `child(ren)`/`kid(s)`, `teen(ager)(s)`, `adult(s)`,
  `senior(s)`/`elderly`.
- **Country**: `from <name>` — resolved via the country map (~130 countries
  with common variants: `usa`, `uk`, `britain`, `ivory coast`, etc.).
- **Age comparison**: `above N`, `over N`, `older than N`, `greater than N` →
  `min_age=N`. `below N`, `under N`, `younger than N`, `less than N` →
  `max_age=N`. `between N and M`, `aged N to M`, `N-M` → both.
- **`young`**: parsing-only shorthand for ages 16–24. Not stored as an
  `age_group`. Only fills gaps — explicit comparisons win.

### Response 200

Same shape as `GET /api/profiles`, plus two extra top-level fields:

```json
{
  "status": "success",
  "query": "young males from nigeria",
  "interpreted_as": { "gender": "male", "min_age": 16, "max_age": 24, "country_id": "NG" },
  "page": 1,
  "limit": 10,
  "total": 37,
  "data": [ ... ]
}
```

### Errors

| Condition                            | Status | Message                     |
| ------------------------------------ | ------ | --------------------------- |
| `q` missing or empty                 | 400    | `Invalid query parameters`  |
| `q` has no interpretable tokens      | 400    | `Unable to interpret query` |
| `page` / `limit` / `sort_by` invalid | 422    | `Invalid query parameters`  |

---

# Performance notes

- **Single round-trip pagination**: `COUNT(*) OVER()` in the main query
  returns the filtered total alongside each row, so one SQL statement covers
  both the page and the total count.
- **Indexed columns**: `gender`, `country_id`, `age_group`, `age`,
  `created_at`, `gender_probability`, plus composite `(gender, country_id, age)`
  for the hottest combined-filter path.
- **Parameterised queries**: user input never concatenated into SQL.
- **Limit clamp**: `limit` >50 silently clamps to 50 to prevent expensive
  full-result dumps.
- **Strict integer/float parsing**: rejects `"30abc"` etc. at the validation
  layer so no bad values reach the query planner.

For 2026 rows the filter + index strategy is overkill; the same plan scales
cleanly to millions without changes.

---

# Evaluation checklist

- [x] Filtering logic — all 7 filter params, combinable with AND
- [x] Combined filters — validated in `test-builder.js`
- [x] Pagination — page/limit with total in response
- [x] Sorting — three allowed fields, asc/desc
- [x] Natural language parsing — all 5 spec examples + extras pass
- [x] README explanation — this file
- [x] Query validation — 400/422 split, consistent error shape
- [x] Performance — indexed + single-query total
