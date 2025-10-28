import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Thermometer, Droplets, CloudRain, Sprout, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDistanceToNow } from 'date-fns';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

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
      {/* Current Conditions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Temperature */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-orange-500" />
              Temperature
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {latestData.temperature_celsius?.toFixed(1) || '--'}°C
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Updated {formatDistanceToNow(new Date(latestData.recorded_at), { addSuffix: true })}
            </p>
          </CardContent>
        </Card>

        {/* Humidity */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Droplets className="h-4 w-4 text-blue-500" />
              Humidity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {latestData.humidity_percentage?.toFixed(0) || '--'}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Air humidity
            </p>
          </CardContent>
        </Card>

        {/* Soil Moisture */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Sprout className="h-4 w-4 text-green-500" />
              Soil Moisture
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {latestData.soil_moisture_percentage?.toFixed(0) || '--'}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {latestData.soil_moisture_percentage > 60 ? 'Wet' : latestData.soil_moisture_percentage > 40 ? 'Good' : 'Dry'}
            </p>
          </CardContent>
        </Card>

        {/* Weather */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CloudRain className="h-4 w-4 text-gray-500" />
              Weather
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {latestData.is_raining ? (
                <>
                  <Badge variant="destructive">Raining</Badge>
                  {latestData.rain_intensity && (
                    <span className="text-xs text-muted-foreground">
                      {latestData.rain_intensity}
                    </span>
                  )}
                </>
              ) : (
                <Badge variant="outline">Clear</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Historical Chart */}
      {historicalData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Environmental Trends (24h)</CardTitle>
            <CardDescription>Temperature and humidity over the last 24 hours</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={historicalData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="recorded_at" 
                  tickFormatter={(value) => new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip 
                  labelFormatter={(value) => new Date(value).toLocaleString()}
                  formatter={(value) => value?.toFixed(1)}
                />
                <Legend />
                <Line 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="temperature_celsius" 
                  stroke="#f97316" 
                  name="Temperature (°C)"
                  dot={false}
                />
                <Line 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="humidity_percentage" 
                  stroke="#3b82f6" 
                  name="Humidity (%)"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}


