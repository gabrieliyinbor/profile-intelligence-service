function normalizeName(name) {
  return String(name).trim().toLowerCase();
}

function getAgeGroup(age) {
  if (age >= 0 && age <= 12) return 'child';
  if (age >= 13 && age <= 19) return 'teenager';
  if (age >= 20 && age <= 59) return 'adult';
  return 'senior';
}

function pickTopCountry(countries) {
  if (!Array.isArray(countries) || countries.length === 0) {
    return null;
  }

  return countries.reduce((best, current) => {
    if (!best || current.probability > best.probability) {
      return current;
    }
    return best;
  }, null);
}

function fullProfileRowToResponse(row) {
  return {
    id: row.id,
    name: row.name,
    gender: row.gender,
    gender_probability: Number(row.gender_probability),
    sample_size: row.sample_size,
    age: row.age,
    age_group: row.age_group,
    country_id: row.country_id,
    country_probability: Number(row.country_probability),
    created_at: new Date(row.created_at).toISOString(),
  };
}

function listProfileRowToResponse(row) {
  return {
    id: row.id,
    name: row.name,
    gender: row.gender,
    age: row.age,
    age_group: row.age_group,
    country_id: row.country_id,
  };
}

module.exports = {
  normalizeName,
  getAgeGroup,
  pickTopCountry,
  fullProfileRowToResponse,
  listProfileRowToResponse,
};
