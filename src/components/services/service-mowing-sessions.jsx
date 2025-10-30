import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Loader2, Scissors, Clock, Ruler, Battery, MapPin, AlertTriangle, TrendingUp, Target, Activity } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { format, formatDuration, intervalToDuration } from 'date-fns';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

/**
 * Custom Tooltip for Session Charts
 */
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white dark:bg-slate-800 p-3 rounded-lg shadow-lg border border-border">
        <p className="text-xs font-semibold mb-2">
          {label}
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
 * Service Mowing Sessions Component
 * Displays mowing sessions for a garden with performance metrics
 * 
 * This replaces the old bot activity logs with service-specific session data
 */
export default function ServiceMowingSessions({ gardenId }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);

  useEffect(() => {
    if (gardenId) {
      loadMowingSessions();
      // Refresh every 30 seconds
      const interval = setInterval(loadMowingSessions, 30000);
      return () => clearInterval(interval);
    }
  }, [gardenId]);

  const loadMowingSessions = async () => {
    try {
      setError(null);
      
      // Get mowing sessions for the last 30 days
      const { data, error: sessionsError } = await supabase
        .from('garden_mowing_sessions')
        .select('*')
        .eq('garden_id', gardenId)
        .order('session_start', { ascending: false })
        .limit(20);
      
      if (sessionsError) throw sessionsError;
      
      setSessions(data || []);
      setLoading(false);
      
    } catch (err) {
      console.error('Error loading mowing sessions:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const variants = {
      'completed': 'default',
      'active': 'secondary',
      'interrupted': 'destructive',
      'low_battery': 'destructive',
      'rain': 'secondary',
      'error': 'destructive',
      'manual_stop': 'outline'
    };
    return <Badge variant={variants[status] || 'outline'}>{status}</Badge>;
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
        <AlertDescription>Error loading mowing sessions: {error}</AlertDescription>
      </Alert>
    );
  }

  if (sessions.length === 0) {
    return (
      <Alert>
        <AlertDescription>No mowing sessions recorded yet</AlertDescription>
      </Alert>
    );
  }

  // Calculate statistics
  const completedSessions = sessions.filter(s => s.completion_status === 'completed');
  const totalArea = completedSessions.reduce((sum, s) => sum + (s.area_covered_sqm || 0), 0);
  const avgArea = completedSessions.length > 0 ? totalArea / completedSessions.length : 0;
  const totalDistance = completedSessions.reduce((sum, s) => sum + (s.distance_traveled_meters || 0), 0);
  const successRate = sessions.length > 0 ? ((completedSessions.length / sessions.length) * 100) : 0;
  
  // Prepare chart data for performance trends
  const performanceData = sessions.slice(0, 10).reverse().map(session => ({
    date: format(new Date(session.session_start), 'MMM d'),
    area: session.area_covered_sqm || 0,
    duration: session.duration_minutes || 0,
    battery: session.battery_start_percentage - (session.battery_end_percentage || 0)
  }));

  return (
    <div className="space-y-4">
      {/* Enhanced Statistics Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="relative overflow-hidden border-t-4 border-t-botkorp-orange hover:shadow-lg transition-all duration-300">
          <div className="absolute inset-0 bg-botkorp-orange/5 pointer-events-none" />
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-xs font-bold flex items-center gap-1.5 text-botkorp-orange uppercase tracking-wider">
              <Activity className="h-3.5 w-3.5" />
              Sessions
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="text-3xl font-bold tabular-nums">{sessions.length}</div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {completedSessions.length} completed successfully
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-t-4 border-t-blue-500 hover:shadow-lg transition-all duration-300">
          <div className="absolute inset-0 bg-blue-500/5 pointer-events-none" />
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-xs font-bold flex items-center gap-1.5 text-blue-700 dark:text-blue-500 uppercase tracking-wider">
              <Ruler className="h-3.5 w-3.5" />
              Coverage
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="text-3xl font-bold tabular-nums">{totalArea.toFixed(1)}</div>
            <p className="text-[10px] text-muted-foreground mt-1">
              m² total • Avg: {avgArea.toFixed(1)} m²
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-t-4 border-t-green-500 hover:shadow-lg transition-all duration-300">
          <div className="absolute inset-0 bg-green-500/5 pointer-events-none" />
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-xs font-bold flex items-center gap-1.5 text-green-700 dark:text-green-500 uppercase tracking-wider">
              <MapPin className="h-3.5 w-3.5" />
              Distance
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="text-3xl font-bold tabular-nums">{(totalDistance / 1000).toFixed(2)}</div>
            <p className="text-[10px] text-muted-foreground mt-1">
              km total traveled
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-t-4 border-t-purple-500 hover:shadow-lg transition-all duration-300">
          <div className="absolute inset-0 bg-purple-500/5 pointer-events-none" />
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-xs font-bold flex items-center gap-1.5 text-purple-700 dark:text-purple-500 uppercase tracking-wider">
              <Target className="h-3.5 w-3.5" />
              Success Rate
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="text-3xl font-bold tabular-nums">{successRate.toFixed(0)}%</div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {completedSessions.length} of {sessions.length} completed
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Performance Trends Chart */}
      {performanceData.length > 0 && (
        <Card className="border-t-4 border-t-botkorp-orange shadow-md hover:shadow-lg transition-all duration-300">
          <CardHeader className="pb-3 pt-4 bg-gradient-to-r from-botkorp-orange/5 to-transparent">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold">Performance Trends</CardTitle>
                <CardDescription className="text-[10px]">Coverage and efficiency over recent sessions</CardDescription>
              </div>
              <Badge variant="outline" className="text-[10px] border-botkorp-orange/30 bg-botkorp-orange/5">
                Last 10 Sessions
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={performanceData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0.1}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.5} />
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 11 }}
                  stroke="#94a3b8"
                />
                <YAxis 
                  tick={{ fontSize: 11 }}
                  stroke="#94a3b8"
                  label={{ value: 'm²', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#64748b' } }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend 
                  wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                  iconType="circle"
                />
                <Area 
                  type="monotone" 
                  dataKey="area" 
                  stroke="#f97316" 
                  strokeWidth={2}
                  fill="url(#colorArea)"
                  name="Area Covered (m²)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Sessions List */}
      <Card className="border-t-4 border-t-botkorp-orange shadow-md hover:shadow-lg transition-all duration-300">
        <CardHeader className="pb-3 pt-4 bg-gradient-to-r from-botkorp-orange/5 to-transparent">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold">Recent Sessions</CardTitle>
              <CardDescription className="text-[10px]">Detailed history of mowing activities</CardDescription>
            </div>
            <Badge variant="outline" className="text-[10px] border-botkorp-orange/30 bg-botkorp-orange/5">
              {sessions.length} Total
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="space-y-2.5">
            {sessions.map((session, index) => (
              <div 
                key={session.id}
                className="relative flex items-start justify-between p-3 border-l-4 rounded-lg hover:shadow-md transition-all duration-300 cursor-pointer animate-in fade-in slide-in-from-bottom-2"
                style={{ 
                  animationDelay: `${index * 30}ms`,
                  borderLeftColor: session.completion_status === 'completed' ? '#f97316' : '#94a3b8'
                }}
                onClick={() => setSelectedSession(session.id === selectedSession ? null : session.id)}
              >
                <div className="absolute inset-0 bg-botkorp-orange/0 hover:bg-botkorp-orange/5 rounded-lg transition-all pointer-events-none" />
                
                <div className="space-y-2 flex-1 relative">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Scissors className="h-3.5 w-3.5 text-botkorp-orange" />
                    <span className="text-xs font-semibold">
                      {format(new Date(session.session_start), 'MMM d, yyyy h:mm a')}
                    </span>
                    {getStatusBadge(session.completion_status)}
                  </div>
                  
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                    {session.duration_minutes && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Clock className="h-3 w-3 flex-shrink-0" />
                        <span>{session.duration_minutes} min</span>
                      </div>
                    )}
                    
                    {session.area_covered_sqm && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Ruler className="h-3 w-3 flex-shrink-0" />
                        <span>{session.area_covered_sqm.toFixed(1)} m²</span>
                      </div>
                    )}
                    
                    {session.battery_end_percentage !== null && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Battery className="h-3 w-3 flex-shrink-0" />
                        <span>{session.battery_start_percentage}% → {session.battery_end_percentage}%</span>
                      </div>
                    )}
                    
                    {session.distance_traveled_meters && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                        <span>{session.distance_traveled_meters.toFixed(0)} m</span>
                      </div>
                    )}
                  </div>

                  {/* Expanded Details */}
                  {selectedSession === session.id && session.notes && (
                    <div className="mt-2.5 pt-2.5 border-t text-xs">
                      <p className="text-muted-foreground">
                        <strong className="text-foreground">Notes:</strong> {session.notes}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


