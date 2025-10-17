import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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
  DollarSign
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { API, BACKEND_URL } from '@/lib/config';
import { useAuth } from '@/context/auth-context';
import SignaturePad from '@/components/services/signature-pad';
import ScheduleSelector from '@/components/services/schedule-selector';

export default function ServiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [service, setService] = useState(null);
  const [gardens, setGardens] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  
  const [showPauseDialog, setShowPauseDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showModifyDialog, setShowModifyDialog] = useState(false);
  const [modifyAction, setModifyAction] = useState(null);
  const [newGardenCount, setNewGardenCount] = useState(1);
  const [modifySignature, setModifySignature] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newServiceName, setNewServiceName] = useState('');
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleData, setScheduleData] = useState({
    scheduleType: 'weekly',
    weeklyDays: [],
    monthlyDays: [],
    preferredTime: '10:00',
    servicesPerMonth: 4,
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

      // Load existing schedule from service_schedules
      const { data: scheduleRecords, error: scheduleError } = await supabase
        .from('service_schedules')
        .select('*')
        .eq('service_id', id)
        .limit(1);

      if (!scheduleError && scheduleRecords && scheduleRecords.length > 0) {
        const record = scheduleRecords[0];
        const loadedSchedule = {
          scheduleType: record.schedule_type || 'weekly',
          weeklyDays: record.weekly_days || [],
          monthlyDays: record.monthly_days || [],
          preferredTime: record.preferred_time || '10:00',
          servicesPerMonth: record.max_services_per_month || 4,
          isValid: true
        };
        setScheduleData(loadedSchedule);
        setCurrentSchedule(loadedSchedule);
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

  const handleCancelService = async () => {
    try {
      setProcessing(true);
      
      const { error } = await supabase
        .from('services')
        .update({
          status: 'cancelled',
          is_active: false,
          cancelled_at: new Date().toISOString(),
          cancellation_reason: 'Cancelled by user'
        })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Service Cancelled',
        description: 'Service has been cancelled successfully.',
      });

      setShowCancelDialog(false);
      setTimeout(() => navigate('/portal/services'), 2000);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to cancel service',
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

      // Update service frequency and billing
      const { error: serviceError } = await supabase
        .from('services')
        .update({
          service_frequency: scheduleData.scheduleType,
          services_per_month: scheduleData.servicesPerMonth || 4
        })
        .eq('id', id);

      if (serviceError) throw serviceError;

      // Update all schedules for this service
      const { error } = await supabase
        .from('service_schedules')
        .update({
          schedule_type: scheduleData.scheduleType,
          weekly_days: scheduleData.weeklyDays || [],
          monthly_days: scheduleData.monthlyDays || [],
          preferred_time: scheduleData.preferredTime,
          max_services_per_month: scheduleData.servicesPerMonth || 4
        })
        .eq('service_id', id);

      if (error) throw error;

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
      'pending_setup': { label: '⏳ Pending', className: 'bg-blue-100 text-blue-800' },
      'pending_installation': { label: '⏳ Pending', className: 'bg-blue-100 text-blue-800' },
      'installation_scheduled': { label: '📅 Scheduled', className: 'bg-purple-100 text-purple-800' },
      'installing': { label: '🔧 Installing', className: 'bg-indigo-100 text-indigo-800' },
      'active': { label: '✓ Active', className: 'bg-emerald-100 text-emerald-800' },
      'cancelled': { label: '✗ Cancelled', className: 'bg-red-100 text-red-800' }
    };
    
    const status = statusMap[service.status] || statusMap['active'];
    return <Badge className={`${status.className} border-0`}>{status.label}</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
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
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 h-14 bg-slate-100 dark:bg-slate-900 p-1.5 rounded-xl shadow-sm">
            <TabsTrigger value="overview" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-md transition-all text-sm font-medium">
              <CircleDot className="h-4 w-4 mr-2" />
              Overview
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

          {/* OVERVIEW TAB */}
          <TabsContent value="overview" className="space-y-6">
            {/* Status Alerts */}
            {service.is_paused && service.paused_at && (
              <Alert className="border-l-4 border-l-amber-500 bg-gradient-to-r from-amber-50 to-transparent dark:from-amber-950/20">
                <Pause className="h-5 w-5 text-amber-600" />
                <AlertDescription className="text-amber-900 dark:text-amber-200">
                  <p className="font-semibold">Service Paused</p>
                  <p className="text-sm mt-1">Since {format(new Date(service.paused_at), 'MMM d, yyyy h:mm a')}</p>
                </AlertDescription>
              </Alert>
            )}

            {service.status === 'pending_setup' && (
              <Alert className="border-l-4 border-l-blue-500 bg-gradient-to-r from-blue-50 to-transparent dark:from-blue-950/20">
                <Info className="h-5 w-5 text-blue-600" />
                <AlertDescription className="text-blue-900 dark:text-blue-200">
                  <p className="font-semibold">Installation Pending</p>
                  <p className="text-sm mt-1">Our team will contact you within 24-48 hours to schedule setup</p>
                </AlertDescription>
              </Alert>
            )}

            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg">
                      <Sprout className="h-7 w-7 text-white" />
                    </div>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 dark:text-white mb-1">{gardens.length}</p>
                  <p className="text-sm text-muted-foreground font-medium">Gardens Managed</p>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
                      <Bot className="h-7 w-7 text-white" />
                    </div>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 dark:text-white mb-1">{gardens.length}</p>
                  <p className="text-sm text-muted-foreground font-medium">Bots Active</p>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center shadow-lg">
                      <Ruler className="h-7 w-7 text-white" />
                    </div>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 dark:text-white mb-1">{Math.round(totalArea)}</p>
                  <p className="text-sm text-muted-foreground font-medium">Square Meters</p>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center shadow-lg">
                      <Activity className="h-7 w-7 text-white" />
                    </div>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 dark:text-white mb-1">{service.services_per_month || 4}</p>
                  <p className="text-sm text-muted-foreground font-medium">Services / Month</p>
                </CardContent>
              </Card>
            </div>

            {/* Service Details */}
            <Card className="border-0 shadow-lg">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl">Service Details</CardTitle>
              </CardHeader>
              <CardContent className="grid md:grid-cols-2 gap-x-8 gap-y-4">
                <div className="flex items-center justify-between py-3 border-b">
                  <span className="text-sm font-medium text-muted-foreground">Service Type</span>
                  <Badge variant="secondary" className="capitalize font-medium">{service.service_type}</Badge>
                </div>
                <div className="flex items-center justify-between py-3 border-b">
                  <span className="text-sm font-medium text-muted-foreground">Schedule</span>
                  <span className="font-semibold capitalize">{service.service_frequency || 'Weekly'}</span>
                </div>
                <div className="flex items-center justify-between py-3 border-b">
                  <span className="text-sm font-medium text-muted-foreground">Location</span>
                  <span className="font-semibold">{service.location?.name}</span>
                </div>
                <div className="flex items-center justify-between py-3 border-b">
                  <span className="text-sm font-medium text-muted-foreground">City</span>
                  <span className="font-semibold">{service.location?.city || 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between py-3">
                  <span className="text-sm font-medium text-muted-foreground">Status</span>
                  <span className="font-semibold capitalize">{service.status?.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex items-center justify-between py-3">
                  <span className="text-sm font-medium text-muted-foreground">Created</span>
                  <span className="font-semibold">{format(new Date(service.created_at), 'MMM d, yyyy')}</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* GARDENS TAB */}
          <TabsContent value="gardens" className="space-y-4">
            {gardens.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {gardens.map((garden, index) => (
                  <Card key={garden.id} className="border-0 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden group">
                    <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600" />
                    <CardHeader className="pb-4 pt-6">
                      <div className="flex items-start gap-3">
                        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg flex-shrink-0 group-hover:scale-110 transition-transform">
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
                      <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 to-blue-600" />
                      <CardHeader className="pb-4 pt-6">
                        <div className="flex flex-col gap-3">
                          <div className="flex items-start gap-3">
                            <div className="h-12 w-12 md:h-14 md:w-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg flex-shrink-0">
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
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="p-3 md:p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900">
                            <p className="text-[10px] md:text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-1">Monthly Total</p>
                            <p className="text-xl md:text-2xl font-bold text-emerald-900 dark:text-emerald-100">
                              R{parseFloat(agreement.monthly_total || 0).toFixed(2)}
                            </p>
                          </div>
                          <div className="p-3 md:p-4 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900">
                            <p className="text-[10px] md:text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">Bot Rental</p>
                            <p className="text-xl md:text-2xl font-bold text-blue-900 dark:text-blue-100">
                              R{parseFloat(agreement.bot_rental_total || 0).toFixed(2)}
                            </p>
                          </div>
                          <div className="p-3 md:p-4 rounded-xl bg-purple-50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900">
                            <p className="text-[10px] md:text-xs font-medium text-purple-600 dark:text-purple-400 mb-1">Service Fee</p>
                            <p className="text-xl md:text-2xl font-bold text-purple-900 dark:text-purple-100">
                              R{parseFloat(agreement.service_total || 0).toFixed(2)}
                            </p>
                          </div>
                        </div>
                        {agreement.agreement_pdf_url && (
                          <Button
                            variant="outline"
                            className="w-full h-10 md:h-11 text-sm md:text-base hover:bg-blue-50 hover:border-blue-200 transition-colors"
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
                  <div className="h-12 w-12 rounded-xl bg-purple-100 dark:bg-purple-950 flex items-center justify-center">
                    <Calendar className="h-6 w-6 text-purple-600 dark:text-purple-400" />
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
                  <div className="space-y-4">
                    <ScheduleSelector
                      schedule={scheduleData}
                      onChange={(newSchedule) => setScheduleData(newSchedule)}
                      maxServicesPerMonth={8}
                    />
                    
                    {/* Billing Impact Alert */}
                    {scheduleData.servicesPerMonth !== currentSchedule?.servicesPerMonth && (
                      <Alert className={scheduleData.servicesPerMonth > (currentSchedule?.servicesPerMonth || 4) ? 'border-orange-200 bg-orange-50 dark:bg-orange-950/20' : 'border-green-200 bg-green-50 dark:bg-green-950/20'}>
                        <AlertCircle className={`h-4 w-4 ${scheduleData.servicesPerMonth > (currentSchedule?.servicesPerMonth || 4) ? 'text-orange-600' : 'text-green-600'}`} />
                        <AlertDescription className={`text-sm ${scheduleData.servicesPerMonth > (currentSchedule?.servicesPerMonth || 4) ? 'text-orange-900 dark:text-orange-200' : 'text-green-900 dark:text-green-200'}`}>
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
                    <div className="p-5 rounded-xl bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/20 dark:to-purple-900/10 border-2 border-purple-200 dark:border-purple-800">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Type</span>
                          <Badge variant="outline" className="capitalize">{scheduleData.scheduleType}</Badge>
                        </div>
                        
                        {scheduleData.weeklyDays?.length > 0 && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-2">Weekly Days</p>
                            <div className="flex flex-wrap gap-1.5">
                              {scheduleData.weeklyDays.map(day => {
                                const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                                return (
                                  <Badge key={day} variant="secondary" className="text-xs">
                                    {dayNames[day]}
                                  </Badge>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        
                        {scheduleData.monthlyDays?.length > 0 && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-2">Monthly Days</p>
                            <div className="flex flex-wrap gap-1.5">
                              {scheduleData.monthlyDays.map(day => (
                                <Badge key={day} variant="secondary" className="text-xs">
                                  {day}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        <div className="flex items-center justify-between pt-2 border-t">
                          <span className="text-sm text-muted-foreground">Preferred Time</span>
                          <span className="font-semibold">{scheduleData.preferredTime}</span>
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
                  <div className="h-12 w-12 rounded-xl bg-blue-100 dark:bg-blue-950 flex items-center justify-center">
                    <Bot className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Number of Gardens</CardTitle>
                    <p className="text-sm text-muted-foreground mt-0.5">Adjust service coverage (requires approval)</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <Alert className="border-l-4 border-l-blue-500 bg-blue-50 dark:bg-blue-950/20">
                  <Info className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-sm text-blue-900 dark:text-blue-200">
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
                        className="h-14 w-14 md:h-16 md:w-16 rounded-full border-2 hover:border-emerald-400 hover:bg-emerald-50 transition-all"
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
                    <p className="text-sm text-muted-foreground mt-0.5">Pause or cancel this service</p>
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
                  className={`w-full h-11 md:h-12 justify-start text-sm md:text-base font-medium ${service.is_paused ? 'bg-emerald-600 hover:bg-emerald-700 shadow-md' : ''}`}
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
                  className="w-full h-11 md:h-12 justify-start text-sm md:text-base font-medium shadow-md"
                  onClick={() => setShowCancelDialog(true)}
                >
                  <X className="h-4 w-4 md:h-5 md:w-5 mr-2 md:mr-3" />
                  Cancel Service
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
              <Play className="h-5 w-5 text-emerald-600" />
              Resume Service?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              All bots will restart and resume their normal schedule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResumeService} className="bg-emerald-600 hover:bg-emerald-700">
              Resume Service
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-xl">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Cancel Service?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <Alert className="border-red-200 bg-red-50 dark:bg-red-950/20">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-800 dark:text-red-200 text-xs">
                    <strong>Warning:</strong> This action cannot be undone
                  </AlertDescription>
                </Alert>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• {gardens.length} gardens will be removed</li>
                  <li>• {agreements.length} agreements will be terminated</li>
                  <li>• Bots will be scheduled for pickup</li>
                  <li>• Final invoice will be generated</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Service</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelService} className="bg-red-600 hover:bg-red-700">
              Yes, Cancel Service
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
              <div className="h-12 w-12 rounded-xl bg-blue-100 dark:bg-blue-950 flex items-center justify-center">
                <FileText className="h-6 w-6 text-blue-600" />
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
                <p className="text-3xl font-bold text-blue-600">{newGardenCount}</p>
              </div>
            </div>

            {/* Impact */}
            <div className="space-y-2">
              <p className="font-semibold text-sm">What happens after approval:</p>
              <div className="space-y-1.5 text-sm">
                {modifyAction === 'add' ? (
                  <>
                    <div className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                      <span>{newGardenCount - gardens.length} new bot{newGardenCount - gardens.length !== 1 ? 's' : ''} deployed</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                      <span>New agreements created</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
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
              className="bg-blue-600 hover:bg-blue-700"
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

