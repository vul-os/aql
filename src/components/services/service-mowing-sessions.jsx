import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Loader2, Scissors, Clock, Ruler, Battery, MapPin, AlertTriangle, TrendingUp, Target, Activity, ChevronDown, ChevronUp } from 'lucide-react';
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
  const [showAll, setShowAll] = useState(false);
  const INITIAL_DISPLAY_COUNT = 5;

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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
          <CardHeader className="pb-2 pt-4">
            <div className="flex items-center justify-between mb-2">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Sessions
              </CardTitle>
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-botkorp-orange/20 to-botkorp-orange/10 dark:from-botkorp-orange/30 dark:to-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                <Activity className="h-4 w-4 text-botkorp-orange" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-3xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{sessions.length}</div>
            <p className="text-[10px] text-muted-foreground mt-1 font-medium">
              {completedSessions.length} completed successfully
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
          <CardHeader className="pb-2 pt-4">
            <div className="flex items-center justify-between mb-2">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Coverage
              </CardTitle>
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#4F5D75]/20 to-[#4F5D75]/10 dark:from-[#4F5D75]/30 dark:to-[#4F5D75]/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                <Ruler className="h-4 w-4 text-[#4F5D75]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-3xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{totalArea.toFixed(1)}</div>
            <p className="text-[10px] text-muted-foreground mt-1 font-medium">
              m² total • Avg: {avgArea.toFixed(1)} m²
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
          <CardHeader className="pb-2 pt-4">
            <div className="flex items-center justify-between mb-2">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Distance
              </CardTitle>
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#10B981]/20 to-[#10B981]/10 dark:from-[#10B981]/30 dark:to-[#10B981]/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                <MapPin className="h-4 w-4 text-[#10B981]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-3xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{(totalDistance / 1000).toFixed(2)}</div>
            <p className="text-[10px] text-muted-foreground mt-1 font-medium">
              km total traveled
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
          <CardHeader className="pb-2 pt-4">
            <div className="flex items-center justify-between mb-2">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Success Rate
              </CardTitle>
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#FF6B35]/20 to-[#FF6B35]/10 dark:from-[#FF6B35]/30 dark:to-[#FF6B35]/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                <Target className="h-4 w-4 text-[#FF6B35]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-3xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{successRate.toFixed(0)}%</div>
            <p className="text-[10px] text-muted-foreground mt-1 font-medium">
              {completedSessions.length} of {sessions.length} completed
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Performance Trends Chart */}
      {performanceData.length > 0 && (
        <Card className="border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 rounded-3xl">
          <CardHeader className="pb-3 pt-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-botkorp-orange/20 to-botkorp-orange/10 dark:from-botkorp-orange/30 dark:to-botkorp-orange/20 flex items-center justify-center shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                  <TrendingUp className="h-5 w-5 text-botkorp-orange" />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold">Performance Trends</CardTitle>
                  <CardDescription className="text-[10px] font-medium">Coverage and efficiency over recent sessions</CardDescription>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] border-0 bg-botkorp-orange/10 text-botkorp-orange font-semibold px-3 rounded-full">
                Last 10 Sessions
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-4 pb-5">
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={performanceData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#FF6B35" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#FF6B35" stopOpacity={0.1}/>
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
                  stroke="#FF6B35" 
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
      <Card className="border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 rounded-3xl">
        <CardHeader className="pb-3 pt-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-botkorp-orange/20 to-botkorp-orange/10 dark:from-botkorp-orange/30 dark:to-botkorp-orange/20 flex items-center justify-center shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                <Scissors className="h-5 w-5 text-botkorp-orange" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold">Recent Sessions</CardTitle>
                <CardDescription className="text-[10px] font-medium">Detailed history of mowing activities</CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] border-0 bg-botkorp-orange/10 text-botkorp-orange font-semibold px-3 rounded-full">
              {sessions.length} Total
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-4 pb-5">
          <div className="space-y-2.5">
            {/* Sessions List - Show limited initially */}
            {(showAll ? sessions : sessions.slice(0, INITIAL_DISPLAY_COUNT)).map((session, index) => (
              <div 
                key={session.id}
                className="relative flex items-start justify-between p-4 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgb(0,0,0,0.08)] transition-all duration-300 cursor-pointer animate-in fade-in slide-in-from-bottom-2 border-0"
                style={{ 
                  animationDelay: `${index * 30}ms`
                }}
                onClick={() => setSelectedSession(session.id === selectedSession ? null : session.id)}
              >
                
                <div className="space-y-2 flex-1 relative">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Scissors className="h-3.5 w-3.5 text-[#FF6B35]" />
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

          {/* See More / Show Less Button */}
          {sessions.length > INITIAL_DISPLAY_COUNT && (
            <div className="mt-4 pt-4 border-t border-border/50">
              <Button
                variant="ghost"
                onClick={() => setShowAll(!showAll)}
                className="w-full h-11 text-xs font-semibold rounded-2xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300 active:scale-95 hover:bg-botkorp-orange/5 group"
              >
                <div className="flex items-center justify-center gap-2">
                  {showAll ? (
                    <>
                      <ChevronUp className="h-4 w-4 text-[#FF6B35] group-hover:scale-110 transition-transform" />
                      <span className="group-hover:text-[#FF6B35] transition-colors">
                        Show Less
                      </span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4 text-[#FF6B35] group-hover:scale-110 transition-transform" />
                      <span className="group-hover:text-[#FF6B35] transition-colors">
                        See More ({sessions.length - INITIAL_DISPLAY_COUNT} more session{sessions.length - INITIAL_DISPLAY_COUNT !== 1 ? 's' : ''})
                      </span>
                    </>
                  )}
                </div>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


