-- Stage 2 migration: brings the Stage 1 profiles table up to Stage 2 spec.
-- Safe to run multiple times (idempotent).

-- 1. Ensure country_name column exists
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS country_name VARCHAR;

-- 2. Ensure name is UNIQUE (Stage 2 spec).
--    Wrapped in DO block so re-running doesn't error if the constraint already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_name_unique'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_name_unique UNIQUE (name);
  END IF;
END$$;

-- 3. Performance indexes for the Stage 2 filter/sort/search paths.
CREATE INDEX IF NOT EXISTS idx_profiles_gender             ON profiles (gender);
CREATE INDEX IF NOT EXISTS idx_profiles_country_id         ON profiles (country_id);
CREATE INDEX IF NOT EXISTS idx_profiles_age_group          ON profiles (age_group);
CREATE INDEX IF NOT EXISTS idx_profiles_age                ON profiles (age);
CREATE INDEX IF NOT EXISTS idx_profiles_created_at         ON profiles (created_at);
CREATE INDEX IF NOT EXISTS idx_profiles_gender_probability ON profiles (gender_probability);

-- Composite index for the most common combined filters
CREATE INDEX IF NOT EXISTS idx_profiles_gender_country_age
  ON profiles (gender, country_id, age);
