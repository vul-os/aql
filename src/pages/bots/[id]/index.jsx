import React, { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Bot, 
  Play, 
  Pause, 
  Square, 
  Settings,
  Activity,
  Clock,
  MapPin,
  Battery,
  Wifi,
  WifiOff,
  ArrowLeft,
  Calendar,
  BarChart3,
  AlertTriangle
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/auth-context'

const BotDetailPage = () => {
  const { id } = useParams()
  const { user } = useAuth()
  const [bot, setBot] = useState(null)
  const [sensors, setSensors] = useState([])
  const [commands, setCommands] = useState([])
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) {
      fetchBotData()
    }
  }, [id])

  const fetchBotData = async () => {
    try {
      // Fetch bot details
      const { data: botData, error: botError } = await supabase
        .from('bots')
        .select('*')
        .eq('id', id)
        .single()

      if (botError) {
        console.error('Error fetching bot:', botError)
        return
      }

      setBot(botData)

      // Fetch sensors
      const { data: sensorsData } = await supabase
        .from('bot_sensors')
        .select('*')
        .eq('bot_id', id)
        .order('recorded_at', { ascending: false })
        .limit(10)

      setSensors(sensorsData || [])

      // Fetch recent commands
      const { data: commandsData } = await supabase
        .from('bot_commands')
        .select('*')
        .eq('bot_id', id)
        .order('sent_at', { ascending: false })
        .limit(10)

      setCommands(commandsData || [])

      // Fetch schedules
      const { data: schedulesData } = await supabase
        .from('bot_schedules')
        .select('*')
        .eq('bot_id', id)

      setSchedules(schedulesData || [])

    } catch (error) {
      console.error('Error fetching bot data:', error)
    } finally {
      setLoading(false)
    }
  }

  const sendBotCommand = async (command) => {
    try {
      const { error } = await supabase
        .from('bot_commands')
        .insert({
          bot_id: id,
          command_type: command,
          command_data: { timestamp: new Date().toISOString() },
          created_by: user.id
        })

      if (error) {
        console.error('Error sending command:', error)
      } else {
        console.log(`Command ${command} sent to bot`)
        // Update bot status optimistically
        setBot(prev => ({
          ...prev,
          status: command === 'start' ? 'online' : command === 'stop' ? 'offline' : prev.status
        }))
        // Refresh commands
        fetchBotData()
      }
    } catch (error) {
      console.error('Error sending command:', error)
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

  const getBotIcon = (type) => {
    switch (type) {
      case 'mowbot': return <Bot className="h-8 w-8 text-green-600" />
      case 'poolbot': return <Bot className="h-8 w-8 text-blue-600" />
      case 'weather_station': return <Activity className="h-8 w-8 text-primary" />
      default: return <Bot className="h-8 w-8" />
    }
  }

  const getBotTypeName = (type) => {
    switch (type) {
      case 'mowbot': return 'MowBot'
      case 'poolbot': return 'PoolBot'
      case 'weather_station': return 'Weather Station'
      default: return type
    }
  }

  const getCommandStatusColor = (status) => {
    switch (status) {
      case 'acknowledged': return 'text-green-600'
      case 'sent': return 'text-blue-600'
      case 'pending': return 'text-yellow-600'
      case 'failed': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-green-600"></div>
      </div>
    )
  }

  if (!bot) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="h-16 w-16 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Bot not found</h3>
            <p className="text-gray-600 mb-4">The bot you're looking for doesn't exist or you don't have access to it.</p>
            <Link to="/bots">
              <Button>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Bots
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center space-x-4">
          <Link to="/bots">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div className="flex items-center space-x-3">
            {getBotIcon(bot.type)}
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{bot.name}</h1>
              <p className="text-gray-600">{getBotTypeName(bot.type)} • {bot.model || 'Unknown Model'}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${getStatusColor(bot.status)}`} />
          <Badge variant={bot.status === 'online' ? 'default' : 'secondary'}>
            {bot.status}
          </Badge>
        </div>
      </div>

      {/* Control Panel */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Control Panel</CardTitle>
          <CardDescription>Send commands to your bot</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex space-x-4">
            <Button
              size="lg"
              onClick={() => sendBotCommand('start')}
              disabled={bot.status === 'online'}
              className="flex items-center space-x-2"
            >
              <Play className="h-5 w-5" />
              <span>Start</span>
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => sendBotCommand('pause')}
              disabled={bot.status !== 'online'}
              className="flex items-center space-x-2"
            >
              <Pause className="h-5 w-5" />
              <span>Pause</span>
            </Button>
            <Button
              size="lg"
              variant="destructive"
              onClick={() => sendBotCommand('stop')}
              disabled={bot.status === 'offline'}
              className="flex items-center space-x-2"
            >
              <Square className="h-5 w-5" />
              <span>Stop</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="sensors">Sensors</TabsTrigger>
          <TabsTrigger value="commands">Commands</TabsTrigger>
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Bot Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Name:</span>
                  <span className="font-medium">{bot.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Type:</span>
                  <span className="font-medium">{getBotTypeName(bot.type)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Model:</span>
                  <span className="font-medium">{bot.model || 'Unknown'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Serial Number:</span>
                  <span className="font-mono text-sm">{bot.serial_number || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Status:</span>
                  <Badge variant={bot.status === 'online' ? 'default' : 'secondary'}>
                    {bot.status}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Last Seen:</span>
                  <span className="font-medium">
                    {bot.last_seen ? new Date(bot.last_seen).toLocaleString() : 'Never'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Created:</span>
                  <span className="font-medium">
                    {new Date(bot.created_at).toLocaleDateString()}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Activity className="h-5 w-5 text-green-600" />
                    <span className="text-sm font-medium">Active Schedules</span>
                  </div>
                  <span className="text-2xl font-bold">{schedules.filter(s => s.is_active).length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <BarChart3 className="h-5 w-5 text-blue-600" />
                    <span className="text-sm font-medium">Sensor Readings</span>
                  </div>
                  <span className="text-2xl font-bold">{sensors.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Clock className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium">Commands Sent</span>
                  </div>
                  <span className="text-2xl font-bold">{commands.length}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Sensors Tab */}
        <TabsContent value="sensors" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Sensor Data</CardTitle>
              <CardDescription>Recent sensor readings from your bot</CardDescription>
            </CardHeader>
            <CardContent>
              {sensors.length === 0 ? (
                <div className="text-center py-8">
                  <Activity className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">No sensor data available</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {sensors.map((sensor) => (
                    <div key={sensor.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center space-x-3">
                        <Activity className="h-5 w-5 text-blue-600" />
                        <div>
                          <p className="font-medium">{sensor.sensor_name}</p>
                          <p className="text-sm text-gray-600">{sensor.sensor_type}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold">{sensor.value} {sensor.unit}</p>
                        <p className="text-sm text-gray-600">
                          {new Date(sensor.recorded_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Commands Tab */}
        <TabsContent value="commands" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Command History</CardTitle>
              <CardDescription>Recent commands sent to your bot</CardDescription>
            </CardHeader>
            <CardContent>
              {commands.length === 0 ? (
                <div className="text-center py-8">
                  <Clock className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">No commands sent yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {commands.map((command) => (
                    <div key={command.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center space-x-3">
                        <Clock className="h-5 w-5 text-blue-600" />
                        <div>
                          <p className="font-medium capitalize">{command.command_type}</p>
                          <p className="text-sm text-gray-600">
                            {new Date(command.sent_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge 
                          variant={command.status === 'acknowledged' ? 'default' : 'secondary'}
                          className={getCommandStatusColor(command.status)}
                        >
                          {command.status}
                        </Badge>
                        {command.acknowledged_at && (
                          <p className="text-sm text-gray-600 mt-1">
                            {new Date(command.acknowledged_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Schedules Tab */}
        <TabsContent value="schedules" className="space-y-6">
          <div className="flex items-center justify-between">
            <CardTitle>Schedules</CardTitle>
            <Link to={`/bots/${id}/schedule`}>
              <Button>
                <Calendar className="h-4 w-4 mr-2" />
                Manage Schedules
              </Button>
            </Link>
          </div>
          <Card>
            <CardContent className="pt-6">
              {schedules.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600 mb-4">No schedules configured</p>
                  <Link to={`/bots/${id}/schedule`}>
                    <Button>
                      <Calendar className="h-4 w-4 mr-2" />
                      Create Schedule
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {schedules.map((schedule) => (
                    <div key={schedule.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center space-x-3">
                        <Calendar className="h-5 w-5 text-blue-600" />
                        <div>
                          <p className="font-medium">{schedule.name}</p>
                          <p className="text-sm text-gray-600">{schedule.schedule_type}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge variant={schedule.is_active ? 'default' : 'secondary'}>
                          {schedule.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default BotDetailPage
