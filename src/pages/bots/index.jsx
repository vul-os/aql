import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
  Bot, 
  Plus, 
  Play, 
  Pause, 
  Square, 
  Settings,
  Activity,
  Clock,
  MapPin,
  Battery,
  Wifi,
  WifiOff
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/auth-context'

const BotsPage = () => {
  const { user } = useAuth()
  const [bots, setBots] = useState([])
  const [places, setPlaces] = useState([])
  const [selectedPlace, setSelectedPlace] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) {
      fetchData()
    }
  }, [user])

  const fetchData = async () => {
    try {
      // Get user's places
      const { data: placeMembers } = await supabase
        .from('place_members')
        .select('place_id, places(*)')
        .eq('user_id', user.id)

      if (placeMembers && placeMembers.length > 0) {
        setPlaces(placeMembers.map(p => p.places))
        setSelectedPlace(placeMembers[0].place_id)
        
        // Fetch bots for the first place
        const { data: botsData } = await supabase
          .from('bots')
          .select('*')
          .eq('place_id', placeMembers[0].place_id)

        setBots(botsData || [])
      }
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handlePlaceChange = async (placeId) => {
    setSelectedPlace(placeId)
    setLoading(true)
    
    try {
      const { data: botsData } = await supabase
        .from('bots')
        .select('*')
        .eq('place_id', placeId)

      setBots(botsData || [])
    } catch (error) {
      console.error('Error fetching bots:', error)
    } finally {
      setLoading(false)
    }
  }

  const sendBotCommand = async (botId, command) => {
    try {
      const { error } = await supabase
        .from('bot_commands')
        .insert({
          bot_id: botId,
          command_type: command,
          command_data: { timestamp: new Date().toISOString() },
          created_by: user.id
        })

      if (error) {
        console.error('Error sending command:', error)
      } else {
        console.log(`Command ${command} sent to bot ${botId}`)
        // Update bot status optimistically
        setBots(prev => prev.map(bot => 
          bot.id === botId 
            ? { ...bot, status: command === 'start' ? 'online' : 'offline' }
            : bot
        ))
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
      case 'mowbot': return <Bot className="h-6 w-6 text-green-600" />
      case 'poolbot': return <Bot className="h-6 w-6 text-blue-600" />
      case 'weather_station': return <Activity className="h-6 w-6 text-purple-600" />
      default: return <Bot className="h-6 w-6" />
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-green-600"></div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Bot Management</h1>
          <p className="text-gray-600">Control and monitor your automated devices</p>
        </div>
        <div className="flex items-center space-x-4">
          {places.length > 0 && (
            <Select value={selectedPlace} onValueChange={handlePlaceChange}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {places.map((place) => (
                  <SelectItem key={place.id} value={place.id}>
                    <div className="flex items-center space-x-2">
                      <MapPin className="h-4 w-4" />
                      <span>{place.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Link to="/bots/add">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Bot
            </Button>
          </Link>
        </div>
      </div>

      {/* Bot Grid */}
      {bots.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <Bot className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No bots found</h3>
            <p className="text-gray-600 mb-4">
              Get started by adding your first bot to this location
            </p>
            <Link to="/bots/add">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Bot
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {bots.map((bot) => (
            <Card key={bot.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {getBotIcon(bot.type)}
                    <div>
                      <CardTitle className="text-lg">{bot.name}</CardTitle>
                      <CardDescription>{getBotTypeName(bot.type)}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className={`w-3 h-3 rounded-full ${getStatusColor(bot.status)}`} />
                    <Badge variant={bot.status === 'online' ? 'default' : 'secondary'}>
                      {bot.status}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Bot Info */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Model:</span>
                    <span>{bot.model || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Serial:</span>
                    <span className="font-mono text-xs">{bot.serial_number || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Last Seen:</span>
                    <span>{bot.last_seen ? new Date(bot.last_seen).toLocaleDateString() : 'Never'}</span>
                  </div>
                </div>

                {/* Control Buttons */}
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => sendBotCommand(bot.id, 'start')}
                    disabled={bot.status === 'online'}
                    className="flex items-center space-x-1"
                  >
                    <Play className="h-3 w-3" />
                    <span>Start</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => sendBotCommand(bot.id, 'pause')}
                    disabled={bot.status !== 'online'}
                    className="flex items-center space-x-1"
                  >
                    <Pause className="h-3 w-3" />
                    <span>Pause</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => sendBotCommand(bot.id, 'stop')}
                    disabled={bot.status === 'offline'}
                    className="flex items-center space-x-1"
                  >
                    <Square className="h-3 w-3" />
                    <span>Stop</span>
                  </Button>
                </div>

                {/* Action Buttons */}
                <div className="flex space-x-2">
                  <Link to={`/bots/${bot.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full">
                      <Settings className="h-4 w-4 mr-2" />
                      Manage
                    </Button>
                  </Link>
                  <Link to={`/bots/${bot.id}/schedule`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full">
                      <Clock className="h-4 w-4 mr-2" />
                      Schedule
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Quick Stats */}
      {bots.length > 0 && (
        <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center space-x-2">
                <Bot className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Bots</p>
                  <p className="text-2xl font-bold">{bots.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center space-x-2">
                <Wifi className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-sm font-medium text-gray-600">Online</p>
                  <p className="text-2xl font-bold">{bots.filter(b => b.status === 'online').length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center space-x-2">
                <WifiOff className="h-5 w-5 text-gray-600" />
                <div>
                  <p className="text-sm font-medium text-gray-600">Offline</p>
                  <p className="text-2xl font-bold">{bots.filter(b => b.status === 'offline').length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center space-x-2">
                <Activity className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="text-sm font-medium text-gray-600">Active</p>
                  <p className="text-2xl font-bold">{bots.filter(b => b.status === 'online').length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export default BotsPage
