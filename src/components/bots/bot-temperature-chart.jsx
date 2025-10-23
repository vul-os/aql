import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Thermometer } from 'lucide-react';
import { format } from 'date-fns';

/**
 * Bot Temperature & Humidity Chart Component
 * Displays temperature and humidity over time (last 24 hours)
 * 
 * Props:
 * - botId: Bot UUID
 * - timeRange: '24h', '7d', '30d' (default: '24h')
 */
export default function BotTemperatureChart({ botId, timeRange = '24h' }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTemperatureData();
  }, [botId, timeRange]);

  const fetchTemperatureData = async () => {
    setLoading(true);
    
    try {
      // Calculate start date based on time range
      const now = new Date();
      let startDate = new Date();
      
      switch (timeRange) {
        case '24h':
          startDate.setHours(now.getHours() - 24);
          break;
        case '7d':
          startDate.setDate(now.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(now.getDate() - 30);
          break;
        default:
          startDate.setHours(now.getHours() - 24);
      }

      // Fetch sensor readings
      const { data: readings, error } = await supabase
        .from('bot_sensor_readings')
        .select('recorded_at, temperature_celsius, humidity_percentage, is_raining')
        .eq('bot_id', botId)
        .gte('recorded_at', startDate.toISOString())
        .order('recorded_at', { ascending: true });

      if (error) throw error;

      // Transform data for chart
      const chartData = readings
        .filter(r => r.temperature_celsius !== null || r.humidity_percentage !== null)
        .map(reading => ({
          time: new Date(reading.recorded_at).getTime(),
          timeLabel: format(new Date(reading.recorded_at), 'HH:mm'),
          temperature: reading.temperature_celsius ? parseFloat(reading.temperature_celsius) : null,
          humidity: reading.humidity_percentage ? parseFloat(reading.humidity_percentage) : null,
          isRaining: reading.is_raining
        }));

      setData(chartData);
    } catch (error) {
      console.error('Error fetching temperature data:', error);
    } finally {
      setLoading(false);
    }
  };

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="text-sm font-semibold mb-2">
            {format(new Date(data.time), 'MMM d, HH:mm')}
          </p>
          <div className="space-y-1">
            {data.temperature !== null && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs text-orange-600">Temperature:</span>
                <span className="font-semibold text-orange-600">{data.temperature.toFixed(1)}°C</span>
              </div>
            )}
            {data.humidity !== null && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs text-blue-600">Humidity:</span>
                <span className="font-semibold text-blue-600">{data.humidity.toFixed(1)}%</span>
              </div>
            )}
            {data.isRaining && (
              <div className="flex items-center gap-2 mt-2 pt-2 border-t">
                <span className="text-xs text-gray-600">🌧️ Raining</span>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="h-[300px] flex items-center justify-center">
        <Thermometer className="w-6 h-6 animate-pulse text-gray-400" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center">
        <div className="text-center">
          <Thermometer className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm text-muted-foreground">No environmental data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis 
            dataKey="timeLabel" 
            stroke="#888"
            fontSize={12}
            tickLine={false}
          />
          <YAxis 
            yAxisId="left"
            domain={[0, 50]}
            stroke="#f97316"
            fontSize={12}
            tickLine={false}
            label={{ value: 'Temp (°C)', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }}
          />
          <YAxis 
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            stroke="#3b82f6"
            fontSize={12}
            tickLine={false}
            label={{ value: 'Humidity (%)', angle: 90, position: 'insideRight', style: { fontSize: 12 } }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            wrapperStyle={{ fontSize: 12 }}
            iconType="line"
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="temperature"
            stroke="#f97316"
            strokeWidth={2}
            dot={false}
            name="Temperature (°C)"
            isAnimationActive={true}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="humidity"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            name="Humidity (%)"
            isAnimationActive={true}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

