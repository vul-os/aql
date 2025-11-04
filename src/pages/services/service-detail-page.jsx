import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import LoadingLottie from '@/components/ui/loading-lottie';
import { ANIMATIONS } from '@/lib/animations';
import PageHeader from '@/components/ui/page-header';
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
  ArrowRight,
  Sprout,
  MapPin,
  Ruler,
  Calendar,
  Bot,
  Loader2,
  FileText,
  Download,
  AlertCircle,
  Info,
  CheckCircle,
  CircleDot,
  Settings,
  Plus,
  Minus,
  Pause,
  Play,
  X,
  Power,
  AlertTriangle,
  Clock,
  LayoutGrid,
  Activity,
  Edit2,
  Check,
  DollarSign,
  Scissors,
  Battery,
  Thermometer,
  Droplets,
  Gauge,
  Navigation,
  TrendingUp,
  Zap,
  History,
  BarChart3,
  Target,
  Timer,
  Leaf
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { format, formatDistanceToNow } from 'date-fns';
import { API, BACKEND_URL } from '@/lib/config';
import { useAuth } from '@/context/auth-context';
import SignaturePad from '@/components/services/signature-pad';
import ServiceEnvironmentalData from '@/components/services/service-environmental-data';
import ServiceMowingSessions from '@/components/services/service-mowing-sessions';

export default function ServiceDetailPage() {
  const { id, tab } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [service, setService] = useState(null);
  const [gardens, setGardens] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Get current tab from URL or default to 'service-data'
  const activeTab = tab || 'service-data';
  
  // Handle tab change - update URL without page refresh
  const handleTabChange = (newTab) => {
    navigate(`/portal/service/${id}/${newTab}`, { replace: false });
  };
  
  const [showPauseDialog, setShowPauseDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [showModifyDialog, setShowModifyDialog] = useState(false);
  const [modifyAction, setModifyAction] = useState(null);
  const [newGardenCount, setNewGardenCount] = useState(1);
  const [modifySignature, setModifySignature] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newServiceName, setNewServiceName] = useState('');
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleData, setScheduleData] = useState({
    dayOfWeek: 1, // 0=Sunday, 6=Saturday
    timeWindowStart: '08:00',
    timeWindowEnd: '12:00',
    servicesPerMonth: 2,
    isValid: false
  });
  const [currentSchedule, setCurrentSchedule] = useState(null);
  const [showBillingConfirm, setShowBillingConfirm] = useState(false);
  const [newPricing, setNewPricing] = useState(null);

  useEffect(() => {
    if (id) {
      loadServiceDetails();
    }
  }, [id]);

  const loadServiceDetails = async () => {
    try {
      setLoading(true);

      const { data: serviceData, error: serviceError } = await supabase
        .from('services')
        .select(`
          *,
          location:locations(*)
        `)
        .eq('id', id)
        .single();

      if (serviceError) throw serviceError;

      if (!serviceData) {
        toast({
          title: "Not found",
          description: "Service not found",
          variant: "destructive"
        });
        navigate('/portal/services');
        return;
      }

      setService(serviceData);
      setNewServiceName(serviceData.name);

      // Load existing schedule preferences from service_preferences
      const { data: preferenceRecords, error: prefError } = await supabase
        .from('service_preferences')
        .select('*')
        .eq('service_id', id)
        .eq('is_active', true)
        .order('priority')
        .limit(1);

      if (!prefError && preferenceRecords && preferenceRecords.length > 0) {
        const pref = preferenceRecords[0];
        const loadedSchedule = {
          dayOfWeek: pref.day_of_week,
          timeWindowStart: pref.time_window_start,
          timeWindowEnd: pref.time_window_end,
          servicesPerMonth: serviceData.services_per_month || 2,
          isValid: true
        };
        setScheduleData(loadedSchedule);
        setCurrentSchedule(loadedSchedule);
      } else {
        // Set defaults if no preferences exist
        setScheduleData({
          dayOfWeek: 1, // Monday
          timeWindowStart: '08:00',
          timeWindowEnd: '12:00',
          servicesPerMonth: serviceData.services_per_month || 2,
          isValid: false
        });
      }

      const { data: gardensData } = await supabase
        .from('gardens')
        .select('*')
        .eq('service_id', id)
        .eq('is_active', true)
        .order('name');

      setGardens(gardensData || []);

      const { data: agreementsData } = await supabase
        .from('rental_agreements')
        .select('*')
        .eq('service_id', id)
        .order('created_at', { ascending: false });

      setAgreements(agreementsData || []);
      
      setNewGardenCount((gardensData || []).length || 1);

    } catch (error) {
      console.error('Error loading service:', error);
      toast({
        title: "Error",
        description: "Failed to load service details",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePauseService = async () => {
    try {
      setProcessing(true);
      
      const { error } = await supabase
        .from('services')
        .update({
          is_paused: true,
          paused_at: new Date().toISOString(),
          paused_reason: 'Paused by user'
        })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Service Paused',
        description: 'All bots have been stopped.',
      });

      setShowPauseDialog(false);
      await loadServiceDetails();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to pause service',
        variant: 'destructive'
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleResumeService = async () => {
    try {
      setProcessing(true);
      
      const { error } = await supabase
        .from('services')
        .update({
          is_paused: false,
          paused_at: null,
          paused_reason: null
        })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Service Resumed',
        description: 'All bots are now active.',
      });

      setShowResumeDialog(false);
      await loadServiceDetails();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to resume service',
        variant: 'destructive'
      });
    } finally {
      setProcessing(false);
    }
  };


  const handleEmergencyStop = async () => {
    if (!window.confirm('⚠️ EMERGENCY STOP: This will immediately halt all bots for this service. Are you sure?')) {
      return;
    }

    try {
      setProcessing(true);
      
      // Get all bots associated with this service's gardens
      const { data: serviceBots, error: botsError } = await supabase
        .from('bots')
        .select('id')
        .in('garden_id', gardens.map(g => g.id))
        .neq('status', 'offline');

      if (botsError) throw botsError;

      if (!serviceBots || serviceBots.length === 0) {
        toast({
          title: 'No Active Bots',
          description: 'All bots are already offline.',
        });
        setProcessing(false);
        return;
      }

      // Send emergency_stop command to all bots
      const commands = serviceBots.map(bot => ({
        bot_id: bot.id,
        command_type: 'emergency_stop',
        command_data: { 
          timestamp: new Date().toISOString(),
          triggered_by: 'service_emergency_stop',
          service_id: id
        },
        created_by: user.id
      }));

      const { error: commandError } = await supabase
        .from('bot_commands')
        .insert(commands);

      if (commandError) throw commandError;

      toast({
        title: '🛑 Emergency Stop Activated',
        description: `Emergency stop sent to ${serviceBots.length} bot(s).`,
        variant: 'destructive'
      });

      // Reload service details
      await loadServiceDetails();

    } catch (error) {
      console.error('Error sending emergency stop:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to send emergency stop command',
        variant: 'destructive'
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleUpdateServiceName = async () => {
    if (!newServiceName.trim()) {
      toast({
        title: 'Invalid Name',
        description: 'Service name cannot be empty',
        variant: 'destructive'
      });
      return;
    }

    if (newServiceName === service.name) {
      setEditingName(false);
      return;
    }

    try {
      setProcessing(true);

      const { error } = await supabase
        .from('services')
        .update({ name: newServiceName.trim() })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Name Updated',
        description: 'Service name has been updated successfully.',
      });

      setEditingName(false);
      await loadServiceDetails();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update service name',
        variant: 'destructive'
      });
    } finally {
      setProcessing(false);
    }
  };

  const handlePrepareScheduleUpdate = async () => {
    if (!scheduleData.isValid) {
      toast({
        title: 'Invalid Schedule',
        description: 'Please select days and time for the schedule',
        variant: 'destructive'
      });
      return;
    }

    // If billing changes, calculate new pricing and show confirmation
    if (scheduleData.servicesPerMonth !== currentSchedule?.servicesPerMonth) {
      try {
        setProcessing(true);
        
        // Calculate new pricing
        const response = await fetch(`${BACKEND_URL}/api/calculate-pricing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            number_of_bots: gardens.length,
            services_per_month: scheduleData.servicesPerMonth
          })
        });

        if (response.ok) {
          const pricingData = await response.json();
          setNewPricing(pricingData.pricing);
          setShowBillingConfirm(true);
        } else {
          throw new Error('Failed to calculate pricing');
        }
      } catch (error) {
        console.error('Pricing error:', error);
        // Continue with update even if pricing calc fails
        await handleUpdateSchedule();
      } finally {
        setProcessing(false);
      }
    } else {
      // No billing change, just update schedule
      await handleUpdateSchedule();
    }
  };

  const handleUpdateSchedule = async () => {
    try {
      setProcessing(true);

      // Update service with edge trimming frequency
      const { error: serviceError } = await supabase
        .from('services')
        .update({
          services_per_month: scheduleData.servicesPerMonth || 2
        })
        .eq('id', id);

      if (serviceError) throw serviceError;

      // Update or insert service preferences
      const { data: existingPref } = await supabase
        .from('service_preferences')
        .select('id')
        .eq('service_id', id)
        .eq('is_active', true)
        .limit(1);

      if (existingPref && existingPref.length > 0) {
        // Update existing preference
        const { error: prefError } = await supabase
          .from('service_preferences')
        .update({
            day_of_week: scheduleData.dayOfWeek,
            time_window_start: scheduleData.timeWindowStart,
            time_window_end: scheduleData.timeWindowEnd,
            priority: 1
          })
          .eq('id', existingPref[0].id);

        if (prefError) throw prefError;
      } else {
        // Create new preference
        const { error: prefError } = await supabase
          .from('service_preferences')
          .insert({
            service_id: id,
            day_of_week: scheduleData.dayOfWeek,
            time_window_start: scheduleData.timeWindowStart,
            time_window_end: scheduleData.timeWindowEnd,
            priority: 1,
            is_active: true
          });

        if (prefError) throw prefError;
      }

      // If billing changed, update rental agreements
      if (newPricing) {
        const { error: agreementError } = await supabase
          .from('rental_agreements')
          .update({
            services_per_month: scheduleData.servicesPerMonth,
            service_total: newPricing.service_total,
            monthly_total: newPricing.monthly_total
          })
          .eq('service_id', id);

        if (agreementError) {
          console.error('Failed to update agreements:', agreementError);
          // Don't fail the whole operation
        }
      }

      toast({
        title: 'Schedule Updated ✓',
        description: newPricing ? 'Service schedule and billing have been updated successfully.' : 'Service schedule updated successfully.',
        duration: 5000
      });

      setEditingSchedule(false);
      setShowBillingConfirm(false);
      setNewPricing(null);
      await loadServiceDetails();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update schedule',
        variant: 'destructive'
      });
    } finally {
      setProcessing(false);
    }
  };

  const getStatusBadge = () => {
    if (!service) return null;
    
    if (service.is_paused) {
      return <Badge className="bg-amber-100 text-amber-800 border-0">⏸ Paused</Badge>;
    }
    
    const statusMap = {
      'pending_setup': { label: '⏳ Pending', className: 'bg-botkorp-orange/10 text-botkorp-orange dark:bg-botkorp-orange/20' },
      'pending_installation': { label: '⏳ Pending', className: 'bg-botkorp-orange/10 text-botkorp-orange dark:bg-botkorp-orange/20' },
      'installation_scheduled': { label: '📅 Scheduled', className: 'bg-[#4F5D75]/10 text-[#4F5D75] dark:bg-[#4F5D75]/20' },
      'installing': { label: '🔧 Installing', className: 'bg-[#4F5D75]/10 text-[#4F5D75] dark:bg-[#4F5D75]/20' },
      'active': { label: '✓ Active', className: 'bg-botkorp-orange/10 text-botkorp-orange dark:bg-botkorp-orange/20' },
      'cancelled': { label: '✗ Cancelled', className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' }
    };
    
    const status = statusMap[service.status] || statusMap['active'];
    return <Badge className={`${status.className} border-0`}>{status.label}</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen">
        <LoadingLottie
          src={ANIMATIONS.loading}
          message="Loading service details..."
          size="md"
        />
      </div>
    );
  }

  if (!service) return null;

  const totalArea = gardens.reduce((sum, g) => sum + parseFloat(g.area_sqm || 0), 0);

  return (
    <>
      <div className="p-3 md:p-5 space-y-5">
        
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground animate-in fade-in slide-in-from-top-3 duration-500">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate('/portal/services')} 
            className="h-7 px-2 hover:bg-botkorp-orange/10 hover:text-botkorp-orange transition-all duration-300"
          >
            <ArrowLeft className="h-3 w-3 mr-1.5" />
            Services
          </Button>
          <span>/</span>
          <span className="font-semibold text-foreground">{service.name}</span>
        </div>

        {/* Enhanced Page Header */}
        <div className="space-y-3 animate-in fade-in slide-in-from-top-3 duration-500">
          <PageHeader
            title={service.name}
            subtitle={`${service.location?.name || 'Unknown Location'} • ${gardens.length} Garden${gardens.length !== 1 ? 's' : ''} • ${Math.round(totalArea)} m²`}
            icon={<Sprout className="h-5 w-5 text-botkorp-orange" />}
            badge={getStatusBadge()}
          />
        </div>

        {/* Quick Stats Overview - Soft UI */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-100">
          {/* Total Area Stat */}
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
            <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2 pt-5">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Area</CardTitle>
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-botkorp-orange/20 to-botkorp-orange/10 dark:from-botkorp-orange/30 dark:to-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                <Ruler className="h-4 w-4 text-botkorp-orange transition-all duration-500" />
              </div>
            </CardHeader>
            <CardContent className="relative pb-5">
              <div className="text-3xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{Math.round(totalArea)}</div>
              <p className="text-[11px] text-muted-foreground font-semibold mt-1">Square Meters</p>
            </CardContent>
          </Card>

          {/* Active Bots Stat */}
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
            <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2 pt-5">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Active Bots</CardTitle>
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-botkorp-orange/20 to-botkorp-orange/10 dark:from-botkorp-orange/30 dark:to-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                <Bot className="h-4 w-4 text-botkorp-orange transition-all duration-500" />
              </div>
            </CardHeader>
            <CardContent className="relative pb-5">
              <div className="text-3xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{gardens.length}</div>
              <p className="text-[11px] text-muted-foreground font-semibold mt-1">Deployed</p>
            </CardContent>
          </Card>

          {/* Gardens Stat */}
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
            <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2 pt-5">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Gardens</CardTitle>
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-botkorp-orange/20 to-botkorp-orange/10 dark:from-botkorp-orange/30 dark:to-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                <Sprout className="h-4 w-4 text-botkorp-orange transition-all duration-500" />
              </div>
            </CardHeader>
            <CardContent className="relative pb-5">
              <div className="text-3xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{gardens.length}</div>
              <p className="text-[11px] text-muted-foreground font-semibold mt-1">Configured</p>
            </CardContent>
          </Card>

          {/* Service Frequency Stat */}
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
            <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2 pt-5">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Frequency</CardTitle>
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-botkorp-orange/20 to-botkorp-orange/10 dark:from-botkorp-orange/30 dark:to-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                <Calendar className="h-4 w-4 text-botkorp-orange transition-all duration-500" />
              </div>
            </CardHeader>
            <CardContent className="relative pb-5">
              <div className="text-3xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{scheduleData.servicesPerMonth || 2}</div>
              <p className="text-[11px] text-muted-foreground font-semibold mt-1">Visits/Month</p>
            </CardContent>
          </Card>
        </div>

        {/* Enhanced Tabs - Soft UI */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-5 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200">
          <TabsList className="grid w-full grid-cols-4 h-14 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 p-2 rounded-3xl shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] border-0 animate-in fade-in zoom-in-95 duration-300">
            <TabsTrigger 
              value="service-data" 
              className="rounded-2xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/90 data-[state=active]:text-white data-[state=active]:shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] transition-all duration-300 text-xs font-bold hover:bg-botkorp-orange/5"
            >
              <Activity className="h-3.5 w-3.5 mr-1.5" />
              Service Data
            </TabsTrigger>
            <TabsTrigger 
              value="gardens" 
              className="rounded-2xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/90 data-[state=active]:text-white data-[state=active]:shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] transition-all duration-300 text-xs font-bold hover:bg-botkorp-orange/5"
            >
              <Sprout className="h-3.5 w-3.5 mr-1.5" />
              Gardens
            </TabsTrigger>
            <TabsTrigger 
              value="agreements" 
              className="rounded-2xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/90 data-[state=active]:text-white data-[state=active]:shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] transition-all duration-300 text-xs font-bold hover:bg-botkorp-orange/5"
            >
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              Agreements
            </TabsTrigger>
            <TabsTrigger 
              value="settings" 
              className="rounded-2xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/90 data-[state=active]:text-white data-[state=active]:shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] transition-all duration-300 text-xs font-bold hover:bg-botkorp-orange/5"
            >
              <Settings className="h-3.5 w-3.5 mr-1.5" />
              Settings
            </TabsTrigger>
          </TabsList>

          {/* SERVICE DATA TAB */}
          <TabsContent value="service-data" className="space-y-5">
            {gardens.length > 0 ? (
              <div className="space-y-6">
                {gardens.map((garden, index) => (
                  <div key={garden.id} className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: `${index * 100}ms` }}>
                    {/* Garden Header */}
                    <div className="flex items-center gap-3 mb-1">
                      <Sprout className="h-5 w-5 text-botkorp-orange" />
                      <div>
                        <h2 className="text-lg font-bold">{garden.name}</h2>
                        <p className="text-xs text-muted-foreground">
                          {Math.round(garden.area_sqm)} m² coverage area
                        </p>
                      </div>
                    </div>

                    {/* Environmental Data Card - Soft UI */}
                    <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 border-0">
                      <CardHeader className="pb-3 pt-5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                              <Thermometer className="w-5 h-5 text-botkorp-orange" />
                            </div>
                            <div>
                              <CardTitle className="text-base font-bold">Environmental Conditions</CardTitle>
                              <CardDescription className="text-[11px] font-medium">Real-time weather & soil data</CardDescription>
                            </div>
                          </div>
                          <Badge variant="outline" className="text-[10px] border-none bg-botkorp-orange/10 text-botkorp-orange font-semibold px-3 py-1 rounded-full">Live</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4 pb-5">
                        <ServiceEnvironmentalData gardenId={garden.id} />
                      </CardContent>
                    </Card>

                    {/* Service History Card - Soft UI */}
                    <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 border-0">
                      <CardHeader className="pb-3 pt-5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                              <Activity className="w-5 h-5 text-botkorp-orange" />
                            </div>
                            <div>
                              <CardTitle className="text-base font-bold">Service History</CardTitle>
                              <CardDescription className="text-[11px] font-medium">Performance & mowing sessions</CardDescription>
                            </div>
                          </div>
                          <Badge variant="outline" className="text-[10px] border-none bg-botkorp-orange/10 text-botkorp-orange font-semibold px-3 py-1 rounded-full">Recent</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4 pb-5">
                        <ServiceMowingSessions gardenId={garden.id} />
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </div>
            ) : (
              <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-4 duration-500 border-0">
                <CardContent className="py-16 text-center">
                  <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mb-5 animate-in zoom-in-50 duration-500 delay-100 shadow-[0_8px_30px_rgb(255,107,53,0.15)]">
                    <Sprout className="h-10 w-10 text-botkorp-orange animate-pulse" />
                  </div>
                  <h3 className="text-lg font-bold mb-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
                    No Gardens Configured
                  </h3>
                  <p className="text-muted-foreground/70 mb-6 max-w-md mx-auto text-sm leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
                    Gardens will appear here after service setup. Once configured, you'll see environmental data and mowing session history.
                  </p>
                  <Alert className="max-w-md mx-auto border-none bg-botkorp-orange/10 animate-in fade-in zoom-in-50 duration-500 delay-400 rounded-xl">
                    <Info className="h-4 w-4 text-botkorp-orange" />
                    <AlertDescription className="text-xs text-left">
                      <strong className="text-sm">What you'll see here:</strong>
                      <ul className="mt-2 space-y-1.5">
                        <li className="flex items-start gap-2">
                          <Thermometer className="h-3 w-3 text-botkorp-orange mt-0.5 flex-shrink-0" />
                          <span>Real-time environmental conditions</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Activity className="h-3 w-3 text-botkorp-orange mt-0.5 flex-shrink-0" />
                          <span>Mowing session history with metrics</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <TrendingUp className="h-3 w-3 text-botkorp-orange mt-0.5 flex-shrink-0" />
                          <span>Service quality trends & analytics</span>
                        </li>
                      </ul>
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* GARDENS TAB */}
          <TabsContent value="gardens" className="space-y-4">
            {gardens.length > 0 ? (
              <>
                {/* Section Header */}
                <div className="flex items-center justify-between mb-1 animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <div className="flex items-center gap-3">
                    <Sprout className="h-5 w-5 text-botkorp-orange" />
                    <h2 className="text-lg font-bold">All Gardens</h2>
                  </div>
                  <Badge variant="secondary" className="h-6 px-3 text-xs bg-botkorp-orange/10 text-botkorp-orange border-0 font-semibold rounded-full">
                    {gardens.length} Total
                  </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {gardens.map((garden, index) => (
                    <Card 
                      key={garden.id} 
                      className="relative overflow-hidden bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] transition-all duration-300 cursor-pointer group hover:-translate-y-1 animate-in fade-in slide-in-from-bottom-4 border-0"
                      style={{ animationDelay: `${index * 50}ms`, animationDuration: '500ms' }}
                    >
                      <CardHeader className="relative pb-3 pt-5">
                        <div className="flex items-start gap-3">
                          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-all duration-300 shadow-[0_4px_20px_rgb(255,107,53,0.15)] group-hover:shadow-[0_4px_20px_rgb(255,107,53,0.25)]">
                            <Sprout className="h-6 w-6 text-botkorp-orange" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base font-bold mb-0.5 truncate group-hover:text-botkorp-orange transition-colors duration-300">
                              {garden.name}
                            </CardTitle>
                            <p className="text-[11px] text-muted-foreground/70 font-medium">Garden #{index + 1}</p>
                            <Badge variant="outline" className="mt-2 text-[10px] h-5 border-none bg-green-500/10 text-green-600 font-semibold px-3 rounded-full">
                              Active
                            </Badge>
                          </div>
                        </div>
                      </CardHeader>
                      
                      <CardContent className="relative space-y-3 pb-5">
                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="relative">
                            <div className="text-center p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all duration-300">
                              <div className="flex items-center justify-center mb-2">
                                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500/15 to-blue-500/5 flex items-center justify-center shadow-[0_2px_10px_rgb(59,130,246,0.1)]">
                                  <Ruler className="h-4 w-4 text-blue-600" />
                                </div>
                              </div>
                              <div className="text-2xl font-bold tabular-nums">{Math.round(garden.area_sqm)}</div>
                              <p className="text-[10px] text-muted-foreground/60 font-medium mt-1">m² Area</p>
                            </div>
                          </div>
                          
                          <div className="relative">
                            <div className="text-center p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all duration-300">
                              <div className="flex items-center justify-center mb-2">
                                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_2px_10px_rgb(255,107,53,0.1)]">
                                  <Bot className="h-4 w-4 text-botkorp-orange" />
                                </div>
                              </div>
                              <div className="text-2xl font-bold tabular-nums">1</div>
                              <p className="text-[10px] text-muted-foreground/60 font-medium mt-1">Bot</p>
                            </div>
                          </div>
                        </div>

                        {/* Metadata */}
                        {garden.created_at && (
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground/70 pt-3 mt-3 border-t border-border">
                            <span className="flex items-center gap-1.5 font-medium">
                              <Calendar className="h-3.5 w-3.5" />
                              Added
                            </span>
                            <span className="font-bold">{format(new Date(garden.created_at), 'MMM d, yyyy')}</span>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            ) : (
              <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-4 duration-500 border-0">
                <CardContent className="py-16 text-center">
                  <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mb-5 animate-in zoom-in-50 duration-500 delay-100 shadow-[0_8px_30px_rgb(255,107,53,0.15)]">
                    <Sprout className="h-10 w-10 text-botkorp-orange animate-pulse" />
                  </div>
                  <h3 className="text-lg font-bold mb-2">No Gardens Configured</h3>
                  <p className="text-sm text-muted-foreground/70 mt-2 max-w-md mx-auto">
                    Gardens will appear here after service setup is complete
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* AGREEMENTS TAB */}
          <TabsContent value="agreements" className="space-y-4">
            {agreements.length > 0 ? (
              <>
                {/* Section Header */}
                <div className="flex items-center justify-between mb-1 animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-botkorp-orange" />
                    <h2 className="text-lg font-bold">Rental Agreements</h2>
                  </div>
                  <Badge variant="secondary" className="h-6 px-3 text-xs bg-botkorp-orange/10 text-botkorp-orange border-0 font-semibold rounded-full">
                    {agreements.length} Total
                  </Badge>
                </div>

                <div className="space-y-4">
                  {agreements.map((agreement, index) => {
                    const garden = gardens.find(g => g.id === agreement.garden_id);
                    return (
                      <Card 
                        key={agreement.id} 
                        className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 overflow-hidden group animate-in fade-in slide-in-from-bottom-3 border-0"
                        style={{ animationDelay: `${index * 50}ms`, animationDuration: '500ms' }}
                      >
                        <CardHeader className="relative pb-3 pt-5">
                          <div className="flex flex-col sm:flex-row gap-3 sm:items-start">
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)] flex-shrink-0 group-hover:scale-105 transition-all duration-300">
                                <FileText className="h-6 w-6 text-botkorp-orange" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <CardTitle className="text-base font-bold mb-1 truncate group-hover:text-botkorp-orange transition-colors duration-300">
                                  {agreement.agreement_number}
                                </CardTitle>
                                <p className="text-xs text-muted-foreground/70 font-medium">{garden?.name || 'Unknown Garden'}</p>
                                {agreement.signed_at && (
                                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70 mt-2">
                                    <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                                    <span className="font-medium">Signed {format(new Date(agreement.signed_at), 'MMM d, yyyy')}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                            <Badge variant="outline" className="capitalize text-[10px] h-6 border-none bg-botkorp-orange/10 text-botkorp-orange font-semibold px-3 rounded-full self-start">
                              {agreement.status}
                            </Badge>
                          </div>
                        </CardHeader>
                        
                        <CardContent className="relative space-y-4 pb-5">
                          {/* Pricing Card */}
                          <div className="p-5 rounded-xl bg-botkorp-orange/10 border-0">
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-[11px] font-bold text-botkorp-orange uppercase tracking-wider">Bot Rental (Monthly)</p>
                              <DollarSign className="h-5 w-5 text-botkorp-orange" />
                            </div>
                            <p className="text-4xl font-bold bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent mb-3 tabular-nums">
                              R{parseFloat(agreement.bot_rental_total || 0).toFixed(2)}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              <span className="font-bold">R150/month per bot</span>
                              <span>•</span>
                              <span className="font-bold">{agreement.number_of_bots || 1} bot{(agreement.number_of_bots || 1) > 1 ? 's' : ''}</span>
                            </div>
                          </div>

                          {/* Download Button */}
                          {agreement.agreement_pdf_url && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full h-11 text-xs font-semibold rounded-xl border-none bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] hover:bg-botkorp-orange hover:text-white transition-all duration-300 active:scale-95"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(agreement.agreement_pdf_url, '_blank');
                              }}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Download PDF Agreement
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </>
            ) : (
              <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-4 duration-500 border-0">
                <CardContent className="py-16 text-center">
                  <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mb-5 animate-in zoom-in-50 duration-500 delay-100 shadow-[0_8px_30px_rgb(255,107,53,0.15)]">
                    <FileText className="h-10 w-10 text-botkorp-orange animate-pulse" />
                  </div>
                  <h3 className="text-lg font-bold mb-2">No Rental Agreements</h3>
                  <p className="text-sm text-muted-foreground/70 mt-2 max-w-md mx-auto">
                    Agreements will be created after service setup is complete
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* SETTINGS TAB */}
          <TabsContent value="settings" className="space-y-4">
            {/* Section Header */}
            <div className="flex items-center gap-3 mb-1 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <Settings className="h-5 w-5 text-botkorp-orange" />
              <h2 className="text-lg font-bold">Service Configuration</h2>
            </div>

            {/* Edit Service Name - Soft UI */}
            <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 animate-in fade-in slide-in-from-bottom-3 border-0">
              <CardHeader className="pb-3 pt-5">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                    <Edit2 className="h-5 w-5 text-botkorp-orange" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">Service Name</CardTitle>
                    <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">Change how this service appears</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 pb-5">
                {editingName ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="serviceName" className="text-xs font-semibold">Service Name</Label>
                      <Input
                        id="serviceName"
                        value={newServiceName}
                        onChange={(e) => setNewServiceName(e.target.value)}
                        placeholder="e.g., Home - Lawn Care"
                        className="h-10 text-sm focus:border-botkorp-orange focus:ring-2 focus:ring-botkorp-orange/20"
                        autoFocus
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleUpdateServiceName}
                        disabled={processing || !newServiceName.trim()}
                        className="flex-1 h-10 text-xs font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] active:scale-95 transition-all duration-300 rounded-2xl border-0 text-white"
                      >
                        {processing ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Save Changes
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setEditingName(false);
                          setNewServiceName(service.name);
                        }}
                        disabled={processing}
                        className="flex-1 h-10 text-xs font-semibold rounded-2xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] active:scale-95 transition-all duration-300"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-5 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all duration-300">
                    <div>
                      <p className="text-[10px] text-muted-foreground/70 mb-1 font-medium uppercase tracking-wider">Current Name</p>
                      <p className="text-sm font-bold">{service.name}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingName(true)}
                      className="h-9 text-xs font-semibold rounded-xl border-none bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] hover:bg-botkorp-orange hover:text-white transition-all duration-300 active:scale-95"
                    >
                      <Edit2 className="h-3.5 w-3.5 mr-1.5" />
                      Edit
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Service Schedule Editor - Soft UI */}
            <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-75 border-0">
              <CardHeader className="pb-3 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                      <Calendar className="h-5 w-5 text-botkorp-orange" />
                    </div>
                    <div>
                      <CardTitle className="text-base font-bold">Service Schedule</CardTitle>
                      <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">When bots will service this property</p>
                    </div>
                  </div>
                  {!editingSchedule && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingSchedule(true)}
                      className="h-9 text-xs font-semibold rounded-xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300 active:scale-95"
                    >
                      <Edit2 className="h-3.5 w-3.5 mr-1.5" />
                      Edit
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                {editingSchedule ? (
                  <div className="space-y-6">
                    {/* Edge Trimming Frequency */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Scissors className="h-5 w-5 text-botkorp-orange" />
                        <Label className="text-base font-semibold">Edge Trimming Frequency</Label>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Choose how many edge trimming visits you'd like per month (1-4 visits)
                      </p>
                      <div className="grid grid-cols-4 gap-3">
                        {[1, 2, 3, 4].map((visits) => (
                          <button
                            key={visits}
                            type="button"
                            onClick={() => setScheduleData({...scheduleData, servicesPerMonth: visits, isValid: true})}
                            className={`p-6 rounded-lg border-2 text-center transition-all ${
                              (scheduleData.servicesPerMonth || 2) === visits
                                ? 'border-botkorp-orange bg-botkorp-orange/10 shadow-md'
                                : 'border-border hover:border-botkorp-orange/50 hover:bg-muted'
                            }`}
                          >
                            <div className="text-3xl font-bold mb-2 text-botkorp-orange">{visits}</div>
                            <div className="text-xs text-muted-foreground">
                              visit{visits > 1 ? 's' : ''}/month
                            </div>
                            <div className="text-sm font-semibold mt-2">
                              R{visits * 100}
                            </div>
                            {(scheduleData.servicesPerMonth || 2) === visits && (
                              <CheckCircle className="h-5 w-5 text-botkorp-orange mx-auto mt-2" />
                            )}
                          </button>
                        ))}
                      </div>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <p className="text-sm text-center">
                          <strong>R{((scheduleData.servicesPerMonth || 2) * 100).toFixed(2)}/month</strong> for edge trimming
                          <span className="text-muted-foreground ml-1">(R100 per visit)</span>
                        </p>
                      </div>
                    </div>

                    {/* Preferred Day of Week */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-botkorp-orange" />
                        <Label className="text-base font-semibold">Preferred Day of Week</Label>
                      </div>
                      <p className="text-sm text-muted-foreground">Choose your preferred day for service visits</p>
                      <div className="grid grid-cols-7 gap-2">
                        {[
                          { value: 0, label: 'Sun', full: 'Sunday' },
                          { value: 1, label: 'Mon', full: 'Monday' },
                          { value: 2, label: 'Tue', full: 'Tuesday' },
                          { value: 3, label: 'Wed', full: 'Wednesday' },
                          { value: 4, label: 'Thu', full: 'Thursday' },
                          { value: 5, label: 'Fri', full: 'Friday' },
                          { value: 6, label: 'Sat', full: 'Saturday' }
                        ].map((day) => (
                          <button
                            key={day.value}
                            type="button"
                            onClick={() => setScheduleData({...scheduleData, dayOfWeek: day.value, isValid: true})}
                            className={`p-3 rounded-lg border-2 text-center transition-all ${
                              (scheduleData.dayOfWeek || 1) === day.value
                                ? 'border-botkorp-orange bg-botkorp-orange text-white shadow-md'
                                : 'border-border hover:border-botkorp-orange/50 hover:bg-muted'
                            }`}
                            title={day.full}
                          >
                            <div className="text-xs font-semibold">{day.label}</div>
                          </button>
                        ))}
                      </div>
                      {scheduleData.dayOfWeek !== undefined && (
                        <p className="text-sm text-muted-foreground">
                          ✓ Selected: {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][scheduleData.dayOfWeek || 1]}
                        </p>
                      )}
                    </div>

                    {/* Preferred Time Window */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Clock className="h-5 w-5 text-botkorp-orange" />
                        <Label className="text-base font-semibold">Preferred Time Window</Label>
                      </div>
                      <p className="text-sm text-muted-foreground">Select your preferred time range for service visits</p>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="time-start">Start Time</Label>
                          <Select 
                            value={scheduleData.timeWindowStart || '08:00'}
                            onValueChange={(value) => setScheduleData({...scheduleData, timeWindowStart: value, isValid: true})}
                          >
                            <SelectTrigger id="time-start">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper" sideOffset={5}>
                              <SelectItem value="06:00">6:00 AM</SelectItem>
                              <SelectItem value="07:00">7:00 AM</SelectItem>
                              <SelectItem value="08:00">8:00 AM</SelectItem>
                              <SelectItem value="09:00">9:00 AM</SelectItem>
                              <SelectItem value="10:00">10:00 AM</SelectItem>
                              <SelectItem value="11:00">11:00 AM</SelectItem>
                              <SelectItem value="12:00">12:00 PM</SelectItem>
                              <SelectItem value="13:00">1:00 PM</SelectItem>
                              <SelectItem value="14:00">2:00 PM</SelectItem>
                              <SelectItem value="15:00">3:00 PM</SelectItem>
                              <SelectItem value="16:00">4:00 PM</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="time-end">End Time</Label>
                          <Select 
                            value={scheduleData.timeWindowEnd || '12:00'}
                            onValueChange={(value) => setScheduleData({...scheduleData, timeWindowEnd: value, isValid: true})}
                          >
                            <SelectTrigger id="time-end">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper" sideOffset={5}>
                              <SelectItem value="08:00">8:00 AM</SelectItem>
                              <SelectItem value="09:00">9:00 AM</SelectItem>
                              <SelectItem value="10:00">10:00 AM</SelectItem>
                              <SelectItem value="11:00">11:00 AM</SelectItem>
                              <SelectItem value="12:00">12:00 PM</SelectItem>
                              <SelectItem value="13:00">1:00 PM</SelectItem>
                              <SelectItem value="14:00">2:00 PM</SelectItem>
                              <SelectItem value="15:00">3:00 PM</SelectItem>
                              <SelectItem value="16:00">4:00 PM</SelectItem>
                              <SelectItem value="17:00">5:00 PM</SelectItem>
                              <SelectItem value="18:00">6:00 PM</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Services are typically scheduled within this time window
                      </p>
                    </div>
                    
                    {/* Billing Impact Alert */}
                    {scheduleData.servicesPerMonth !== currentSchedule?.servicesPerMonth && (
                      <Alert className={scheduleData.servicesPerMonth > (currentSchedule?.servicesPerMonth || 4) ? 'border-orange-200 bg-orange-50 dark:bg-orange-950/20' : 'border-botkorp-orange/20 bg-botkorp-orange/5 dark:bg-botkorp-orange/10'}>
                        <AlertCircle className={`h-4 w-4 ${scheduleData.servicesPerMonth > (currentSchedule?.servicesPerMonth || 4) ? 'text-orange-600' : 'text-botkorp-orange'}`} />
                        <AlertDescription className={`text-sm ${scheduleData.servicesPerMonth > (currentSchedule?.servicesPerMonth || 4) ? 'text-orange-900 dark:text-orange-200' : 'text-foreground/90'}`}>
                          <p className="font-semibold mb-1">Billing Change</p>
                          <p className="text-xs">
                            {scheduleData.servicesPerMonth > (currentSchedule?.servicesPerMonth || 4) ? (
                              <>Increasing from {currentSchedule?.servicesPerMonth || 4} to {scheduleData.servicesPerMonth} services per month will increase your monthly billing. Changes apply from next billing cycle.</>
                            ) : (
                              <>Decreasing from {currentSchedule?.servicesPerMonth || 4} to {scheduleData.servicesPerMonth} services per month will reduce your monthly billing. Changes apply from next billing cycle.</>
                            )}
                          </p>
                        </AlertDescription>
                      </Alert>
                    )}
                    
                    <div className="flex gap-3 pt-4 border-t">
                      <Button
                        onClick={handlePrepareScheduleUpdate}
                        disabled={processing || !scheduleData.isValid}
                        className="flex-1 h-11 text-xs font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] active:scale-95 transition-all duration-300 rounded-2xl border-0 text-white"
                      >
                        {processing ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        {scheduleData.servicesPerMonth !== currentSchedule?.servicesPerMonth ? 'Update Schedule & Billing' : 'Save Schedule'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setEditingSchedule(false);
                          setNewPricing(null);
                          loadServiceDetails();
                        }}
                        disabled={processing}
                        className="flex-1 h-11 text-xs font-semibold rounded-2xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] active:scale-95 transition-all duration-300"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-5 rounded-xl bg-botkorp-orange/10 border-0">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-muted-foreground/70 font-bold uppercase tracking-wider">Preferred Day</span>
                          <Badge variant="outline" className="capitalize text-[10px] h-6 border-none bg-botkorp-orange/10 text-botkorp-orange font-semibold px-3 rounded-full">
                            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][scheduleData.dayOfWeek || 1]}
                          </Badge>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-muted-foreground/70 font-bold uppercase tracking-wider">Time Window</span>
                          <Badge variant="outline" className="text-[10px] h-6 border-none bg-botkorp-orange/10 text-botkorp-orange font-semibold px-3 rounded-full">
                            {scheduleData.timeWindowStart || '08:00'} - {scheduleData.timeWindowEnd || '12:00'}
                          </Badge>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-muted-foreground/70 font-bold uppercase tracking-wider">Edge Trimming</span>
                          <Badge variant="outline" className="text-[10px] h-6 border-none bg-botkorp-orange/10 text-botkorp-orange font-semibold px-3 rounded-full">
                            {scheduleData.servicesPerMonth || 2} visit{(scheduleData.servicesPerMonth || 2) > 1 ? 's' : ''}/month
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Modify Gardens - Soft UI */}
            <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-150 border-0">
              <CardHeader className="pb-3 pt-5">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                    <Bot className="h-5 w-5 text-botkorp-orange" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">Number of Gardens</CardTitle>
                    <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">Adjust service coverage (requires approval)</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <Alert className="border-none bg-botkorp-orange/10 rounded-xl">
                  <Info className="h-4 w-4 text-botkorp-orange" />
                  <AlertDescription className="text-xs">
                    Each garden requires one bot. Changes need admin approval and your signature.
                  </AlertDescription>
                </Alert>

                {/* Counter - Mobile Responsive */}
                <div className="p-6 md:p-8 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                  <div className="flex flex-col items-center gap-4">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Gardens</p>
                    
                    <div className="flex items-center justify-center gap-4 md:gap-6">
                      <Button
                        variant="outline"
                        size="lg"
                        onClick={() => newGardenCount > 1 && setNewGardenCount(newGardenCount - 1)}
                        disabled={newGardenCount <= 1}
                        className="h-14 w-14 md:h-16 md:w-16 rounded-full border-2 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-20 transition-all"
                      >
                        <Minus className="h-5 w-5 md:h-6 md:w-6" />
                      </Button>

                      <div className="text-center min-w-[100px] md:min-w-[140px]">
                        <p className="text-5xl md:text-7xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">
                          {newGardenCount}
                        </p>
                        {newGardenCount !== gardens.length && (
                          <Badge variant="outline" className="mt-2 md:mt-3 font-medium text-xs md:text-sm">
                            {newGardenCount > gardens.length ? '+' : ''}{newGardenCount - gardens.length}
                          </Badge>
                        )}
                      </div>

                      <Button
                        variant="outline"
                        size="lg"
                        onClick={() => setNewGardenCount(newGardenCount + 1)}
                        className="h-14 w-14 md:h-16 md:w-16 rounded-full border-2 hover:border-botkorp-orange hover:bg-botkorp-orange/5 transition-all"
                      >
                        <Plus className="h-5 w-5 md:h-6 md:w-6" />
                      </Button>
                    </div>
                  </div>
                </div>

                {newGardenCount !== gardens.length && (
                  <div className="space-y-2.5">
                    <Alert className="border-none bg-orange-100/80 dark:bg-orange-950/30 rounded-xl">
                      <AlertCircle className="h-4 w-4 text-orange-600" />
                      <AlertDescription className="text-xs text-orange-900 dark:text-orange-200">
                        <strong>Admin approval required</strong> - Changes will be reviewed within 24 hours
                      </AlertDescription>
                    </Alert>
                    
                    <Button
                      className="w-full h-11 text-xs font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] active:scale-95 transition-all duration-300 rounded-2xl border-0 text-white"
                      onClick={() => {
                        setModifyAction(newGardenCount > gardens.length ? 'add' : 'remove');
                        setShowModifyDialog(true);
                      }}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Request Amendment ({newGardenCount > gardens.length ? '+' : ''}{newGardenCount - gardens.length} Garden{Math.abs(newGardenCount - gardens.length) !== 1 ? 's' : ''})
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Service Controls - Soft UI */}
            <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200 border-0">
              <CardHeader className="pb-3 pt-5">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                    <Power className="h-5 w-5 text-botkorp-orange" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">Service Controls</CardTitle>
                    <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">Pause or manage this service</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2.5 pt-4">
                {service.is_paused && service.paused_at && (
                  <Alert className="border-none bg-amber-100/80 dark:bg-amber-950/30 rounded-xl">
                    <Pause className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-xs text-amber-900 dark:text-amber-200">
                      Paused since {format(new Date(service.paused_at), 'MMM d, yyyy h:mm a')}
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  variant={service.is_paused ? "default" : "outline"}
                  className={`w-full h-11 justify-start text-xs font-semibold transition-all active:scale-95 rounded-2xl border-0 ${
                    service.is_paused 
                      ? 'bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] text-white hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)]' 
                      : 'bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)]'
                  }`}
                  onClick={() => service.is_paused ? setShowResumeDialog(true) : setShowPauseDialog(true)}
                >
                  {service.is_paused ? (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Resume Service
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4 mr-2" />
                      Pause Service
                    </>
                  )}
                </Button>

                <Button
                  variant="destructive"
                  className="w-full h-11 justify-start text-xs font-semibold bg-gradient-to-br from-red-600 to-red-700 shadow-[4px_4px_12px_rgba(220,38,38,0.3),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(220,38,38,0.4),-3px_-3px_10px_rgba(255,255,255,0.15)] transition-all active:scale-95 rounded-2xl border-0"
                  onClick={handleEmergencyStop}
                  disabled={processing}
                >
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  {processing ? 'Stopping...' : 'Emergency Stop All Bots'}
                </Button>

              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Compact Dialogs */}
      
      {/* Pause */}
      <AlertDialog open={showPauseDialog} onOpenChange={setShowPauseDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-xl">
              <Pause className="h-5 w-5 text-amber-600" />
              Pause Service?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              All bots will stop immediately. Billing continues. You can resume anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePauseService} className="bg-amber-600 hover:bg-amber-700">
              Pause Service
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Resume */}
      <AlertDialog open={showResumeDialog} onOpenChange={setShowResumeDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-xl">
              <Play className="h-5 w-5 text-botkorp-orange" />
              Resume Service?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              All bots will restart and resume their normal schedule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResumeService} className="bg-botkorp-orange hover:bg-botkorp-orange/90">
              Resume Service
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      {/* Modify Amendment Dialog */}
      <AlertDialog open={showModifyDialog} onOpenChange={(open) => {
        if (!open) {
          setModifySignature(null);
          setNewGardenCount(gardens.length);
        }
        setShowModifyDialog(open);
      }}>
        <AlertDialogContent className="max-w-2xl max-h-[90vh]">
          <AlertDialogHeader className="pb-4">
            <AlertDialogTitle className="text-2xl flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center">
                <FileText className="h-6 w-6 text-botkorp-orange" />
              </div>
              Amendment Request
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              {modifyAction === 'add' 
                ? `Add ${newGardenCount - gardens.length} garden${newGardenCount - gardens.length !== 1 ? 's' : ''} to your service`
                : `Remove ${gardens.length - newGardenCount} garden${gardens.length - newGardenCount !== 1 ? 's' : ''} from your service`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="space-y-5 overflow-y-auto max-h-[55vh] pr-2">
            <Alert className="border-none bg-orange-100/80 dark:bg-orange-950/30 rounded-xl">
              <AlertCircle className="h-4 w-4 text-orange-600" />
              <AlertDescription className="text-sm text-orange-900 dark:text-orange-200">
                <strong>Admin approval required</strong> - Changes will be reviewed within 24 hours
              </AlertDescription>
            </Alert>

            {/* Summary */}
            <div className="grid grid-cols-3 gap-4 p-5 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">Current</p>
                <p className="text-3xl font-bold">{gardens.length}</p>
              </div>
              <div className="flex items-center justify-center">
                <ArrowRight className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">New</p>
                <p className="text-3xl font-bold text-botkorp-orange">{newGardenCount}</p>
              </div>
            </div>

            {/* Impact */}
            <div className="space-y-2">
              <p className="font-semibold text-sm">What happens after approval:</p>
              <div className="space-y-1.5 text-sm">
                {modifyAction === 'add' ? (
                  <>
                    <div className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-botkorp-orange mt-0.5 flex-shrink-0" />
                      <span>{newGardenCount - gardens.length} new bot{newGardenCount - gardens.length !== 1 ? 's' : ''} deployed</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-botkorp-orange mt-0.5 flex-shrink-0" />
                      <span>New agreements created</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-botkorp-orange mt-0.5 flex-shrink-0" />
                      <span>Installation scheduled (48hrs)</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
                      <span>{gardens.length - newGardenCount} bot{gardens.length - newGardenCount !== 1 ? 's' : ''} removed</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
                      <span>Agreements terminated</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
                      <span>Pickup scheduled (48hrs)</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Signature */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Sign to Request Amendment</Label>
              <SignaturePad
                signature={modifySignature}
                onSignatureComplete={(sig) => setModifySignature(sig)}
              />
              <p className="text-xs text-muted-foreground">
                Your signature confirms this amendment request
              </p>
            </div>
          </div>

          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel onClick={() => {
              setModifySignature(null);
              setNewGardenCount(gardens.length);
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!modifySignature || processing}
              onClick={async () => {
                try {
                  setProcessing(true);
                  
                  const response = await fetch(API.CREATE_SERVICE_AMENDMENT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      user_id: user.id,
                      service_id: id,
                      amendment_type: modifyAction === 'add' ? 'add_gardens' : 'remove_gardens',
                      current_count: gardens.length,
                      new_count: newGardenCount,
                      signature_base64: modifySignature
                    })
                  });

                  if (!response.ok) throw new Error('Failed to submit');

                  toast({
                    title: 'Request Submitted',
                    description: 'Amendment pending approval - you\'ll be notified within 24hrs',
                    duration: 5000,
                  });
                  
                  setModifySignature(null);
                  setNewGardenCount(gardens.length);
                  setShowModifyDialog(false);
                } catch (error) {
                  toast({
                    title: 'Failed',
                    description: 'Could not submit amendment',
                    variant: 'destructive'
                  });
                } finally {
                  setProcessing(false);
                }
              }}
              className="bg-botkorp-orange hover:bg-botkorp-orange/90"
            >
              {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
              Submit Request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Billing Confirmation Dialog */}
      <AlertDialog open={showBillingConfirm} onOpenChange={setShowBillingConfirm}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-orange-600" />
              Confirm Billing Change
            </AlertDialogTitle>
            <AlertDialogDescription>
              Your schedule change will affect monthly billing
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {newPricing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                  <p className="text-xs text-muted-foreground mb-1">Current Monthly</p>
                  <p className="text-2xl font-bold">R{((agreements[0]?.monthly_total || 0) * gardens.length).toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{currentSchedule?.servicesPerMonth || 4} services/month</p>
                </div>
                <div className="p-4 rounded-xl bg-orange-100/80 dark:bg-orange-950/30">
                  <p className="text-xs text-orange-600 mb-1">New Monthly</p>
                  <p className="text-2xl font-bold text-orange-900 dark:text-orange-100">R{(newPricing.monthly_total * gardens.length).toFixed(2)}</p>
                  <p className="text-xs text-orange-600 mt-1">{scheduleData.servicesPerMonth} services/month</p>
                </div>
              </div>

              <Alert className="border-none bg-orange-100/80 dark:bg-orange-950/30 rounded-xl">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <AlertDescription className="text-sm text-orange-900 dark:text-orange-200">
                  <p className="font-semibold mb-2">
                    Monthly {scheduleData.servicesPerMonth > (currentSchedule?.servicesPerMonth || 4) ? 'Increase' : 'Decrease'}: 
                    {' '}
                    {scheduleData.servicesPerMonth > (currentSchedule?.servicesPerMonth || 4) ? '+' : ''}
                    R{((newPricing.monthly_total * gardens.length) - ((agreements[0]?.monthly_total || 0) * gardens.length)).toFixed(2)}
                  </p>
                  <ul className="text-xs space-y-1">
                    <li>• Changes apply from next billing cycle</li>
                    <li>• All {gardens.length} rental agreement{gardens.length !== 1 ? 's' : ''} will be updated</li>
                    <li>• Service frequency: {currentSchedule?.servicesPerMonth || 4} → {scheduleData.servicesPerMonth} per month</li>
                  </ul>
                </AlertDescription>
              </Alert>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowBillingConfirm(false);
              setNewPricing(null);
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUpdateSchedule}
              disabled={processing}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
              Confirm Billing Change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

