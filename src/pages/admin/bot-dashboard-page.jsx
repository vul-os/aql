import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Battery, 
  Thermometer, 
  Droplets, 
  Activity, 
  MapPin, 
  Power,
  Gauge,
  Navigation,
  AlertTriangle,
  CheckCircle2,
  Clock
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

/**
 * Bot Dashboard Page
 * Displays real-time sensor data, location, events, and statistics for a bot
 */
export default function BotDashboardPage() {
  const { botId } = useParams();
  
  const [botInfo, setBotInfo] = useState(null);
  const [latestSensor, setLatestSensor] = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);
  const [locationHistory, setLocationHistory] = useState([]);
  const [todayStats, setTodayStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBotData();
    
    // Set up real-time subscription
    const subscription = supabase
      .channel('bot-updates')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'bot_sensor_readings',
        filter: `bot_id=eq.${botId}`
      }, (payload) => {
        setLatestSensor(payload.new);
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [botId]);

  const fetchBotData = async () => {
    setLoading(true);
    
    try {
      // Fetch bot info to get location_id
      const { data: bot, error: botError } = await supabase
        .from('bots')
        .select('*, location_id')
        .eq('id', botId)
        .single();
      
      if (botError) throw botError;
      
      setBotInfo(bot);

      if (!bot.location_id) {
        console.warn('Bot has no location assigned');
        setLoading(false);
        return;
      }

      // Use RPC function to get bot data
      const { data: botData, error: rpcError } = await supabase
        .rpc('get_location_bot_data', { location_id_input: bot.location_id });
      
      if (rpcError) throw rpcError;

      if (botData && botData.length > 0) {
        const data = botData[0];
        
        // Parse JSONB fields from RPC response
        setLatestSensor(data.latest_sensor_reading);
        setRecentEvents(data.recent_events || []);
        setLocationHistory(data.location_trail || []);
        setTodayStats(data.today_stats);
      }

    } catch (error) {
      console.error('Error fetching bot data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      online: 'bg-green-500',
      offline: 'bg-gray-500',
      active: 'bg-blue-500',
      idle: 'bg-yellow-500',
      charging: 'bg-purple-500',
      error: 'bg-red-500',
      maintenance: 'bg-orange-500'
    };
    return colors[status] || 'bg-gray-500';
  };

  const getSeverityColor = (severity) => {
    const colors = {
      info: 'bg-blue-100 text-blue-800',
      warning: 'bg-yellow-100 text-yellow-800',
      error: 'bg-red-100 text-red-800',
      critical: 'bg-red-200 text-red-900'
    };
    return colors[severity] || 'bg-gray-100 text-gray-800';
  };

  const getBatteryColor = (level) => {
    if (level > 60) return 'text-green-600';
    if (level > 30) return 'text-yellow-600';
    return 'text-red-600';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Activity className="w-8 h-8 animate-spin mx-auto mb-2" />
          <p>Loading bot data...</p>
        </div>
      </div>
    );
  }

  if (!botInfo) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-2" />
          <p>Bot not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{botInfo.name}</h1>
          <p className="text-muted-foreground">Serial: {botInfo.serial_number}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={getStatusColor(botInfo.status)}>
            {botInfo.status}
          </Badge>
          {latestSensor?.is_on && (
            <Badge variant="outline" className="bg-green-50">
              <Power className="w-3 h-3 mr-1" />
              On
            </Badge>
          )}
        </div>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Battery */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Battery className={`w-4 h-4 ${getBatteryColor(latestSensor?.battery_percentage || 0)}`} />
              Battery
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {latestSensor?.battery_percentage || 0}%
            </div>
            <p className="text-xs text-muted-foreground">
              {latestSensor?.battery_voltage || 0}V
              {latestSensor?.is_charging && ' • Charging'}
            </p>
          </CardContent>
        </Card>

        {/* Temperature */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Thermometer className="w-4 h-4" />
              Temperature
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {latestSensor?.temperature_celsius?.toFixed(1) || '--'}°C
            </div>
            <p className="text-xs text-muted-foreground">
              Humidity: {latestSensor?.humidity_percentage?.toFixed(0) || '--'}%
            </p>
          </CardContent>
        </Card>

        {/* RPM */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Gauge className="w-4 h-4" />
              Motor RPM
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {latestSensor?.rpm || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {latestSensor?.bot_specific_data?.blade_rpm 
                ? `Blade: ${latestSensor.bot_specific_data.blade_rpm}`
                : 'Idle'}
            </p>
          </CardContent>
        </Card>

        {/* Location */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Location
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-mono">
              {latestSensor?.latitude?.toFixed(4) || '--'},
              {latestSensor?.longitude?.toFixed(4) || '--'}
            </div>
            <p className="text-xs text-muted-foreground">
              Heading: {latestSensor?.direction_degrees?.toFixed(0) || '--'}°
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sensor Details */}
        <Card>
          <CardHeader>
            <CardTitle>Sensor Readings</CardTitle>
            <CardDescription>
              Last updated: {latestSensor?.recorded_at 
                ? formatDistanceToNow(new Date(latestSensor.recorded_at), { addSuffix: true })
                : 'Never'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 3D Orientation */}
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <Navigation className="w-4 h-4" />
                3D Orientation
              </h4>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Pitch:</span>
                  <p className="font-mono">{latestSensor?.pitch?.toFixed(2) || '--'}°</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Roll:</span>
                  <p className="font-mono">{latestSensor?.roll?.toFixed(2) || '--'}°</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Yaw:</span>
                  <p className="font-mono">{latestSensor?.yaw?.toFixed(2) || '--'}°</p>
                </div>
              </div>
            </div>

            {/* 3D Acceleration */}
            <div>
              <h4 className="font-semibold mb-2">3D Acceleration (m/s²)</h4>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">X:</span>
                  <p className="font-mono">{latestSensor?.acceleration_x?.toFixed(2) || '--'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Y:</span>
                  <p className="font-mono">{latestSensor?.acceleration_y?.toFixed(2) || '--'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Z:</span>
                  <p className="font-mono">{latestSensor?.acceleration_z?.toFixed(2) || '--'}</p>
                </div>
              </div>
            </div>

            {/* Movement */}
            <div>
              <h4 className="font-semibold mb-2">Movement</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Speed:</span>
                  <p className="font-mono">{latestSensor?.speed_cm_per_sec?.toFixed(1) || '--'} cm/s</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Distance:</span>
                  <p className="font-mono">{latestSensor?.distance_traveled_cm?.toFixed(1) || '--'} cm</p>
                </div>
              </div>
            </div>

            {/* Environment */}
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <Droplets className="w-4 h-4" />
                Environment
              </h4>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rain:</span>
                  <Badge variant={latestSensor?.is_raining ? "destructive" : "outline"}>
                    {latestSensor?.is_raining ? 'Yes' : 'No'}
                  </Badge>
                </div>
                {latestSensor?.is_raining && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Intensity:</span>
                    <span>{latestSensor?.rain_intensity || 0}</span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Today's Statistics */}
        <Card>
          <CardHeader>
            <CardTitle>Today's Statistics</CardTitle>
            <CardDescription>{format(new Date(), 'MMMM d, yyyy')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {todayStats ? (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Runtime
                  </span>
                  <span className="font-semibold">
                    {Math.floor(todayStats.total_runtime_minutes / 60)}h {todayStats.total_runtime_minutes % 60}m
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Distance Traveled</span>
                  <span className="font-semibold">{todayStats.total_distance_meters?.toFixed(0) || 0}m</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Area Covered</span>
                  <span className="font-semibold">{todayStats.area_covered_sqm?.toFixed(0) || 0}m²</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Avg Battery</span>
                  <span className="font-semibold">{todayStats.average_battery_level?.toFixed(0) || 0}%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Events</span>
                  <div className="flex gap-2">
                    <Badge variant="outline">{todayStats.total_events || 0} total</Badge>
                    {todayStats.error_count > 0 && (
                      <Badge variant="destructive">{todayStats.error_count} errors</Badge>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No statistics available for today</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Events */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Events</CardTitle>
          <CardDescription>Last 20 events</CardDescription>
        </CardHeader>
        <CardContent>
          {recentEvents.length > 0 ? (
            <div className="space-y-3">
              {recentEvents.map((event) => (
                <div key={event.id} className="flex items-start gap-3 p-3 border rounded-lg">
                  <div className="flex-shrink-0 mt-0.5">
                    {event.severity === 'error' || event.severity === 'critical' ? (
                      <AlertTriangle className="w-5 h-5 text-red-500" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-sm">{event.title}</h4>
                      <Badge className={getSeverityColor(event.severity)} variant="outline">
                        {event.severity}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{event.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(event.event_timestamp), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No events recorded</p>
          )}
        </CardContent>
      </Card>

      {/* Location Map would go here */}
      <Card>
        <CardHeader>
          <CardTitle>Location History</CardTitle>
          <CardDescription>
            {locationHistory.length} GPS points recorded
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-100 rounded-lg h-64 flex items-center justify-center">
            <p className="text-muted-foreground">
              Map component goes here (use Leaflet or Google Maps)
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

