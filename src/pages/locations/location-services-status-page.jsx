import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import LoadingLottie from '@/components/ui/loading-lottie';
import NumberTicker from '@/components/ui/number-ticker';
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
  CloudRain,
  Bot
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import PageHeader from '@/components/ui/page-header';

/**
 * Location Services Status Page
 * Shows bot status for a specific location (garden/pool)
 * Users see this in context of their garden/pool, not raw bot data
 */
export default function LocationServicesStatusPage() {
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
      maintenance: 'bg-botkorp-orange'
    };
    return colors[status] || 'bg-gray-500';
  };

  const getSeverityColor = (severity) => {
    const colors = {
      info: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
      warning: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
      error: 'bg-red-500/10 text-red-600 border-red-500/20',
      critical: 'bg-red-500/15 text-red-700 border-red-500/30'
    };
    return colors[severity] || 'bg-muted text-muted-foreground';
  };

  const getBatteryColor = (level) => {
    if (level > 60) return 'text-green-600';
    if (level > 30) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getBatteryBgColor = (level) => {
    if (level > 60) return 'from-green-500/15 to-green-500/5';
    if (level > 30) return 'from-yellow-500/15 to-yellow-500/5';
    return 'from-red-500/15 to-red-500/5';
  };

  const getBatteryBarColor = (level) => {
    if (level > 60) return 'bg-green-500';
    if (level > 30) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen bg-[#FAFAFA] dark:bg-[#121212]">
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
      <div className="min-h-screen p-4 md:p-6 lg:p-8 space-y-8 bg-[#FAFAFA] dark:bg-[#121212]">
        <div className="flex items-center justify-center min-h-[600px]">
          <Card className="max-w-md w-full border-2 border-[#E5E7EB] dark:border-[#2a2a2a] shadow-lg bg-white dark:bg-[#1a1a1a]">
            <CardContent className="pt-12 pb-12 text-center space-y-6">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-yellow-500/15 to-yellow-500/5 shadow-[0_4px_20px_rgb(234,179,8,0.15)]">
                <AlertTriangle className="w-10 h-10 text-yellow-600" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-[#121212] dark:text-white">No Bot Found</h3>
                <p className="text-sm text-[#4F5D75] dark:text-[#B0B3B8]">{error}</p>
                <p className="text-xs text-[#B0B3B8] dark:text-[#6B7A94]">
                  This location may not have an active bot assigned yet.
                </p>
              </div>
              <Button 
                onClick={() => navigate('/portal')}
                className="bg-gradient-to-r from-[#FF6B35] to-[#E85A2A] hover:from-[#E85A2A] hover:to-[#FF6B35] shadow-lg hover:shadow-xl transition-all duration-300 text-white font-bold px-6 py-5 rounded-xl"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!botData) return null;

  const latestSensor = botData.latest_sensor_reading;
  const recentEvents = botData.recent_events || [];
  const todayStats = botData.today_stats;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto min-h-screen">
      <div className="space-y-6">
        {/* Breadcrumb/Back Button */}
        <div className="flex items-center gap-3 animate-in fade-in slide-in-from-top-3 duration-500">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate('/portal')}
            className="h-9 px-3 bg-background/60 backdrop-blur-sm hover:bg-background/80 transition-all rounded-xl shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>

        {/* Enhanced Header - Soft UI */}
        <div className="relative overflow-hidden rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-top-3 duration-500 group">
          {/* Base gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-green-500 via-green-500/90 to-emerald-500" />
          
          {/* Animated grid pattern */}
          <div className="absolute inset-0 opacity-20 dark:opacity-30">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSA0MCAwIEwgMCAwIDAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMC41Ii8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] animate-pulse" style={{ animationDuration: '4s' }} />
          </div>

          {/* Floating particles */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute w-1 h-1 bg-white/40 rounded-full top-[20%] left-[15%] animate-float" style={{ animationDelay: '0s', animationDuration: '8s' }} />
            <div className="absolute w-1.5 h-1.5 bg-white/30 rounded-full top-[60%] left-[25%] animate-float" style={{ animationDelay: '2s', animationDuration: '10s' }} />
            <div className="absolute w-1 h-1 bg-white/40 rounded-full top-[40%] left-[80%] animate-float" style={{ animationDelay: '1s', animationDuration: '9s' }} />
          </div>

          {/* Content */}
          <div className="relative p-8">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="h-20 w-20 rounded-2xl bg-white/25 dark:bg-white/15 backdrop-blur-md flex items-center justify-center shadow-xl border border-white/20 group-hover:scale-110 transition-all duration-500">
                  <span className="text-4xl">{botData.bot_type === 'mow_bot' ? '🌱' : '🏊'}</span>
                </div>
                <div>
                  <span className="text-xs text-white/70 dark:text-white/60 font-bold uppercase tracking-[0.15em] block mb-1">
                    {botData.bot_type === 'mow_bot' ? 'Garden' : 'Pool'} Service
                  </span>
                  <h1 className="text-4xl font-bold text-white tracking-tight drop-shadow-2xl leading-none">
                    {botData.bot_name}
                  </h1>
                  {latestSensor?.reading_timestamp && (
                    <p className="text-white/90 dark:text-white/80 text-sm mt-2">
                      Last updated {formatDistanceToNow(new Date(latestSensor.reading_timestamp), { addSuffix: true })}
                    </p>
                  )}
                </div>
              </div>
              
              <div className="flex flex-col items-start md:items-end gap-2">
                <Badge className={`${getStatusColor(botData.bot_status)} text-white px-4 py-2 text-sm shadow-xl border-0`}>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                    {botData.bot_status.toUpperCase()}
                  </div>
                </Badge>
                {latestSensor?.is_on && (
                  <Badge className="bg-white/25 dark:bg-white/15 backdrop-blur-md text-white px-4 py-2 shadow-xl border border-white/20">
                    <Zap className="w-4 h-4 mr-1" />
                    Active Now
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Soft UI Tabs */}
        <Tabs defaultValue="current" className="w-full">
          <TabsList className="bg-gradient-to-br from-background to-muted/20 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-1 h-auto rounded-2xl">
            <TabsTrigger 
              value="current" 
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-500 data-[state=active]:to-emerald-500 data-[state=active]:text-white data-[state=active]:shadow-lg px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-wide transition-all duration-300"
            >
              <Activity className="w-4 h-4 mr-2" />
              Current Status
            </TabsTrigger>
            <TabsTrigger 
              value="history" 
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/90 data-[state=active]:text-white data-[state=active]:shadow-lg px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-wide transition-all duration-300"
            >
              <History className="w-4 h-4 mr-2" />
              Activity History
            </TabsTrigger>
            <TabsTrigger 
              value="stats" 
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-indigo-500 data-[state=active]:text-white data-[state=active]:shadow-lg px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-wide transition-all duration-300"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Statistics
            </TabsTrigger>
          </TabsList>

          {/* Current Status Tab */}
          <TabsContent value="current" className="space-y-6 mt-6">
            {/* Section Header */}
            <div className="flex items-center gap-3 animate-in fade-in slide-in-from-bottom-3 duration-500">
              <div className="h-1 w-1 bg-green-500 rounded-full" />
              <div className="h-1 w-8 bg-gradient-to-r from-green-500 to-green-500/60 rounded-full" />
              <h2 className="text-xs font-bold uppercase tracking-[0.15em]">
                Live Metrics
              </h2>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-muted/30 to-transparent" />
            </div>

            {/* Enhanced Quick Stats - Soft Design */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-3 duration-700">
              {/* Battery Card */}
              <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 group">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Battery</span>
                  <div className={`h-9 w-9 rounded-xl bg-gradient-to-br ${getBatteryBgColor(latestSensor?.battery_percentage || 0)} flex items-center justify-center shadow-[0_4px_20px_rgba(0,0,0,0.08)] group-hover:scale-110 transition-all duration-300`}>
                    <Battery className={`h-4 w-4 ${getBatteryColor(latestSensor?.battery_percentage || 0)}`} />
                  </div>
                </div>
                <div className="text-3xl font-bold mb-1">
                  <NumberTicker value={latestSensor?.battery_percentage || 0} />%
                </div>
                <div className="flex items-center gap-2 mb-3">
                  {latestSensor?.is_charging && <Zap className="w-3 h-3 text-yellow-500" />}
                  <p className="text-xs text-muted-foreground/60">
                    {latestSensor?.is_charging ? 'Charging' : 'Not charging'}
                  </p>
                </div>
                <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-1000 ${getBatteryBarColor(latestSensor?.battery_percentage || 0)} rounded-full`}
                    style={{ width: `${latestSensor?.battery_percentage || 0}%` }}
                  />
                </div>
              </div>

              {/* Temperature Card */}
              <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 group">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Temperature</span>
                  <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-orange-500/15 to-orange-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(249,115,22,0.15)] group-hover:scale-110 transition-all duration-300">
                    <Thermometer className="h-4 w-4 text-orange-600" />
                  </div>
                </div>
                <div className="text-3xl font-bold mb-1">
                  {latestSensor?.temperature_celsius?.toFixed(1) || '--'}°C
                </div>
                <div className="flex items-center gap-2">
                  <Droplets className="w-3 h-3 text-blue-500" />
                  <p className="text-xs text-muted-foreground/60">
                    {latestSensor?.humidity_percentage?.toFixed(0) || '--'}% humidity
                  </p>
                </div>
              </div>

              {/* Activity Card */}
              <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 group">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Activity</span>
                  <div className={`h-9 w-9 rounded-xl bg-gradient-to-br ${latestSensor?.is_on ? 'from-blue-500/15 to-blue-500/5' : 'from-muted/30 to-muted/10'} flex items-center justify-center shadow-[0_4px_20px_rgba(0,0,0,0.08)] group-hover:scale-110 transition-all duration-300`}>
                    <Gauge className={`h-4 w-4 ${latestSensor?.is_on ? 'text-blue-600' : 'text-muted-foreground'}`} />
                  </div>
                </div>
                <div className="text-3xl font-bold mb-1">
                  {latestSensor?.is_on ? 'Working' : 'Idle'}
                </div>
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-3 h-3 text-blue-500" />
                  <p className="text-xs text-muted-foreground/60">
                    {latestSensor?.rpm || 0} RPM
                  </p>
                </div>
              </div>

              {/* Weather Card */}
              <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 group">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Weather</span>
                  <div className={`h-9 w-9 rounded-xl bg-gradient-to-br ${latestSensor?.is_raining ? 'from-blue-500/15 to-blue-500/5' : 'from-yellow-500/15 to-yellow-500/5'} flex items-center justify-center shadow-[0_4px_20px_rgba(0,0,0,0.08)] group-hover:scale-110 transition-all duration-300`}>
                    {latestSensor?.is_raining ? (
                      <CloudRain className="h-4 w-4 text-blue-600" />
                    ) : (
                      <Sun className="h-4 w-4 text-yellow-600" />
                    )}
                  </div>
                </div>
                <div className="text-3xl font-bold mb-1">
                  {latestSensor?.is_raining ? '🌧️' : '☀️'}
                </div>
                <p className="text-xs text-muted-foreground/60">
                  {latestSensor?.is_raining ? 'Rain detected' : 'Clear conditions'}
                </p>
              </div>
            </div>

            {/* Today's Summary - Soft Design */}
            {todayStats && (
              <div className="animate-in fade-in slide-in-from-bottom-3 duration-500 delay-150">
                {/* Section Header */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-1 w-1 bg-botkorp-orange rounded-full" />
                  <div className="h-1 w-8 bg-gradient-to-r from-botkorp-orange to-botkorp-orange/60 rounded-full" />
                  <h2 className="text-xs font-bold uppercase tracking-[0.15em]">
                    Today's Performance
                  </h2>
                  <div className="flex-1 h-[1px] bg-gradient-to-r from-muted/30 to-transparent" />
                </div>

                <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-sm font-semibold mb-0.5">Daily Summary</h3>
                      <p className="text-xs text-muted-foreground/60 flex items-center gap-1.5">
                        <Calendar className="w-3 h-3" />
                        {format(new Date(), 'EEEE, MMMM d, yyyy')}
                      </p>
                    </div>
                    <div className="text-4xl">📊</div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                      <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/15 to-blue-500/5 mb-3 shadow-[0_4px_20px_rgb(59,130,246,0.15)]">
                        <Clock className="w-5 h-5 text-blue-600" />
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 mb-1 font-medium uppercase tracking-wider">Runtime</p>
                      <p className="text-xl font-bold">
                        {Math.floor(todayStats.total_runtime_minutes / 60)}h {todayStats.total_runtime_minutes % 60}m
                      </p>
                    </div>
                    <div className="text-center p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                      <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/15 to-purple-500/5 mb-3 shadow-[0_4px_20px_rgb(168,85,247,0.15)]">
                        <Navigation className="w-5 h-5 text-purple-600" />
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 mb-1 font-medium uppercase tracking-wider">Distance</p>
                      <p className="text-xl font-bold">{todayStats.total_distance_meters?.toFixed(0)}m</p>
                    </div>
                    <div className="text-center p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                      <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/15 to-green-500/5 mb-3 shadow-[0_4px_20px_rgb(34,197,94,0.15)]">
                        <MapPin className="w-5 h-5 text-green-600" />
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 mb-1 font-medium uppercase tracking-wider">Area Covered</p>
                      <p className="text-xl font-bold">{todayStats.area_covered_sqm?.toFixed(0)}m²</p>
                    </div>
                    <div className="text-center p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                      <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500/15 to-yellow-500/5 mb-3 shadow-[0_4px_20px_rgb(234,179,8,0.15)]">
                        <Battery className="w-5 h-5 text-yellow-600" />
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 mb-1 font-medium uppercase tracking-wider">Avg Battery</p>
                      <p className="text-xl font-bold">{todayStats.average_battery_level?.toFixed(0)}%</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Activity History Tab */}
          <TabsContent value="history" className="space-y-6 mt-6">
            {/* Section Header */}
            <div className="flex items-center gap-3 animate-in fade-in slide-in-from-bottom-3 duration-500">
              <div className="h-1 w-1 bg-botkorp-orange rounded-full" />
              <div className="h-1 w-8 bg-gradient-to-r from-botkorp-orange to-botkorp-orange/60 rounded-full" />
              <h2 className="text-xs font-bold uppercase tracking-[0.15em]">
                Recent Activity
              </h2>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-muted/30 to-transparent" />
            </div>

            <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all animate-in fade-in slide-in-from-bottom-3 duration-500 delay-150">
              <div className="flex items-center gap-3 mb-5">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                  <History className="h-5 w-5 text-botkorp-orange" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Recent Events</h3>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    Last 20 events
                  </p>
                </div>
              </div>

              {recentEvents.length > 0 ? (
                <div className="space-y-2">
                  {recentEvents.map((event, index) => (
                    <div 
                      key={event.id} 
                      className="flex items-start gap-3 p-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all duration-300 cursor-pointer group animate-in fade-in slide-in-from-left-3"
                      style={{ animationDelay: `${index * 50}ms`, animationDuration: '300ms' }}
                    >
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm ${
                        event.severity === 'error' || event.severity === 'critical' 
                          ? 'bg-red-500' 
                          : event.severity === 'warning'
                          ? 'bg-yellow-500'
                          : 'bg-green-500'
                      }`}>
                        {event.severity === 'error' || event.severity === 'critical' ? (
                          <AlertTriangle className="w-4 h-4 text-white" />
                        ) : event.severity === 'warning' ? (
                          <AlertTriangle className="w-4 h-4 text-white" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-white" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="font-semibold text-xs truncate group-hover:text-botkorp-orange transition-colors">{event.title}</h4>
                          <Badge className={`${getSeverityColor(event.severity)} text-[9px] uppercase font-bold px-2 py-0.5 h-4 capitalize border`}>
                            {event.severity}
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground/60 mb-1">{event.description}</p>
                        {event.event_timestamp && (
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
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
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-muted/30 to-muted/10 mb-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                    <History className="w-8 h-8 text-muted-foreground/60" />
                  </div>
                  <p className="text-sm font-semibold mb-1">No recent events</p>
                  <p className="text-xs text-muted-foreground/60">Events will appear here when activity is detected</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Statistics Tab */}
          <TabsContent value="stats" className="space-y-6 mt-6">
            {/* Section Header */}
            <div className="flex items-center gap-3 animate-in fade-in slide-in-from-bottom-3 duration-500">
              <div className="h-1 w-1 bg-blue-500 rounded-full" />
              <div className="h-1 w-8 bg-gradient-to-r from-blue-500 to-blue-500/60 rounded-full" />
              <h2 className="text-xs font-bold uppercase tracking-[0.15em]">
                Performance Analytics
              </h2>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-muted/30 to-transparent" />
            </div>

            <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all animate-in fade-in slide-in-from-bottom-3 duration-500 delay-150">
              <div className="flex items-center gap-3 mb-5">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500/15 to-blue-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(59,130,246,0.15)]">
                  <BarChart3 className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Weekly Statistics</h3>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    Last 7 days performance
                  </p>
                </div>
              </div>

              {statistics.length > 0 ? (
                <div className="space-y-3">
                  {statistics.map((stat, index) => (
                    <div 
                      key={stat.date} 
                      className="p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all duration-300 animate-in fade-in slide-in-from-left-3"
                      style={{ animationDelay: `${index * 50}ms`, animationDuration: '300ms' }}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500/15 to-blue-500/5 flex items-center justify-center shadow-[0_2px_10px_rgb(59,130,246,0.1)]">
                            <Calendar className="w-4 h-4 text-blue-600" />
                          </div>
                          <h4 className="font-semibold text-sm">
                            {format(new Date(stat.date), 'EEEE, MMM d')}
                          </h4>
                        </div>
                        {stat.error_count > 0 && (
                          <Badge className="bg-red-500/10 text-red-600 border-red-500/20 text-[9px] font-bold uppercase px-2 py-0.5 h-5">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            {stat.error_count} errors
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="text-center p-3 rounded-lg bg-white dark:bg-[#1a1a1a] shadow-[0_2px_8px_rgb(0,0,0,0.04)]">
                          <div className="flex items-center justify-center gap-1.5 mb-1">
                            <Clock className="w-3 h-3 text-blue-500" />
                            <span className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wide">Runtime</span>
                          </div>
                          <p className="text-base font-bold">
                            {Math.floor(stat.total_runtime_minutes / 60)}h {stat.total_runtime_minutes % 60}m
                          </p>
                        </div>
                        <div className="text-center p-3 rounded-lg bg-white dark:bg-[#1a1a1a] shadow-[0_2px_8px_rgb(0,0,0,0.04)]">
                          <div className="flex items-center justify-center gap-1.5 mb-1">
                            <Navigation className="w-3 h-3 text-purple-500" />
                            <span className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wide">Distance</span>
                          </div>
                          <p className="text-base font-bold">{stat.total_distance_meters?.toFixed(0)}m</p>
                        </div>
                        <div className="text-center p-3 rounded-lg bg-white dark:bg-[#1a1a1a] shadow-[0_2px_8px_rgb(0,0,0,0.04)]">
                          <div className="flex items-center justify-center gap-1.5 mb-1">
                            <Battery className="w-3 h-3 text-green-500" />
                            <span className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wide">Battery</span>
                          </div>
                          <p className="text-base font-bold">{stat.average_battery_level?.toFixed(0)}%</p>
                        </div>
                        <div className="text-center p-3 rounded-lg bg-white dark:bg-[#1a1a1a] shadow-[0_2px_8px_rgb(0,0,0,0.04)]">
                          <div className="flex items-center justify-center gap-1.5 mb-1">
                            <Thermometer className="w-3 h-3 text-orange-500" />
                            <span className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wide">Temp</span>
                          </div>
                          <p className="text-base font-bold">{stat.average_temperature?.toFixed(1)}°C</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-muted/30 to-muted/10 mb-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                    <BarChart3 className="w-8 h-8 text-muted-foreground/60" />
                  </div>
                  <p className="text-sm font-semibold mb-1">No statistics available</p>
                  <p className="text-xs text-muted-foreground/60">Statistics will appear after the bot has been active</p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

