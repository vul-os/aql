import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import LoadingLottie from '@/components/ui/loading-lottie';
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
  BarChart3,
  History,
  ArrowLeft,
  Zap,
  TrendingUp,
  Calendar,
  Sun,
  CloudRain
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

/**
 * Location Bot Status Page
 * Shows bot status for a specific location (garden/pool)
 * Users see this in context of their garden/pool, not raw bot data
 */
export default function LocationBotStatusPage() {
  const { locationId } = useParams();
  const navigate = useNavigate();
  
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
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-green-50 flex items-center justify-center">
        <LoadingLottie
          src="https://lottie.host/51fee83a-3e79-41b0-8a20-77f890b9b6f1/iUangPxwIF.lottie"
          message="Loading bot status..."
          size="md"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-green-50">
        <div className="container mx-auto p-6">
          <div className="flex items-center justify-center min-h-[600px]">
            <Card className="max-w-md w-full border-0 shadow-xl">
              <CardContent className="pt-6">
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-yellow-100 mb-4">
                    <AlertTriangle className="w-10 h-10 text-yellow-600" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">No Bot Found</h3>
                  <p className="text-base text-gray-700 mb-2">{error}</p>
                  <p className="text-sm text-gray-500 mb-6">
                    This location may not have an active bot assigned yet.
                  </p>
                  <Button 
                    onClick={() => navigate('/portal')}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Dashboard
                  </Button>
                </div>
              </CardContent>
            </Card>
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-green-50">
      <div className="container mx-auto p-6 space-y-6">
        {/* Breadcrumb/Back Button */}
        <div className="flex items-center gap-3">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate('/portal')}
            className="h-9 px-3 hover:bg-white/80 transition-all"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>

        {/* Enhanced Header with Gradient */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-green-600 via-green-500 to-emerald-400 p-8 shadow-xl">
          <div className="absolute inset-0 bg-grid-white/10 [mask-image:linear-gradient(0deg,transparent,black)]"></div>
          <div className="relative flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-5xl">{botData.bot_type === 'mow_bot' ? '🌱' : '🏊'}</span>
                <div>
                  <h1 className="text-3xl font-bold text-white">
                    {botData.bot_type === 'mow_bot' ? 'Garden' : 'Pool'} Status
                  </h1>
                  <p className="text-green-50 text-lg">{botData.bot_name}</p>
                </div>
              </div>
              {latestSensor?.reading_timestamp && (
                <p className="text-green-100 text-sm">
                  Last updated {formatDistanceToNow(new Date(latestSensor.reading_timestamp), { addSuffix: true })}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge className={`${getStatusColor(botData.bot_status)} text-white px-4 py-2 text-base shadow-lg`}>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                  {botData.bot_status.toUpperCase()}
                </div>
              </Badge>
              {latestSensor?.is_on && (
                <Badge className="bg-white text-green-700 px-4 py-2 shadow-lg border-0">
                  <Zap className="w-4 h-4 mr-1" />
                  Active
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Enhanced Tabs */}
        <Tabs defaultValue="current" className="w-full">
          <TabsList className="bg-white shadow-md p-1 h-auto">
            <TabsTrigger value="current" className="data-[state=active]:bg-green-500 data-[state=active]:text-white px-6 py-3">
              <Activity className="w-4 h-4 mr-2" />
              Current Status
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-green-500 data-[state=active]:text-white px-6 py-3">
              <History className="w-4 h-4 mr-2" />
              Activity History
            </TabsTrigger>
            <TabsTrigger value="stats" className="data-[state=active]:bg-green-500 data-[state=active]:text-white px-6 py-3">
              <BarChart3 className="w-4 h-4 mr-2" />
              Statistics
            </TabsTrigger>
          </TabsList>

          {/* Current Status Tab */}
          <TabsContent value="current" className="space-y-6 mt-6">
            {/* Enhanced Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Battery Card */}
              <Card className="relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                <div className="absolute inset-0 bg-gradient-to-br from-green-400 to-emerald-600 opacity-10"></div>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-700">
                    <div className={`p-2 rounded-lg ${latestSensor?.battery_percentage > 60 ? 'bg-green-100' : latestSensor?.battery_percentage > 30 ? 'bg-yellow-100' : 'bg-red-100'}`}>
                      <Battery className={`w-5 h-5 ${getBatteryColor(latestSensor?.battery_percentage || 0)}`} />
                    </div>
                    Battery
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
                    {latestSensor?.battery_percentage || 0}%
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    {latestSensor?.is_charging && <Zap className="w-3 h-3 text-yellow-500" />}
                    <p className="text-xs text-gray-600">
                      {latestSensor?.is_charging ? 'Charging' : 'Not charging'}
                    </p>
                  </div>
                  <div className="mt-3 bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-500 ${latestSensor?.battery_percentage > 60 ? 'bg-green-500' : latestSensor?.battery_percentage > 30 ? 'bg-yellow-500' : 'bg-red-500'}`}
                      style={{ width: `${latestSensor?.battery_percentage || 0}%` }}
                    ></div>
                  </div>
                </CardContent>
              </Card>

              {/* Temperature Card */}
              <Card className="relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                <div className="absolute inset-0 bg-gradient-to-br from-orange-400 to-red-500 opacity-10"></div>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-700">
                    <div className="p-2 rounded-lg bg-orange-100">
                      <Thermometer className="w-5 h-5 text-orange-600" />
                    </div>
                    Temperature
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent">
                    {latestSensor?.temperature_celsius?.toFixed(1) || '--'}°C
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Droplets className="w-3 h-3 text-blue-500" />
                    <p className="text-xs text-gray-600">
                      {latestSensor?.humidity_percentage?.toFixed(0) || '--'}% humidity
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Activity Card */}
              <Card className="relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-400 to-indigo-600 opacity-10"></div>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-700">
                    <div className={`p-2 rounded-lg ${latestSensor?.is_on ? 'bg-blue-100' : 'bg-gray-100'}`}>
                      <Gauge className={`w-5 h-5 ${latestSensor?.is_on ? 'text-blue-600' : 'text-gray-600'}`} />
                    </div>
                    Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                    {latestSensor?.is_on ? 'Working' : 'Idle'}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <TrendingUp className="w-3 h-3 text-blue-500" />
                    <p className="text-xs text-gray-600">
                      {latestSensor?.rpm || 0} RPM
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Weather Card */}
              <Card className="relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                <div className="absolute inset-0 bg-gradient-to-br from-sky-400 to-blue-600 opacity-10"></div>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-700">
                    <div className={`p-2 rounded-lg ${latestSensor?.is_raining ? 'bg-blue-100' : 'bg-yellow-100'}`}>
                      {latestSensor?.is_raining ? (
                        <CloudRain className="w-5 h-5 text-blue-600" />
                      ) : (
                        <Sun className="w-5 h-5 text-yellow-600" />
                      )}
                    </div>
                    Weather
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold">
                    {latestSensor?.is_raining ? '🌧️' : '☀️'}
                  </div>
                  <p className="text-xs text-gray-600 mt-2">
                    {latestSensor?.is_raining ? 'Rain detected' : 'Clear conditions'}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Enhanced Today's Summary */}
            {todayStats && (
              <Card className="border-0 shadow-lg overflow-hidden">
                <div className="bg-gradient-to-r from-green-500 to-emerald-500 p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-white text-2xl mb-1">Today's Summary</CardTitle>
                      <CardDescription className="text-green-50 flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        {format(new Date(), 'EEEE, MMMM d, yyyy')}
                      </CardDescription>
                    </div>
                    <div className="text-5xl">📊</div>
                  </div>
                </div>
                <CardContent className="p-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div className="text-center">
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 mb-3">
                        <Clock className="w-6 h-6 text-blue-600" />
                      </div>
                      <p className="text-sm text-gray-600 mb-1">Runtime</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {Math.floor(todayStats.total_runtime_minutes / 60)}h {todayStats.total_runtime_minutes % 60}m
                      </p>
                    </div>
                    <div className="text-center">
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-purple-100 mb-3">
                        <Navigation className="w-6 h-6 text-purple-600" />
                      </div>
                      <p className="text-sm text-gray-600 mb-1">Distance</p>
                      <p className="text-2xl font-bold text-gray-900">{todayStats.total_distance_meters?.toFixed(0)}m</p>
                    </div>
                    <div className="text-center">
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mb-3">
                        <MapPin className="w-6 h-6 text-green-600" />
                      </div>
                      <p className="text-sm text-gray-600 mb-1">Area Covered</p>
                      <p className="text-2xl font-bold text-gray-900">{todayStats.area_covered_sqm?.toFixed(0)}m²</p>
                    </div>
                    <div className="text-center">
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-yellow-100 mb-3">
                        <Battery className="w-6 h-6 text-yellow-600" />
                      </div>
                      <p className="text-sm text-gray-600 mb-1">Avg Battery</p>
                      <p className="text-2xl font-bold text-gray-900">{todayStats.average_battery_level?.toFixed(0)}%</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Enhanced Activity History Tab */}
          <TabsContent value="history" className="space-y-6 mt-6">
            <Card className="border-0 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-slate-50 to-blue-50">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl">Recent Events</CardTitle>
                    <CardDescription className="flex items-center gap-2 mt-1">
                      <History className="w-4 h-4" />
                      Last 20 events
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {recentEvents.length > 0 ? (
                  <div className="space-y-4">
                    {recentEvents.map((event, index) => (
                      <div 
                        key={event.id} 
                        className="flex items-start gap-4 p-4 rounded-xl bg-white border border-gray-100 hover:shadow-md transition-all duration-200 hover:border-green-200"
                        style={{ animationDelay: `${index * 50}ms` }}
                      >
                        <div className="flex-shrink-0 mt-1">
                          <div className={`p-3 rounded-full ${
                            event.severity === 'error' || event.severity === 'critical' 
                              ? 'bg-red-100' 
                              : event.severity === 'warning'
                              ? 'bg-yellow-100'
                              : 'bg-green-100'
                          }`}>
                            {event.severity === 'error' || event.severity === 'critical' ? (
                              <AlertTriangle className="w-5 h-5 text-red-600" />
                            ) : event.severity === 'warning' ? (
                              <AlertTriangle className="w-5 h-5 text-yellow-600" />
                            ) : (
                              <CheckCircle2 className="w-5 h-5 text-green-600" />
                            )}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-semibold text-base text-gray-900">{event.title}</h4>
                            <Badge className={`${getSeverityColor(event.severity)} border-0`}>
                              {event.severity}
                            </Badge>
                          </div>
                        <p className="text-sm text-gray-600 mb-2">{event.description}</p>
                        {event.event_timestamp && (
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <Clock className="w-3 h-3" />
                            {formatDistanceToNow(new Date(event.event_timestamp), { addSuffix: true })}
                          </div>
                        )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                      <History className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-gray-600">No recent events</p>
                    <p className="text-sm text-gray-500 mt-1">Events will appear here when activity is detected</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Enhanced Statistics Tab */}
          <TabsContent value="stats" className="space-y-6 mt-6">
            <Card className="border-0 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-purple-50 to-pink-50">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl">Weekly Statistics</CardTitle>
                    <CardDescription className="flex items-center gap-2 mt-1">
                      <BarChart3 className="w-4 h-4" />
                      Last 7 days performance
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {statistics.length > 0 ? (
                  <div className="space-y-4">
                    {statistics.map((stat, index) => (
                      <div 
                        key={stat.date} 
                        className="p-5 rounded-xl bg-gradient-to-br from-white to-gray-50 border border-gray-100 hover:shadow-md transition-all duration-200 hover:border-purple-200"
                        style={{ animationDelay: `${index * 50}ms` }}
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-purple-100">
                              <Calendar className="w-5 h-5 text-purple-600" />
                            </div>
                            <h4 className="font-semibold text-lg text-gray-900">
                              {format(new Date(stat.date), 'EEEE, MMM d')}
                            </h4>
                          </div>
                          {stat.error_count > 0 && (
                            <Badge className="bg-red-100 text-red-700 border-red-200">
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              {stat.error_count} errors
                            </Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="text-center p-3 rounded-lg bg-white">
                            <div className="flex items-center justify-center gap-2 mb-1">
                              <Clock className="w-4 h-4 text-blue-500" />
                              <span className="text-xs text-gray-600 font-medium">Runtime</span>
                            </div>
                            <p className="text-lg font-bold text-gray-900">
                              {Math.floor(stat.total_runtime_minutes / 60)}h {stat.total_runtime_minutes % 60}m
                            </p>
                          </div>
                          <div className="text-center p-3 rounded-lg bg-white">
                            <div className="flex items-center justify-center gap-2 mb-1">
                              <Navigation className="w-4 h-4 text-purple-500" />
                              <span className="text-xs text-gray-600 font-medium">Distance</span>
                            </div>
                            <p className="text-lg font-bold text-gray-900">{stat.total_distance_meters?.toFixed(0)}m</p>
                          </div>
                          <div className="text-center p-3 rounded-lg bg-white">
                            <div className="flex items-center justify-center gap-2 mb-1">
                              <Battery className="w-4 h-4 text-green-500" />
                              <span className="text-xs text-gray-600 font-medium">Avg Battery</span>
                            </div>
                            <p className="text-lg font-bold text-gray-900">{stat.average_battery_level?.toFixed(0)}%</p>
                          </div>
                          <div className="text-center p-3 rounded-lg bg-white">
                            <div className="flex items-center justify-center gap-2 mb-1">
                              <Thermometer className="w-4 h-4 text-orange-500" />
                              <span className="text-xs text-gray-600 font-medium">Avg Temp</span>
                            </div>
                            <p className="text-lg font-bold text-gray-900">{stat.average_temperature?.toFixed(1)}°C</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                      <BarChart3 className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-gray-600">No statistics available</p>
                    <p className="text-sm text-gray-500 mt-1">Statistics will appear after the bot has been active</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

