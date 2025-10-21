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
  Loader2,
  BarChart3,
  History
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

/**
 * Location Bot Status Page
 * Shows bot status for a specific location (garden/pool)
 * Users see this in context of their garden/pool, not raw bot data
 */
export default function LocationBotStatusPage() {
  const { locationId } = useParams();
  
  const [botData, setBotData] = useState(null);
  const [sensorHistory, setSensorHistory] = useState([]);
  const [statistics, setStatistics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchBotData();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchBotData, 30000);
    return () => clearInterval(interval);
  }, [locationId]);

  const fetchBotData = async () => {
    try {
      setError(null);
      
      // Get bot data for this location
      const { data, error: rpcError } = await supabase
        .rpc('get_location_bot_data', { location_id_input: locationId });
      
      if (rpcError) throw rpcError;
      
      if (!data || data.length === 0) {
        setError('No bot found for this location');
        setLoading(false);
        return;
      }
      
      setBotData(data[0]);
      
      // Get sensor history
      const { data: history } = await supabase
        .rpc('get_bot_sensor_history', { 
          location_id_input: locationId,
          hours_back: 24 
        });
      
      if (history) setSensorHistory(history);
      
      // Get statistics
      const { data: stats } = await supabase
        .rpc('get_location_bot_statistics', {
          location_id_input: locationId,
          days_back: 7
        });
      
      if (stats) setStatistics(stats);
      
      setLoading(false);
    } catch (err) {
      console.error('Error fetching bot data:', err);
      setError(err.message);
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
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
          <p>Loading status...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-2" />
            <p className="text-lg font-semibold mb-2">{error}</p>
            <p className="text-muted-foreground">
              This location may not have an active bot assigned yet.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!botData) return null;

  const latestSensor = botData.latest_sensor_reading;
  const recentEvents = botData.recent_events || [];
  const todayStats = botData.today_stats;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{botData.bot_type === 'mow_bot' ? '🌱 Garden' : '🏊 Pool'} Status</h1>
          <p className="text-muted-foreground">{botData.bot_name}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={getStatusColor(botData.bot_status)}>
            {botData.bot_status}
          </Badge>
          {latestSensor?.is_on && (
            <Badge variant="outline" className="bg-green-50">
              <Power className="w-3 h-3 mr-1" />
              Active
            </Badge>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="current" className="w-full">
        <TabsList>
          <TabsTrigger value="current">
            <Activity className="w-4 h-4 mr-2" />
            Current Status
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="w-4 h-4 mr-2" />
            Activity History
          </TabsTrigger>
          <TabsTrigger value="stats">
            <BarChart3 className="w-4 h-4 mr-2" />
            Statistics
          </TabsTrigger>
        </TabsList>

        {/* Current Status Tab */}
        <TabsContent value="current" className="space-y-4">
          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                  {latestSensor?.is_charging ? 'Charging' : 'Not charging'}
                </p>
              </CardContent>
            </Card>

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
                  {latestSensor?.humidity_percentage?.toFixed(0) || '--'}% humidity
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Gauge className="w-4 h-4" />
                  Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {latestSensor?.is_on ? 'Working' : 'Idle'}
                </div>
                <p className="text-xs text-muted-foreground">
                  {latestSensor?.rpm || 0} RPM
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Droplets className="w-4 h-4" />
                  Weather
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {latestSensor?.is_raining ? '🌧️' : '☀️'}
                </div>
                <p className="text-xs text-muted-foreground">
                  {latestSensor?.is_raining ? 'Rain detected' : 'Clear'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Today's Summary */}
          {todayStats && (
            <Card>
              <CardHeader>
                <CardTitle>Today's Summary</CardTitle>
                <CardDescription>{format(new Date(), 'MMMM d, yyyy')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Runtime</p>
                    <p className="text-2xl font-bold">
                      {Math.floor(todayStats.total_runtime_minutes / 60)}h {todayStats.total_runtime_minutes % 60}m
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Distance</p>
                    <p className="text-2xl font-bold">{todayStats.total_distance_meters?.toFixed(0)}m</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Area Covered</p>
                    <p className="text-2xl font-bold">{todayStats.area_covered_sqm?.toFixed(0)}m²</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Avg Battery</p>
                    <p className="text-2xl font-bold">{todayStats.average_battery_level?.toFixed(0)}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Activity History Tab */}
        <TabsContent value="history" className="space-y-4">
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
                <p className="text-sm text-muted-foreground">No recent events</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Statistics Tab */}
        <TabsContent value="stats" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Weekly Statistics</CardTitle>
              <CardDescription>Last 7 days</CardDescription>
            </CardHeader>
            <CardContent>
              {statistics.length > 0 ? (
                <div className="space-y-4">
                  {statistics.map((stat) => (
                    <div key={stat.date} className="border-b pb-3 last:border-0">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold">{format(new Date(stat.date), 'EEEE, MMM d')}</h4>
                        {stat.error_count > 0 && (
                          <Badge variant="destructive">{stat.error_count} errors</Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div>
                          <span className="text-muted-foreground">Runtime:</span>
                          <p className="font-semibold">
                            {Math.floor(stat.total_runtime_minutes / 60)}h {stat.total_runtime_minutes % 60}m
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Distance:</span>
                          <p className="font-semibold">{stat.total_distance_meters?.toFixed(0)}m</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Avg Battery:</span>
                          <p className="font-semibold">{stat.average_battery_level?.toFixed(0)}%</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Avg Temp:</span>
                          <p className="font-semibold">{stat.average_temperature?.toFixed(1)}°C</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No statistics available</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

