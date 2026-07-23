-- Profiles table linked to auth.users
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their profile" ON profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "Users can update their profile" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- Function: when a new profile is created, create a default home and add owner membership
CREATE OR REPLACE FUNCTION create_home_for_new_profile()
RETURNS TRIGGER AS $$
DECLARE
  new_home_id UUID;
BEGIN
  INSERT INTO homes (name, timezone)
  VALUES (COALESCE(NEW.full_name, 'My Home'), 'Africa/Johannesburg')
  RETURNING id INTO new_home_id;

  INSERT INTO home_members (home_id, user_id, role, joined_at)
  VALUES (new_home_id, NEW.id, 'owner', NOW());

  INSERT INTO home_subscriptions (home_id, package_id, status, started_at, trial_ends_at)
  SELECT new_home_id, sp.id, 'trial', NOW(), NOW() + INTERVAL '14 days'
  FROM service_packages sp
  WHERE sp.name = 'Basic'
  LIMIT 1;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_create_home_for_profile ON profiles;
CREATE TRIGGER trigger_create_home_for_profile
AFTER INSERT ON profiles
FOR EACH ROW
EXECUTE FUNCTION create_home_for_new_profile(); 