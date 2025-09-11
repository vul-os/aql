import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://zjaeljuzyuuaxprcfvrz.supabase.co'
const supabaseKey = 'sb_secret_REDACTED'

const supabase = createClient(supabaseUrl, supabaseKey)

async function seedData() {
  console.log('🌱 Starting data seeding...')

  try {
    // Create a test user (this will trigger the profile creation)
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: 'test@botserv.com',
      password: 'testpassword123',
      options: {
        data: {
          full_name: 'Test User'
        }
      }
    })

    if (authError) {
      console.log('User might already exist:', authError.message)
    } else {
      console.log('✅ Test user created')
    }

    // Wait a moment for the profile to be created
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Get the user profile
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', 'test@botserv.com')
      .single()

    if (!profiles) {
      console.log('❌ No profile found for test user')
      return
    }

    console.log('✅ Found test user profile')

    // Get user's places
    const { data: placeMembers } = await supabase
      .from('place_members')
      .select('place_id, places(*)')
      .eq('user_id', profiles.id)

    if (!placeMembers || placeMembers.length === 0) {
      console.log('❌ No places found for test user')
      return
    }

    const placeId = placeMembers[0].place_id
    console.log('✅ Using place:', placeMembers[0].places.name)

    // Add sample bots
    const bots = [
      {
        place_id: placeId,
        name: 'MowBot Alpha',
        type: 'mowbot',
        model: 'MowBot Pro 2024',
        serial_number: 'MB001',
        status: 'online',
        last_seen: new Date().toISOString()
      },
      {
        place_id: placeId,
        name: 'PoolBot Beta',
        type: 'poolbot',
        model: 'PoolBot Clean 2024',
        serial_number: 'PB001',
        status: 'offline',
        last_seen: new Date(Date.now() - 3600000).toISOString()
      },
      {
        place_id: placeId,
        name: 'Weather Station Gamma',
        type: 'weather_station',
        model: 'WeatherPro 2024',
        serial_number: 'WS001',
        status: 'online',
        last_seen: new Date().toISOString()
      }
    ]

    for (const bot of bots) {
      const { error } = await supabase
        .from('bots')
        .upsert(bot, { onConflict: 'serial_number' })
      
      if (error) {
        console.log('Error adding bot:', error.message)
      } else {
        console.log(`✅ Added bot: ${bot.name}`)
      }
    }

    // Add sample smart devices
    const deviceTypes = await supabase.from('device_types').select('*')
    
    if (deviceTypes.data) {
      const bulbType = deviceTypes.data.find(dt => dt.name === 'smart_bulb')
      const plugType = deviceTypes.data.find(dt => dt.name === 'smart_plug')
      const airconType = deviceTypes.data.find(dt => dt.name === 'smart_aircon')

      const devices = [
        {
          place_id: placeId,
          device_type_id: bulbType?.id,
          name: 'Living Room Light',
          room: 'living_room',
          brand: 'Philips',
          model: 'Hue White and Color',
          serial_number: 'PH001',
          status: 'online',
          last_seen: new Date().toISOString()
        },
        {
          place_id: placeId,
          device_type_id: plugType?.id,
          name: 'Coffee Maker Plug',
          room: 'kitchen',
          brand: 'TP-Link',
          model: 'HS100',
          serial_number: 'TP001',
          status: 'online',
          last_seen: new Date().toISOString()
        },
        {
          place_id: placeId,
          device_type_id: airconType?.id,
          name: 'Living Room AC',
          room: 'living_room',
          brand: 'Daikin',
          model: 'FTXM35R',
          serial_number: 'DK001',
          status: 'online',
          last_seen: new Date().toISOString()
        }
      ]

      for (const device of devices) {
        if (device.device_type_id) {
          const { error } = await supabase
            .from('smart_devices')
            .upsert(device, { onConflict: 'serial_number' })
          
          if (error) {
            console.log('Error adding device:', error.message)
          } else {
            console.log(`✅ Added device: ${device.name}`)
          }
        }
      }
    }

    // Add sample scenes
    const scenes = [
      {
        place_id: placeId,
        name: 'Movie Night',
        description: 'Perfect lighting for watching movies',
        scene_data: {
          devices: {
            'Living Room Light': { brightness: 20, color: '#ff6600' },
            'TV Backlight': { brightness: 30, color: '#0066ff' }
          }
        },
        icon: 'film',
        is_active: true
      },
      {
        place_id: placeId,
        name: 'Good Morning',
        description: 'Bright and energizing morning scene',
        scene_data: {
          devices: {
            'Living Room Light': { brightness: 100, color: '#ffffff', color_temperature: 5000 },
            'Coffee Maker Plug': { power: true }
          }
        },
        icon: 'sunrise',
        is_active: true
      }
    ]

    for (const scene of scenes) {
      const { error } = await supabase
        .from('scenes')
        .upsert(scene, { onConflict: 'name' })
      
      if (error) {
        console.log('Error adding scene:', error.message)
      } else {
        console.log(`✅ Added scene: ${scene.name}`)
      }
    }

    console.log('🎉 Data seeding completed!')
    console.log('📧 Test login: test@botserv.com / testpassword123')

  } catch (error) {
    console.error('❌ Error seeding data:', error)
  }
}

seedData()
