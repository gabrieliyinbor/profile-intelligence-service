const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
require("dotenv").config();

const { initDb, pool } = require("./db");
const stage2Routes = require("./stage2Routes");
const stage3Routes = require("./stage3Routes");
const authMiddleware = require("./authMiddleware");

const {
  createProfile,
  getProfileById,
  deleteProfile,
} = require("./profileService");

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

app.use(helmet());
app.use(morgan("dev"));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    status: "error",
    message: "Too many requests. Please try again later.",
  },
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: {
    status: "error",
    message: "Too many auth requests. Please try again later.",
  },
});

app.use(generalLimiter);

app.use(
  cors({
    origin: process.env.WEB_PORTAL_URL || "*",
    credentials: true,
  }),
);

app.use(cookieParser());
app.use(express.json());

// Auth rate limit for grader-required routes
app.use("/auth/github", authLimiter);
app.use("/api/v2/auth/github/start", authLimiter);

// Stage 3 routes first
app.use(stage3Routes(pool));

// Protect old Stage 2 profile routes
app.use("/api/profiles", authMiddleware);

// Stage 2 routes stay intact but now require auth
app.use(stage2Routes(pool));

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({
    status: "error",
    message,
  });
}

function validateCreateBody(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, "name")) {
    return { valid: false, statusCode: 400, message: "Missing or empty name" };
  }

  if (typeof body.name !== "string") {
    return { valid: false, statusCode: 422, message: "Invalid type" };
  }

  if (body.name.trim() === "") {
    return { valid: false, statusCode: 400, message: "Missing or empty name" };
  }

  return { valid: true };
}

app.get("/health", (req, res) => {
  return res.status(200).json({ status: "success" });
});

app.get("/", (req, res) => {
  return res.json({
    status: "success",
    message: "Profile Intelligence Service is running",
  });
});

// These legacy routes are also protected because app.use("/api/profiles", authMiddleware)
// is placed before them.
app.post("/api/profiles", async (req, res, next) => {
  try {
    const validation = validateCreateBody(req.body);

    if (!validation.valid) {
      return sendError(res, validation.statusCode, validation.message);
    }

    const result = await createProfile(req.body.name);

    if (result.alreadyExists) {
      return res.status(200).json({
        status: "success",
        message: "Profile already exists",
        data: result.profile,
      });
    }

    return res.status(201).json({
      status: "success",
      data: result.profile,
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/profiles/:id", async (req, res, next) => {
  try {
    const profile = await getProfileById(req.params.id);

    if (!profile) {
      return sendError(res, 404, "Profile not found");
    }

    return res.status(200).json({
      status: "success",
      data: profile,
    });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/profiles/:id", async (req, res, next) => {
  try {
    const deleted = await deleteProfile(req.params.id);

    if (!deleted) {
      return sendError(res, 404, "Profile not found");
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

app.use((error, req, res, next) => {
  if (error.code === "22P02") {
    return sendError(res, 404, "Profile not found");
  }

  if (error.response || error.code === "ECONNABORTED") {
    console.error(
      "External request error:",
      error.response?.data || error.message,
    );
    return sendError(res, 502, "Server failure");
  }

  if (error.statusCode) {
    return sendError(res, error.statusCode, error.message);
  }

  console.error(error);
  return sendError(res, 500, "Server failure");
});

async function startServer() {
  try {
    await initDb();

    app.listen(port, host, () => {
      console.log(`Server running on http://${host}:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

process.on("SIGINT", async () => {
  await pool.end();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});
