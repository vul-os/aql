-- Smart home device types
CREATE TABLE device_types (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE, -- 'light', 'plug', 'aircon', 'tv', 'camera', 'door_lock', etc.
  category TEXT NOT NULL, -- 'lighting', 'power', 'climate', 'entertainment', 'security', 'appliance'
  description TEXT,
  icon TEXT, -- Icon name for UI
  capabilities JSONB, -- Array of capabilities like ['on_off', 'brightness', 'color', 'temperature']
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Smart home devices
CREATE TABLE smart_devices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  place_id UUID REFERENCES places(id) ON DELETE CASCADE,
  device_type_id UUID REFERENCES device_types(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  room TEXT, -- 'living_room', 'bedroom', 'kitchen', 'outdoor', etc.
  brand TEXT,
  model TEXT,
  serial_number TEXT UNIQUE,
  mac_address TEXT,
  ip_address INET,
  status TEXT DEFAULT 'offline', -- 'online', 'offline', 'maintenance', 'error'
  last_seen TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB, -- Device-specific configuration and settings
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Device states (current state of devices)
CREATE TABLE device_states (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id UUID REFERENCES smart_devices(id) ON DELETE CASCADE,
  state_data JSONB NOT NULL, -- Current state like {"power": true, "brightness": 80, "color": "#ffffff"}
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Device commands (commands sent to devices)
CREATE TABLE device_commands (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id UUID REFERENCES smart_devices(id) ON DELETE CASCADE,
  command_type TEXT NOT NULL, -- 'turn_on', 'turn_off', 'set_brightness', 'set_color', 'set_temperature', etc.
  command_data JSONB, -- Command parameters
  status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'acknowledged', 'failed'
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES profiles(id),
  response_data JSONB -- Device response
);

-- Device schedules (automation schedules for smart devices)
CREATE TABLE device_schedules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id UUID REFERENCES smart_devices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  schedule_type TEXT NOT NULL, -- 'daily', 'weekly', 'monthly', 'sunrise', 'sunset', 'custom'
  schedule_data JSONB NOT NULL, -- Schedule configuration
  action_data JSONB NOT NULL, -- What action to perform
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Device groups (group devices together for coordinated control)
CREATE TABLE device_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  place_id UUID REFERENCES places(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  group_type TEXT, -- 'room', 'zone', 'scene', 'custom'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Device group memberships
CREATE TABLE device_group_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID REFERENCES device_groups(id) ON DELETE CASCADE,
  device_id UUID REFERENCES smart_devices(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(group_id, device_id)
);

-- Scenes (predefined device configurations)
CREATE TABLE scenes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  place_id UUID REFERENCES places(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  scene_data JSONB NOT NULL, -- Device states for this scene
  icon TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_smart_devices_place_id ON smart_devices(place_id);
CREATE INDEX idx_smart_devices_device_type_id ON smart_devices(device_type_id);
CREATE INDEX idx_smart_devices_room ON smart_devices(room);
CREATE INDEX idx_device_states_device_id ON device_states(device_id);
CREATE INDEX idx_device_states_recorded_at ON device_states(recorded_at);
CREATE INDEX idx_device_commands_device_id ON device_commands(device_id);
CREATE INDEX idx_device_commands_status ON device_commands(status);
CREATE INDEX idx_device_schedules_device_id ON device_schedules(device_id);
CREATE INDEX idx_device_groups_place_id ON device_groups(place_id);
CREATE INDEX idx_device_group_members_group_id ON device_group_members(group_id);
CREATE INDEX idx_device_group_members_device_id ON device_group_members(device_id);
CREATE INDEX idx_scenes_place_id ON scenes(place_id);

-- Add updated_at triggers
CREATE TRIGGER update_smart_devices_updated_at BEFORE UPDATE ON smart_devices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_device_schedules_updated_at BEFORE UPDATE ON device_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_device_groups_updated_at BEFORE UPDATE ON device_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_scenes_updated_at BEFORE UPDATE ON scenes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
