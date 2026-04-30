const express = require("express");
const axios = require("axios");

const authMiddleware = require("./authMiddleware");
const roleMiddleware = require("./roleMiddleware");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require("./tokenService");

const {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} = require("./pkce");

const oauthStore = new Map();

function getRoleFromGithub(username) {
  const admins = (process.env.ADMIN_GITHUB_USERS || "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  return admins.includes(username.toLowerCase()) ? "admin" : "analyst";
}

function stage3Routes(pool) {
  const router = express.Router();

  router.get("/api/v2/health", (req, res) => {
    res.json({
      status: "success",
      version: "v2",
      message: "Stage 3 API is running",
    });
  });

  // DEV LOGIN - keep for testing only
  router.post("/api/v2/auth/dev-login", (req, res) => {
    const { username = "test-user", role = "analyst" } = req.body || {};

    if (!["admin", "analyst"].includes(role)) {
      return res.status(400).json({
        status: "error",
        message: "Role must be admin or analyst",
      });
    }

    const user = { id: 1, username, role };

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    return res.json({
      status: "success",
      message: "Dev login successful",
      data: {
        user,
        accessToken,
        refreshToken,
      },
    });
  });

  // GITHUB OAUTH START WITH PKCE
  router.get("/api/v2/auth/github/start", (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const callbackUrl = process.env.GITHUB_CALLBACK_URL;

    if (!clientId || !callbackUrl) {
      return res.status(500).json({
        status: "error",
        message: "GitHub OAuth environment variables are missing",
      });
    }

    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    oauthStore.set(state, {
      codeVerifier,
      createdAt: Date.now(),
    });

    const githubUrl = new URL("https://github.com/login/oauth/authorize");

    githubUrl.searchParams.set("client_id", clientId);
    githubUrl.searchParams.set("redirect_uri", callbackUrl);
    githubUrl.searchParams.set("scope", "read:user user:email");
    githubUrl.searchParams.set("state", state);
    githubUrl.searchParams.set("code_challenge", codeChallenge);
    githubUrl.searchParams.set("code_challenge_method", "S256");

    return res.redirect(githubUrl.toString());
  });

  // GITHUB OAUTH CALLBACK
  router.get("/api/v2/auth/github/callback", async (req, res, next) => {
    try {
      const { code, state } = req.query;

      if (!code || !state) {
        return res.status(400).json({
          status: "error",
          message: "Missing GitHub OAuth code or state",
        });
      }

      const stored = oauthStore.get(state);

      if (!stored) {
        return res.status(400).json({
          status: "error",
          message: "Invalid or expired OAuth state",
        });
      }

      oauthStore.delete(state);

      const params = new URLSearchParams();
      params.append("client_id", process.env.GITHUB_CLIENT_ID);
      params.append("client_secret", process.env.GITHUB_CLIENT_SECRET);
      params.append("code", code);
      params.append("redirect_uri", process.env.GITHUB_CALLBACK_URL);
      params.append("code_verifier", stored.codeVerifier);

      const tokenResponse = await axios.post(
        "https://github.com/login/oauth/access_token",
        params,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
      );

      const githubAccessToken = tokenResponse.data.access_token;

      if (!githubAccessToken) {
        return res.status(401).json({
          status: "error",
          message: "GitHub authentication failed",
          details: tokenResponse.data,
        });
      }

      const githubUserResponse = await axios.get(
        "https://api.github.com/user",
        {
          headers: {
            Authorization: `Bearer ${githubAccessToken}`,
            Accept: "application/vnd.github+json",
          },
        },
      );

      const githubUser = githubUserResponse.data;

      const user = {
        id: githubUser.id,
        username: githubUser.login,
        role: getRoleFromGithub(githubUser.login),
      };

      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);

      return res.json({
        status: "success",
        message: "GitHub OAuth login successful",
        data: {
          user,
          accessToken,
          refreshToken,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  // REFRESH TOKEN
  router.post("/api/v2/auth/refresh", (req, res) => {
    try {
      const { refreshToken } = req.body || {};

      if (!refreshToken) {
        return res.status(400).json({
          status: "error",
          message: "Refresh token is required",
        });
      }

      const decoded = verifyRefreshToken(refreshToken);

      const user = {
        id: decoded.id,
        username: decoded.username,
        role: decoded.role,
      };

      const newAccessToken = generateAccessToken(user);

      return res.json({
        status: "success",
        data: {
          accessToken: newAccessToken,
        },
      });
    } catch (error) {
      return res.status(401).json({
        status: "error",
        message: "Invalid or expired refresh token",
      });
    }
  });

  router.get("/api/v2/me", authMiddleware, (req, res) => {
    return res.json({
      status: "success",
      data: req.user,
    });
  });

  router.get("/api/v2/profiles", authMiddleware, async (req, res, next) => {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
      const offset = (page - 1) * limit;

      const totalResult = await pool.query("SELECT COUNT(*) FROM profiles");
      const total = Number(totalResult.rows[0].count);
      const totalPages = Math.ceil(total / limit);

      const result = await pool.query(
        "SELECT * FROM profiles ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        [limit, offset],
      );

      return res.json({
        status: "success",
        data: result.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get(
    "/api/v2/profiles/export.csv",
    authMiddleware,
    roleMiddleware("admin"),
    async (req, res, next) => {
      try {
        const result = await pool.query(
          "SELECT * FROM profiles ORDER BY created_at DESC",
        );

        const rows = result.rows;

        if (rows.length === 0) {
          res.setHeader("Content-Type", "text/csv");
          res.setHeader(
            "Content-Disposition",
            "attachment; filename=profiles.csv",
          );
          return res.send("id,name\n");
        }

        const headers = Object.keys(rows[0]);

        const csvRows = [
          headers.join(","),
          ...rows.map((row) =>
            headers
              .map((header) => {
                const value = row[header] ?? "";
                return `"${String(value).replace(/"/g, '""')}"`;
              })
              .join(","),
          ),
        ];

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          "attachment; filename=profiles.csv",
        );

        return res.send(csvRows.join("\n"));
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

module.exports = stage3Routes;
