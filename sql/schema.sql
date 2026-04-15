CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  gender TEXT NOT NULL,
  gender_probability NUMERIC(5,4) NOT NULL,
  sample_size INTEGER NOT NULL,
  age INTEGER NOT NULL,
  age_group TEXT NOT NULL,
  country_id VARCHAR(10) NOT NULL,
  country_probability NUMERIC(7,6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profiles_age_non_negative CHECK (age >= 0),
  CONSTRAINT profiles_sample_size_non_negative CHECK (sample_size >= 0)
);

CREATE INDEX IF NOT EXISTS idx_profiles_gender ON profiles (LOWER(gender));
CREATE INDEX IF NOT EXISTS idx_profiles_country_id ON profiles (UPPER(country_id));
CREATE INDEX IF NOT EXISTS idx_profiles_age_group ON profiles (LOWER(age_group));
