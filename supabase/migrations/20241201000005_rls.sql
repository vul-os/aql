-- Enable Row Level Security and add minimal policies

-- PROFILES
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow users to view own profile" ON profiles;
CREATE POLICY "Allow users to view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "Allow users to update own profile" ON profiles;
CREATE POLICY "Allow users to update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- PLACES
ALTER TABLE places ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow members to view places" ON places;
CREATE POLICY "Allow members to view places" ON places
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM place_members pm WHERE pm.place_id = places.id AND pm.user_id = auth.uid()
  ));

-- PLACE_MEMBERS
ALTER TABLE place_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow members to view memberships" ON place_members;
CREATE POLICY "Allow members to view memberships" ON place_members
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM place_members pm WHERE pm.place_id = place_members.place_id AND pm.user_id = auth.uid()
  ));

-- COVERAGE_AREAS (public read)
ALTER TABLE coverage_areas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read coverage" ON coverage_areas;
CREATE POLICY "Public read coverage" ON coverage_areas
  FOR SELECT USING (true);

-- BOTS
ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow members to read bots" ON bots;
CREATE POLICY "Allow members to read bots" ON bots
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM place_members pm WHERE pm.place_id = bots.place_id AND pm.user_id = auth.uid()
  ));

-- BOT_SCHEDULES
ALTER TABLE bot_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow members to read schedules" ON bot_schedules;
CREATE POLICY "Allow members to read schedules" ON bot_schedules
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM bots b JOIN place_members pm ON pm.place_id = b.place_id
    WHERE b.id = bot_schedules.bot_id AND pm.user_id = auth.uid()
  ));

-- BOT_SENSORS
ALTER TABLE bot_sensors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow members to read sensors" ON bot_sensors;
CREATE POLICY "Allow members to read sensors" ON bot_sensors
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM bots b JOIN place_members pm ON pm.place_id = b.place_id
    WHERE b.id = bot_sensors.bot_id AND pm.user_id = auth.uid()
  ));

-- BOT_COMMANDS (read-only by members; inserts should be via RPC or future policy)
ALTER TABLE bot_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow members to read commands" ON bot_commands;
CREATE POLICY "Allow members to read commands" ON bot_commands
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM bots b JOIN place_members pm ON pm.place_id = b.place_id
    WHERE b.id = bot_commands.bot_id AND pm.user_id = auth.uid()
  ));

-- SMART DEVICES
ALTER TABLE device_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read device types" ON device_types;
CREATE POLICY "Public read device types" ON device_types
  FOR SELECT USING (true);

ALTER TABLE smart_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow members to read devices" ON smart_devices;
CREATE POLICY "Allow members to read devices" ON smart_devices
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM place_members pm WHERE pm.place_id = smart_devices.place_id AND pm.user_id = auth.uid()
  ));

ALTER TABLE device_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow members to read device states" ON device_states;
CREATE POLICY "Allow members to read device states" ON device_states
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM smart_devices d JOIN place_members pm ON pm.place_id = d.place_id
    WHERE d.id = device_states.device_id AND pm.user_id = auth.uid()
  ));

ALTER TABLE device_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow members to read device commands" ON device_commands;
CREATE POLICY "Allow members to read device commands" ON device_commands
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM smart_devices d JOIN place_members pm ON pm.place_id = d.place_id
    WHERE d.id = device_commands.device_id AND pm.user_id = auth.uid()
  ));

ALTER TABLE device_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow members to read device schedules" ON device_schedules;
CREATE POLICY "Allow members to read device schedules" ON device_schedules
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM smart_devices d JOIN place_members pm ON pm.place_id = d.place_id
    WHERE d.id = device_schedules.device_id AND pm.user_id = auth.uid()
  ));

ALTER TABLE device_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow members to read device groups" ON device_groups;
CREATE POLICY "Allow members to read device groups" ON device_groups
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM place_members pm WHERE pm.place_id = device_groups.place_id AND pm.user_id = auth.uid()
  ));

ALTER TABLE device_group_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow members to read device group members" ON device_group_members;
CREATE POLICY "Allow members to read device group members" ON device_group_members
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM device_groups g JOIN place_members pm ON pm.place_id = g.place_id
    WHERE g.id = device_group_members.group_id AND pm.user_id = auth.uid()
  ));


