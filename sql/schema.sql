CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,
  name VARCHAR NOT NULL UNIQUE,
  gender VARCHAR NOT NULL,
  gender_probability DOUBLE PRECISION NOT NULL,
  age INT NOT NULL,
  age_group VARCHAR NOT NULL,
  country_id VARCHAR(2) NOT NULL,
  country_name VARCHAR NOT NULL,
  country_probability DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profiles_age_non_negative CHECK (age >= 0)
);

CREATE INDEX IF NOT EXISTS idx_profiles_gender ON profiles (gender);
CREATE INDEX IF NOT EXISTS idx_profiles_age_group ON profiles (age_group);
CREATE INDEX IF NOT EXISTS idx_profiles_country_id ON profiles (country_id);
CREATE INDEX IF NOT EXISTS idx_profiles_age ON profiles (age);
CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON profiles (created_at);
CREATE INDEX IF NOT EXISTS idx_profiles_gender_probability ON profiles (gender_probability);
CREATE INDEX IF NOT EXISTS idx_profiles_country_probability ON profiles (country_probability);

CREATE INDEX IF NOT EXISTS idx_profiles_gender_country_age
  ON profiles (gender, country_id, age);