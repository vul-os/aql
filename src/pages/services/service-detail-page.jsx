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
  BarChart3
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { format, formatDistanceToNow } from 'date-fns';
import { API, BACKEND_URL } from '@/lib/config';
import { useAuth } from '@/context/auth-context';
import SignaturePad from '@/components/services/signature-pad';
import BotMap from '@/components/bots/bot-map';
import BotBatteryChart from '@/components/bots/bot-battery-chart';
import BotTemperatureChart from '@/components/bots/bot-temperature-chart';

export default function ServiceDetailPage() {
  const { id, tab } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [service, setService] = useState(null);
  const [gardens, setGardens] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Get current tab from URL or default to 'bot-status'
  const activeTab = tab || 'bot-status';
  
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

  // Bot status state
  const [botData, setBotData] = useState(null);
  const [botLoading, setBotLoading] = useState(false);
  const [botError, setBotError] = useState(null);

  useEffect(() => {
    if (id) {
      loadServiceDetails();
    }
  }, [id]);

  // Auto-refresh bot data when on bot-status tab
  useEffect(() => {
    if (activeTab === 'bot-status') {
      loadBotData();
      const interval = setInterval(loadBotData, 30000); // Refresh every 30 seconds
      return () => clearInterval(interval);
    }
  }, [activeTab, id]);

  const loadBotData = async () => {
    if (!id) return;
    
    try {
      setBotLoading(true);
      setBotError(null);
      
      // Get service to find location_id
      const { data: serviceData, error: serviceError } = await supabase
        .from('services')
        .select('location_id')
        .eq('id', id)
        .single();
      
      if (serviceError || !serviceData?.location_id) {
        setBotError('Service location not configured');
        setBotLoading(false);
        return;
      }
      
      // Get bot data for this location
      const { data, error: rpcError } = await supabase
        .rpc('get_location_bot_data', { location_id_input: serviceData.location_id });
      
      if (rpcError) {
        console.error('Error fetching bot data:', rpcError);
        setBotError('Unable to load bot data');
        setBotLoading(false);
        return;
      }
      
      if (!data || data.length === 0) {
        setBotError('No bot assigned yet. Bot assignment happens during installation.');
        setBotLoading(false);
        return;
      }
      
      console.log('✅ Bot data loaded:', data[0]);
      console.log('📍 Location trail points:', data[0]?.location_trail?.length || 0);
      console.log('📊 Today stats:', data[0]?.today_stats);
      setBotData(data[0]);
      setBotLoading(false);
    } catch (error) {
      console.error('Error loading bot data:', error);
      setBotError(error.message || 'An unexpected error occurred');
      setBotLoading(false);
    }
  };

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
      'pending_setup': { label: '⏳ Pending', className: 'bg-accent/10 text-accent dark:bg-accent/20' },
      'pending_installation': { label: '⏳ Pending', className: 'bg-accent/10 text-accent dark:bg-accent/20' },
      'installation_scheduled': { label: '📅 Scheduled', className: 'bg-secondary/10 text-secondary dark:bg-secondary/20' },
      'installing': { label: '🔧 Installing', className: 'bg-secondary/10 text-secondary dark:bg-secondary/20' },
      'active': { label: '✓ Active', className: 'bg-accent/10 text-accent dark:bg-accent/20' },
      'cancelled': { label: '✗ Cancelled', className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' }
    };
    
    const status = statusMap[service.status] || statusMap['active'];
    return <Badge className={`${status.className} border-0`}>{status.label}</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="max-w-7xl mx-auto p-6 md:p-8 lg:p-12 space-y-8">
        
        {/* Breadcrumb Header */}
        <div className="flex items-center gap-3 text-sm text-muted-foreground mb-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/portal/services')} className="h-9 px-3 hover:bg-slate-100">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Services
          </Button>
          <span>/</span>
          <span className="font-medium text-slate-900 dark:text-white">{service.name}</span>
        </div>

        {/* Page Header */}
        <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-white/70 to-accent/10 dark:from-secondary dark:via-secondary/40 dark:to-muted/40 p-4 md:p-6 shadow-md">
          <div className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/20 blur-2xl"></div>
          <div className="pointer-events-none absolute -bottom-12 -left-12 h-40 w-40 rounded-full bg-accent/20 blur-2xl"></div>
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 flex-1">
              <div className="flex-1">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{service.name}</h1>
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    <span>{service.location?.name}</span>
                  </div>
                  <div className="h-1 w-1 rounded-full bg-slate-300" />
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>Created {format(new Date(service.created_at), 'MMM d, yyyy')}</span>
                  </div>
                  <div className="h-1 w-1 rounded-full bg-slate-300" />
                  {getStatusBadge()}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 h-14 bg-slate-100 dark:bg-slate-900 p-1.5 rounded-xl shadow-sm">
            <TabsTrigger value="bot-status" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-md transition-all text-sm font-medium">
              <Bot className="h-4 w-4 mr-2" />
              Bot Status
            </TabsTrigger>
            <TabsTrigger value="gardens" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-md transition-all text-sm font-medium">
              <Sprout className="h-4 w-4 mr-2" />
              Gardens
            </TabsTrigger>
            <TabsTrigger value="agreements" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-md transition-all text-sm font-medium">
              <FileText className="h-4 w-4 mr-2" />
              Agreements
            </TabsTrigger>
            <TabsTrigger value="settings" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-md transition-all text-sm font-medium">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </TabsTrigger>
          </TabsList>

          {/* BOT STATUS TAB */}
          <TabsContent value="bot-status" className="space-y-6">
            {botLoading ? (
              <div className="flex items-center justify-center min-h-[400px]">
                <LoadingLottie
                  src={ANIMATIONS.loading}
                  message="Loading bot status..."
                  size="md"
                />
              </div>
            ) : botError ? (
              <Card className="border-0 shadow-lg">
                <CardContent className="p-8 text-center">
                  <div className="h-16 w-16 rounded-full bg-yellow-100 dark:bg-yellow-900/20 flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle className="w-8 h-8 text-yellow-600 dark:text-yellow-500" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">Unable to Load Bot Status</h3>
                  <p className="text-muted-foreground mb-6">{botError}</p>
                  
                  {botError.includes('No bot assigned') && (
                    <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-left max-w-md mx-auto">
                      <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                        <Info className="w-4 h-4 text-blue-600" />
                        What's Next?
                      </h4>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li>• Bots are assigned during installation</li>
                        <li>• Our team will contact you within 24-48 hours</li>
                        <li>• You'll receive a notification when your bot is active</li>
                      </ul>
                    </div>
                  )}
                  
                  <Button
                    onClick={loadBotData}
                    variant="outline"
                    className="mt-6"
                  >
                    <Activity className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                </CardContent>
              </Card>
            ) : botData ? (
              <>
                {/* Bot Status Header */}
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-green-600 via-green-500 to-emerald-400 p-6 shadow-lg">
                  <div className="absolute inset-0 bg-grid-white/10"></div>
                  <div className="relative flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-4xl">🤖</span>
                        <div>
                          <h2 className="text-2xl font-bold text-white">
                            {botData.bot_name || 'Bot Status'}
                          </h2>
                          <p className="text-green-50 text-sm">
                            {botData.bot_type === 'mow_bot' ? 'Lawn Mowing Bot' : 'Service Bot'}
                          </p>
                        </div>
                      </div>
                      {botData.latest_sensor_reading?.recorded_at && (
                        <p className="text-green-100 text-xs">
                          Last updated {formatDistanceToNow(new Date(botData.latest_sensor_reading.recorded_at), { addSuffix: true })}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge className={`${botData.bot_status === 'online' ? 'bg-white text-green-700' : 'bg-gray-500 text-white'} px-4 py-2 text-sm shadow-lg border-0`}>
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${botData.bot_status === 'online' ? 'bg-green-600 animate-pulse' : 'bg-gray-300'}`}></span>
                          {botData.bot_status?.toUpperCase() || 'OFFLINE'}
                        </div>
                      </Badge>
                      {botData.latest_sensor_reading?.is_on && (
                        <Badge className="bg-white text-green-700 px-4 py-2 shadow-lg border-0">
                          <Zap className="w-4 h-4 mr-1" />
                          Active
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                {/* Quick Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {/* Battery Card */}
                  <Card className="relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300">
                    <div className="absolute inset-0 bg-gradient-to-br from-green-400 to-emerald-600 opacity-5"></div>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-700">
                        <div className={`p-2 rounded-lg ${(botData.latest_sensor_reading?.battery_percentage || 0) > 60 ? 'bg-green-100' : (botData.latest_sensor_reading?.battery_percentage || 0) > 30 ? 'bg-yellow-100' : 'bg-red-100'}`}>
                          <Battery className={`w-5 h-5 ${(botData.latest_sensor_reading?.battery_percentage || 0) > 60 ? 'text-green-600' : (botData.latest_sensor_reading?.battery_percentage || 0) > 30 ? 'text-yellow-600' : 'text-red-600'}`} />
                        </div>
                        Battery
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-4xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
                        {botData.latest_sensor_reading?.battery_percentage || 0}%
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        {botData.latest_sensor_reading?.is_charging && <Zap className="w-3 h-3 text-yellow-500" />}
                        <p className="text-xs text-gray-600">
                          {botData.latest_sensor_reading?.is_charging ? 'Charging' : 'Not charging'}
                        </p>
                      </div>
                      <div className="mt-3 bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-500 ${(botData.latest_sensor_reading?.battery_percentage || 0) > 60 ? 'bg-green-500' : (botData.latest_sensor_reading?.battery_percentage || 0) > 30 ? 'bg-yellow-500' : 'bg-red-500'}`}
                          style={{ width: `${botData.latest_sensor_reading?.battery_percentage || 0}%` }}
                        ></div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Temperature Card */}
                  <Card className="relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300">
                    <div className="absolute inset-0 bg-gradient-to-br from-orange-400 to-red-500 opacity-5"></div>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-700">
                        <div className="p-2 rounded-lg bg-orange-100">
                          <Thermometer className="w-5 h-5 text-orange-600" />
                        </div>
                        Temperature
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-4xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent">
                        {botData.latest_sensor_reading?.temperature_celsius?.toFixed(1) || '--'}°C
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <Droplets className="w-3 h-3 text-blue-500" />
                        <p className="text-xs text-gray-600">
                          {botData.latest_sensor_reading?.humidity_percentage?.toFixed(0) || '--'}% humidity
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Activity Card */}
                  <Card className="relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-400 to-indigo-600 opacity-5"></div>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-700">
                        <div className={`p-2 rounded-lg ${botData.latest_sensor_reading?.is_on ? 'bg-blue-100' : 'bg-gray-100'}`}>
                          <Gauge className={`w-5 h-5 ${botData.latest_sensor_reading?.is_on ? 'text-blue-600' : 'text-gray-600'}`} />
                        </div>
                        Activity
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                        {botData.latest_sensor_reading?.is_on ? 'Working' : 'Idle'}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <TrendingUp className="w-3 h-3 text-blue-500" />
                        <p className="text-xs text-gray-600">
                          {botData.latest_sensor_reading?.rpm || 0} RPM
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Weather Card */}
                  <Card className="relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300">
                    <div className="absolute inset-0 bg-gradient-to-br from-sky-400 to-blue-600 opacity-5"></div>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-700">
                        <div className={`p-2 rounded-lg ${botData.latest_sensor_reading?.is_raining ? 'bg-blue-100' : 'bg-yellow-100'}`}>
                          {botData.latest_sensor_reading?.is_raining ? '🌧️' : '☀️'}
                        </div>
                        Weather
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-4xl font-bold">
                        {botData.latest_sensor_reading?.is_raining ? '🌧️' : '☀️'}
                      </div>
                      <p className="text-xs text-gray-600 mt-2">
                        {botData.latest_sensor_reading?.is_raining ? 'Rain detected' : 'Clear conditions'}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Map and Graphs */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Bot Location Map */}
                  <Card className="border-0 shadow-lg">
                    <CardHeader className="bg-gradient-to-r from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
                      <CardTitle className="flex items-center gap-2">
                        <MapPin className="w-5 h-5 text-green-600" />
                        Live Location
                      </CardTitle>
                      <CardDescription>Real-time bot position and movement trail</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                      <BotMap
                        botId={botData.bot_id}
                        currentLocation={botData.latest_sensor_reading ? {
                          lat: botData.latest_sensor_reading.latitude,
                          lng: botData.latest_sensor_reading.longitude,
                          heading: botData.latest_sensor_reading.direction_degrees || 0
                        } : null}
                        locationHistory={botData.location_trail || []}
                      />
                    </CardContent>
                  </Card>

                  {/* Today's Performance */}
                  <Card className="border-0 shadow-lg">
                    <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950">
                      <CardTitle className="flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-green-600" />
                        Today's Performance
                      </CardTitle>
                      <CardDescription>{format(new Date(), 'EEEE, MMMM d, yyyy')}</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-4">
                      {botData.today_stats ? (
                        <>
                          <div className="flex justify-between items-center p-3 rounded-lg bg-slate-50 dark:bg-slate-900">
                            <span className="text-sm text-muted-foreground flex items-center gap-2">
                              <Clock className="w-4 h-4" />
                              Runtime
                            </span>
                            <span className="font-bold text-lg">
                              {Math.floor(botData.today_stats.total_runtime_minutes / 60)}h {botData.today_stats.total_runtime_minutes % 60}m
                            </span>
                          </div>
                          <div className="flex justify-between items-center p-3 rounded-lg bg-slate-50 dark:bg-slate-900">
                            <span className="text-sm text-muted-foreground flex items-center gap-2">
                              <Navigation className="w-4 h-4" />
                              Distance
                            </span>
                            <span className="font-bold text-lg">{botData.today_stats.total_distance_meters?.toFixed(0) || 0}m</span>
                          </div>
                          <div className="flex justify-between items-center p-3 rounded-lg bg-slate-50 dark:bg-slate-900">
                            <span className="text-sm text-muted-foreground flex items-center gap-2">
                              <MapPin className="w-4 h-4" />
                              Area Covered
                            </span>
                            <span className="font-bold text-lg">{botData.today_stats.area_covered_sqm?.toFixed(0) || 0}m²</span>
                          </div>
                          <div className="flex justify-between items-center p-3 rounded-lg bg-slate-50 dark:bg-slate-900">
                            <span className="text-sm text-muted-foreground flex items-center gap-2">
                              <Battery className="w-4 h-4" />
                              Avg Battery
                            </span>
                            <span className="font-bold text-lg">{botData.today_stats.average_battery_level?.toFixed(0) || 0}%</span>
                          </div>
                          {botData.today_stats.error_count > 0 && (
                            <div className="flex justify-between items-center p-3 rounded-lg bg-red-50 dark:bg-red-950">
                              <span className="text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4" />
                                Issues
                              </span>
                              <Badge variant="destructive">{botData.today_stats.error_count} errors</Badge>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-8">No activity data available for today</p>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Battery Chart */}
                <Card className="border-0 shadow-lg">
                  <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950">
                    <CardTitle className="flex items-center gap-2">
                      <Battery className="w-5 h-5 text-green-600" />
                      Battery Level (Last 24 Hours)
                    </CardTitle>
                    <CardDescription>Track battery charge and discharge cycles</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <BotBatteryChart botId={botData.bot_id} timeRange="24h" />
                  </CardContent>
                </Card>

                {/* Temperature Chart */}
                <Card className="border-0 shadow-lg">
                  <CardHeader className="bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-950 dark:to-red-950">
                    <CardTitle className="flex items-center gap-2">
                      <Thermometer className="w-5 h-5 text-orange-600" />
                      Temperature & Humidity (Last 24 Hours)
                    </CardTitle>
                    <CardDescription>Environmental conditions during operation</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <BotTemperatureChart botId={botData.bot_id} timeRange="24h" />
                  </CardContent>
                </Card>

                {/* Recent Events */}
                {botData.recent_events && botData.recent_events.length > 0 && (
                  <Card className="border-0 shadow-lg">
                    <CardHeader className="bg-gradient-to-r from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
                      <CardTitle className="flex items-center gap-2">
                        <History className="w-5 h-5 text-blue-600" />
                        Recent Events
                      </CardTitle>
                      <CardDescription>Latest bot activities and notifications</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                      <div className="space-y-3">
                        {botData.recent_events.slice(0, 5).map((event) => (
                          <div key={event.id} className="flex items-start gap-3 p-4 border rounded-lg hover:shadow-md transition-all">
                            <div className="flex-shrink-0 mt-0.5">
                              {event.severity === 'error' || event.severity === 'critical' ? (
                                <AlertTriangle className="w-5 h-5 text-red-500" />
                              ) : event.severity === 'warning' ? (
                                <AlertTriangle className="w-5 h-5 text-yellow-500" />
                              ) : (
                                <CheckCircle className="w-5 h-5 text-green-500" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-semibold text-sm">{event.title}</h4>
                                <Badge variant={event.severity === 'error' ? 'destructive' : 'secondary'} className="text-xs">
                                  {event.severity}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">{event.description}</p>
                              {event.event_timestamp && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {formatDistanceToNow(new Date(event.event_timestamp), { addSuffix: true })}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : null}
          </TabsContent>

          {/* GARDENS TAB */}
          <TabsContent value="gardens" className="space-y-4">
            {gardens.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {gardens.map((garden, index) => (
                  <Card key={garden.id} className="border-0 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden group">
                    <CardHeader className="pb-4 pt-6">
                      <div className="flex items-start gap-3">
                        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-accent to-accent/80 flex items-center justify-center shadow-lg flex-shrink-0 group-hover:scale-110 transition-transform">
                          <Sprout className="h-7 w-7 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-lg font-bold mb-1 truncate">{garden.name}</CardTitle>
                          <p className="text-xs text-muted-foreground">Garden #{index + 1}</p>
                          <Badge variant="outline" className="mt-2 text-xs">Active</Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-center">
                          <Ruler className="h-4 w-4 text-slate-400 mx-auto mb-1" />
                          <p className="text-xl font-bold">{Math.round(garden.area_sqm)}</p>
                          <p className="text-xs text-muted-foreground">m² Area</p>
                        </div>
                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-center">
                          <Bot className="h-4 w-4 text-slate-400 mx-auto mb-1" />
                          <p className="text-xl font-bold">1</p>
                          <p className="text-xs text-muted-foreground">Bot</p>
                        </div>
                      </div>
                      {garden.created_at && (
                        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                          <span>Added</span>
                          <span className="font-medium">{format(new Date(garden.created_at), 'MMM d, yyyy')}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="border-2 border-dashed">
                <CardContent className="py-16 text-center">
                  <Sprout className="h-16 w-16 mx-auto text-slate-300 mb-4" />
                  <p className="text-lg font-medium text-slate-600">No gardens configured</p>
                  <p className="text-sm text-muted-foreground mt-2">Gardens will appear here after service setup</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* AGREEMENTS TAB */}
          <TabsContent value="agreements" className="space-y-4">
            {agreements.length > 0 ? (
              <div className="space-y-4">
                {agreements.map((agreement) => {
                  const garden = gardens.find(g => g.id === agreement.garden_id);
                  return (
                    <Card key={agreement.id} className="border-0 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden">
                      <CardHeader className="pb-4 pt-6">
                        <div className="flex flex-col gap-3">
                          <div className="flex items-start gap-3">
                            <div className="h-12 w-12 md:h-14 md:w-14 rounded-2xl bg-gradient-to-br from-secondary to-secondary/80 flex items-center justify-center shadow-lg flex-shrink-0">
                              <FileText className="h-6 w-6 md:h-7 md:w-7 text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <CardTitle className="text-base md:text-lg font-bold mb-1 break-words">{agreement.agreement_number}</CardTitle>
                              <p className="text-sm text-muted-foreground">{garden?.name || 'Unknown Garden'}</p>
                              {agreement.signed_at && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Signed {format(new Date(agreement.signed_at), 'MMM d, yyyy')}
                                </p>
                              )}
                            </div>
                            <Badge variant="outline" className="capitalize text-xs">{agreement.status}</Badge>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="p-4 md:p-5 rounded-xl bg-gradient-to-br from-secondary/5 to-secondary/10 dark:from-secondary/10 dark:to-secondary/20 border-2 border-secondary/20 dark:border-secondary/30">
                          <p className="text-xs font-medium text-secondary mb-2">Bot Rental (Monthly)</p>
                          <p className="text-3xl md:text-4xl font-bold text-foreground mb-2">
                            R{parseFloat(agreement.bot_rental_total || 0).toFixed(2)}
                          </p>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>R150/month per bot</span>
                            <span>•</span>
                            <span>{agreement.number_of_bots || 1} bot{(agreement.number_of_bots || 1) > 1 ? 's' : ''}</span>
                          </div>
                        </div>
                        {agreement.agreement_pdf_url && (
                          <Button
                            variant="outline"
                            className="w-full h-10 md:h-11 text-sm md:text-base hover:bg-accent/5 hover:border-accent/30 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(agreement.agreement_pdf_url, '_blank');
                            }}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Download PDF
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card className="border-2 border-dashed">
                <CardContent className="py-16 text-center">
                  <FileText className="h-16 w-16 mx-auto text-slate-300 mb-4" />
                  <p className="text-lg font-medium text-slate-600">No rental agreements</p>
                  <p className="text-sm text-muted-foreground mt-2">Agreements will be created after service setup</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* SETTINGS TAB */}
          <TabsContent value="settings" className="space-y-6">
            {/* Edit Service Name */}
            <Card className="border-0 shadow-lg">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    <Edit2 className="h-6 w-6 text-slate-600 dark:text-slate-400" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Service Name</CardTitle>
                    <p className="text-sm text-muted-foreground mt-0.5">Change how this service appears</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {editingName ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="serviceName">Service Name</Label>
                      <Input
                        id="serviceName"
                        value={newServiceName}
                        onChange={(e) => setNewServiceName(e.target.value)}
                        placeholder="e.g., Home - Lawn Care"
                        className="h-11 text-base"
                        autoFocus
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleUpdateServiceName}
                        disabled={processing || !newServiceName.trim()}
                        className="flex-1 h-11"
                      >
                        {processing ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4 mr-2" />
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
                        className="flex-1 h-11"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Current Name</p>
                      <p className="text-lg font-semibold">{service.name}</p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => setEditingName(true)}
                      className="h-10"
                    >
                      <Edit2 className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Service Schedule Editor */}
            <Card className="border-0 shadow-lg">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-secondary/10 dark:bg-secondary/20 flex items-center justify-center">
                    <Calendar className="h-6 w-6 text-secondary" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-xl">Service Schedule</CardTitle>
                    <p className="text-sm text-muted-foreground mt-0.5">When bots will service this property</p>
                  </div>
                  {!editingSchedule && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingSchedule(true)}
                    >
                      <Edit2 className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {editingSchedule ? (
                  <div className="space-y-6">
                    {/* Edge Trimming Frequency */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Scissors className="h-5 w-5 text-primary" />
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
                                ? 'border-primary bg-primary/10 shadow-md'
                                : 'border-border hover:border-primary/50 hover:bg-muted'
                            }`}
                          >
                            <div className="text-3xl font-bold mb-2 text-primary">{visits}</div>
                            <div className="text-xs text-muted-foreground">
                              visit{visits > 1 ? 's' : ''}/month
                            </div>
                            <div className="text-sm font-semibold mt-2">
                              R{visits * 100}
                            </div>
                            {(scheduleData.servicesPerMonth || 2) === visits && (
                              <CheckCircle className="h-5 w-5 text-primary mx-auto mt-2" />
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
                        <Calendar className="h-5 w-5 text-primary" />
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
                                ? 'border-primary bg-primary text-primary-foreground shadow-md'
                                : 'border-border hover:border-primary/50 hover:bg-muted'
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
                        <Clock className="h-5 w-5 text-primary" />
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
                      <Alert className={scheduleData.servicesPerMonth > (currentSchedule?.servicesPerMonth || 4) ? 'border-orange-200 bg-orange-50 dark:bg-orange-950/20' : 'border-accent/20 bg-accent/5 dark:bg-accent/10'}>
                        <AlertCircle className={`h-4 w-4 ${scheduleData.servicesPerMonth > (currentSchedule?.servicesPerMonth || 4) ? 'text-orange-600' : 'text-accent'}`} />
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
                    
                    <div className="flex gap-2 pt-4 border-t">
                      <Button
                        onClick={handlePrepareScheduleUpdate}
                        disabled={processing || !scheduleData.isValid}
                        className="flex-1 h-11"
                      >
                        {processing ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <CheckCircle className="h-4 w-4 mr-2" />
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
                        className="flex-1 h-11"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-5 rounded-xl bg-gradient-to-br from-secondary/5 to-secondary/10 dark:from-secondary/10 dark:to-secondary/20 border-2 border-secondary/20 dark:border-secondary/30">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Preferred Day</span>
                          <Badge variant="outline" className="capitalize">
                            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][scheduleData.dayOfWeek || 1]}
                          </Badge>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Time Window</span>
                          <Badge variant="outline">
                            {scheduleData.timeWindowStart || '08:00'} - {scheduleData.timeWindowEnd || '12:00'}
                                  </Badge>
                            </div>
                        
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Edge Trimming Visits/Month</span>
                          <Badge variant="outline">
                            {scheduleData.servicesPerMonth || 2} visit{(scheduleData.servicesPerMonth || 2) > 1 ? 's' : ''}
                                </Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Modify Gardens */}
            <Card className="border-0 shadow-lg">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-secondary/10 dark:bg-secondary/20 flex items-center justify-center">
                    <Bot className="h-6 w-6 text-secondary" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Number of Gardens</CardTitle>
                    <p className="text-sm text-muted-foreground mt-0.5">Adjust service coverage (requires approval)</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <Alert className="border-l-4 border-l-accent bg-accent/5 dark:bg-accent/10">
                  <Info className="h-4 w-4 text-accent" />
                  <AlertDescription className="text-sm text-foreground/90">
                    Each garden requires one bot. Changes need admin approval and your signature.
                  </AlertDescription>
                </Alert>

                {/* Counter - Mobile Responsive */}
                <div className="p-6 md:p-8 rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 border border-slate-200 dark:border-slate-700">
                  <div className="flex flex-col items-center gap-4">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Gardens</p>
                    
                    <div className="flex items-center justify-center gap-4 md:gap-6">
                      <Button
                        variant="outline"
                        size="lg"
                        onClick={() => newGardenCount > 1 && setNewGardenCount(newGardenCount - 1)}
                        disabled={newGardenCount <= 1}
                        className="h-14 w-14 md:h-16 md:w-16 rounded-full border-2 hover:border-orange-400 hover:bg-orange-50 disabled:opacity-20 transition-all"
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
                        className="h-14 w-14 md:h-16 md:w-16 rounded-full border-2 hover:border-accent hover:bg-accent/5 transition-all"
                      >
                        <Plus className="h-5 w-5 md:h-6 md:w-6" />
                      </Button>
                    </div>
                  </div>
                </div>

                {newGardenCount !== gardens.length && (
                  <div className="space-y-3">
                    <Alert className="border-orange-200 bg-orange-50 dark:bg-orange-950/20">
                      <AlertCircle className="h-4 w-4 text-orange-600" />
                      <AlertDescription className="text-sm text-orange-900 dark:text-orange-200">
                        <strong>Admin approval required</strong> - Changes will be reviewed within 24 hours
                      </AlertDescription>
                    </Alert>
                    
                    <Button
                      className="w-full h-12 text-base font-semibold shadow-md"
                      onClick={() => {
                        setModifyAction(newGardenCount > gardens.length ? 'add' : 'remove');
                        setShowModifyDialog(true);
                      }}
                    >
                      <FileText className="h-5 w-5 mr-2" />
                      Request Amendment ({newGardenCount > gardens.length ? '+' : ''}{newGardenCount - gardens.length} Garden{Math.abs(newGardenCount - gardens.length) !== 1 ? 's' : ''})
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Service Controls */}
            <Card className="border-0 shadow-lg">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    <Power className="h-6 w-6 text-slate-600 dark:text-slate-400" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Service Controls</CardTitle>
                    <p className="text-sm text-muted-foreground mt-0.5">Pause or manage this service</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {service.is_paused && service.paused_at && (
                  <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                    <Pause className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-sm text-amber-900 dark:text-amber-200">
                      Paused since {format(new Date(service.paused_at), 'MMM d, yyyy h:mm a')}
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  variant={service.is_paused ? "default" : "outline"}
                  className={`w-full h-11 md:h-12 justify-start text-sm md:text-base font-medium ${service.is_paused ? 'bg-accent hover:bg-accent/90 shadow-md' : ''}`}
                  onClick={() => service.is_paused ? setShowResumeDialog(true) : setShowPauseDialog(true)}
                >
                  {service.is_paused ? (
                    <>
                      <Play className="h-4 w-4 md:h-5 md:w-5 mr-2 md:mr-3" />
                      Resume Service
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4 md:h-5 md:w-5 mr-2 md:mr-3" />
                      Pause Service
                    </>
                  )}
                </Button>

                <Button
                  variant="destructive"
                  className="w-full h-11 md:h-12 justify-start text-sm md:text-base font-medium shadow-md bg-red-600 hover:bg-red-700"
                  onClick={handleEmergencyStop}
                  disabled={processing}
                >
                  <AlertTriangle className="h-4 w-4 md:h-5 md:w-5 mr-2 md:mr-3" />
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
              <Play className="h-5 w-5 text-accent" />
              Resume Service?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              All bots will restart and resume their normal schedule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResumeService} className="bg-accent hover:bg-accent/90">
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
              <div className="h-12 w-12 rounded-xl bg-secondary/10 dark:bg-secondary/20 flex items-center justify-center">
                <FileText className="h-6 w-6 text-secondary" />
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
            <Alert className="border-orange-200 bg-orange-50 dark:bg-orange-950/20">
              <AlertCircle className="h-4 w-4 text-orange-600" />
              <AlertDescription className="text-sm text-orange-900 dark:text-orange-200">
                <strong>Admin approval required</strong> - Changes will be reviewed within 24 hours
              </AlertDescription>
            </Alert>

            {/* Summary */}
            <div className="grid grid-cols-3 gap-4 p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50">
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">Current</p>
                <p className="text-3xl font-bold">{gardens.length}</p>
              </div>
              <div className="flex items-center justify-center">
                <ArrowRight className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">New</p>
                <p className="text-3xl font-bold text-accent">{newGardenCount}</p>
              </div>
            </div>

            {/* Impact */}
            <div className="space-y-2">
              <p className="font-semibold text-sm">What happens after approval:</p>
              <div className="space-y-1.5 text-sm">
                {modifyAction === 'add' ? (
                  <>
                    <div className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-accent mt-0.5 flex-shrink-0" />
                      <span>{newGardenCount - gardens.length} new bot{newGardenCount - gardens.length !== 1 ? 's' : ''} deployed</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-accent mt-0.5 flex-shrink-0" />
                      <span>New agreements created</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-accent mt-0.5 flex-shrink-0" />
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
              className="bg-accent hover:bg-accent/90"
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
                <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50 border">
                  <p className="text-xs text-muted-foreground mb-1">Current Monthly</p>
                  <p className="text-2xl font-bold">R{((agreements[0]?.monthly_total || 0) * gardens.length).toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{currentSchedule?.servicesPerMonth || 4} services/month</p>
                </div>
                <div className="p-4 rounded-lg bg-orange-50 dark:bg-orange-950/20 border-2 border-orange-200">
                  <p className="text-xs text-orange-600 mb-1">New Monthly</p>
                  <p className="text-2xl font-bold text-orange-900 dark:text-orange-100">R{(newPricing.monthly_total * gardens.length).toFixed(2)}</p>
                  <p className="text-xs text-orange-600 mt-1">{scheduleData.servicesPerMonth} services/month</p>
                </div>
              </div>

              <Alert className="border-orange-200 bg-orange-50 dark:bg-orange-950/20">
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
    </div>
  );
}

