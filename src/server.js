const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { initDb, pool } = require('./db');
const {
  createProfile,
  getProfileById,
  listProfiles,
  deleteProfile,
} = require('./profileService');

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

app.use(cors({ origin: '*' }));
app.use(express.json());

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({
    status: 'error',
    message,
  });
}

function validateCreateBody(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'name')) {
    return { valid: false, statusCode: 400, message: 'Missing or empty name' };
  }

  if (typeof body.name !== 'string') {
    return { valid: false, statusCode: 422, message: 'Invalid type' };
  }

  if (body.name.trim() === '') {
    return { valid: false, statusCode: 400, message: 'Missing or empty name' };
  }

  return { valid: true };
}

app.get('/health', (req, res) => {
  return res.status(200).json({ status: 'success' });
});

app.get('/', (req, res) => {
  return res.json({
    status: 'success',
    message: 'Profile Intelligence Service is running',
  });
});

app.post('/api/profiles', async (req, res, next) => {
  try {
    const validation = validateCreateBody(req.body);
    if (!validation.valid) {
      return sendError(res, validation.statusCode, validation.message);
    }

    const result = await createProfile(req.body.name);

    if (result.alreadyExists) {
      return res.status(200).json({
        status: 'success',
        message: 'Profile already exists',
        data: result.profile,
      });
    }

    return res.status(201).json({
      status: 'success',
      data: result.profile,
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/profiles/:id', async (req, res, next) => {
  try {
    const profile = await getProfileById(req.params.id);

    if (!profile) {
      return sendError(res, 404, 'Profile not found');
    }

    return res.status(200).json({
      status: 'success',
      data: profile,
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/profiles', async (req, res, next) => {
  try {
    const profiles = await listProfiles({
      gender: req.query.gender,
      country_id: req.query.country_id,
      age_group: req.query.age_group,
    });

    return res.status(200).json({
      status: 'success',
      count: profiles.length,
      data: profiles,
    });
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/profiles/:id', async (req, res, next) => {
  try {
    const deleted = await deleteProfile(req.params.id);

    if (!deleted) {
      return sendError(res, 404, 'Profile not found');
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

app.use((error, req, res, next) => {
  if (error.code === '22P02') {
    return sendError(res, 404, 'Profile not found');
  }

  if (error.response || error.code === 'ECONNABORTED') {
    return sendError(res, 502, 'Upstream or server failure');
  }

  if (error.statusCode) {
    return sendError(res, error.statusCode, error.message);
  }

  console.error(error);
  return sendError(res, 500, 'Internal server error');
});

async function startServer() {
  try {
    await initDb();
    app.listen(port, host, () => {
      console.log(`Server running on http://${host}:${port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
