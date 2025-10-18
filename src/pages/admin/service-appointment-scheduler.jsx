import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Calendar as CalendarIcon, Clock, Plus, ChevronLeft, ChevronRight, MapPin, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import PageHeader from '@/components/ui/page-header';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, parseISO } from 'date-fns';

export default function ServiceAppointmentScheduler() {
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [appointments, setAppointments] = useState([]);
  const [preferences, setPreferences] = useState([]);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [bots, setBots] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const [newAppointment, setNewAppointment] = useState({
    start_time: '09:00',
    end_time: '11:00',
    assigned_bot_id: null,
    notes: ''
  });

  useEffect(() => {
    loadServices();
    loadBots();
  }, []);

  useEffect(() => {
    if (selectedService) {
      loadAppointments();
      loadPreferences();
    }
  }, [selectedService, currentMonth]);

  const loadServices = async () => {
    try {
      const { data, error } = await supabase
        .from('services')
        .select(`
          *,
          locations(name, city, address),
          organizations(name)
        `)
        .eq('is_active', true)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setServices(data || []);
      if (data && data.length > 0) {
        setSelectedService(data[0]);
      }
    } catch (error) {
      console.error('Error loading services:', error);
      toast({
        title: 'Error',
        description: 'Failed to load services',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadAppointments = async () => {
    if (!selectedService) return;

    try {
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth() + 1;

      const { data, error } = await supabase
        .rpc('get_service_appointments_for_month', {
          p_service_id: selectedService.id,
          p_year: year,
          p_month: month
        });

      if (error) throw error;
      setAppointments(data || []);
    } catch (error) {
      console.error('Error loading appointments:', error);
    }
  };

  const loadPreferences = async () => {
    if (!selectedService) return;

    try {
      const { data, error } = await supabase
        .from('service_preferences')
        .select('*')
        .eq('service_id', selectedService.id)
        .eq('is_active', true)
        .order('priority');

      if (error) throw error;
      setPreferences(data || []);
    } catch (error) {
      console.error('Error loading preferences:', error);
    }
  };

  const loadBots = async () => {
    try {
      const { data, error } = await supabase
        .from('bots')
        .select('id, name, bot_type')
        .eq('is_enabled', true)
        .order('name');

      if (error) throw error;
      setBots(data || []);
    } catch (error) {
      console.error('Error loading bots:', error);
    }
  };

  const handleScheduleAppointment = async () => {
    if (!selectedService || !selectedDate) return;

    try {
      const { data, error } = await supabase.rpc('schedule_service_appointment', {
        p_service_id: selectedService.id,
        p_appointment_date: format(selectedDate, 'yyyy-MM-dd'),
        p_start_time: newAppointment.start_time,
        p_end_time: newAppointment.end_time,
        p_assigned_bot_id: newAppointment.assigned_bot_id || null,
        p_assigned_technician_id: null,
        p_created_by: (await supabase.auth.getUser()).data.user.id,
        p_notes: newAppointment.notes || null
      });

      if (error) throw error;

      const result = typeof data === 'string' ? JSON.parse(data) : data;

      if (result.success) {
        toast({
          title: 'Success',
          description: 'Appointment scheduled successfully'
        });
        setShowScheduleDialog(false);
        setNewAppointment({
          start_time: '09:00',
          end_time: '11:00',
          assigned_bot_id: null,
          notes: ''
        });
        loadAppointments();
      } else {
        throw new Error(result.error || 'Failed to schedule appointment');
      }
    } catch (error) {
      console.error('Error scheduling appointment:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to schedule appointment',
        variant: 'destructive'
      });
    }
  };

  const getAppointmentsForDate = (date) => {
    return appointments.filter(apt => 
      isSameDay(parseISO(apt.appointment_date), date)
    );
  };

  const getPreferencesForDate = (date) => {
    const dayOfWeek = date.getDay();
    return preferences.filter(pref => pref.day_of_week === dayOfWeek);
  };

  const getDayName = (dayNum) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayNum];
  };

  const getStatusColor = (status) => {
    const colors = {
      scheduled: 'bg-blue-100 text-blue-800',
      confirmed: 'bg-green-100 text-green-800',
      in_progress: 'bg-purple-100 text-purple-800',
      completed: 'bg-gray-100 text-gray-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="Service Appointment Scheduler"
        subtitle="Allocate appointment dates and times for customer services"
        icon={<CalendarIcon className="h-6 w-6 text-primary" />}
      />

      {/* Service Selector */}
      <Card>
        <CardHeader>
          <CardTitle>Select Service</CardTitle>
          <CardDescription>Choose a service to manage appointments</CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={selectedService?.id}
            onValueChange={(id) => {
              const service = services.find(s => s.id === id);
              setSelectedService(service);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a service" />
            </SelectTrigger>
            <SelectContent>
              {services.map(service => (
                <SelectItem key={service.id} value={service.id}>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    {service.name} - {service.locations?.name} ({service.service_frequency}, {service.services_per_month}/month)
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedService && (
            <div className="mt-4 p-4 bg-muted rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{selectedService.name}</span>
                <Badge>{selectedService.status}</Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                <p>Location: {selectedService.locations?.name}, {selectedService.locations?.city}</p>
                <p>Frequency: {selectedService.services_per_month} services per month</p>
                <p>Organization: {selectedService.organizations?.name}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedService && (
        <>
          {/* Customer Preferences */}
          {preferences.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Customer Preferences</CardTitle>
                <CardDescription>Preferred days and time windows</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {preferences.map((pref, index) => (
                    <Badge key={index} variant="outline" className="text-sm py-2">
                      <Clock className="h-3 w-3 mr-1" />
                      {getDayName(pref.day_of_week)} {pref.time_window_start}-{pref.time_window_end}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Calendar */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>
                  {format(currentMonth, 'MMMM yyyy')}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setCurrentMonth(new Date())}
                  >
                    Today
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-2">
                {/* Day headers */}
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="text-center font-semibold text-sm text-muted-foreground py-2">
                    {day}
                  </div>
                ))}

                {/* Calendar days */}
                {daysInMonth.map((date, index) => {
                  const dayAppointments = getAppointmentsForDate(date);
                  const dayPreferences = getPreferencesForDate(date);
                  const isToday = isSameDay(date, new Date());

                  return (
                    <div
                      key={index}
                      className={`
                        min-h-[100px] border rounded-lg p-2 cursor-pointer hover:border-primary transition-colors
                        ${!isSameMonth(date, currentMonth) ? 'opacity-40' : ''}
                        ${isToday ? 'border-primary border-2' : ''}
                        ${dayPreferences.length > 0 ? 'bg-blue-50 dark:bg-blue-950/20' : ''}
                      `}
                      onClick={() => {
                        setSelectedDate(date);
                        setShowScheduleDialog(true);
                      }}
                    >
                      <div className="font-semibold text-sm mb-1">
                        {format(date, 'd')}
                      </div>

                      {/* Appointments */}
                      <div className="space-y-1">
                        {dayAppointments.map(apt => (
                          <div
                            key={apt.appointment_id}
                            className={`text-xs p-1 rounded ${getStatusColor(apt.status)}`}
                          >
                            {apt.start_time.slice(0, 5)} - {apt.end_time.slice(0, 5)}
                          </div>
                        ))}
                      </div>

                      {/* Preference indicator */}
                      {dayPreferences.length > 0 && dayAppointments.length === 0 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          <Clock className="h-3 w-3 inline" /> Available
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Schedule Appointment Dialog */}
      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Appointment</DialogTitle>
            <DialogDescription>
              {selectedDate && format(selectedDate, 'EEEE, MMMM d, yyyy')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Customer preferences for this day */}
            {selectedDate && getPreferencesForDate(selectedDate).length > 0 && (
              <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                <div className="text-sm font-semibold mb-2">Customer Preferences:</div>
                {getPreferencesForDate(selectedDate).map((pref, index) => (
                  <div key={index} className="text-sm text-muted-foreground">
                    {pref.time_window_start} - {pref.time_window_end}
                  </div>
                ))}
              </div>
            )}

            {/* Existing appointments */}
            {selectedDate && getAppointmentsForDate(selectedDate).length > 0 && (
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-sm font-semibold mb-2">Existing Appointments:</div>
                {getAppointmentsForDate(selectedDate).map((apt, index) => (
                  <div key={index} className="text-sm flex items-center justify-between">
                    <span>{apt.start_time.slice(0, 5)} - {apt.end_time.slice(0, 5)}</span>
                    <Badge variant="outline">{apt.status}</Badge>
                  </div>
                ))}
              </div>
            )}

            {/* Time Selection */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Time</Label>
                <Input
                  type="time"
                  value={newAppointment.start_time}
                  onChange={(e) => setNewAppointment({ ...newAppointment, start_time: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={newAppointment.end_time}
                  onChange={(e) => setNewAppointment({ ...newAppointment, end_time: e.target.value })}
                />
              </div>
            </div>

            {/* Bot Assignment */}
            <div className="space-y-2">
              <Label>Assign Bot (Optional)</Label>
              <Select
                value={newAppointment.assigned_bot_id || 'none'}
                onValueChange={(value) => setNewAppointment({ ...newAppointment, assigned_bot_id: value === 'none' ? null : value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a bot" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No bot assigned</SelectItem>
                  {bots.map(bot => (
                    <SelectItem key={bot.id} value={bot.id}>
                      {bot.name} ({bot.bot_type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Input
                value={newAppointment.notes}
                onChange={(e) => setNewAppointment({ ...newAppointment, notes: e.target.value })}
                placeholder="Any additional notes..."
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowScheduleDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleScheduleAppointment}>
                Schedule Appointment
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

