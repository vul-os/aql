import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { Battery } from 'lucide-react';
import { format } from 'date-fns';

/**
 * Bot Battery Chart Component
 * Displays battery level over time (last 24 hours)
 * 
 * Props:
 * - botId: Bot UUID
 * - timeRange: '24h', '7d', '30d' (default: '24h')
 */
export default function BotBatteryChart({ botId, timeRange = '24h' }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBatteryData();
  }, [botId, timeRange]);

  const fetchBatteryData = async () => {
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
        .select('recorded_at, battery_percentage, battery_voltage, is_charging')
        .eq('bot_id', botId)
        .gte('recorded_at', startDate.toISOString())
        .order('recorded_at', { ascending: true });

      if (error) throw error;

      // Transform data for chart
      const chartData = readings
        .filter(r => r.battery_percentage !== null)
        .map(reading => ({
          time: new Date(reading.recorded_at).getTime(),
          timeLabel: format(new Date(reading.recorded_at), 'HH:mm'),
          battery: reading.battery_percentage,
          voltage: reading.battery_voltage || 0,
          isCharging: reading.is_charging
        }));

      setData(chartData);
    } catch (error) {
      console.error('Error fetching battery data:', error);
    } finally {
      setLoading(false);
    }
  };

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="text-sm font-semibold mb-1">
            {format(new Date(data.time), 'MMM d, HH:mm')}
          </p>
          <div className="flex items-center gap-2">
            <Battery className={`w-4 h-4 ${data.battery > 60 ? 'text-green-600' : data.battery > 30 ? 'text-yellow-600' : 'text-red-600'}`} />
            <span className="text-2xl font-bold">{data.battery}%</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {data.voltage.toFixed(2)}V
            {data.isCharging && ' • Charging'}
          </p>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="h-[300px] flex items-center justify-center">
        <Battery className="w-6 h-6 animate-pulse text-gray-400" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center">
        <div className="text-center">
          <Battery className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm text-muted-foreground">No battery data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="batteryGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis 
            dataKey="timeLabel" 
            stroke="#888"
            fontSize={12}
            tickLine={false}
          />
          <YAxis 
            domain={[0, 100]}
            stroke="#888"
            fontSize={12}
            tickLine={false}
            label={{ value: 'Battery %', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="battery"
            stroke="#22c55e"
            strokeWidth={2}
            fill="url(#batteryGradient)"
            isAnimationActive={true}
          />
          {/* Reference lines for low battery thresholds */}
          <line y1="20" y2="20" stroke="#ef4444" strokeWidth={1} strokeDasharray="5 5" opacity={0.3} />
          <line y1="50" y2="50" stroke="#eab308" strokeWidth={1} strokeDasharray="5 5" opacity={0.2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}




