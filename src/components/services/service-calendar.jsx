import React, { useState, useEffect } from 'react';
import { Calendar, MapPin, Clock, CheckCircle, XCircle, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const STATUS_COLORS = {
  scheduled: 'bg-blue-100 text-blue-800 border-blue-300',
  confirmed: 'bg-green-100 text-green-800 border-green-300',
  in_progress: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  completed: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  cancelled: 'bg-gray-100 text-gray-800 border-gray-300',
  no_show: 'bg-red-100 text-red-800 border-red-300'
};

const STATUS_ICONS = {
  scheduled: Clock,
  confirmed: CheckCircle,
  in_progress: AlertCircle,
  completed: CheckCircle,
  cancelled: XCircle,
  no_show: XCircle
};

export default function ServiceCalendar() {
  const { selectedOrg } = useAuth();
  const { toast } = useToast();
  
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarData, setCalendarData] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [loading, setLoading] = useState(true);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  useEffect(() => {
    if (selectedOrg) {
      loadCalendarData();
    }
  }, [selectedOrg, year, month]);

  const loadCalendarData = async () => {
    setLoading(true);
    try {
      // Load calendar appointments
      const { data: calData, error: calError } = await supabase
        .rpc('get_service_calendar_for_month', {
          p_year: year,
          p_month: month,
          p_organization_id: selectedOrg.organization_id
        });

      if (calError) throw calError;
      setCalendarData(calData || []);

      // Load statistics
      const { data: stats, error: statsError } = await supabase
        .rpc('get_monthly_service_statistics', {
          p_year: year,
          p_month: month,
          p_organization_id: selectedOrg.organization_id
        });

      if (statsError) throw statsError;
      setStatistics(stats);

    } catch (error) {
      console.error('Error loading calendar:', error);
      toast({
        title: 'Error Loading Calendar',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const getDaysInMonth = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];
    
    // Add empty cells for days before the month starts
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push({ date: null, appointments: [] });
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayData = calendarData.find(d => d.appointment_date === dateStr);
      
      days.push({
        date: day,
        fullDate: dateStr,
        appointments: dayData?.appointments || [],
        isToday: dateStr === new Date().toISOString().split('T')[0]
      });
    }

    return days;
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const days = getDaysInMonth();

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500">Loading calendar...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold">Service Calendar</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToPreviousMonth}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToToday}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={goToNextMonth}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <div className="ml-4 text-lg font-semibold">
            {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
          </div>
        </div>
      </div>

      {/* Statistics Summary */}
      {statistics && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-gray-600">Total</div>
              <div className="text-2xl font-bold">{statistics.total_appointments}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-emerald-600">Completed</div>
              <div className="text-2xl font-bold text-emerald-700">{statistics.completed}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-blue-600">Scheduled</div>
              <div className="text-2xl font-bold text-blue-700">{statistics.scheduled}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-green-600">Confirmed</div>
              <div className="text-2xl font-bold text-green-700">{statistics.confirmed}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-gray-600">Locations</div>
              <div className="text-2xl font-bold flex items-center gap-1">
                <MapPin className="w-5 h-5 text-gray-500" />
                {statistics.unique_locations}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-gray-600">Avg Duration</div>
              <div className="text-2xl font-bold">{statistics.avg_duration_minutes || 0}m</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Calendar Grid */}
      <Card>
        <CardContent className="p-6">
          {/* Day Headers */}
          <div className="grid grid-cols-7 gap-2 mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-center text-sm font-semibold text-gray-600 py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Days */}
          <div className="grid grid-cols-7 gap-2">
            {days.map((day, index) => (
              <div
                key={index}
                className={`
                  min-h-[120px] border rounded-lg p-2 
                  ${day.date ? 'bg-white hover:bg-gray-50' : 'bg-gray-50'}
                  ${day.isToday ? 'ring-2 ring-primary' : ''}
                `}
              >
                {day.date && (
                  <>
                    <div className={`
                      text-sm font-semibold mb-2
                      ${day.isToday ? 'text-primary' : 'text-gray-700'}
                    `}>
                      {day.date}
                    </div>
                    
                    {/* Appointments */}
                    <div className="space-y-1">
                      {day.appointments.slice(0, 3).map((apt, idx) => {
                        const StatusIcon = STATUS_ICONS[apt.status];
                        return (
                          <div
                            key={idx}
                            className={`
                              text-xs p-1 rounded border
                              ${STATUS_COLORS[apt.status] || 'bg-gray-100'}
                              cursor-pointer hover:shadow-sm
                            `}
                            title={`${apt.location_name} - ${apt.service_name}`}
                          >
                            <div className="flex items-start gap-1">
                              <StatusIcon className="w-3 h-3 mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">
                                  {formatTime(apt.start_time)}
                                </div>
                                <div className="truncate text-[10px] opacity-80">
                                  {apt.location_name}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {day.appointments.length > 3 && (
                        <div className="text-[10px] text-gray-500 text-center">
                          +{day.appointments.length - 3} more
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4">
            <div className="text-sm font-semibold text-gray-700">Status Legend:</div>
            {Object.entries(STATUS_COLORS).map(([status, colorClass]) => {
              const StatusIcon = STATUS_ICONS[status];
              return (
                <div key={status} className="flex items-center gap-2">
                  <div className={`px-2 py-1 rounded border text-xs ${colorClass} flex items-center gap-1`}>
                    <StatusIcon className="w-3 h-3" />
                    {status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

