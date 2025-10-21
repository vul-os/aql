import React, { useState } from 'react';
import { CheckCircle, Clock, Camera, AlertCircle, Star, FileText } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';

export default function ServiceCompletionForm({ appointment, open, onOpenChange, onComplete }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  
  const [formData, setFormData] = useState({
    service_duration_minutes: '',
    service_notes: '',
    service_quality_rating: 5,
    issues_encountered: '',
    parts_used: '',
    completion_photos: [],
    next_service_recommended_date: ''
  });

  const handleStartWork = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .rpc('start_service_work', {
          p_appointment_id: appointment.id,
          p_technician_id: user.id
        });

      if (error) throw error;
      
      if (data.success) {
        toast({
          title: 'Work Started',
          description: 'Timer started for this service appointment',
        });
        
        if (onComplete) onComplete();
      } else {
        throw new Error(data.error);
      }
      
    } catch (error) {
      console.error('Error starting work:', error);
      toast({
        title: 'Error Starting Work',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEndWork = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .rpc('end_service_work', {
          p_appointment_id: appointment.id
        });

      if (error) throw error;
      
      if (data.success) {
        toast({
          title: 'Work Ended',
          description: `Duration: ${data.actual_duration_minutes} minutes`,
        });
        
        // Update form with actual duration
        setFormData(prev => ({
          ...prev,
          service_duration_minutes: data.actual_duration_minutes
        }));
        
        if (onComplete) onComplete();
      } else {
        throw new Error(data.error);
      }
      
    } catch (error) {
      console.error('Error ending work:', error);
      toast({
        title: 'Error Ending Work',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    try {
      setLoading(true);

      // Parse arrays from comma-separated strings
      const issuesArray = formData.issues_encountered
        ? formData.issues_encountered.split(',').map(s => s.trim()).filter(Boolean)
        : null;
      
      const partsArray = formData.parts_used
        ? formData.parts_used.split(',').map(s => s.trim()).filter(Boolean)
        : null;

      const { data, error } = await supabase
        .rpc('complete_service_appointment', {
          p_appointment_id: appointment.id,
          p_completed_by: user.id,
          p_service_duration_minutes: parseInt(formData.service_duration_minutes) || null,
          p_service_notes: formData.service_notes || null,
          p_service_quality_rating: formData.service_quality_rating || null,
          p_issues_encountered: issuesArray,
          p_parts_used: partsArray,
          p_completion_photos: formData.completion_photos.length > 0 ? formData.completion_photos : null,
          p_next_service_recommended_date: formData.next_service_recommended_date || null
        });

      if (error) throw error;
      
      if (data.success) {
        toast({
          title: 'Service Completed',
          description: 'Service appointment has been marked as completed and a service record has been created.',
          duration: 5000,
        });
        
        onOpenChange(false);
        if (onComplete) onComplete();
      } else {
        throw new Error(data.error);
      }
      
    } catch (error) {
      console.error('Error completing service:', error);
      toast({
        title: 'Error Completing Service',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  if (!appointment) return null;

  const isInProgress = appointment.status === 'in_progress';
  const hasStarted = appointment.work_started_at !== null;
  const hasEnded = appointment.work_ended_at !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Complete Service Appointment</DialogTitle>
          <DialogDescription>
            Fill in the service completion details and mark this appointment as completed
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Appointment Info */}
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Service:</span>
                  <span className="font-medium">{appointment.service_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Location:</span>
                  <span className="font-medium">{appointment.location_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Date:</span>
                  <span className="font-medium">
                    {new Date(appointment.appointment_date).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Time:</span>
                  <span className="font-medium">
                    {appointment.start_time} - {appointment.end_time}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Status:</span>
                  <Badge>{appointment.status}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Work Timer Controls */}
          {!hasStarted && (
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-blue-600" />
                    <div>
                      <div className="font-medium">Start Work Timer</div>
                      <div className="text-sm text-gray-600">
                        Track actual time spent on this service
                      </div>
                    </div>
                  </div>
                  <Button 
                    onClick={handleStartWork}
                    disabled={loading}
                  >
                    Start Work
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {hasStarted && !hasEnded && (
            <Card className="border-yellow-200 bg-yellow-50">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-yellow-600 animate-pulse" />
                    <div>
                      <div className="font-medium">Work in Progress</div>
                      <div className="text-sm text-gray-600">
                        Started: {new Date(appointment.work_started_at).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                  <Button 
                    onClick={handleEndWork}
                    disabled={loading}
                    variant="outline"
                  >
                    End Work
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {hasEnded && (
            <Card className="border-green-200 bg-green-50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <div>
                    <div className="font-medium">Work Completed</div>
                    <div className="text-sm text-gray-600">
                      Duration: {appointment.actual_duration_minutes} minutes
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Duration (Manual Override) */}
          <div className="space-y-2">
            <Label htmlFor="duration">
              Service Duration (minutes)
              {hasEnded && <span className="text-xs text-gray-500 ml-2">(auto-calculated)</span>}
            </Label>
            <Input
              id="duration"
              type="number"
              placeholder="e.g., 45"
              value={formData.service_duration_minutes}
              onChange={(e) => updateField('service_duration_minutes', e.target.value)}
              disabled={hasEnded}
            />
          </div>

          {/* Service Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Service Notes *</Label>
            <Textarea
              id="notes"
              placeholder="Describe the work completed, any observations, etc."
              rows={4}
              value={formData.service_notes}
              onChange={(e) => updateField('service_notes', e.target.value)}
            />
          </div>

          {/* Quality Rating */}
          <div className="space-y-2">
            <Label>Service Quality Rating</Label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => updateField('service_quality_rating', rating)}
                  className={`p-2 rounded transition-colors ${
                    formData.service_quality_rating >= rating
                      ? 'text-yellow-500'
                      : 'text-gray-300 hover:text-yellow-400'
                  }`}
                >
                  <Star className="w-6 h-6 fill-current" />
                </button>
              ))}
            </div>
          </div>

          {/* Issues Encountered */}
          <div className="space-y-2">
            <Label htmlFor="issues">
              Issues Encountered
              <span className="text-xs text-gray-500 ml-2">(comma-separated)</span>
            </Label>
            <Textarea
              id="issues"
              placeholder="e.g., Broken sprinkler head, Overgrown weeds, Equipment malfunction"
              rows={2}
              value={formData.issues_encountered}
              onChange={(e) => updateField('issues_encountered', e.target.value)}
            />
          </div>

          {/* Parts Used */}
          <div className="space-y-2">
            <Label htmlFor="parts">
              Parts Used/Replaced
              <span className="text-xs text-gray-500 ml-2">(comma-separated)</span>
            </Label>
            <Textarea
              id="parts"
              placeholder="e.g., Blade, Oil filter, Spark plug"
              rows={2}
              value={formData.parts_used}
              onChange={(e) => updateField('parts_used', e.target.value)}
            />
          </div>

          {/* Next Service Date */}
          <div className="space-y-2">
            <Label htmlFor="next-service">Recommended Next Service Date</Label>
            <Input
              id="next-service"
              type="date"
              value={formData.next_service_recommended_date}
              onChange={(e) => updateField('next_service_recommended_date', e.target.value)}
            />
          </div>

          {/* Photo Upload Placeholder */}
          <div className="space-y-2">
            <Label>Completion Photos</Label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <Camera className="w-8 h-8 mx-auto mb-2 text-gray-400" />
              <p className="text-sm text-gray-500">Photo upload functionality</p>
              <p className="text-xs text-gray-400">Coming soon</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleComplete}
            disabled={loading || !formData.service_notes}
          >
            {loading ? 'Completing...' : 'Complete Service'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

