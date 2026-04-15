const axios = require('axios');
const { v7: uuidv7 } = require('uuid');
const { pool } = require('./db');
const {
  normalizeName,
  getAgeGroup,
  pickTopCountry,
  fullProfileRowToResponse,
  listProfileRowToResponse,
} = require('./utils');

const genderizeBaseUrl = 'https://api.genderize.io';
const agifyBaseUrl = 'https://api.agify.io';
const nationalizeBaseUrl = 'https://api.nationalize.io';

async function fetchExternalProfileData(name) {
  const [genderRes, ageRes, countryRes] = await Promise.all([
    axios.get(genderizeBaseUrl, { params: { name }, timeout: 10000 }),
    axios.get(agifyBaseUrl, { params: { name }, timeout: 10000 }),
    axios.get(nationalizeBaseUrl, { params: { name }, timeout: 10000 }),
  ]);

  const genderData = genderRes.data;
  const ageData = ageRes.data;
  const countryData = countryRes.data;

  if (!genderData || genderData.gender === null || Number(genderData.count) === 0) {
    const error = new Error('Genderize returned an invalid response');
    error.statusCode = 502;
    throw error;
  }

  if (!ageData || ageData.age === null) {
    const error = new Error('Agify returned an invalid response');
    error.statusCode = 502;
    throw error;
  }

  const topCountry = pickTopCountry(countryData?.country);
  if (!topCountry) {
    const error = new Error('Nationalize returned an invalid response');
    error.statusCode = 502;
    throw error;
  }

  return {
    gender: genderData.gender,
    gender_probability: Number(genderData.probability),
    sample_size: Number(genderData.count),
    age: Number(ageData.age),
    age_group: getAgeGroup(Number(ageData.age)),
    country_id: topCountry.country_id,
    country_probability: Number(topCountry.probability),
  };
}

async function findProfileByName(name) {
  const normalizedName = normalizeName(name);
  const result = await pool.query(
    `SELECT id, name, gender, gender_probability, sample_size, age, age_group, country_id,
            country_probability, created_at
     FROM profiles
     WHERE normalized_name = $1`,
    [normalizedName]
  );

  return result.rows[0] || null;
}

async function createProfile(name) {
  const normalizedName = normalizeName(name);

  const existingProfile = await findProfileByName(name);
  if (existingProfile) {
    return {
      alreadyExists: true,
      profile: fullProfileRowToResponse(existingProfile),
    };
  }

  const enriched = await fetchExternalProfileData(normalizedName);
  const id = uuidv7();

  const insertResult = await pool.query(
    `INSERT INTO profiles (
       id, name, normalized_name, gender, gender_probability, sample_size,
       age, age_group, country_id, country_probability, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (normalized_name) DO NOTHING
     RETURNING id, name, gender, gender_probability, sample_size, age, age_group,
               country_id, country_probability, created_at`,
    [
      id,
      normalizedName,
      normalizedName,
      enriched.gender,
      enriched.gender_probability,
      enriched.sample_size,
      enriched.age,
      enriched.age_group,
      enriched.country_id,
      enriched.country_probability,
    ]
  );

  if (insertResult.rows.length === 0) {
    const raceWinner = await findProfileByName(normalizedName);
    return {
      alreadyExists: true,
      profile: fullProfileRowToResponse(raceWinner),
    };
  }

  return {
    alreadyExists: false,
    profile: fullProfileRowToResponse(insertResult.rows[0]),
  };
}

async function getProfileById(id) {
  const result = await pool.query(
    `SELECT id, name, gender, gender_probability, sample_size, age, age_group, country_id,
            country_probability, created_at
     FROM profiles
     WHERE id = $1`,
    [id]
  );

  return result.rows[0] ? fullProfileRowToResponse(result.rows[0]) : null;
}

async function listProfiles(filters) {
  const conditions = [];
  const values = [];

  if (filters.gender) {
    values.push(filters.gender.toLowerCase());
    conditions.push(`LOWER(gender) = $${values.length}`);
  }

  if (filters.country_id) {
    values.push(filters.country_id.toUpperCase());
    conditions.push(`UPPER(country_id) = $${values.length}`);
  }

  if (filters.age_group) {
    values.push(filters.age_group.toLowerCase());
    conditions.push(`LOWER(age_group) = $${values.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT id, name, gender, age, age_group, country_id
     FROM profiles
     ${whereClause}
     ORDER BY created_at DESC`,
    values
  );

  return result.rows.map(listProfileRowToResponse);
}

async function deleteProfile(id) {
  const result = await pool.query('DELETE FROM profiles WHERE id = $1', [id]);
  return result.rowCount > 0;
}

module.exports = {
  createProfile,
  getProfileById,
  listProfiles,
  deleteProfile,
};
