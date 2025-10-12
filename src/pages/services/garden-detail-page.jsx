import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft,
  Sprout,
  MapPin,
  Ruler,
  Calendar,
  Bot,
  TrendingUp,
  Activity,
  AlertTriangle,
  Pause,
  Play,
  Loader2,
  AlertOctagon
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

export default function GardenDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [garden, setGarden] = useState(null);
  const [location, setLocation] = useState(null);
  const [assignedBots, setAssignedBots] = useState([]);
  const [recentSessions, setRecentSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pausingService, setPausingService] = useState(false);
  const [showStopBotsDialog, setShowStopBotsDialog] = useState(false);
  const [stoppingBots, setStoppingBots] = useState(false);

  useEffect(() => {
    if (id) {
      loadGardenDetails();
    }
  }, [id]);

  const loadGardenDetails = async () => {
    try {
      setLoading(true);

      // Load garden details using the RPC function
      const { data, error } = await supabase.rpc('get_garden_details', {
        garden_uuid: id
      });

      if (error) {
        console.error('RPC error:', error);
        throw error;
      }

      if (!data) {
        toast({
          title: "Not found",
          description: "Garden not found",
          variant: "destructive"
        });
        navigate('/portal/services');
        return;
      }

      // Parse JSON response if needed
      const parsedData = typeof data === 'string' ? JSON.parse(data) : data;

      setGarden(parsedData.garden);
      setLocation(parsedData.location);
      setAssignedBots(parsedData.assigned_bots || []);
      setRecentSessions(parsedData.recent_sessions || []);

    } catch (error) {
      console.error('Error loading garden:', error);
      toast({
        title: "Error",
        description: "Failed to load garden details",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async () => {
    setPausingService(true);
    try {
      const { error } = await supabase.rpc('pause_garden_service', {
        p_garden_id: id,
        p_user_id: user.id,
        p_reason: 'Paused by user'
      });

      if (error) throw error;

      toast({
        title: 'Service paused',
        description: 'Garden service has been paused. No charges will apply.',
      });

      loadGardenDetails();
    } catch (error) {
      console.error('Error pausing service:', error);
      toast({
        title: 'Failed to pause',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setPausingService(false);
    }
  };

  const handleResume = async () => {
    setPausingService(true);
    try {
      const { error } = await supabase.rpc('resume_garden_service', {
        p_garden_id: id,
        p_user_id: user.id
      });

      if (error) throw error;

      toast({
        title: 'Service resumed',
        description: 'Garden service has been resumed. Billing will continue.',
      });

      loadGardenDetails();
    } catch (error) {
      console.error('Error resuming service:', error);
      toast({
        title: 'Failed to resume',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setPausingService(false);
    }
  };

  const handleStopBots = async () => {
    setStoppingBots(true);
    try {
      // Send stop command to all assigned bots
      const stopCommands = assignedBots.map(bot => ({
        bot_id: bot.id,
        issued_by: user.id,
        command_type: 'stop',
        command_payload: { reason: 'Emergency stop from garden detail page' },
        status: 'pending'
      }));

      const { error } = await supabase
        .from('bot_commands')
        .insert(stopCommands);

      if (error) throw error;

      toast({
        title: 'Stop command sent',
        description: `Stop command sent to ${assignedBots.length} bot${assignedBots.length !== 1 ? 's' : ''}`,
      });

      setShowStopBotsDialog(false);
      loadGardenDetails();
    } catch (error) {
      console.error('Error stopping bots:', error);
      toast({
        title: 'Failed to stop bots',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setStoppingBots(false);
    }
  };

  const InfoRow = ({ label, value, icon }) => (
    <div className="flex items-start gap-3 py-2">
      {icon && <div className="text-muted-foreground mt-0.5">{icon}</div>}
      <div className="flex-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="font-medium">{value || 'Not specified'}</p>
      </div>
    </div>
  );

  const getBotStatusColor = (status) => {
    switch (status) {
      case 'online':
      case 'active':
        return 'default';
      case 'idle':
        return 'secondary';
      case 'charging':
        return 'outline';
      case 'offline':
        return 'secondary';
      case 'error':
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!garden) {
    return (
      <div className="p-4 md:p-6">
        <div className="text-center py-12">
          <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Garden not found</h2>
          <Button onClick={() => navigate('/portal/services')}>
            Back to Services
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/portal/services')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Sprout className="h-6 w-6 text-green-600" />
            <h1 className="text-3xl font-bold tracking-tight">{garden.name}</h1>
          </div>
          {location && (
            <p className="text-muted-foreground flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              {location.name}, {location.city}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {garden.is_paused ? (
            <Badge variant="outline" className="gap-1">
              <Pause className="h-3 w-3" />
              Paused
            </Badge>
          ) : (
            <>
              {garden.requires_maintenance && (
                <Badge variant="destructive">Requires Maintenance</Badge>
              )}
              <Badge variant="default">Active</Badge>
            </>
          )}
          
          {/* Stop Bots Button (Emergency) */}
          {assignedBots.length > 0 && !garden.is_paused && (
            <Button
              variant="destructive"
              onClick={() => setShowStopBotsDialog(true)}
              disabled={stoppingBots}
              className="gap-2"
            >
              {stoppingBots ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <AlertOctagon className="h-4 w-4" />
                  Stop Bots
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Main Info Card */}
      <Card>
        <CardHeader>
          <CardTitle>Garden Information</CardTitle>
          <CardDescription>Details and specifications (read-only)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {garden.description && (
            <>
              <InfoRow
                label="Description"
                value={garden.description}
              />
              <Separator />
            </>
          )}

          <div className="space-y-1">
            <InfoRow
              label="Area"
              value={garden.area_sqm ? `${garden.area_sqm} m²` : null}
              icon={<Ruler className="h-4 w-4" />}
            />
            <Separator />
            <InfoRow
              label="Service Frequency"
              value={garden.service_frequency ? (garden.service_frequency === 'bi-weekly' ? 'Bi-Weekly (Every 2 Weeks)' : 'Monthly (Every 4 Weeks)') : null}
              icon={<Calendar className="h-4 w-4" />}
            />
            <Separator />
            <InfoRow
              label="Last Mowed"
              value={garden.last_mowed_at ? format(new Date(garden.last_mowed_at), 'MMM d, yyyy') : 'Never'}
              icon={<Calendar className="h-4 w-4" />}
            />
            <Separator />
            <InfoRow
              label="Next Scheduled Mow"
              value={garden.next_scheduled_mow ? format(new Date(garden.next_scheduled_mow), 'MMM d, yyyy') : 'Not scheduled'}
              icon={<Calendar className="h-4 w-4" />}
            />
          </div>

          {garden.has_obstacles && (
            <>
              <Separator className="my-4" />
              <InfoRow
                label="Obstacles"
                value={garden.obstacle_description || 'Yes, obstacles present'}
                icon={<AlertTriangle className="h-4 w-4" />}
              />
            </>
          )}

          {garden.notes && (
            <>
              <Separator className="my-4" />
              <InfoRow
                label="Notes"
                value={garden.notes}
              />
            </>
          )}

          <Separator className="my-4" />
          <div className="text-xs text-muted-foreground">
            Created: {format(new Date(garden.created_at), 'MMM d, yyyy')}
            {garden.updated_at && garden.updated_at !== garden.created_at && (
              <> • Updated: {format(new Date(garden.updated_at), 'MMM d, yyyy')}</>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Assigned Bots */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                Assigned Bots
              </CardTitle>
              <CardDescription>Bots currently servicing this garden</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {assignedBots && assignedBots.length > 0 ? (
            <div className="space-y-3">
              {assignedBots.map((assignment) => (
                <div
                  key={assignment.bot.id}
                  className="flex items-center justify-between p-4 rounded-lg border"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold">{assignment.bot.name}</p>
                      <Badge variant={getBotStatusColor(assignment.bot.status)}>
                        {assignment.bot.status}
                      </Badge>
                      {assignment.assignment.is_primary && (
                        <Badge variant="outline">Primary</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {assignment.bot.bot_type.replace('_', ' ')} • Serial: {assignment.bot.serial_number || 'N/A'}
                    </p>
                    <div className="flex gap-4 mt-2 text-sm">
                      <span className="text-muted-foreground">
                        Total Mows: <strong>{assignment.assignment.total_mows || 0}</strong>
                      </span>
                      <span className="text-muted-foreground">
                        Runtime: <strong>{Math.round((assignment.assignment.total_runtime_minutes || 0) / 60)}h</strong>
                      </span>
                      {assignment.assignment.last_mowed_at && (
                        <span className="text-muted-foreground">
                          Last: <strong>{format(new Date(assignment.assignment.last_mowed_at), 'MMM d')}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Bot className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No bots assigned to this garden yet</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Mowing Sessions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Recent Mowing Sessions
          </CardTitle>
          <CardDescription>Latest mowing activity for this garden</CardDescription>
        </CardHeader>
        <CardContent>
          {recentSessions && recentSessions.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Area Mowed</TableHead>
                    <TableHead>Battery Used</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentSessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell>
                        {format(new Date(session.start_time), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        {session.duration_minutes ? `${session.duration_minutes} min` : 'N/A'}
                      </TableCell>
                      <TableCell>
                        {session.area_mowed_sqm ? `${session.area_mowed_sqm} m²` : 'N/A'}
                      </TableCell>
                      <TableCell>
                        {session.battery_used ? `${session.battery_used}%` : 'N/A'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={session.completed_successfully ? 'default' : 'destructive'}>
                          {session.completed_successfully ? 'Completed' : 'Failed'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No mowing sessions recorded yet</p>
            </div>
          )}
        </CardContent>
      </Card>
      {/* Pause/Resume Service - At Bottom */}
      <Card>
        <CardHeader>
          <CardTitle>Service Control</CardTitle>
          <CardDescription>
            {garden.is_paused 
              ? 'Service is currently paused. No charges apply while paused.' 
              : 'Pause this service to stop billing temporarily'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {garden.is_paused ? (
            <div className="space-y-4">
              {garden.paused_at && (
                <div className="p-3 bg-muted/50 rounded text-sm">
                  <p className="text-muted-foreground">
                    Paused since {format(new Date(garden.paused_at), 'MMM d, yyyy')}
                  </p>
                  {garden.pause_reason && (
                    <p className="text-muted-foreground mt-1">
                      Reason: {garden.pause_reason}
                    </p>
                  )}
                </div>
              )}
              <Button
                onClick={handleResume}
                disabled={pausingService}
                size="lg"
                className="w-full gap-2"
              >
                {pausingService ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Resume Service
                  </>
                )}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={handlePause}
              disabled={pausingService}
              size="lg"
              className="w-full gap-2"
            >
              {pausingService ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Pause className="h-4 w-4" />
                  Pause Service
                </>
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Stop Bots Confirmation Dialog */}
      <AlertDialog open={showStopBotsDialog} onOpenChange={setShowStopBotsDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertOctagon className="h-5 w-5" />
              Stop All Bots?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will send an emergency stop command to all {assignedBots.length} bot{assignedBots.length !== 1 ? 's' : ''} servicing this garden.
              The bot{assignedBots.length !== 1 ? 's' : ''} will stop immediately and return to {assignedBots.length !== 1 ? 'their' : 'its'} charging station.
              <div className="mt-3 p-3 bg-destructive/10 border border-destructive/20 rounded">
                <p className="font-semibold text-sm">⚠️ This is an emergency action</p>
                <p className="text-sm mt-1">Only use this if there's an immediate safety concern or emergency.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStopBots}
              className="bg-destructive hover:bg-destructive/90"
              disabled={stoppingBots}
            >
              {stoppingBots ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Stopping...
                </>
              ) : (
                <>
                  <AlertOctagon className="h-4 w-4 mr-2" />
                  Yes, Stop All Bots
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

