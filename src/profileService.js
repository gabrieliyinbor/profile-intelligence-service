const axios = require("axios");
const { v7: uuidv7 } = require("uuid");
const { pool } = require("./db");
const {
  normalizeName,
  getAgeGroup,
  pickTopCountry,
  fullProfileRowToResponse,
  listProfileRowToResponse,
} = require("./utils");

const genderizeBaseUrl = "https://api.genderize.io";
const agifyBaseUrl = "https://api.agify.io";
const nationalizeBaseUrl = "https://api.nationalize.io";

const regionNames =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

function getCountryNameFromIso(countryId) {
  if (!countryId) return null;
  try {
    return regionNames
      ? regionNames.of(String(countryId).toUpperCase())
      : String(countryId).toUpperCase();
  } catch {
    return String(countryId).toUpperCase();
  }
}

async function fetchExternalProfileData(name) {
  const [genderRes, ageRes, countryRes] = await Promise.all([
    axios.get(genderizeBaseUrl, { params: { name }, timeout: 10000 }),
    axios.get(agifyBaseUrl, { params: { name }, timeout: 10000 }),
    axios.get(nationalizeBaseUrl, { params: { name }, timeout: 10000 }),
  ]);

  const genderData = genderRes.data;
  const ageData = ageRes.data;
  const countryData = countryRes.data;

  if (
    !genderData ||
    genderData.gender === null ||
    Number(genderData.count) === 0
  ) {
    const error = new Error("Server failure");
    error.statusCode = 502;
    throw error;
  }

  if (!ageData || ageData.age === null) {
    const error = new Error("Server failure");
    error.statusCode = 502;
    throw error;
  }

  const topCountry = pickTopCountry(countryData?.country);
  if (!topCountry) {
    const error = new Error("Server failure");
    error.statusCode = 502;
    throw error;
  }

  return {
    gender: genderData.gender,
    gender_probability: Number(genderData.probability),
    age: Number(ageData.age),
    age_group: getAgeGroup(Number(ageData.age)),
    country_id: String(topCountry.country_id).toUpperCase(),
    country_name: getCountryNameFromIso(topCountry.country_id),
    country_probability: Number(topCountry.probability),
  };
}

async function findProfileByName(name) {
  const normalizedName = normalizeName(name);

  const result = await pool.query(
    `SELECT id, name, gender, gender_probability, age, age_group, country_id,
            country_name, country_probability, created_at
     FROM profiles
     WHERE LOWER(TRIM(name)) = $1
     LIMIT 1`,
    [normalizedName],
  );

  return result.rows[0] || null;
}

async function createProfile(name) {
  const normalizedName = normalizeName(name);

  const existingProfile = await findProfileByName(normalizedName);
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
       id, name, gender, gender_probability,
       age, age_group, country_id, country_name,
       country_probability, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (name) DO NOTHING
     RETURNING id, name, gender, gender_probability, age, age_group,
               country_id, country_name, country_probability, created_at`,
    [
      id,
      normalizedName,
      enriched.gender,
      enriched.gender_probability,
      enriched.age,
      enriched.age_group,
      enriched.country_id,
      enriched.country_name,
      enriched.country_probability,
    ],
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
    `SELECT id, name, gender, gender_probability, age, age_group, country_id,
            country_name, country_probability, created_at
     FROM profiles
     WHERE id = $1`,
    [id],
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

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const result = await pool.query(
    `SELECT id, name, gender, gender_probability, age, age_group, country_id,
            country_name, country_probability, created_at
     FROM profiles
     ${whereClause}
     ORDER BY created_at DESC`,
    values,
  );

  return result.rows.map(listProfileRowToResponse);
}

async function deleteProfile(id) {
  const result = await pool.query("DELETE FROM profiles WHERE id = $1", [id]);
  return result.rowCount > 0;
}

module.exports = {
  createProfile,
  getProfileById,
  listProfiles,
  deleteProfile,
};
