# Botserv Platform - Project Plan

## Overview
Botserv is a platform to manage bots and services, starting with mowing bots (mowbot), weather stations, and poolbots. The platform will handle bot management, scheduling, sensor data, and user/place management.

## Phase 1: Database Setup (Supabase)

### 1.1 Core Tables
- **profiles** - User profiles extending Supabase auth
- **places** - Locations/properties where bots operate
- **place_members** - Many-to-many relationship between users and places with roles
- **coverage_areas** - Geographic areas where service is available
- **bots** - Bot instances (mowbot, poolbot, etc.)
- **bot_schedules** - Scheduling for bots that need it
- **bot_sensors** - Sensor data from bots
- **bot_commands** - Commands sent to bots

### 1.2 Database Schema Design
```sql
-- Profiles table (extends auth.users)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  phone TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Places table
CREATE TABLE places (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  country TEXT DEFAULT 'South Africa',
  postal_code TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Place members with roles
CREATE TABLE place_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  place_id UUID REFERENCES places(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- 'owner', 'admin', 'member'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(place_id, user_id)
);

-- Coverage areas
CREATE TABLE coverage_areas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  country TEXT DEFAULT 'South Africa',
  postal_code TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  radius_km DECIMAL(5, 2) DEFAULT 5.0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bots table
CREATE TABLE bots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  place_id UUID REFERENCES places(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'mowbot', 'poolbot', 'weather_station'
  model TEXT,
  serial_number TEXT UNIQUE,
  status TEXT DEFAULT 'offline', -- 'online', 'offline', 'maintenance', 'error'
  last_seen TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bot schedules
CREATE TABLE bot_schedules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_id UUID REFERENCES bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  schedule_type TEXT NOT NULL, -- 'daily', 'weekly', 'monthly', 'custom'
  schedule_data JSONB NOT NULL, -- Flexible schedule configuration
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bot sensors
CREATE TABLE bot_sensors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_id UUID REFERENCES bots(id) ON DELETE CASCADE,
  sensor_type TEXT NOT NULL, -- 'temperature', 'humidity', 'soil_moisture', 'weather'
  sensor_name TEXT NOT NULL,
  value DECIMAL(10, 4),
  unit TEXT,
  metadata JSONB,
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bot commands
CREATE TABLE bot_commands (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_id UUID REFERENCES bots(id) ON DELETE CASCADE,
  command_type TEXT NOT NULL, -- 'start', 'stop', 'pause', 'resume', 'schedule'
  command_data JSONB,
  status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'acknowledged', 'failed'
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES profiles(id)
);
```

### 1.3 Database Functions
- **create_user_profile()** - Trigger function to create profile when user signs up
- **create_default_place()** - Function to create a default place and add user as owner
- **check_coverage()** - Function to check if a location is covered

## Phase 2: Frontend Setup

### 2.1 Project Structure
```
src/
├── components/
│   ├── ui/ (already exists - shadcn components)
│   ├── auth/
│   ├── layout/
│   ├── forms/
│   └── bots/
├── pages/
│   ├── auth/ (signin, signup, forgot-password, etc.)
│   ├── dashboard/
│   ├── bots/
│   ├── places/
│   ├── coverage/
│   └── landing/
├── hooks/
├── context/
├── services/
└── lib/
```

### 2.2 Key Pages
- **Landing Page** - Public page with coverage search
- **Auth Pages** - Sign in, sign up, password reset
- **Dashboard** - Main user dashboard
- **Bots Page** - Bot management and monitoring
- **Places Page** - Place management
- **Coverage Search** - Public coverage checker

### 2.3 Components Needed
- Bot status cards
- Schedule management
- Sensor data displays
- Coverage map component
- Place management forms

## Phase 3: Core Features

### 3.1 Authentication & User Management
- Supabase Auth integration
- User profile management
- Place membership management
- Role-based access control

### 3.2 Bot Management
- Bot registration and setup
- Real-time status monitoring
- Command sending interface
- Schedule management
- Sensor data visualization

### 3.3 Coverage System
- Geographic coverage checking
- Public coverage search page
- Email integration for uncovered areas
- Coverage area management

### 3.4 Place Management
- Multi-place support
- Member management
- Role assignment
- Place-specific bot management

## Phase 4: Advanced Features

### 4.1 Scheduling System
- Flexible scheduling (daily, weekly, monthly)
- Weather-based scheduling
- Maintenance scheduling
- Schedule templates

### 4.2 Sensor Integration
- Real-time sensor data
- Historical data visualization
- Alerts and notifications
- Weather station integration

### 4.3 Command System
- Bot command interface
- Command history
- Status tracking
- Error handling

## Phase 5: Polish & Deployment

### 5.1 UI/UX Improvements
- Responsive design
- Dark mode support
- Loading states
- Error handling
- Toast notifications

### 5.2 Performance Optimization
- Code splitting
- Lazy loading
- Caching strategies
- Database optimization

### 5.3 Deployment
- Supabase production setup
- Environment configuration
- CI/CD pipeline
- Monitoring and analytics

## Technology Stack

### Frontend
- **React 19** with Vite
- **React Router** for navigation
- **Shadcn/ui** for components
- **Tailwind CSS** for styling
- **Framer Motion** for animations
- **React Hook Form** + **Zod** for forms
- **Supabase JS** for database/auth

### Backend
- **Supabase** (PostgreSQL + Auth + Real-time)
- **PostgreSQL** with custom functions
- **Row Level Security** (Phase 2)

### Development Tools
- **ESLint** for code quality
- **Prettier** for formatting
- **Git** for version control

## Implementation Order

1. **Database Setup** - Create all tables and functions
2. **Auth System** - Implement authentication pages
3. **Landing Page** - Create public landing with coverage search
4. **Dashboard** - Basic user dashboard
5. **Place Management** - Places and members
6. **Bot Management** - Bot CRUD operations
7. **Scheduling** - Bot scheduling system
8. **Sensor Data** - Real-time sensor monitoring
9. **Polish** - UI improvements and error handling
10. **Deployment** - Production setup

## Success Metrics

- User registration and authentication working
- Bot registration and management functional
- Coverage search working for public users
- Scheduling system operational
- Real-time sensor data display
- Responsive design across devices
- Error handling and loading states
- Production deployment successful

## Updated Database Schema (Smart Home Integration)

### Additional Tables Added
- **device_types** - Categories of smart home devices (lights, plugs, AC, TV, etc.)
- **smart_devices** - Individual smart home devices
- **device_states** - Current state of devices
- **device_commands** - Commands sent to devices
- **device_schedules** - Automation schedules for devices
- **device_groups** - Group devices together (rooms, zones, scenes)
- **device_group_members** - Many-to-many relationship for device groups
- **scenes** - Predefined device configurations

### Smart Home Device Categories
- **Lighting**: Smart bulbs, strips, switches, dimmers
- **Power**: Smart plugs, outlets, power strips
- **Climate**: Air conditioners, heaters, fans, thermostats
- **Entertainment**: Smart TVs, soundbars, projectors, streaming devices
- **Security**: Cameras, doorbells, door locks, sensors
- **Appliances**: Washing machines, dryers, dishwashers, refrigerators, ovens, coffee makers
- **Garden**: Sprinklers, gates, pool heaters
- **Window**: Blinds, curtains, window openers
- **Air Quality**: Air purifiers, humidifiers, dehumidifiers, CO2 monitors
- **Other**: Smart speakers, displays, chargers, vacuums

### Key Features Added
1. **Unified Device Management** - Control both bots and smart home devices from one platform
2. **Device Grouping** - Organize devices by room, zone, or custom groups
3. **Scene Management** - Create and activate predefined device configurations
4. **Automation Scheduling** - Set up automated schedules for any device type
5. **Real-time Control** - Send commands and monitor device states in real-time
6. **Energy Monitoring** - Track power consumption for smart plugs and outlets
7. **Voice Integration Ready** - Architecture supports voice assistant integration

### Implementation Status
✅ Database schema created with comprehensive device types
✅ Sample data seeded for testing
✅ Frontend structure updated to support smart devices
✅ Dashboard shows both bots and smart devices
✅ Authentication system working
✅ Landing page with coverage search functional
🔄 Device control interfaces (in progress)
🔄 Scene management (planned)
🔄 Automation scheduling (planned)
🔄 Real-time device monitoring (planned)

### Next Steps
1. Complete device control interfaces
2. Implement scene creation and activation
3. Add automation scheduling system
4. Integrate real-time device monitoring
5. Add voice assistant integration
6. Implement energy monitoring dashboards
7. Add device discovery and setup wizards
