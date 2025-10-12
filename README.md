# Bot Korp Platform

A comprehensive platform for managing autonomous bots and smart property automation. Bot Korp provides centralized control for mowing bots, pool cleaners, security bots, weather stations, and complete property management automation.

## Features

### 🤖 Bot Management
- **MowBots**: Automated lawn mowing robots with smart scheduling
- **PoolBots**: Pool cleaning robots with maintenance scheduling
- **Weather Stations**: Environmental sensors for weather and soil data
- Real-time status monitoring and command control
- Automated scheduling based on weather and conditions

### 🏠 Smart Home Integration
- **Lighting**: Smart bulbs, strips, switches, dimmers
- **Power**: Smart plugs, outlets, power strips with energy monitoring
- **Climate**: Air conditioners, heaters, fans, thermostats
- **Entertainment**: Smart TVs, soundbars, projectors, streaming devices
- **Security**: Cameras, doorbells, door locks, motion sensors
- **Appliances**: Washing machines, dryers, dishwashers, refrigerators, ovens
- **Garden**: Sprinklers, gates, pool heaters
- **Window**: Blinds, curtains, window openers
- **Air Quality**: Air purifiers, humidifiers, dehumidifiers, CO2 monitors

### 🎯 Key Capabilities
- **Unified Dashboard**: Control all devices from one interface
- **Scene Management**: Create and activate predefined device configurations
- **Automation Scheduling**: Set up automated schedules for any device
- **Device Grouping**: Organize devices by room, zone, or custom groups
- **Real-time Control**: Send commands and monitor device states
- **Coverage Search**: Check service availability by location
- **Multi-place Support**: Manage multiple properties and locations

## Technology Stack

### Frontend
- **React 19** with Vite for fast development
- **React Router** for navigation
- **Shadcn/ui** for beautiful, accessible components
- **Tailwind CSS** for styling
- **Framer Motion** for smooth animations
- **React Hook Form** + **Zod** for form validation
- **Supabase JS** for real-time database and authentication

### Backend
- **Supabase** (PostgreSQL + Auth + Real-time + Storage)
- **PostgreSQL** with custom functions and triggers
- **Row Level Security** for data protection

### Development Tools
- **ESLint** for code quality
- **Prettier** for code formatting
- **Git** for version control

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Supabase account

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd botkorp-mono
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Supabase**
   - Create a new Supabase project
   - Update the Supabase URL and API key in `src/lib/supabase.js`
   - Run the database migrations in the `supabase/migrations/` folder

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Open your browser**
   Navigate to `http://localhost:5173`

## Database Setup

The project includes comprehensive database migrations:

1. **Core Tables**: profiles, places, place_members, coverage_areas
2. **Bot Tables**: bots, bot_schedules, bot_sensors, bot_commands
3. **Smart Device Tables**: device_types, smart_devices, device_states, device_commands, device_schedules, device_groups, scenes

### Key Database Functions
- `create_user_profile()` - Automatically creates user profile and default place
- `create_default_place()` - Creates a default place for new users
- `check_coverage()` - Checks if a location is covered by service

## Project Structure

```
src/
├── components/
│   ├── ui/                 # Shadcn/ui components
│   ├── auth/               # Authentication components
│   └── layout/             # Layout components
├── pages/
│   ├── auth/               # Authentication pages
│   ├── dashboard/          # Main dashboard
│   ├── bots/               # Bot management
│   ├── devices/            # Smart device management
│   ├── places/             # Place management
│   ├── scenes/             # Scene management
│   └── landing/            # Public landing page
├── context/                # React context providers
├── hooks/                   # Custom React hooks
├── lib/                    # Utility functions and configurations
└── services/               # API services
```

## Features in Development

### Phase 1: Core Platform ✅
- [x] Database schema with bots and smart devices
- [x] User authentication and profiles
- [x] Landing page with coverage search
- [x] Dashboard with device overview
- [x] Basic navigation and layout

### Phase 2: Device Management 🔄
- [ ] Bot registration and setup
- [ ] Smart device discovery and pairing
- [ ] Real-time device control interfaces
- [ ] Device status monitoring
- [ ] Command history and logging

### Phase 3: Automation & Scenes 🔄
- [ ] Scene creation and management
- [ ] Automation scheduling system
- [ ] Weather-based automation
- [ ] Device grouping and zones
- [ ] Voice assistant integration

### Phase 4: Advanced Features 📋
- [ ] Energy monitoring dashboards
- [ ] Device analytics and insights
- [ ] Mobile app development
- [ ] API for third-party integrations
- [ ] Advanced security features

## API Integration

The platform is designed to integrate with various smart home protocols:
- **WiFi**: Direct HTTP/MQTT communication
- **Zigbee**: Via Zigbee hubs
- **Z-Wave**: Via Z-Wave controllers
- **Thread**: Via Thread border routers
- **Matter**: Universal smart home standard

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support and questions:
- Email: support@botkorp.com
- Create an issue in the repository

## Roadmap

- **Q1 2024**: Core platform and basic device management
- **Q2 2024**: Advanced automation and scene management
- **Q3 2024**: Mobile app and voice integration
- **Q4 2024**: Analytics, insights, and third-party integrations

---

Built with ❤️ for the smart home community
