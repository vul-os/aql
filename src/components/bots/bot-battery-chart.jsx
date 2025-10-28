import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, ReferenceLine } from 'recharts';
import { Battery, BatteryCharging, BatteryWarning, BatteryLow, Zap, TrendingUp, TrendingDown } from 'lucide-react';
import { format } from 'date-fns';
import { Card } from '@/components/ui/card';

/**
 * Bot Battery Chart Component - DEPRECATED
 * 
 * ⚠️ DEPRECATION WARNING ⚠️
 * This component uses bot-centric data (bot_sensor_readings table) which has been removed.
 * The system is now SERVICE-CENTRIC.
 * 
 * For battery data, use:
 * - ServiceMowingSessions component for session-level battery usage
 * - Service dashboard to view mowing performance metrics
 * 
 * This component is kept for backward compatibility with admin dashboards only.
 * 
 * Props:
 * - botId: Bot UUID
 * - timeRange: '24h', '7d', '30d' (default: '24h')
 */
export default function BotBatteryChart({ botId, timeRange = '24h' }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    current: 0,
    average: 0,
    min: 0,
    max: 0,
    isCharging: false,
    chargingTime: 0
  });

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

      // ⚠️ DEPRECATED: This queries the old bot_sensor_readings table
      // For service-centric data, use garden_mowing_sensor_data instead
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

      // Calculate statistics
      if (chartData.length > 0) {
        const batteryLevels = chartData.map(d => d.battery);
        const current = chartData[chartData.length - 1].battery;
        const average = batteryLevels.reduce((a, b) => a + b, 0) / batteryLevels.length;
        const min = Math.min(...batteryLevels);
        const max = Math.max(...batteryLevels);
        const isCharging = chartData[chartData.length - 1].isCharging;
        
        // Calculate charging time
        const chargingReadings = chartData.filter(d => d.isCharging);
        const chargingTime = chargingReadings.length * 5; // Assuming 5 min intervals

        setStats({
          current: Math.round(current),
          average: Math.round(average),
          min: Math.round(min),
          max: Math.round(max),
          isCharging,
          chargingTime
        });
      }

      setData(chartData);
    } catch (error) {
      console.error('Error fetching battery data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getBatteryColor = (level) => {
    if (level >= 80) return { color: '#10b981', bg: 'bg-green-500', text: 'text-green-600', label: 'Excellent' };
    if (level >= 60) return { color: '#22c55e', bg: 'bg-green-400', text: 'text-green-500', label: 'Good' };
    if (level >= 40) return { color: '#eab308', bg: 'bg-yellow-400', text: 'text-yellow-600', label: 'Moderate' };
    if (level >= 20) return { color: '#f59e0b', bg: 'bg-orange-400', text: 'text-orange-600', label: 'Low' };
    return { color: '#ef4444', bg: 'bg-red-500', text: 'text-red-600', label: 'Critical' };
  };

  const getBatteryIcon = (level, isCharging) => {
    if (isCharging) return BatteryCharging;
    if (level >= 60) return Battery;
    if (level >= 20) return BatteryWarning;
    return BatteryLow;
  };

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const batteryInfo = getBatteryColor(data.battery);
      const BatteryIcon = getBatteryIcon(data.battery, data.isCharging);
      
      return (
        <div className="bg-white dark:bg-gray-800 p-4 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            {format(new Date(data.time), 'MMM d, yyyy • HH:mm')}
          </p>
          <div className="flex items-center gap-3 mb-2">
            <BatteryIcon 
              className={`w-6 h-6 ${batteryInfo.text} ${data.isCharging ? 'animate-pulse' : ''}`} 
              fill={data.isCharging ? batteryInfo.color : 'none'}
            />
            <span className="text-3xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
              {data.battery}%
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <Zap className="w-3 h-3 text-gray-400" />
              <span className="text-gray-600 dark:text-gray-300">{data.voltage.toFixed(2)}V</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                data.isCharging 
                  ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' 
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
              }`}>
                {data.isCharging ? '⚡ Charging' : batteryInfo.label}
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-20 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-[300px] bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse flex items-center justify-center">
          <Battery className="w-8 h-8 text-gray-400 animate-pulse" />
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-[400px] flex items-center justify-center">
        <div className="text-center">
          <Battery className="w-12 h-12 mx-auto mb-3 text-gray-400" />
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">No battery data available</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Data will appear once the bot reports battery levels</p>
        </div>
      </div>
    );
  }

  const currentColor = getBatteryColor(stats.current);
  const BatteryIcon = getBatteryIcon(stats.current, stats.isCharging);
  const trend = data.length >= 2 ? data[data.length - 1].battery - data[data.length - 2].battery : 0;

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Current Battery */}
        <Card className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950 border-green-200 dark:border-green-800">
          <div className="flex items-start justify-between mb-2">
            <span className="text-xs font-medium text-green-700 dark:text-green-300">Current</span>
            <BatteryIcon 
              className={`w-5 h-5 ${currentColor.text} ${stats.isCharging ? 'animate-pulse' : ''}`}
              fill={stats.isCharging ? currentColor.color : 'none'}
            />
          </div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-green-900 dark:text-green-100">{stats.current}%</span>
            {trend !== 0 && (
              <span className={`text-xs flex items-center ${trend > 0 ? 'text-green-600' : 'text-red-600'} mb-1`}>
                {trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {Math.abs(trend).toFixed(1)}%
              </span>
            )}
          </div>
          {stats.isCharging && (
            <div className="mt-2 text-xs font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
              <Zap className="w-3 h-3" />
              Charging
            </div>
          )}
        </Card>

        {/* Average */}
        <Card className="p-4 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950 dark:to-cyan-950 border-blue-200 dark:border-blue-800">
          <div className="flex items-start justify-between mb-2">
            <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Average</span>
            <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-blue-500"></div>
            </div>
          </div>
          <span className="text-2xl font-bold text-blue-900 dark:text-blue-100">{stats.average}%</span>
        </Card>

        {/* Min */}
        <Card className="p-4 bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-950 dark:to-red-950 border-orange-200 dark:border-orange-800">
          <div className="flex items-start justify-between mb-2">
            <span className="text-xs font-medium text-orange-700 dark:text-orange-300">Minimum</span>
            <TrendingDown className="w-5 h-5 text-orange-600" />
          </div>
          <span className="text-2xl font-bold text-orange-900 dark:text-orange-100">{stats.min}%</span>
        </Card>

        {/* Max */}
        <Card className="p-4 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950 dark:to-pink-950 border-purple-200 dark:border-purple-800">
          <div className="flex items-start justify-between mb-2">
            <span className="text-xs font-medium text-purple-700 dark:text-purple-300">Maximum</span>
            <TrendingUp className="w-5 h-5 text-purple-600" />
          </div>
          <span className="text-2xl font-bold text-purple-900 dark:text-purple-100">{stats.max}%</span>
        </Card>
      </div>

      {/* Chart */}
      <div className="w-full h-[320px] bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="batteryGradientGreen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.4}/>
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.05}/>
              </linearGradient>
              <linearGradient id="batteryGradientYellow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#eab308" stopOpacity={0.4}/>
                <stop offset="100%" stopColor="#eab308" stopOpacity={0.05}/>
              </linearGradient>
              <linearGradient id="batteryGradientRed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4}/>
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:opacity-20" />
            <XAxis 
              dataKey="timeLabel" 
              stroke="#9ca3af"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis 
              domain={[0, 100]}
              stroke="#9ca3af"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#6b7280', strokeWidth: 1, strokeDasharray: '5 5' }} />
            
            {/* Reference zones */}
            <ReferenceLine y={20} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1.5} opacity={0.5} label={{ value: 'Critical', position: 'insideTopRight', fill: '#ef4444', fontSize: 10 }} />
            <ReferenceLine y={40} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1} opacity={0.3} />
            <ReferenceLine y={60} stroke="#eab308" strokeDasharray="3 3" strokeWidth={1} opacity={0.3} />
            <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="3 3" strokeWidth={1} opacity={0.3} />
            
            <Area
              type="monotone"
              dataKey="battery"
              stroke="#10b981"
              strokeWidth={3}
              fill={`url(#batteryGradient${stats.current >= 60 ? 'Green' : stats.current >= 20 ? 'Yellow' : 'Red'})`}
              isAnimationActive={true}
              animationDuration={1000}
              dot={false}
              activeDot={{ r: 6, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
