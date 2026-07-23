import React, { useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Calendar, 
  Clock, 
  MapPin, 
  Edit, 
  Trash2, 
  Pause, 
  Play,
  Info,
  Plus,
  Loader2
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function SchedulesPage() {
  const navigate = useNavigate();
  const { selectedOrg } = useOutletContext();
  const { toast } = useToast();
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (selectedOrg?.organization_id) {
      loadSchedules();
    }
  }, [selectedOrg]);

  const loadSchedules = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('service_schedules')
        .select(`
          *,
          locations (
            id,
            name,
            address
          ),
          gardens (
            id,
            name,
            area_sqm
          ),
          pools (
            id,
            name
          )
        `)
        .eq('organization_id', selectedOrg.organization_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      setSchedules(data || []);
    } catch (error) {
      console.error('Error loading schedules:', error);
      toast({
        title: 'Error',
        description: 'Failed to load schedules',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const togglePause = async (schedule) => {
    try {
      const { error } = await supabase
        .from('service_schedules')
        .update({ is_paused: !schedule.is_paused })
        .eq('id', schedule.id);

      if (error) throw error;

      toast({
        title: schedule.is_paused ? 'Schedule Resumed' : 'Schedule Paused',
        description: schedule.is_paused 
          ? 'Your service schedule has been resumed'
          : 'Your service schedule has been paused'
      });

      loadSchedules();
    } catch (error) {
      console.error('Error toggling pause:', error);
      toast({
        title: 'Error',
        description: 'Failed to update schedule',
        variant: 'destructive'
      });
    }
  };

  const deleteSchedule = async (scheduleId) => {
    if (!confirm('Are you sure you want to delete this schedule?')) return;

    try {
      const { error } = await supabase
        .from('service_schedules')
        .delete()
        .eq('id', scheduleId);

      if (error) throw error;

      toast({
        title: 'Schedule Deleted',
        description: 'The service schedule has been removed'
      });

      loadSchedules();
    } catch (error) {
      console.error('Error deleting schedule:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete schedule',
        variant: 'destructive'
      });
    }
  };

  const formatTime = (time) => {
    if (!time) return '';
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const formatScheduleDays = (schedule) => {
    const parts = [];
    
    if (schedule.schedule_type === 'weekly' || schedule.schedule_type === 'mixed') {
      if (schedule.weekly_days?.length > 0) {
        const days = schedule.weekly_days
          .map(d => DAYS_OF_WEEK[d])
          .join(', ');
        parts.push(`Every ${days}`);
      }
    }
    
    if (schedule.schedule_type === 'monthly' || schedule.schedule_type === 'mixed') {
      if (schedule.monthly_days?.length > 0) {
        const ordinal = (n) => {
          const s = ['th', 'st', 'nd', 'rd'];
          const v = n % 100;
          return n + (s[(v - 20) % 10] || s[v] || s[0]);
        };
        const days = schedule.monthly_days.map(d => ordinal(d)).join(', ');
        parts.push(`${days} of month`);
      }
    }
    
    return parts.join(' and ') || 'No schedule';
  };

  const formatNextService = (date) => {
    if (!date) return 'Not scheduled';
    
    const serviceDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const diffTime = serviceDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays < 7) return `In ${diffDays} days`;
    
    return serviceDate.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: serviceDate.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
    });
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Service Schedules</h1>
          <p className="text-muted-foreground">
            Manage your recurring service schedules
          </p>
        </div>
        <Button onClick={() => navigate('/portal/services/add')}>
          <Plus className="h-4 w-4 mr-2" />
          Add Service
        </Button>
      </div>

      {/* Info Alert */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>Service schedules are automatically created when you add a new service.</strong> You cannot create a schedule without a service first. 
          Once you've added a service (lawn, pool, security), you can manage its schedule here.
        </AlertDescription>
      </Alert>

      {/* Schedules List */}
      {schedules.length === 0 ? (
        <Card className="border-2 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-6">
            <div className="rounded-full bg-primary/10 p-8">
              <Calendar className="h-16 w-16 text-primary" />
            </div>
            <div className="space-y-3 max-w-xl">
              <h3 className="text-3xl font-bold">No Service Schedules Yet</h3>
              <p className="text-muted-foreground text-lg">
                Schedules are created automatically when you add a service. 
                Start by adding your first service (lawn, pool, or security), 
                and its schedule will appear here for you to manage.
              </p>
            </div>
            
            <Alert className="max-w-xl">
              <Info className="h-4 w-4" />
              <AlertDescription>
                <strong>Note:</strong> You must have a location and service before you can schedule anything. 
                Services come with built-in schedules that you can customize.
              </AlertDescription>
            </Alert>

            <Button size="lg" onClick={() => navigate('/portal/services/add')} className="text-lg px-8 py-6">
              <Plus className="h-6 w-6 mr-2" />
              Add Your First Service
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {schedules.map((schedule) => (
            <Card 
              key={schedule.id}
              className={cn(
                "transition-all hover:shadow-lg",
                schedule.is_paused && "opacity-60"
              )}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      <MapPin className="h-5 w-5 text-primary" />
                      {schedule.locations?.name}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {schedule.locations?.address}
                    </CardDescription>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => togglePause(schedule)}
                      title={schedule.is_paused ? 'Resume' : 'Pause'}
                    >
                      {schedule.is_paused ? (
                        <Play className="h-4 w-4" />
                      ) : (
                        <Pause className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteSchedule(schedule.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                {/* Service Info */}
                <div className="flex items-center justify-between pb-3 border-b">
                  <div>
                    <p className="text-sm text-muted-foreground">Service Area</p>
                    <p className="font-medium">
                      {schedule.gardens?.name || schedule.pools?.name || 'Unknown'}
                    </p>
                    {schedule.gardens?.area_sqm && (
                      <p className="text-xs text-muted-foreground">
                        {schedule.gardens.area_sqm} m²
                      </p>
                    )}
                  </div>
                  <Badge variant={schedule.is_paused ? 'secondary' : 'default'}>
                    {schedule.is_paused ? 'Paused' : 'Active'}
                  </Badge>
                </div>

                {/* Schedule Details */}
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Schedule</p>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm">{formatScheduleDays(schedule)}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Time</p>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm">{formatTime(schedule.preferred_time)}</p>
                    </div>
                  </div>

                  {/* Next Service */}
                  <div className="pt-3 border-t">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Next Service</span>
                      <span className={cn(
                        "text-sm font-medium",
                        schedule.is_paused ? "text-muted-foreground" : "text-primary"
                      )}>
                        {schedule.is_paused ? 'Paused' : formatNextService(schedule.next_service_date)}
                      </span>
                    </div>
                  </div>

                  {/* Usage Stats */}
                  <div className="pt-3 border-t">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">This Month</span>
                      <span>
                        <span className="font-medium">{schedule.services_used_this_month}</span>
                        <span className="text-muted-foreground"> / {schedule.max_services_per_month}</span>
                      </span>
                    </div>
                    <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary transition-all"
                        style={{ 
                          width: `${Math.min((schedule.services_used_this_month / schedule.max_services_per_month) * 100, 100)}%` 
                        }}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

