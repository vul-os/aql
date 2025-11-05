import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Thermometer, Droplets, CloudRain, Sprout, AlertTriangle, Activity } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDistanceToNow } from 'date-fns';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis
} from 'recharts';

/**
 * Custom Tooltip for Environmental Charts
 */
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white dark:bg-slate-800 p-3 rounded-lg shadow-lg border border-border">
        <p className="text-xs font-semibold mb-2">
          {new Date(label).toLocaleString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit' 
          })}
        </p>
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-1.5">
              <div 
                className="w-2 h-2 rounded-full" 
                style={{ backgroundColor: entry.color }}
              />
              {entry.name}
            </span>
            <span className="font-bold">{entry.value?.toFixed(1)}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

/**
 * Radial Progress Component
 */
const RadialProgress = ({ value, maxValue, color, label, unit }) => {
  const percentage = (value / maxValue) * 100;
  const data = [{ value: percentage, fill: color }];
  
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={120}>
        <RadialBarChart 
          cx="50%" 
          cy="50%" 
          innerRadius="70%" 
          outerRadius="100%" 
          data={data} 
          startAngle={90} 
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar
            background={{ fill: '#e5e7eb' }}
            dataKey="value"
            cornerRadius={10}
            fill={color}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl font-bold">{value?.toFixed(0)}</div>
          <div className="text-[10px] text-muted-foreground">{unit}</div>
        </div>
      </div>
    </div>
  );
};

/**
 * Service Environmental Data Component
 * Displays environmental sensor data for a garden (temperature, humidity, soil moisture)
 * 
 * This replaces the old bot-centric sensor data display with service-specific environmental data
 */
export default function ServiceEnvironmentalData({ gardenId }) {
  const [latestData, setLatestData] = useState(null);
  const [historicalData, setHistoricalData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (gardenId) {
      loadEnvironmentalData();
      // Refresh every 30 seconds
      const interval = setInterval(loadEnvironmentalData, 30000);
      return () => clearInterval(interval);
    }
  }, [gardenId]);

  const loadEnvironmentalData = async () => {
    try {
      setError(null);
      
      // Get latest environmental data
      const { data: latest, error: latestError } = await supabase
        .from('garden_environmental_data')
        .select('*')
        .eq('garden_id', gardenId)
        .order('recorded_at', { ascending: false })
        .limit(1);
      
      if (latestError) throw latestError;
      
      if (latest && latest.length > 0) {
        setLatestData(latest[0]);
      }
      
      // Get last 24 hours of data for chart
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      const { data: historical, error: historicalError } = await supabase
        .from('garden_environmental_data')
        .select('*')
        .eq('garden_id', gardenId)
        .gte('recorded_at', yesterday.toISOString())
        .order('recorded_at', { ascending: true });
      
      if (historicalError) throw historicalError;
      
      setHistoricalData(historical || []);
      setLoading(false);
      
    } catch (err) {
      console.error('Error loading environmental data:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>Error loading environmental data: {error}</AlertDescription>
      </Alert>
    );
  }

  if (!latestData) {
    return (
      <Alert>
        <AlertDescription>No environmental data available yet</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Current Conditions with Radial Progress */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Temperature */}
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
          <CardHeader className="pb-2 pt-4">
            <div className="flex items-center justify-between mb-2">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Temperature
              </CardTitle>
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#FF6B35]/20 to-[#FF6B35]/10 dark:from-[#FF6B35]/30 dark:to-[#FF6B35]/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                <Thermometer className="h-4 w-4 text-[#FF6B35]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <RadialProgress 
              value={latestData.temperature_celsius || 0}
              maxValue={50}
              color="#FF6B35"
              unit="°C"
            />
            <p className="text-[10px] text-center text-muted-foreground mt-2 font-medium">
              Updated {formatDistanceToNow(new Date(latestData.recorded_at), { addSuffix: true })}
            </p>
          </CardContent>
        </Card>

        {/* Humidity */}
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
          <CardHeader className="pb-2 pt-4">
            <div className="flex items-center justify-between mb-2">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Humidity
              </CardTitle>
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#4F5D75]/20 to-[#4F5D75]/10 dark:from-[#4F5D75]/30 dark:to-[#4F5D75]/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                <Droplets className="h-4 w-4 text-[#4F5D75]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <RadialProgress 
              value={latestData.humidity_percentage || 0}
              maxValue={100}
              color="#4F5D75"
              unit="%"
            />
            <p className="text-[10px] text-center text-muted-foreground mt-2 font-medium">
              Air humidity level
            </p>
          </CardContent>
        </Card>

        {/* Soil Moisture */}
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
          <CardHeader className="pb-2 pt-4">
            <div className="flex items-center justify-between mb-2">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Soil Moisture
              </CardTitle>
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#10B981]/20 to-[#10B981]/10 dark:from-[#10B981]/30 dark:to-[#10B981]/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                <Sprout className="h-4 w-4 text-[#10B981]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <RadialProgress 
              value={latestData.soil_moisture_percentage || 0}
              maxValue={100}
              color="#10B981"
              unit="%"
            />
            <p className="text-[10px] text-center text-muted-foreground mt-2 font-medium">
              {latestData.soil_moisture_percentage > 60 ? 'Wet soil' : latestData.soil_moisture_percentage > 40 ? 'Optimal' : 'Dry soil'}
            </p>
          </CardContent>
        </Card>

        {/* Weather */}
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
          <CardHeader className="pb-2 pt-4">
            <div className="flex items-center justify-between mb-2">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Weather
              </CardTitle>
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#4F5D75]/20 to-[#4F5D75]/10 dark:from-[#4F5D75]/30 dark:to-[#4F5D75]/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                <CloudRain className="h-4 w-4 text-[#4F5D75]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-4 pt-6">
            <div className="flex flex-col items-center gap-3">
              <CloudRain className={`h-12 w-12 ${latestData.is_raining ? 'text-[#4F5D75]' : 'text-[#B0B3B8]'}`} />
              {latestData.is_raining ? (
                <>
                  <Badge className="text-xs border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 font-semibold">Raining</Badge>
                  {latestData.rain_intensity && (
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {latestData.rain_intensity}
                    </span>
                  )}
                </>
              ) : (
                <Badge className="text-xs border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 font-semibold">Clear</Badge>
              )}
            </div>
            <p className="text-[10px] text-center text-muted-foreground mt-3 font-medium">
              Current conditions
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Historical Chart with Area Gradients */}
      {historicalData.length > 0 && (
        <Card className="border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 rounded-3xl">
          <CardHeader className="pb-3 pt-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-botkorp-orange/20 to-botkorp-orange/10 dark:from-botkorp-orange/30 dark:to-botkorp-orange/20 flex items-center justify-center shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                  <Activity className="h-5 w-5 text-botkorp-orange" />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold">Environmental Trends (24h)</CardTitle>
                  <CardDescription className="text-[10px] font-medium">Temperature and humidity patterns over time</CardDescription>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] border-0 bg-botkorp-orange/10 text-botkorp-orange font-semibold px-3 rounded-full">
                Live Data
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-4 pb-5">
            <ResponsiveContainer width="100%" height={350}>
              <AreaChart data={historicalData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#FF6B35" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#FF6B35" stopOpacity={0.1}/>
                  </linearGradient>
                  <linearGradient id="colorHumidity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4F5D75" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#4F5D75" stopOpacity={0.1}/>
                  </linearGradient>
                  <linearGradient id="colorSoil" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0.1}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.5} />
                <XAxis 
                  dataKey="recorded_at" 
                  tickFormatter={(value) => new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  tick={{ fontSize: 11 }}
                  stroke="#94a3b8"
                />
                <YAxis 
                  yAxisId="left" 
                  tick={{ fontSize: 11 }}
                  stroke="#94a3b8"
                  label={{ value: '°C / %', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#64748b' } }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend 
                  wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                  iconType="circle"
                />
                <Area 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="temperature_celsius" 
                  stroke="#FF6B35" 
                  strokeWidth={2}
                  fill="url(#colorTemp)"
                  name="Temperature (°C)"
                />
                <Area 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="humidity_percentage" 
                  stroke="#4F5D75" 
                  strokeWidth={2}
                  fill="url(#colorHumidity)"
                  name="Humidity (%)"
                />
                {historicalData[0]?.soil_moisture_percentage && (
                  <Area 
                    yAxisId="left"
                    type="monotone" 
                    dataKey="soil_moisture_percentage" 
                    stroke="#10B981" 
                    strokeWidth={2}
                    fill="url(#colorSoil)"
                    name="Soil Moisture (%)"
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}


