-- Device last_seen auto-update trigger
CREATE OR REPLACE FUNCTION update_device_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE devices 
  SET last_seen = NOW(), updated_at = NOW()
  WHERE id = NEW.device_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_device_last_seen
  AFTER INSERT ON sensor_readings
  FOR EACH ROW
  EXECUTE FUNCTION update_device_last_seen();

-- Subscription limit checker (skeleton; implement per business logic)
CREATE OR REPLACE FUNCTION check_device_limit(home_uuid UUID, device_type TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  current_count INTEGER;
  max_allowed INTEGER;
BEGIN
  SELECT COUNT(*) INTO current_count
  FROM devices d
  JOIN device_categories c ON c.id = d.category_id
  WHERE d.home_id = home_uuid AND (
    (device_type = 'mower' AND c.name = 'lawn_care') OR
    (device_type = 'pool' AND c.name = 'pool') OR
    (device_type = 'weather' AND c.name = 'weather')
  );

  SELECT sp.max_mowers INTO max_allowed
  FROM home_subscriptions hs
  JOIN service_packages sp ON sp.id = hs.package_id
  WHERE hs.home_id = home_uuid AND hs.status IN ('active','trial')
  ORDER BY hs.started_at DESC
  LIMIT 1;

  IF device_type = 'mower' THEN
    RETURN COALESCE(current_count,0) < COALESCE(max_allowed,1);
  END IF;

  -- For other device types, allow by default unless you extend packages
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Paystack R1 authorization testing tables and function
CREATE TABLE IF NOT EXISTS paystack_test_charges (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    home_id UUID REFERENCES homes(id),
    authorization_code TEXT NOT NULL,
    email TEXT NOT NULL,
    amount_cents INTEGER DEFAULT 100,
    reference TEXT UNIQUE NOT NULL,
    status TEXT CHECK (status IN ('pending', 'success', 'failed')) DEFAULT 'pending',
    paystack_response JSONB,
    tested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION test_paystack_authorization(
    p_home_id UUID,
    p_authorization_code TEXT,
    p_email TEXT
) RETURNS UUID AS $$
DECLARE
    test_id UUID;
    test_reference TEXT;
BEGIN
    test_reference := 'test_' || gen_random_uuid()::text;
    INSERT INTO paystack_test_charges (home_id, authorization_code, email, reference)
    VALUES (p_home_id, p_authorization_code, p_email, test_reference)
    RETURNING id INTO test_id;
    PERFORM pg_notify('test_authorization', test_id::text);
    RETURN test_id;
END;
$$ LANGUAGE plpgsql;

-- Cron jobs (requires pg_cron extension enabled on the project)
DO $$ BEGIN
  PERFORM 1 FROM pg_extension WHERE extname = 'pg_cron';
  IF NOT FOUND THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;
END $$;

-- Schedules
SELECT cron.schedule(
    'schedule-daily-maintenance',
    '0 6 * * *',
    $$SELECT 1$$
) ON CONFLICT DO NOTHING;

SELECT cron.schedule(
    'process-monthly-billing',
    '0 0 1 * *',
    $$SELECT 1$$
) ON CONFLICT DO NOTHING;

SELECT cron.schedule(
    'device-health-check',
    '0 * * * *',
    $$SELECT 1$$
) ON CONFLICT DO NOTHING;

SELECT cron.schedule(
    'cleanup-old-readings',
    '0 2 * * *',
    $$DELETE FROM sensor_readings WHERE created_at < NOW() - INTERVAL '2 years';$$
) ON CONFLICT DO NOTHING; 