-- Function to create user profile when user signs up
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  
  -- Create a default place for the user
  PERFORM create_default_place(NEW.id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically create profile when user signs up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_user_profile();

-- Function to create a default place and add user as owner
CREATE OR REPLACE FUNCTION create_default_place(user_id UUID)
RETURNS UUID AS $$
DECLARE
  place_id UUID;
BEGIN
  -- Create a default place
  INSERT INTO places (name, address, city, state, country)
  VALUES (
    'My Home',
    'Address not set',
    'City not set',
    'Province not set',
    'South Africa'
  )
  RETURNING id INTO place_id;
  
  -- Add user as owner of the place
  INSERT INTO place_members (place_id, user_id, role)
  VALUES (place_id, user_id, 'owner');
  
  RETURN place_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if a location is covered
CREATE OR REPLACE FUNCTION check_coverage(
  lat DECIMAL(10, 8),
  lng DECIMAL(11, 8),
  city TEXT DEFAULT NULL,
  state TEXT DEFAULT NULL,
  postal_code TEXT DEFAULT NULL
)
RETURNS TABLE(
  is_covered BOOLEAN,
  coverage_area_id UUID,
  coverage_area_name TEXT,
  distance_km DECIMAL(5, 2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN ca.id IS NOT NULL THEN true 
      ELSE false 
    END as is_covered,
    ca.id as coverage_area_id,
    ca.name as coverage_area_name,
    CASE 
      WHEN ca.id IS NOT NULL THEN 
        ST_Distance(
          ST_Point(lng, lat)::geography,
          ST_Point(ca.longitude, ca.latitude)::geography
        ) / 1000
      ELSE NULL
    END as distance_km
  FROM coverage_areas ca
  WHERE ca.is_active = true
    AND (
      -- Check by coordinates if provided
      (lat IS NOT NULL AND lng IS NOT NULL AND 
       ST_DWithin(
         ST_Point(lng, lat)::geography,
         ST_Point(ca.longitude, ca.latitude)::geography,
         ca.radius_km * 1000
       ))
      OR
      -- Check by city/state if coordinates not provided
      (lat IS NULL AND lng IS NULL AND 
       ca.city ILIKE '%' || COALESCE(city, '') || '%' AND
       ca.state ILIKE '%' || COALESCE(state, '') || '%')
      OR
      -- Check by postal code if provided
      (postal_code IS NOT NULL AND ca.postal_code = postal_code)
    )
  ORDER BY distance_km ASC NULLS LAST
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_places_updated_at BEFORE UPDATE ON places FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_bots_updated_at BEFORE UPDATE ON bots FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_bot_schedules_updated_at BEFORE UPDATE ON bot_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
