import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  Loader2,
  Info,
  ArrowLeft
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

/**
 * Service Bot Status Page
 * Shows bot sensor data in the context of a service (for regular users)
 * Uses RPC functions to enforce RLS
 */
export default function ServiceBotStatus() {
  const { serviceId } = useParams();
  const navigate = useNavigate();
  
  const [botData, setBotData] = useState(null);
  const [sensorHistory, setSensorHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchServiceBotData();
    
    // Refresh data every 30 seconds
    const interval = setInterval(fetchServiceBotData, 30000);
    return () => clearInterval(interval);
  }, [serviceId]);

  const fetchServiceBotData = async () => {
    try {
      setError(null);
      
      // First, get the service to find the location_id
      const { data: serviceData, error: serviceError } = await supabase
        .from('services')
        .select('location_id, name')
        .eq('id', serviceId)
        .single();
      
      if (serviceError) {
        console.error('Service fetch error:', serviceError);
        throw new Error('Unable to load service information');
      }
      
      if (!serviceData || !serviceData.location_id) {
        setError('Service location not configured. Please contact support.');
        setLoading(false);
        return;
      }
      
      const locationId = serviceData.location_id;
      
      // Call RPC function to get bot data for this location
      const { data, error: rpcError } = await supabase
        .rpc('get_location_bot_data', { location_id_input: locationId });
      
      if (rpcError) {
        console.error('RPC error:', rpcError);
        throw new Error('Unable to load bot data. Please try again.');
      }
      
      if (!data || data.length === 0) {
        setError('No bot assigned yet. Bot assignment happens during installation.');
        setLoading(false);
        return;
      }
      
      setBotData(data[0]);
      
      // Get sensor history for graphs
      const { data: history, error: historyError } = await supabase
        .rpc('get_bot_sensor_history', { 
          location_id_input: locationId,
          hours_back: 6 
        });
      
      if (!historyError && history) {
        setSensorHistory(history);
      }
      
      setLoading(false);
    } catch (err) {
      console.error('Error fetching bot data:', err);
      setError(err.message || 'An unexpected error occurred');
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
        <LoadingLottie
          src="https://lottie.host/51fee83a-3e79-41b0-8a20-77f890b9b6f1/iUangPxwIF.lottie"
          message="Loading service status..."
          size="md"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <Card className="max-w-md w-full border-0 shadow-lg">
            <CardContent className="p-8 text-center">
              <div className="h-16 w-16 rounded-full bg-yellow-100 dark:bg-yellow-900/20 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-yellow-600 dark:text-yellow-500" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Unable to Load Bot Status</h3>
              <p className="text-muted-foreground mb-6">{error}</p>
              
              {error.includes('No bot assigned') && (
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-left">
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                    <Info className="w-4 h-4 text-blue-600" />
                    What's Next?
                  </h4>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>• Bots are assigned during installation</li>
                    <li>• Our team will contact you within 24-48 hours</li>
                    <li>• You'll receive a notification when your bot is active</li>
                  </ul>
                </div>
              )}
              
              <Button
                onClick={() => window.location.reload()}
                variant="outline"
                className="mt-6"
              >
                Try Again
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!botData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-2" />
          <p>No bot data available</p>
        </div>
      </div>
    );
  }

  const latestSensor = botData.latest_sensor_reading;
  const recentEvents = botData.recent_events || [];
  const todayStats = botData.today_stats;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Breadcrumb/Back Button */}
      <div className="flex items-center gap-3">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => navigate(`/portal/service/${serviceId}`)}
          className="h-9 px-3"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Service
        </Button>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Service Status</h1>
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

        {/* Activity */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Gauge className="w-4 h-4" />
              Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {latestSensor?.is_on ? 'Active' : 'Idle'}
            </div>
            <p className="text-xs text-muted-foreground">
              {latestSensor?.rpm ? `${latestSensor.rpm} RPM` : 'Standby'}
            </p>
          </CardContent>
        </Card>

        {/* Weather */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Droplets className="w-4 h-4" />
              Weather
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {latestSensor?.is_raining ? '🌧️ Rain' : '☀️ Clear'}
            </div>
            <p className="text-xs text-muted-foreground">
              Last update: {latestSensor?.recorded_at 
                ? formatDistanceToNow(new Date(latestSensor.recorded_at), { addSuffix: true })
                : 'Never'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Current Status */}
        <Card>
          <CardHeader>
            <CardTitle>Current Status</CardTitle>
            <CardDescription>
              Real-time sensor readings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {latestSensor ? (
              <>
                {/* Movement */}
                {latestSensor.speed_cm_per_sec > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2">Movement</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Speed:</span>
                        <p className="font-mono">{latestSensor.speed_cm_per_sec?.toFixed(1)} cm/s</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Direction:</span>
                        <p className="font-mono">{latestSensor.direction_degrees?.toFixed(0)}°</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Orientation (if bot is moving) */}
                {latestSensor.is_on && (
                  <div>
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <Navigation className="w-4 h-4" />
                      Orientation
                    </h4>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Pitch:</span>
                        <p className="font-mono">{latestSensor.pitch?.toFixed(1) || '--'}°</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Roll:</span>
                        <p className="font-mono">{latestSensor.roll?.toFixed(1) || '--'}°</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Heading:</span>
                        <p className="font-mono">{latestSensor.yaw?.toFixed(0) || '--'}°</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Environment */}
                <div>
                  <h4 className="font-semibold mb-2">Environment</h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Rain:</span>
                      <Badge variant={latestSensor.is_raining ? "destructive" : "outline"}>
                        {latestSensor.is_raining ? 'Detected' : 'None'}
                      </Badge>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No sensor data available</p>
            )}
          </CardContent>
        </Card>

        {/* Today's Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Today's Summary</CardTitle>
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
                  <span className="text-sm text-muted-foreground">Distance Covered</span>
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
                {todayStats.error_count > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Issues</span>
                    <Badge variant="destructive">{todayStats.error_count} errors</Badge>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No activity today</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Recent events and notifications</CardDescription>
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
            <p className="text-sm text-muted-foreground">No recent activity</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

