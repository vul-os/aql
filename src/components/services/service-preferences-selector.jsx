import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Calendar, Clock, Plus, Trash2, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const DAYS_OF_WEEK = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

const TIME_SLOTS = [
  { value: '08:00', label: '8:00 AM' },
  { value: '09:00', label: '9:00 AM' },
  { value: '10:00', label: '10:00 AM' },
  { value: '11:00', label: '11:00 AM' },
  { value: '12:00', label: '12:00 PM' },
  { value: '13:00', label: '1:00 PM' },
  { value: '14:00', label: '2:00 PM' },
  { value: '15:00', label: '3:00 PM' },
  { value: '16:00', label: '4:00 PM' },
  { value: '17:00', label: '5:00 PM' },
];

export default function ServicePreferencesSelector({ serviceId, onSave }) {
  const [preferences, setPreferences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (serviceId) {
      loadPreferences();
    }
  }, [serviceId]);

  const loadPreferences = async () => {
    try {
      const { data, error } = await supabase
        .from('service_preferences')
        .select('*')
        .eq('service_id', serviceId)
        .eq('is_active', true)
        .order('priority');

      if (error) throw error;

      setPreferences(data || []);
    } catch (error) {
      console.error('Error loading preferences:', error);
      toast({
        title: 'Error',
        description: 'Failed to load preferences',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const addPreference = () => {
    const newPref = {
      id: `temp_${Date.now()}`,
      service_id: serviceId,
      day_of_week: 1, // Monday
      time_window_start: '09:00',
      time_window_end: '11:00',
      priority: preferences.length + 1,
      is_active: true,
      isNew: true
    };
    setPreferences([...preferences, newPref]);
  };

  const removePreference = async (pref) => {
    if (pref.isNew) {
      setPreferences(preferences.filter(p => p.id !== pref.id));
    } else {
      try {
        const { error } = await supabase
          .from('service_preferences')
          .update({ is_active: false })
          .eq('id', pref.id);

        if (error) throw error;

        setPreferences(preferences.filter(p => p.id !== pref.id));
        toast({
          title: 'Removed',
          description: 'Preference removed successfully'
        });
      } catch (error) {
        console.error('Error removing preference:', error);
        toast({
          title: 'Error',
          description: 'Failed to remove preference',
          variant: 'destructive'
        });
      }
    }
  };

  const updatePreference = (id, field, value) => {
    setPreferences(preferences.map(p => 
      p.id === id ? { ...p, [field]: value } : p
    ));
  };

  const savePreferences = async () => {
    setSaving(true);
    try {
      const prefsToSave = preferences.map((pref, index) => ({
        service_id: serviceId,
        day_of_week: pref.day_of_week,
        time_window_start: pref.time_window_start,
        time_window_end: pref.time_window_end,
        priority: index + 1,
        is_active: true
      }));

      // Delete old preferences first
      const { error: deleteError } = await supabase
        .from('service_preferences')
        .delete()
        .eq('service_id', serviceId);

      if (deleteError) throw deleteError;

      // Insert new preferences
      const { error: insertError } = await supabase
        .from('service_preferences')
        .insert(prefsToSave);

      if (insertError) throw insertError;

      toast({
        title: 'Success',
        description: 'Service preferences saved successfully'
      });

      await loadPreferences();
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error saving preferences:', error);
      toast({
        title: 'Error',
        description: 'Failed to save preferences',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const getDayLabel = (dayNum) => {
    return DAYS_OF_WEEK.find(d => d.value === dayNum)?.label || 'Unknown';
  };

  if (loading) {
    return <div>Loading preferences...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Service Schedule Preferences
        </CardTitle>
        <CardDescription>
          Choose your preferred days and time windows for service visits. 
          The admin will schedule actual appointments based on your preferences.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {preferences.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="mb-4">No scheduling preferences set yet</p>
            <Button onClick={addPreference}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Preference
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {preferences.map((pref, index) => (
                <div key={pref.id} className="border rounded-lg p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">Preference {index + 1}</Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removePreference(pref)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Day of Week */}
                    <div className="space-y-2">
                      <Label>Day of Week</Label>
                      <Select
                        value={pref.day_of_week.toString()}
                        onValueChange={(value) => updatePreference(pref.id, 'day_of_week', parseInt(value))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DAYS_OF_WEEK.map(day => (
                            <SelectItem key={day.value} value={day.value.toString()}>
                              {day.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Start Time */}
                    <div className="space-y-2">
                      <Label>Start Time</Label>
                      <Select
                        value={pref.time_window_start}
                        onValueChange={(value) => updatePreference(pref.id, 'time_window_start', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TIME_SLOTS.map(slot => (
                            <SelectItem key={slot.value} value={slot.value}>
                              {slot.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* End Time */}
                    <div className="space-y-2">
                      <Label>End Time</Label>
                      <Select
                        value={pref.time_window_end}
                        onValueChange={(value) => updatePreference(pref.id, 'time_window_end', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TIME_SLOTS.filter(slot => slot.value > pref.time_window_start).map(slot => (
                            <SelectItem key={slot.value} value={slot.value}>
                              {slot.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>
                      {getDayLabel(pref.day_of_week)}s between{' '}
                      {TIME_SLOTS.find(t => t.value === pref.time_window_start)?.label} and{' '}
                      {TIME_SLOTS.find(t => t.value === pref.time_window_end)?.label}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-4 border-t">
              <Button variant="outline" onClick={addPreference}>
                <Plus className="h-4 w-4 mr-2" />
                Add Another Day
              </Button>
              <Button onClick={savePreferences} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : 'Save Preferences'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

