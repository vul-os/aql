import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Loader2, Scissors, Clock, Ruler, Battery, MapPin, AlertTriangle, TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { format, formatDuration, intervalToDuration } from 'date-fns';

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

  return (
    <div className="space-y-4">
      {/* Statistics Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sessions.length}</div>
            <p className="text-xs text-muted-foreground">
              {completedSessions.length} completed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Ruler className="h-4 w-4" />
              Area Covered
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalArea.toFixed(1)} m²</div>
            <p className="text-xs text-muted-foreground">
              Avg: {avgArea.toFixed(1)} m² per session
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Distance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(totalDistance / 1000).toFixed(2)} km</div>
            <p className="text-xs text-muted-foreground">
              Total traveled
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Success Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {sessions.length > 0 ? ((completedSessions.length / sessions.length) * 100).toFixed(0) : 0}%
            </div>
            <p className="text-xs text-muted-foreground">
              Completion rate
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sessions List */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Sessions</CardTitle>
          <CardDescription>Last 20 mowing sessions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {sessions.map((session) => (
              <div 
                key={session.id}
                className="flex items-start justify-between p-4 border rounded-lg hover:bg-accent transition-colors cursor-pointer"
                onClick={() => setSelectedSession(session.id === selectedSession ? null : session.id)}
              >
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <Scissors className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">
                      {format(new Date(session.session_start), 'MMM d, yyyy h:mm a')}
                    </span>
                    {getStatusBadge(session.completion_status)}
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2 text-sm">
                    {session.duration_minutes && (
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">{session.duration_minutes} min</span>
                      </div>
                    )}
                    
                    {session.area_covered_sqm && (
                      <div className="flex items-center gap-1">
                        <Ruler className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">{session.area_covered_sqm.toFixed(1)} m²</span>
                      </div>
                    )}
                    
                    {session.battery_end_percentage !== null && (
                      <div className="flex items-center gap-1">
                        <Battery className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {session.battery_start_percentage}% → {session.battery_end_percentage}%
                        </span>
                      </div>
                    )}
                    
                    {session.distance_traveled_meters && (
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">{session.distance_traveled_meters.toFixed(0)} m</span>
                      </div>
                    )}
                  </div>

                  {/* Expanded Details */}
                  {selectedSession === session.id && session.notes && (
                    <div className="mt-3 pt-3 border-t text-sm text-muted-foreground">
                      <p><strong>Notes:</strong> {session.notes}</p>
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


