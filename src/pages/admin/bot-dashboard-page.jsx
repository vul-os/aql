import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Clock,
  TrendingUp,
  Map as MapIcon
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import BotMap from '@/components/bots/bot-map';
import BotBatteryChart from '@/components/bots/bot-battery-chart';
import BotTemperatureChart from '@/components/bots/bot-temperature-chart';
import LoadingLottie from '@/components/ui/loading-lottie';
import PageHeader from '@/components/ui/page-header';

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
        console.log('📡 Real-time sensor reading:', payload.new);
        setLatestSensor(payload.new);
        
        // Update bot info battery level
        if (payload.new.battery_percentage !== undefined) {
          setBotInfo(prev => ({
            ...prev,
            battery_level: payload.new.battery_percentage
          }));
        }
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'bot_events',
        filter: `bot_id=eq.${botId}`
      }, (payload) => {
        console.log('📡 Real-time event:', payload.new);
        setRecentEvents(prev => [payload.new, ...prev].slice(0, 20));
      })
      .subscribe();

    // Refresh dashboard data every 30 seconds
    const interval = setInterval(() => {
      fetchBotData();
    }, 30000);

    return () => {
      subscription.unsubscribe();
      clearInterval(interval);
    };
  }, [botId]);

  const fetchBotData = async () => {
    setLoading(true);
    
    try {
      // Fetch bot info
      const { data: bot, error: botError } = await supabase
        .from('bots')
        .select('*')
        .eq('id', botId)
        .single();
      
      if (botError) throw botError;
      setBotInfo(bot);

      // Fetch latest sensor reading
      const { data: sensorData, error: sensorError } = await supabase
        .from('bot_sensor_readings')
        .select('*')
        .eq('bot_id', botId)
        .order('recorded_at', { ascending: false })
        .limit(1);
      
      if (sensorError) throw sensorError;
      if (sensorData && sensorData.length > 0) {
        setLatestSensor(sensorData[0]);
      }

      // Fetch recent events (last 20)
      const { data: eventsData, error: eventsError } = await supabase
        .from('bot_events')
        .select('*')
        .eq('bot_id', botId)
        .order('event_timestamp', { ascending: false })
        .limit(20);
      
      if (eventsError) throw eventsError;
      setRecentEvents(eventsData || []);

      // Fetch location history (last 100 points)
      const { data: locationData, error: locationError } = await supabase
        .from('bot_location_history')
        .select('*')
        .eq('bot_id', botId)
        .order('recorded_at', { ascending: false })
        .limit(100);
      
      if (locationError) throw locationError;
      setLocationHistory(locationData || []);

      // Fetch today's statistics
      const today = new Date().toISOString().split('T')[0];
      const { data: statsData, error: statsError } = await supabase
        .from('bot_daily_statistics')
        .select('*')
        .eq('bot_id', botId)
        .eq('date', today)
        .single();
      
      if (statsError && statsError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
        console.error('Error fetching stats:', statsError);
      } else if (statsData) {
        setTodayStats(statsData);
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
      <div className="flex items-center justify-center h-full min-h-screen">
        <LoadingLottie
          src="https://lottie.host/51fee83a-3e79-41b0-8a20-77f890b9b6f1/iUangPxwIF.lottie"
          message="Loading bot data..."
          size="md"
        />
      </div>
    );
  }

  if (!botInfo) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-red-500/10 dark:bg-red-500/20 mb-4">
            <AlertTriangle className="h-10 w-10 text-red-500" />
          </div>
          <h3 className="text-lg font-bold mb-1">Bot not found</h3>
          <p className="text-sm text-muted-foreground">The requested bot could not be found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 md:p-5 space-y-5 max-w-[1800px] mx-auto">
      {/* Header */}
      <div className="space-y-3 animate-in fade-in slide-in-from-top-3 duration-500">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Bot className="h-5 w-5 text-botkorp-orange" />
              {botInfo.name}
            </h1>
            <p className="text-muted-foreground text-xs mt-1">Serial: {botInfo.serial_number}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={`${getStatusColor(botInfo.status)} text-white border-0 text-xs`}>
              {botInfo.status}
            </Badge>
            {latestSensor?.is_on && (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                <Power className="w-3 h-3 mr-1" />
                On
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Battery */}
        <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 shadow-sm">
          <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
          <CardHeader className="relative pb-2">
            <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <div className="h-6 w-6 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center">
                <Battery className={`h-3 w-3 ${getBatteryColor(latestSensor?.battery_percentage || 0)}`} />
              </div>
              Battery
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-bold tabular-nums">
              {latestSensor?.battery_percentage || 0}%
            </div>
            <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
              {latestSensor?.battery_voltage || 0}V
              {latestSensor?.is_charging && ' • Charging'}
            </p>
          </CardContent>
        </Card>

        {/* Temperature */}
        <Card className="relative overflow-hidden border-l-4 border-l-blue-500 hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-75 shadow-sm">
          <div className="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/5 transition-all duration-300" />
          <CardHeader className="relative pb-2">
            <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <div className="h-6 w-6 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
                <Thermometer className="h-3 w-3 text-blue-600" />
              </div>
              Temperature
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-bold tabular-nums">
              {latestSensor?.temperature_celsius?.toFixed(1) || '--'}°C
            </div>
            <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
              Humidity: {latestSensor?.humidity_percentage?.toFixed(0) || '--'}%
            </p>
          </CardContent>
        </Card>

        {/* RPM */}
        <Card className="relative overflow-hidden border-l-4 border-l-purple-500 hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-150 shadow-sm">
          <div className="absolute inset-0 bg-purple-500/0 group-hover:bg-purple-500/5 transition-all duration-300" />
          <CardHeader className="relative pb-2">
            <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <div className="h-6 w-6 rounded-lg bg-purple-500/10 dark:bg-purple-500/20 flex items-center justify-center">
                <Gauge className="h-3 w-3 text-purple-600" />
              </div>
              Motor RPM
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-bold tabular-nums">
              {latestSensor?.rpm || 0}
            </div>
            <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
              {latestSensor?.bot_specific_data?.blade_rpm 
                ? `Blade: ${latestSensor.bot_specific_data.blade_rpm}`
                : 'Idle'}
            </p>
          </CardContent>
        </Card>

        {/* Location */}
        <Card className="relative overflow-hidden border-l-4 border-l-emerald-500 hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200 shadow-sm">
          <div className="absolute inset-0 bg-emerald-500/0 group-hover:bg-emerald-500/5 transition-all duration-300" />
          <CardHeader className="relative pb-2">
            <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <div className="h-6 w-6 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/20 flex items-center justify-center">
                <MapPin className="h-3 w-3 text-emerald-600" />
              </div>
              Location
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-xs font-mono tabular-nums">
              {latestSensor?.latitude?.toFixed(4) || '--'},
              {latestSensor?.longitude?.toFixed(4) || '--'}
            </div>
            <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
              Heading: {latestSensor?.direction_degrees?.toFixed(0) || '--'}°
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Sensor Details */}
        <Card className="border-0 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="h-0.5 w-6 bg-botkorp-orange rounded-full" />
              <CardTitle className="text-sm">Sensor Readings</CardTitle>
            </div>
            <CardDescription className="text-xs">
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
        <Card className="border-0 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-500 delay-350">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="h-0.5 w-6 bg-botkorp-orange rounded-full" />
              <CardTitle className="text-sm">Today's Statistics</CardTitle>
            </div>
            <CardDescription className="text-xs">{format(new Date(), 'MMMM d, yyyy')}</CardDescription>
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

      {/* Analytics Tabs */}
      <Tabs defaultValue="charts" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="charts" className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Charts
          </TabsTrigger>
          <TabsTrigger value="map" className="flex items-center gap-2">
            <MapIcon className="w-4 h-4" />
            Location Map
          </TabsTrigger>
        </TabsList>

        <TabsContent value="charts" className="space-y-6">
          {/* Battery Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Battery Level (Last 24 Hours)</CardTitle>
              <CardDescription>Battery percentage over time</CardDescription>
            </CardHeader>
            <CardContent>
              <BotBatteryChart botId={botId} />
            </CardContent>
          </Card>

          {/* Temperature & Humidity Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Temperature & Humidity (Last 24 Hours)</CardTitle>
              <CardDescription>Environmental conditions over time</CardDescription>
            </CardHeader>
            <CardContent>
              <BotTemperatureChart botId={botId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="map">
          {/* Location Map */}
          <Card>
            <CardHeader>
              <CardTitle>Location History & Trail</CardTitle>
              <CardDescription>
                {locationHistory.length} GPS points recorded | Last update: {latestSensor?.recorded_at 
                  ? formatDistanceToNow(new Date(latestSensor.recorded_at), { addSuffix: true })
                  : 'Never'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BotMap 
                botId={botId}
                currentLocation={latestSensor ? {
                  lat: latestSensor.latitude,
                  lng: latestSensor.longitude,
                  heading: latestSensor.direction_degrees
                } : null}
                locationHistory={locationHistory}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

