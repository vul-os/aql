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
  ArrowLeft,
  Sprout,
  MapPin,
  Ruler,
  Calendar,
  Bot,
  TrendingUp,
  Activity,
  AlertTriangle
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

export default function GardenDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [garden, setGarden] = useState(null);
  const [location, setLocation] = useState(null);
  const [assignedBots, setAssignedBots] = useState([]);
  const [recentSessions, setRecentSessions] = useState([]);
  const [loading, setLoading] = useState(true);

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

      if (error) throw error;

      if (!data) {
        toast({
          title: "Not found",
          description: "Garden not found",
          variant: "destructive"
        });
        navigate('/portal/services');
        return;
      }

      setGarden(data.garden);
      setLocation(data.location);
      setAssignedBots(data.assigned_bots || []);
      setRecentSessions(data.recent_sessions || []);

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
        {garden.requires_maintenance && (
          <Badge variant="destructive">Requires Maintenance</Badge>
        )}
        {garden.is_active && (
          <Badge variant="outline">Active</Badge>
        )}
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            <div className="space-y-1">
              <InfoRow
                label="Area"
                value={garden.area_sqm ? `${garden.area_sqm} m²` : null}
                icon={<Ruler className="h-4 w-4" />}
              />
              <Separator />
              <InfoRow
                label="Perimeter"
                value={garden.perimeter_m ? `${garden.perimeter_m} m` : null}
                icon={<Ruler className="h-4 w-4" />}
              />
              <Separator />
              <InfoRow
                label="Grass Type"
                value={garden.grass_type}
                icon={<Sprout className="h-4 w-4" />}
              />
              <Separator />
              <InfoRow
                label="Terrain Type"
                value={garden.terrain_type ? garden.terrain_type.charAt(0).toUpperCase() + garden.terrain_type.slice(1) : null}
              />
              <Separator />
              <InfoRow
                label="Difficulty Level"
                value={garden.difficulty_level ? garden.difficulty_level.charAt(0).toUpperCase() + garden.difficulty_level.slice(1) : null}
              />
            </div>

            <div className="space-y-1">
              <InfoRow
                label="Preferred Cut Height"
                value={garden.preferred_cut_height_mm ? `${garden.preferred_cut_height_mm} mm` : null}
              />
              <Separator />
              <InfoRow
                label="Preferred Pattern"
                value={garden.preferred_pattern ? garden.preferred_pattern.charAt(0).toUpperCase() + garden.preferred_pattern.slice(1) : null}
              />
              <Separator />
              <InfoRow
                label="Mowing Frequency"
                value={garden.mowing_frequency_days ? `Every ${garden.mowing_frequency_days} days` : null}
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
    </div>
  );
}

