import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Bot, 
  Home, 
  Lightbulb, 
  Thermometer, 
  Tv, 
  Camera, 
  Plug, 
  Plus,
  Activity,
  Clock,
  Settings
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/auth-context'

const Dashboard = () => {
  const { user, profile } = useAuth()
  const [bots, setBots] = useState([])
  const [smartDevices, setSmartDevices] = useState([])
  const [deviceTypes, setDeviceTypes] = useState([])
  const [scenes, setScenes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) {
      fetchDashboardData()
    }
  }, [user])

  const fetchDashboardData = async () => {
    try {
      // Get user's places
      const { data: places } = await supabase
        .from('place_members')
        .select('place_id, places(*)')
        .eq('user_id', user.id)

      if (places && places.length > 0) {
        const placeIds = places.map(p => p.place_id)

        // Fetch bots
        const { data: botsData } = await supabase
          .from('bots')
          .select('*')
          .in('place_id', placeIds)

        // Fetch smart devices
        const { data: devicesData } = await supabase
          .from('smart_devices')
          .select(`
            *,
            device_types(*)
          `)
          .in('place_id', placeIds)

        // Fetch device types
        const { data: typesData } = await supabase
          .from('device_types')
          .select('*')

        // Fetch scenes
        const { data: scenesData } = await supabase
          .from('scenes')
          .select('*')
          .in('place_id', placeIds)

        setBots(botsData || [])
        setSmartDevices(devicesData || [])
        setDeviceTypes(typesData || [])
        setScenes(scenesData || [])
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'online': return 'bg-green-500'
      case 'offline': return 'bg-gray-500'
      case 'maintenance': return 'bg-yellow-500'
      case 'error': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  const getDeviceIcon = (category) => {
    switch (category) {
      case 'lighting': return <Lightbulb className="h-5 w-5" />
      case 'climate': return <Thermometer className="h-5 w-5" />
      case 'entertainment': return <Tv className="h-5 w-5" />
      case 'security': return <Camera className="h-5 w-5" />
      case 'power': return <Plug className="h-5 w-5" />
      default: return <Home className="h-5 w-5" />
    }
  }

  const getBotIcon = (type) => {
    switch (type) {
      case 'mowbot': return <Bot className="h-5 w-5 text-green-600" />
      case 'poolbot': return <Bot className="h-5 w-5 text-blue-600" />
      case 'weather_station': return <Activity className="h-5 w-5 text-purple-600" />
      default: return <Bot className="h-5 w-5" />
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-green-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
              <p className="text-gray-600">Welcome back, {profile?.full_name || user?.email}</p>
            </div>
            <div className="flex items-center space-x-4">
              <Link to="/bots">
                <Button variant="outline">
                  <Bot className="h-4 w-4 mr-2" />
                  Manage Bots
                </Button>
              </Link>
              <Link to="/devices">
                <Button variant="outline">
                  <Home className="h-4 w-4 mr-2" />
                  Smart Devices
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="bots">Bots</TabsTrigger>
            <TabsTrigger value="devices">Smart Devices</TabsTrigger>
            <TabsTrigger value="scenes">Scenes</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Bots</CardTitle>
                  <Bot className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{bots.length}</div>
                  <p className="text-xs text-muted-foreground">
                    {bots.filter(b => b.status === 'online').length} online
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Smart Devices</CardTitle>
                  <Home className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{smartDevices.length}</div>
                  <p className="text-xs text-muted-foreground">
                    {smartDevices.filter(d => d.status === 'online').length} online
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Scenes</CardTitle>
                  <Settings className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{scenes.length}</div>
                  <p className="text-xs text-muted-foreground">
                    {scenes.filter(s => s.is_active).length} active
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Device Types</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{deviceTypes.length}</div>
                  <p className="text-xs text-muted-foreground">
                    Available types
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest bot and device activity</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {bots.slice(0, 3).map((bot) => (
                    <div key={bot.id} className="flex items-center space-x-4">
                      {getBotIcon(bot.type)}
                      <div className="flex-1">
                        <p className="font-medium">{bot.name}</p>
                        <p className="text-sm text-gray-600">{bot.type}</p>
                      </div>
                      <Badge variant={bot.status === 'online' ? 'default' : 'secondary'}>
                        {bot.status}
                      </Badge>
                    </div>
                  ))}
                  {smartDevices.slice(0, 3).map((device) => (
                    <div key={device.id} className="flex items-center space-x-4">
                      {getDeviceIcon(device.device_types?.category)}
                      <div className="flex-1">
                        <p className="font-medium">{device.name}</p>
                        <p className="text-sm text-gray-600">{device.device_types?.name}</p>
                      </div>
                      <Badge variant={device.status === 'online' ? 'default' : 'secondary'}>
                        {device.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Bots Tab */}
          <TabsContent value="bots" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Your Bots</h2>
              <Link to="/bots/add">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Bot
                </Button>
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {bots.map((bot) => (
                <Card key={bot.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        {getBotIcon(bot.type)}
                        <CardTitle className="text-lg">{bot.name}</CardTitle>
                      </div>
                      <div className={`w-3 h-3 rounded-full ${getStatusColor(bot.status)}`} />
                    </div>
                    <CardDescription>{bot.model || bot.type}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Status:</span>
                        <Badge variant={bot.status === 'online' ? 'default' : 'secondary'}>
                          {bot.status}
                        </Badge>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Last Seen:</span>
                        <span>{bot.last_seen ? new Date(bot.last_seen).toLocaleDateString() : 'Never'}</span>
                      </div>
                    </div>
                    <div className="mt-4 flex space-x-2">
                      <Link to={`/bots/${bot.id}`} className="flex-1">
                        <Button variant="outline" size="sm" className="w-full">
                          Manage
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Smart Devices Tab */}
          <TabsContent value="devices" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Smart Devices</h2>
              <Link to="/devices/add">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Device
                </Button>
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {smartDevices.map((device) => (
                <Card key={device.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        {getDeviceIcon(device.device_types?.category)}
                        <CardTitle className="text-lg">{device.name}</CardTitle>
                      </div>
                      <div className={`w-3 h-3 rounded-full ${getStatusColor(device.status)}`} />
                    </div>
                    <CardDescription>
                      {device.device_types?.name} • {device.room || 'Unknown Room'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Status:</span>
                        <Badge variant={device.status === 'online' ? 'default' : 'secondary'}>
                          {device.status}
                        </Badge>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Brand:</span>
                        <span>{device.brand || 'Unknown'}</span>
                      </div>
                    </div>
                    <div className="mt-4 flex space-x-2">
                      <Link to={`/devices/${device.id}`} className="flex-1">
                        <Button variant="outline" size="sm" className="w-full">
                          Control
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Scenes Tab */}
          <TabsContent value="scenes" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Scenes</h2>
              <Link to="/scenes/add">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Scene
                </Button>
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {scenes.map((scene) => (
                <Card key={scene.id}>
                  <CardHeader>
                    <CardTitle className="text-lg">{scene.name}</CardTitle>
                    <CardDescription>{scene.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Status:</span>
                        <Badge variant={scene.is_active ? 'default' : 'secondary'}>
                          {scene.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-4 flex space-x-2">
                      <Button variant="outline" size="sm" className="flex-1">
                        Activate
                      </Button>
                      <Link to={`/scenes/${scene.id}`}>
                        <Button variant="outline" size="sm">
                          Edit
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

export default Dashboard
