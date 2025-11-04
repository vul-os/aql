import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Bot, 
  Loader2, 
  Search,
  MapPin,
  Edit,
  CheckCircle,
  AlertCircle,
  Sprout,
  Building,
  Wrench,
  Plus,
  Calendar,
  DollarSign,
  FileText,
  TrendingUp,
  Activity
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import PageHeader from '@/components/ui/page-header';
import LoadingLottie from '@/components/ui/loading-lottie';
import { format } from 'date-fns';

export default function BotManagementPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { tab } = useParams();
  const [bots, setBots] = useState([]);
  const [allLocations, setAllLocations] = useState([]);
  const [gardens, setGardens] = useState([]);
  const [pools, setPools] = useState([]);
  const [unassignedGardens, setUnassignedGardens] = useState([]);
  const [unassignedPools, setUnassignedPools] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBot, setSelectedBot] = useState(null);
  const [showBotDialog, setShowBotDialog] = useState(false);
  const [showCreateBotDialog, setShowCreateBotDialog] = useState(false);
  const [showAssignmentDialog, setShowAssignmentDialog] = useState(false);
  const [selectedLocationForAssignment, setSelectedLocationForAssignment] = useState(null);
  const [showMaintenanceDialog, setShowMaintenanceDialog] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [maintenanceSearchQuery, setMaintenanceSearchQuery] = useState('');
  
  // Get current tab from URL or default to 'overview'
  const activeTab = tab || 'overview';
  
  // Handle tab change - update URL without page refresh
  const handleTabChange = (newTab) => {
    navigate(`/admin/bot-management/${newTab}`, { replace: false });
  };

  // Form for bot editing
  const [botForm, setBotForm] = useState({
    status: '',
    location_id: '',
    garden_id: ''
  });

  // Form for bot creation - simplified, assignment happens later
  const [createBotForm, setCreateBotForm] = useState({
    name: '',
    bot_type: 'mow_bot',
    serial_number: '',
    hardware_version: '',
    firmware_version: ''
  });

  // Form for maintenance logging
  const [maintenanceForm, setMaintenanceForm] = useState({
    bot_id: '',
    service_type: 'routine_maintenance',
    title: '',
    description: '',
    cost: '',
    parts_replaced: '',
    performed_by: '',
    performed_at: new Date().toISOString().slice(0, 16),
    notes: '',
    hours_spent: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load ALL bots from all locations
      const { data: botsData, error: botsError } = await supabase
        .from('bots')
        .select(`
          *,
          location:locations(id, name, city, province, address, organization:organizations(id, name)),
          bot_garden_assignments(
            garden:gardens(id, name, location_id)
          )
        `)
        .order('created_at', { ascending: false });

      if (botsError) throw botsError;
      
      // Flatten garden assignment
      const botsWithGarden = (botsData || []).map(bot => ({
        ...bot,
        assigned_garden: bot.bot_garden_assignments?.[0]?.garden || null
      }));
      
      setBots(botsWithGarden);

      // Load ALL locations with organization details
      const { data: locationsData, error: locationsError } = await supabase
        .from('locations')
        .select(`
          *,
          organization:organizations(id, name)
        `)
        .eq('is_active', true)
        .order('name');

      if (locationsError) throw locationsError;
      setAllLocations(locationsData || []);

      // Load ALL gardens
      const { data: gardensData, error: gardensError } = await supabase
        .from('gardens')
        .select(`
          *,
          location:locations(name, city)
        `)
        .eq('is_active', true)
        .order('name');

      if (gardensError) throw gardensError;
      setGardens(gardensData || []);

      // Load ALL pools
      const { data: poolsData, error: poolsError } = await supabase
        .from('pools')
        .select(`
          *,
          location:locations(name, city),
          service:services(name, service_type)
        `)
        .eq('is_active', true)
        .order('name');

      if (poolsError) throw poolsError;
      setPools(poolsData || []);

      // Find gardens without bot assignments
      const { data: gardensWithBots, error: gardenAssignError } = await supabase
        .from('bot_garden_assignments')
        .select('garden_id')
        .eq('is_active', true);

      if (gardenAssignError) throw gardenAssignError;
      
      const assignedGardenIds = new Set((gardensWithBots || []).map(a => a.garden_id));
      const unassigned = (gardensData || []).filter(g => !assignedGardenIds.has(g.id));
      setUnassignedGardens(unassigned);

      // Find pools without bot assignments
      const { data: poolsWithBots, error: poolAssignError } = await supabase
        .from('bot_pool_assignments')
        .select('pool_id')
        .eq('is_active', true);

      if (poolAssignError) throw poolAssignError;
      
      const assignedPoolIds = new Set((poolsWithBots || []).map(a => a.pool_id));
      const unassignedP = (poolsData || []).filter(p => !assignedPoolIds.has(p.id));
      setUnassignedPools(unassignedP);

      // Load maintenance records
      const { data: recordsData, error: recordsError } = await supabase
        .from('service_records')
        .select(`
          *,
          bot:bots(
            id,
            name,
            serial_number,
            location:locations(name, city)
          )
        `)
        .order('created_at', { ascending: false });

      if (recordsError) throw recordsError;
      setRecords(recordsData || []);

    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load bot data',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBot = async () => {
    try {
      setActionLoading(true);

      if (!createBotForm.name || !createBotForm.bot_type) {
        toast({
          title: 'Validation Error',
          description: 'Please enter a bot name and select a type',
          variant: 'destructive'
        });
        return;
      }

      // Create bot without location - location will be assigned later via the Manage button
      // We need a temporary location_id, so use the first available location
      const tempLocation = allLocations[0];
      if (!tempLocation) {
        toast({
          title: 'No Locations',
          description: 'Please create a location first before adding bots',
          variant: 'destructive'
        });
        return;
      }

      const { data: newBot, error: botError } = await supabase
        .from('bots')
        .insert({
          name: createBotForm.name,
          bot_type: createBotForm.bot_type,
          location_id: tempLocation.id, // Temporary - will be updated via Manage
          serial_number: createBotForm.serial_number || null,
          hardware_version: createBotForm.hardware_version || null,
          firmware_version: createBotForm.firmware_version || null,
          status: 'offline'
        })
        .select()
        .single();

      if (botError) throw botError;

      toast({
        variant: 'success',
        title: 'Bot Created',
        description: `${createBotForm.name} has been created. Use "Manage" to assign it to a location.`,
      });

      setShowCreateBotDialog(false);
      setCreateBotForm({
        name: '',
        bot_type: 'mow_bot',
        serial_number: '',
        hardware_version: '',
        firmware_version: ''
      });
      await loadData();
    } catch (error) {
      console.error('Error creating bot:', error);
      toast({
        title: 'Creation Failed',
        description: error.message || 'Failed to create bot',
        variant: 'destructive'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateBot = async () => {
    try {
      setActionLoading(true);

      // Update bot
      const { error: botError } = await supabase
        .from('bots')
        .update({
          status: botForm.status,
          location_id: botForm.location_id
        })
        .eq('id', selectedBot.id);

      if (botError) throw botError;

      // Update garden assignment if changed
      // Remove old assignment first
      await supabase
        .from('bot_garden_assignments')
        .delete()
        .eq('bot_id', selectedBot.id);

      // Add new assignment (if not "none")
      if (botForm.garden_id && botForm.garden_id !== 'none') {
        const { error: assignError } = await supabase
          .from('bot_garden_assignments')
          .insert({
            bot_id: selectedBot.id,
            garden_id: botForm.garden_id
          });

        if (assignError) throw assignError;
      }

      toast({
        variant: 'success',
        title: 'Bot Updated',
        description: 'Bot has been updated successfully.',
      });

      setShowBotDialog(false);
      await loadData();
    } catch (error) {
      console.error('Error updating bot:', error);
      toast({
        title: 'Update Failed',
        description: error.message || 'Failed to update bot',
        variant: 'destructive'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddMaintenanceRecord = async () => {
    try {
      setActionLoading(true);

      if (!maintenanceForm.bot_id || !maintenanceForm.title) {
        toast({
          title: 'Validation Error',
          description: 'Please select a bot and enter a title',
          variant: 'destructive'
        });
        return;
      }

      // Get the bot's location_id for the service record
      const selectedBotData = bots.find(b => b.id === maintenanceForm.bot_id);
      
      const { error } = await supabase
        .from('service_records')
        .insert({
          bot_id: maintenanceForm.bot_id,
          location_id: selectedBotData?.location_id,
          service_type: maintenanceForm.service_type,
          title: maintenanceForm.title,
          description: maintenanceForm.description || null,
          total_cost: maintenanceForm.cost ? parseFloat(maintenanceForm.cost) : null,
          parts_replaced: maintenanceForm.parts_replaced ? [maintenanceForm.parts_replaced] : null,
          performed_by_name: maintenanceForm.performed_by || user?.user_metadata?.full_name || 'Admin',
          service_start: maintenanceForm.performed_at,
          service_end: maintenanceForm.performed_at,
          status: 'completed'
        });

      if (error) throw error;

      toast({
        variant: 'success',
        title: 'Record Added',
        description: 'Maintenance record has been logged successfully.',
      });

      setShowMaintenanceDialog(false);
      setMaintenanceForm({
        bot_id: '',
        service_type: 'routine_maintenance',
        title: '',
        description: '',
        cost: '',
        parts_replaced: '',
        performed_by: '',
        performed_at: new Date().toISOString().slice(0, 16),
        notes: '',
        hours_spent: ''
      });
      
      await loadData();
    } catch (error) {
      console.error('Error adding record:', error);
      toast({
        title: 'Error',
        description: 'Failed to add maintenance record',
        variant: 'destructive'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      'online': { label: 'Online', className: 'bg-emerald-50 text-emerald-700 border-0 shadow-sm' },
      'offline': { label: 'Offline', className: 'bg-slate-100 text-slate-700 border-0 shadow-sm' },
      'active': { label: 'Active', className: 'bg-green-50 text-green-700 border-0 shadow-sm' },
      'idle': { label: 'Idle', className: 'bg-blue-50 text-blue-700 border-0 shadow-sm' },
      'charging': { label: 'Charging', className: 'bg-amber-50 text-amber-700 border-0 shadow-sm' },
      'error': { label: 'Error', className: 'bg-red-50 text-red-700 border-0 shadow-sm' },
      'maintenance': { label: 'Maintenance', className: 'bg-orange-50 text-orange-700 border-0 shadow-sm' }
    };
    
    const statusInfo = statusMap[status] || statusMap['offline'];
    return <Badge variant="outline" className={`${statusInfo.className} font-medium px-3 py-1 rounded-lg`}>{statusInfo.label}</Badge>;
  };

  const getServiceTypeBadge = (type) => {
    const typeMap = {
      'routine_maintenance': { label: 'Routine', className: 'bg-blue-50 text-blue-700 border-0 shadow-sm' },
      'repair': { label: 'Repair', className: 'bg-orange-50 text-orange-700 border-0 shadow-sm' },
      'battery_replacement': { label: 'Battery', className: 'bg-amber-50 text-amber-700 border-0 shadow-sm' },
      'blade_replacement': { label: 'Blade', className: 'bg-purple-50 text-purple-700 border-0 shadow-sm' },
      'sensor_calibration': { label: 'Calibration', className: 'bg-green-50 text-green-700 border-0 shadow-sm' },
      'firmware_update': { label: 'Firmware', className: 'bg-indigo-50 text-indigo-700 border-0 shadow-sm' },
      'other': { label: 'Other', className: 'bg-slate-100 text-slate-700 border-0 shadow-sm' }
    };
    
    const typeInfo = typeMap[type] || typeMap['other'];
    return <Badge variant="outline" className={`${typeInfo.className} font-medium px-3 py-1 rounded-lg`}>{typeInfo.label}</Badge>;
  };

  // Filter bots by search query
  const filteredBots = bots.filter(bot => {
    const matchesSearch = 
      bot.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bot.serial_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bot.location?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bot.location?.address?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bot.location?.organization?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bot.assigned_garden?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesSearch;
  });

  // Filter maintenance records
  const filteredRecords = records.filter(record => {
    return (
      record.title?.toLowerCase().includes(maintenanceSearchQuery.toLowerCase()) ||
      record.bot?.name?.toLowerCase().includes(maintenanceSearchQuery.toLowerCase()) ||
      record.bot?.serial_number?.toLowerCase().includes(maintenanceSearchQuery.toLowerCase()) ||
      record.performed_by_name?.toLowerCase().includes(maintenanceSearchQuery.toLowerCase()) ||
      record.description?.toLowerCase().includes(maintenanceSearchQuery.toLowerCase())
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen">
        <LoadingLottie
          src="https://lottie.host/51fee83a-3e79-41b0-8a20-77f890b9b6f1/iUangPxwIF.lottie"
          message="Loading bot data..."
          size="md"
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-[1800px] mx-auto">
      <div className="space-y-4 animate-in fade-in slide-in-from-top-3 duration-500">
        <PageHeader
          title="Bot Management"
          subtitle="Manage bot locations, assignments, status, and maintenance records"
          icon={<Bot className="h-5 w-5 text-botkorp-orange" />}
        />
      </div>

      {/* Stats Cards - Soft UI Design */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900 dark:to-slate-800/50 hover:shadow-2xl hover:shadow-botkorp-orange/10 transition-all duration-500 group animate-in fade-in slide-in-from-bottom-3 duration-500 shadow-lg">
          <div className="absolute top-0 right-0 w-32 h-32 bg-botkorp-orange/5 rounded-full blur-3xl group-hover:bg-botkorp-orange/10 transition-all duration-500" />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Bots</CardTitle>
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-botkorp-orange/10 to-botkorp-orange/5 dark:from-botkorp-orange/20 dark:to-botkorp-orange/10 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-inner">
              <Bot className="h-5 w-5 text-botkorp-orange transition-all duration-300" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-3xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">{bots.length}</div>
            <p className="text-xs text-muted-foreground font-medium mt-1.5">Across all locations</p>
          </CardContent>
        </Card>
        
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-emerald-50/30 dark:from-slate-900 dark:to-emerald-950/20 hover:shadow-2xl hover:shadow-emerald-500/10 transition-all duration-500 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-75 shadow-lg">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl group-hover:bg-emerald-500/10 transition-all duration-500" />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active Bots</CardTitle>
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 dark:from-emerald-500/20 dark:to-emerald-500/10 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-inner">
              <Activity className="h-5 w-5 text-emerald-600 transition-all duration-300" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-3xl font-bold text-emerald-600 tabular-nums">
              {bots.filter(b => b.status === 'online' || b.status === 'active').length}
            </div>
            <p className="text-xs text-muted-foreground font-medium mt-1.5">Currently online</p>
          </CardContent>
        </Card>
        
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-orange-50/30 dark:from-slate-900 dark:to-orange-950/20 hover:shadow-2xl hover:shadow-orange-500/10 transition-all duration-500 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-150 shadow-lg">
          <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-full blur-3xl group-hover:bg-orange-500/10 transition-all duration-500" />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Maintenance</CardTitle>
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-orange-500/10 to-orange-500/5 dark:from-orange-500/20 dark:to-orange-500/10 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-inner">
              <Wrench className="h-5 w-5 text-orange-600 transition-all duration-300" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-3xl font-bold text-orange-600 tabular-nums">
              {bots.filter(b => b.status === 'maintenance').length}
            </div>
            <p className="text-xs text-muted-foreground font-medium mt-1.5">In service</p>
          </CardContent>
        </Card>
        
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-blue-50/30 dark:from-slate-900 dark:to-blue-950/20 hover:shadow-2xl hover:shadow-blue-500/10 transition-all duration-500 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200 shadow-lg">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-all duration-500" />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Service Records</CardTitle>
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-500/10 to-blue-500/5 dark:from-blue-500/20 dark:to-blue-500/10 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-inner">
              <FileText className="h-5 w-5 text-blue-600 transition-all duration-300" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-3xl font-bold text-blue-600 tabular-nums">{records.length}</div>
            <p className="text-xs text-muted-foreground font-medium mt-1.5">Total logged</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full max-w-3xl grid-cols-3 h-12 p-1 bg-white dark:bg-slate-900 shadow-lg rounded-2xl border-0">
          <TabsTrigger value="overview" className="flex items-center gap-2 text-sm rounded-xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/80 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-300">
            <Bot className="h-4 w-4" />
            Bot Overview
          </TabsTrigger>
          <TabsTrigger value="unassigned" className="flex items-center gap-2 text-sm rounded-xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/80 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-300">
            <AlertCircle className="h-4 w-4" />
            Unassigned ({unassignedGardens.length + unassignedPools.length})
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="flex items-center gap-2 text-sm rounded-xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/80 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-300">
            <Wrench className="h-4 w-4" />
            Maintenance Logs
          </TabsTrigger>
        </TabsList>

        {/* Bot Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          {/* Search Bar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-botkorp-orange transition-colors duration-300" />
              <Input
                placeholder="Search by bot name, serial, location, address, or organization..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-11 h-12 text-sm border-0 bg-white dark:bg-slate-900 shadow-lg rounded-2xl focus:ring-2 focus:ring-botkorp-orange/30 focus:shadow-xl transition-all duration-300"
              />
            </div>
            <Button 
              onClick={() => setShowCreateBotDialog(true)} 
              className="w-full sm:w-auto h-12 px-6 text-sm bg-gradient-to-br from-botkorp-orange to-botkorp-orange/80 hover:from-botkorp-orange/90 hover:to-botkorp-orange/70 text-white shadow-lg hover:shadow-xl rounded-2xl transition-all duration-300 active:scale-95 group border-0"
            >
              <Plus className="h-4 w-4 mr-2 group-hover:rotate-90 transition-transform duration-300" />
              Create Bot
            </Button>
          </div>

          {/* Bots Table */}
          <Card className="border-0 shadow-xl bg-white dark:bg-slate-900 rounded-3xl animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
            <CardHeader className="pb-4 pt-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">All Bots ({filteredBots.length})</CardTitle>
                <Badge variant="secondary" className="h-7 px-3 text-xs bg-emerald-50 text-emerald-700 border-0 font-medium shadow-sm">
                  {bots.filter(b => b.status === 'online' || b.status === 'active').length} Active
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {filteredBots.length > 0 ? (
                <div className="overflow-x-auto -mx-6">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b border-slate-100 dark:border-slate-800 hover:bg-transparent">
                        <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Bot</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Current Location</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Assigned Garden</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</TableHead>
                        <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredBots.map((bot) => (
                        <TableRow key={bot.id} className="border-b border-slate-50 dark:border-slate-900 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                          <TableCell className="py-4">
                            <div>
                              <p className="font-semibold text-sm">{bot.name}</p>
                              <p className="text-xs text-muted-foreground font-mono mt-0.5">{bot.serial_number || 'No Serial'}</p>
                            </div>
                          </TableCell>
                          <TableCell className="py-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <MapPin className="h-3.5 w-3.5 text-botkorp-orange" />
                                <span className="font-medium text-sm">{bot.location?.name || 'Unassigned'}</span>
                              </div>
                              {bot.location?.address && (
                                <p className="text-xs text-muted-foreground mt-1 ml-5">{bot.location.address}</p>
                              )}
                              {bot.location?.organization && (
                                <div className="flex items-center gap-1.5 mt-1 ml-5">
                                  <Building className="h-3 w-3 text-slate-400" />
                                  <span className="text-xs text-muted-foreground">{bot.location.organization.name}</span>
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-4">
                            {bot.assigned_garden ? (
                              <div className="flex items-center gap-2">
                                <Sprout className="h-3.5 w-3.5 text-emerald-600" />
                                <span className="text-sm">{bot.assigned_garden.name}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">Not assigned</span>
                            )}
                          </TableCell>
                          <TableCell className="py-4">
                            {getStatusBadge(bot.status)}
                          </TableCell>
                          <TableCell className="text-right py-4">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 px-4 text-xs border-0 bg-slate-50 hover:bg-botkorp-orange hover:text-white shadow-sm hover:shadow-md transition-all duration-300 active:scale-95 rounded-xl"
                              onClick={() => {
                                setSelectedBot(bot);
                                setBotForm({
                                  status: bot.status,
                                  location_id: bot.location_id || '',
                                  garden_id: bot.assigned_garden?.id || ''
                                });
                                setShowBotDialog(true);
                              }}
                            >
                              <Edit className="h-3.5 w-3.5 mr-1.5" />
                              Manage
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-20 text-center">
                  <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-botkorp-orange/10 to-botkorp-orange/5 dark:from-botkorp-orange/20 dark:to-botkorp-orange/10 mb-6 shadow-inner">
                    <Bot className="h-10 w-10 text-botkorp-orange" />
                  </div>
                  <h3 className="text-base font-semibold mb-2">No bots found</h3>
                  <p className="text-sm text-muted-foreground">Try adjusting your search terms</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Unassigned Tab - Grouped by Location */}
        <TabsContent value="unassigned" className="space-y-4">
          {(() => {
            // Group unassigned items by location
            const locationGroups = {};
            
            unassignedGardens.forEach(garden => {
              const locationId = garden.location_id;
              if (!locationGroups[locationId]) {
                locationGroups[locationId] = {
                  location: garden.location,
                  gardens: [],
                  pools: []
                };
              }
              locationGroups[locationId].gardens.push(garden);
            });
            
            unassignedPools.forEach(pool => {
              const locationId = pool.location_id;
              if (!locationGroups[locationId]) {
                locationGroups[locationId] = {
                  location: pool.location,
                  gardens: [],
                  pools: []
                };
              }
              locationGroups[locationId].pools.push(pool);
            });
            
            const locationsWithUnassigned = Object.values(locationGroups);
            
            if (locationsWithUnassigned.length === 0) {
              return (
                <Card className="border-0 shadow-xl bg-white dark:bg-slate-900 rounded-3xl">
                  <CardContent className="py-20 text-center">
                    <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/20 dark:to-emerald-900/20 mb-6 shadow-inner">
                      <CheckCircle className="h-10 w-10 text-emerald-600" />
                    </div>
                    <p className="text-lg font-semibold text-emerald-600">All Gardens & Pools Assigned!</p>
                    <p className="text-sm text-muted-foreground mt-2">Every garden and pool has a bot assigned</p>
                  </CardContent>
                </Card>
              );
            }
            
            return locationsWithUnassigned.map((group, index) => (
              <Card key={index} className="border-0 shadow-xl bg-white dark:bg-slate-900 rounded-3xl overflow-hidden">
                <CardHeader className="bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800/50 border-b border-slate-100 dark:border-slate-800 py-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-3 rounded-2xl bg-gradient-to-br from-orange-100 to-orange-50 dark:from-orange-950/20 dark:to-orange-900/10 shadow-inner">
                        <MapPin className="h-5 w-5 text-orange-600" />
                      </div>
                      <div>
                        <CardTitle className="text-lg font-semibold">{group.location?.name || 'Unknown Location'}</CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          {group.gardens.length} garden{group.gardens.length !== 1 ? 's' : ''} & {group.pools.length} pool{group.pools.length !== 1 ? 's' : ''} need assignment
                        </p>
                      </div>
                    </div>
                    <Button 
                      onClick={() => {
                        setSelectedLocationForAssignment(group);
                        setShowAssignmentDialog(true);
                      }}
                      className="bg-gradient-to-br from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white shadow-lg hover:shadow-xl rounded-xl px-6 h-11 border-0 transition-all duration-300"
                    >
                      <Wrench className="h-4 w-4 mr-2" />
                      Assign Bots
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-6 pb-8">
                  <div className="space-y-6">
                    {/* Gardens */}
                    {group.gardens.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-4 flex items-center gap-2 text-slate-700 dark:text-slate-300">
                          <Sprout className="h-4 w-4 text-emerald-600" />
                          Gardens Needing Bots
                        </h4>
                        <div className="grid gap-3">
                          {group.gardens.map((garden) => (
                            <div key={garden.id} className="flex items-center justify-between p-4 rounded-2xl bg-gradient-to-br from-orange-50 to-orange-50/50 dark:from-orange-950/10 dark:to-orange-900/5 border border-orange-100 dark:border-orange-900/20 shadow-sm hover:shadow-md transition-all duration-300">
                              <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/30">
                                  <Sprout className="h-4 w-4 text-emerald-600" />
                                </div>
                                <div>
                                  <p className="font-semibold text-sm">{garden.name}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {garden.area_sqm ? `${Math.round(garden.area_sqm)}m²` : 'Area not set'} • {garden.service?.name || 'No service'}
                                  </p>
                                </div>
                              </div>
                              <Badge variant="outline" className="bg-orange-100 text-orange-700 border-0 shadow-sm font-medium px-3 py-1 rounded-lg">
                                <AlertCircle className="h-3 w-3 mr-1.5" />
                                No Bot
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Pools */}
                    {group.pools.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-4 flex items-center gap-2 text-slate-700 dark:text-slate-300">
                          <Activity className="h-4 w-4 text-blue-600" />
                          Pools Needing Bots
                        </h4>
                        <div className="grid gap-3">
                          {group.pools.map((pool) => (
                            <div key={pool.id} className="flex items-center justify-between p-4 rounded-2xl bg-gradient-to-br from-orange-50 to-orange-50/50 dark:from-orange-950/10 dark:to-orange-900/5 border border-orange-100 dark:border-orange-900/20 shadow-sm hover:shadow-md transition-all duration-300">
                              <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-950/30">
                                  <Activity className="h-4 w-4 text-blue-600" />
                                </div>
                                <div>
                                  <p className="font-semibold text-sm">{pool.name}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                                    {pool.pool_type || 'Pool'} • {pool.service?.name || 'No service'}
                                  </p>
                                </div>
                              </div>
                              <Badge variant="outline" className="bg-orange-100 text-orange-700 border-0 shadow-sm font-medium px-3 py-1 rounded-lg">
                                <AlertCircle className="h-3 w-3 mr-1.5" />
                                No Bot
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ));
          })()}
        </TabsContent>

        {/* Maintenance Tab */}
        <TabsContent value="maintenance" className="space-y-4">
          {/* Actions Bar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-botkorp-orange transition-colors duration-300" />
              <Input
                placeholder="Search records by bot, title, technician..."
                value={maintenanceSearchQuery}
                onChange={(e) => setMaintenanceSearchQuery(e.target.value)}
                className="pl-11 h-12 text-sm border-0 bg-white dark:bg-slate-900 shadow-lg rounded-2xl focus:ring-2 focus:ring-botkorp-orange/30 focus:shadow-xl transition-all duration-300"
              />
            </div>
            <Button 
              onClick={() => setShowMaintenanceDialog(true)} 
              className="w-full sm:w-auto h-12 px-6 text-sm bg-gradient-to-br from-botkorp-orange to-botkorp-orange/80 hover:from-botkorp-orange/90 hover:to-botkorp-orange/70 text-white shadow-lg hover:shadow-xl rounded-2xl transition-all duration-300 active:scale-95 group border-0"
            >
              <Plus className="h-4 w-4 mr-2 group-hover:rotate-90 transition-transform duration-300" />
              Log Maintenance
            </Button>
          </div>

          {/* Records Table */}
          <Card className="border-0 shadow-xl bg-white dark:bg-slate-900 rounded-3xl animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
            <CardHeader className="pb-4 pt-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">Maintenance History ({filteredRecords.length})</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {filteredRecords.length > 0 ? (
                <div className="overflow-x-auto -mx-6">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b border-slate-100 dark:border-slate-800 hover:bg-transparent">
                        <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Bot</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Details</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Technician</TableHead>
                        <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRecords.map((record) => (
                        <TableRow key={record.id} className="border-b border-slate-50 dark:border-slate-900 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                          <TableCell className="whitespace-nowrap py-4">
                            <div>
                              <p className="font-medium text-xs">
                                {format(new Date(record.service_start || record.created_at), 'MMM d, yyyy')}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {format(new Date(record.service_start || record.created_at), 'h:mm a')}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="py-4">
                            <div>
                              <p className="font-semibold text-sm">{record.bot?.name || 'Unknown'}</p>
                              <p className="text-xs text-muted-foreground font-mono mt-0.5">{record.bot?.serial_number}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">{record.bot?.location?.name}</p>
                            </div>
                          </TableCell>
                          <TableCell className="py-4">
                            {getServiceTypeBadge(record.service_type)}
                          </TableCell>
                          <TableCell className="max-w-md py-4">
                            <div>
                              <p className="font-medium text-sm">{record.title}</p>
                              {record.description && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{record.description}</p>
                              )}
                              {record.parts_replaced && (
                                <p className="text-xs text-blue-600 mt-1">Parts: {record.parts_replaced}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm py-4">{record.performed_by_name || 'N/A'}</TableCell>
                          <TableCell className="text-right py-4">
                            {record.total_cost ? (
                              <span className="font-bold text-sm">R{parseFloat(record.total_cost).toFixed(2)}</span>
                            ) : (
                              <span className="text-muted-foreground text-xs">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-20 text-center">
                  <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-orange-100 to-orange-50 dark:from-orange-950/20 dark:to-orange-900/10 mb-6 shadow-inner">
                    <Wrench className="h-10 w-10 text-orange-600" />
                  </div>
                  <h3 className="text-base font-semibold mb-2">No maintenance records found</h3>
                  <p className="text-sm text-muted-foreground">Log your first maintenance activity</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Bot Dialog - Improved */}
      {selectedBot && (
        <Dialog open={showBotDialog} onOpenChange={setShowBotDialog}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader className="space-y-3">
              <DialogTitle className="flex items-center gap-3 text-xl">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Bot className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <div>Manage Bot: {selectedBot.name}</div>
                  <p className="text-sm font-normal text-muted-foreground mt-1">
                    Serial: {selectedBot.serial_number || 'N/A'}
                  </p>
                </div>
              </DialogTitle>
              <DialogDescription>
                Update bot status, transfer to a different location, and manage garden assignments
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* Current Info Alert */}
              <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
                <AlertCircle className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-sm">
                  <strong className="text-blue-900 dark:text-blue-200">Current Status:</strong>
                  <div className="mt-2 space-y-1 text-blue-800 dark:text-blue-300">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5" />
                      <span>Location: {selectedBot.location?.name || 'No location'}</span>
                    </div>
                    {selectedBot.location?.organization && (
                      <div className="flex items-center gap-2">
                        <Building className="h-3.5 w-3.5" />
                        <span>Organization: {selectedBot.location.organization.name}</span>
                      </div>
                    )}
                    {selectedBot.assigned_garden && (
                      <div className="flex items-center gap-2">
                        <Sprout className="h-3.5 w-3.5" />
                        <span>Garden: {selectedBot.assigned_garden.name}</span>
                      </div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>

              <div className="grid gap-5">
                {/* Status */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Bot Status</Label>
                  <Select value={botForm.status} onValueChange={(value) => setBotForm({...botForm, status: value})}>
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="online">Online</SelectItem>
                      <SelectItem value="offline">Offline</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="idle">Idle</SelectItem>
                      <SelectItem value="charging">Charging</SelectItem>
                      <SelectItem value="error">Error</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Current operational status of the bot
                  </p>
                </div>

                {/* Location Transfer */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Location Assignment *
                  </Label>
                  <Select 
                    value={botForm.location_id} 
                    onValueChange={(value) => {
                      setBotForm({...botForm, location_id: value, garden_id: ''});
                    }}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[280px]">
                      {allLocations.map((location) => (
                        <SelectItem key={location.id} value={location.id}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{location.name}</span>
                            {location.city && (
                              <span className="text-xs text-muted-foreground">• {location.city}</span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Assign or transfer this bot to a different location
                  </p>
                </div>

                {/* Garden Assignment */}
                {botForm.location_id && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Sprout className="h-4 w-4" />
                      Garden Assignment
                    </Label>
                    <Select 
                      value={botForm.garden_id} 
                      onValueChange={(value) => setBotForm({...botForm, garden_id: value})}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="Select garden" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[280px]">
                        <SelectItem value="none">
                          <span className="text-muted-foreground italic">No garden assignment</span>
                        </SelectItem>
                        {gardens
                          .filter(g => g.location_id === botForm.location_id)
                          .map((garden) => (
                            <SelectItem key={garden.id} value={garden.id}>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{garden.name}</span>
                                <span className="text-xs text-muted-foreground">• {Math.round(garden.area_sqm)}m²</span>
                              </div>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Optional: Assign to a specific garden at this location
                    </p>
                  </div>
                )}

                {/* Change Summary */}
                {(botForm.location_id !== selectedBot.location_id || 
                  botForm.status !== selectedBot.status ||
                  botForm.garden_id !== (selectedBot.assigned_garden?.id || '')) && (
                  <Alert className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20">
                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                    <AlertDescription className="text-sm">
                      <strong className="text-emerald-900 dark:text-emerald-200">Changes to be applied:</strong>
                      <ul className="text-xs mt-2 space-y-1.5 text-emerald-800 dark:text-emerald-300">
                        {botForm.status !== selectedBot.status && (
                          <li className="flex items-center gap-2">
                            • Status: <Badge variant="outline" className="text-[10px]">{selectedBot.status}</Badge> → <Badge variant="outline" className="text-[10px]">{botForm.status}</Badge>
                          </li>
                        )}
                        {botForm.location_id !== selectedBot.location_id && (
                          <li className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            Location: {selectedBot.location?.name || 'None'} → {allLocations.find(l => l.id === botForm.location_id)?.name || 'None'}
                          </li>
                        )}
                        {botForm.garden_id !== (selectedBot.assigned_garden?.id || '') && (
                          <li className="flex items-center gap-1">
                            <Sprout className="h-3 w-3" />
                            Garden: {selectedBot.assigned_garden?.name || 'None'} → {gardens.find(g => g.id === botForm.garden_id)?.name || 'None'}
                          </li>
                        )}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>

            <DialogFooter className="gap-3">
              <Button 
                variant="outline" 
                onClick={() => setShowBotDialog(false)} 
                disabled={actionLoading}
                className="px-6 h-11 rounded-xl border-slate-200 hover:bg-slate-50"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleUpdateBot} 
                disabled={actionLoading || !botForm.location_id}
                className="px-6 h-11 rounded-xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange/80 hover:from-botkorp-orange/90 hover:to-botkorp-orange/70 text-white shadow-lg hover:shadow-xl border-0"
              >
                {actionLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create Bot Dialog */}
      <Dialog open={showCreateBotDialog} onOpenChange={setShowCreateBotDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader className="space-y-3">
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/20">
                <Bot className="h-6 w-6 text-emerald-600" />
              </div>
              Create New Bot
            </DialogTitle>
            <DialogDescription>
              Create a bot and assign it to a location afterwards using the "Manage" button
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            <div className="grid gap-5">
              {/* Bot Name */}
              <div className="space-y-2">
                <Label htmlFor="bot_name" className="text-sm font-medium">
                  Bot Name *
                </Label>
                <Input
                  id="bot_name"
                  value={createBotForm.name}
                  onChange={(e) => setCreateBotForm({...createBotForm, name: e.target.value})}
                  placeholder="e.g., MowBot-001, PoolBot-Alpha"
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">
                  A unique identifier for this bot
                </p>
              </div>

              {/* Bot Type */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Bot Type *</Label>
                <Select value={createBotForm.bot_type} onValueChange={(value) => setCreateBotForm({...createBotForm, bot_type: value})}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mow_bot">
                      <div className="flex items-center gap-2">
                        <Sprout className="h-4 w-4 text-emerald-600" />
                        <span>Mow Bot</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="pool_bot">
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-blue-600" />
                        <span>Pool Bot</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="weather_station">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-amber-600" />
                        <span>Weather Station</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="security_bot">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-slate-600" />
                        <span>Security Bot</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Serial Number */}
                <div className="space-y-2">
                  <Label htmlFor="serial_number" className="text-sm font-medium">
                    Serial Number
                  </Label>
                  <Input
                    id="serial_number"
                    value={createBotForm.serial_number}
                    onChange={(e) => setCreateBotForm({...createBotForm, serial_number: e.target.value})}
                    placeholder="SN-2024-001"
                    className="h-11"
                  />
                </div>

                {/* Hardware Version */}
                <div className="space-y-2">
                  <Label htmlFor="hardware_version" className="text-sm font-medium">
                    Hardware Version
                  </Label>
                  <Input
                    id="hardware_version"
                    value={createBotForm.hardware_version}
                    onChange={(e) => setCreateBotForm({...createBotForm, hardware_version: e.target.value})}
                    placeholder="v2.1"
                    className="h-11"
                  />
                </div>
              </div>

              {/* Firmware Version */}
              <div className="space-y-2">
                <Label htmlFor="firmware_version" className="text-sm font-medium">
                  Firmware Version
                </Label>
                <Input
                  id="firmware_version"
                  value={createBotForm.firmware_version}
                  onChange={(e) => setCreateBotForm({...createBotForm, firmware_version: e.target.value})}
                  placeholder="1.5.2"
                  className="h-11"
                />
              </div>

              <Alert className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
                <AlertDescription className="text-sm text-emerald-900 dark:text-emerald-200">
                  After creation, use the <strong>"Manage"</strong> button to assign this bot to a location and garden/pool.
                </AlertDescription>
              </Alert>
            </div>
          </div>

          <DialogFooter className="gap-3">
            <Button 
              variant="outline" 
              onClick={() => setShowCreateBotDialog(false)} 
              disabled={actionLoading}
              className="px-6 h-11 rounded-xl border-slate-200 hover:bg-slate-50"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleCreateBot} 
              disabled={actionLoading || !createBotForm.name || !createBotForm.bot_type}
              className="px-6 h-11 rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white shadow-lg hover:shadow-xl border-0"
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Create Bot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assignment Dialog */}
      {selectedLocationForAssignment && (
        <Dialog open={showAssignmentDialog} onOpenChange={setShowAssignmentDialog}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader className="space-y-3">
              <DialogTitle className="flex items-center gap-3 text-xl">
                <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/20">
                  <Wrench className="h-6 w-6 text-emerald-600" />
                </div>
                <div>
                  <div>Assign Bots to {selectedLocationForAssignment.location?.name}</div>
                  <p className="text-sm font-normal text-muted-foreground mt-1">
                    {selectedLocationForAssignment.gardens.length} garden{selectedLocationForAssignment.gardens.length !== 1 ? 's' : ''} & {selectedLocationForAssignment.pools.length} pool{selectedLocationForAssignment.pools.length !== 1 ? 's' : ''} need assignment
                  </p>
                </div>
              </DialogTitle>
              <DialogDescription>
                Assign bots to each garden and pool at this location. Create new bots if needed.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
                <AlertCircle className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-sm text-blue-900 dark:text-blue-200">
                  <strong>How to assign:</strong> Go to the Bot Overview tab, create bots if needed, then use the <strong>"Manage"</strong> button on each bot to assign it to this location and select specific gardens/pools.
                </AlertDescription>
              </Alert>

              {/* Available Bots at this location */}
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  Available Bots at {selectedLocationForAssignment.location?.name}
                </h3>
                <div className="grid gap-2">
                  {bots.filter(b => b.location_id === selectedLocationForAssignment.location?.id).length > 0 ? (
                    bots.filter(b => b.location_id === selectedLocationForAssignment.location?.id).map((bot) => (
                      <div key={bot.id} className="flex items-center justify-between p-3 rounded-lg border bg-slate-50 dark:bg-slate-900/20">
                        <div className="flex items-center gap-3">
                          <Bot className="h-4 w-4" />
                          <div>
                            <p className="font-medium">{bot.name}</p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {bot.bot_type.replace('_', ' ')} • {bot.status}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedBot(bot);
                            setBotForm({
                              status: bot.status,
                              location_id: bot.location_id || '',
                              garden_id: bot.assigned_garden?.id || ''
                            });
                            setShowAssignmentDialog(false);
                            setShowBotDialog(true);
                          }}
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Assign
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="p-6 text-center rounded-lg border border-dashed">
                      <Bot className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
                      <p className="text-sm text-muted-foreground">No bots at this location</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => {
                          setShowAssignmentDialog(false);
                          setShowCreateBotDialog(true);
                        }}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Create Bot
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Unassigned Items */}
              <div className="space-y-4">
                {selectedLocationForAssignment.gardens.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-orange-700">
                      <Sprout className="h-4 w-4" />
                      Gardens Needing Assignment
                    </h3>
                    <div className="grid gap-2">
                      {selectedLocationForAssignment.gardens.map((garden) => (
                        <div key={garden.id} className="p-3 rounded-lg border bg-orange-50/50 dark:bg-orange-950/10">
                          <div className="flex items-center gap-2">
                            <Sprout className="h-4 w-4 text-emerald-600" />
                            <span className="font-medium">{garden.name}</span>
                            <span className="text-xs text-muted-foreground">
                              • {garden.area_sqm ? `${Math.round(garden.area_sqm)}m²` : 'Area not set'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedLocationForAssignment.pools.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-orange-700">
                      <Activity className="h-4 w-4" />
                      Pools Needing Assignment
                    </h3>
                    <div className="grid gap-2">
                      {selectedLocationForAssignment.pools.map((pool) => (
                        <div key={pool.id} className="p-3 rounded-lg border bg-orange-50/50 dark:bg-orange-950/10">
                          <div className="flex items-center gap-2">
                            <Activity className="h-4 w-4 text-blue-600" />
                            <span className="font-medium">{pool.name}</span>
                            <span className="text-xs text-muted-foreground capitalize">
                              • {pool.pool_type || 'Pool'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="gap-3">
              <Button 
                variant="outline" 
                onClick={() => setShowAssignmentDialog(false)}
                className="px-6 h-11 rounded-xl border-slate-200 hover:bg-slate-50"
              >
                Close
              </Button>
              <Button 
                onClick={() => {
                  setShowAssignmentDialog(false);
                  setShowCreateBotDialog(true);
                }}
                className="px-6 h-11 rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white shadow-lg hover:shadow-xl border-0"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create New Bot
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Add Maintenance Dialog - Improved */}
      <Dialog open={showMaintenanceDialog} onOpenChange={setShowMaintenanceDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="space-y-3">
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-950/20">
                <Wrench className="h-6 w-6 text-orange-600" />
              </div>
              Log Maintenance Activity
            </DialogTitle>
            <DialogDescription>
              Record detailed maintenance, repairs, or service performed on a bot
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* Bot Selection */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">Select Bot *</Label>
              <Select value={maintenanceForm.bot_id} onValueChange={(value) => setMaintenanceForm({...maintenanceForm, bot_id: value})}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Select bot" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {bots.map((bot) => (
                    <SelectItem key={bot.id} value={bot.id}>
                      <div className="py-2">
                        <div className="flex items-center gap-2 font-medium">
                          <Bot className="h-4 w-4" />
                          {bot.name}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {bot.serial_number} • {bot.location?.name}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              {/* Service Type */}
              <div className="space-y-3">
                <Label className="text-base font-semibold">Service Type *</Label>
                <Select value={maintenanceForm.service_type} onValueChange={(value) => setMaintenanceForm({...maintenanceForm, service_type: value})}>
                  <SelectTrigger className="h-12">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="routine_maintenance">🔧 Routine Maintenance</SelectItem>
                    <SelectItem value="repair">🛠️ Repair</SelectItem>
                    <SelectItem value="battery_replacement">🔋 Battery Replacement</SelectItem>
                    <SelectItem value="blade_replacement">⚔️ Blade Replacement</SelectItem>
                    <SelectItem value="sensor_calibration">📡 Sensor Calibration</SelectItem>
                    <SelectItem value="firmware_update">💾 Firmware Update</SelectItem>
                    <SelectItem value="other">📝 Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Date/Time */}
              <div className="space-y-3">
                <Label htmlFor="datetime" className="text-base font-semibold">Date & Time *</Label>
                <Input
                  id="datetime"
                  type="datetime-local"
                  value={maintenanceForm.performed_at}
                  onChange={(e) => setMaintenanceForm({...maintenanceForm, performed_at: e.target.value})}
                  className="h-12"
                />
              </div>
            </div>

            {/* Title */}
            <div className="space-y-3">
              <Label htmlFor="title" className="text-base font-semibold">Title *</Label>
              <Input
                id="title"
                value={maintenanceForm.title}
                onChange={(e) => setMaintenanceForm({...maintenanceForm, title: e.target.value})}
                placeholder="e.g., Weekly maintenance check, Blade replacement"
                className="h-12"
              />
            </div>

            {/* Description */}
            <div className="space-y-3">
              <Label htmlFor="description" className="text-base font-semibold">Detailed Description</Label>
              <Textarea
                id="description"
                value={maintenanceForm.description}
                onChange={(e) => setMaintenanceForm({...maintenanceForm, description: e.target.value})}
                placeholder="Describe the work performed, issues found, actions taken..."
                rows={5}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">Provide comprehensive details about the maintenance activity</p>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              {/* Parts Replaced */}
              <div className="space-y-3">
                <Label htmlFor="parts" className="text-base font-semibold">Parts Replaced</Label>
                <Input
                  id="parts"
                  value={maintenanceForm.parts_replaced}
                  onChange={(e) => setMaintenanceForm({...maintenanceForm, parts_replaced: e.target.value})}
                  placeholder="e.g., Blade assembly, Battery pack"
                  className="h-12"
                />
              </div>

              {/* Cost */}
              <div className="space-y-3">
                <Label htmlFor="cost" className="text-base font-semibold flex items-center gap-1">
                  <DollarSign className="h-4 w-4" />
                  Cost (R)
                </Label>
                <Input
                  id="cost"
                  type="number"
                  step="0.01"
                  value={maintenanceForm.cost}
                  onChange={(e) => setMaintenanceForm({...maintenanceForm, cost: e.target.value})}
                  placeholder="0.00"
                  className="h-12"
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              {/* Performed By */}
              <div className="space-y-3">
                <Label htmlFor="performed_by" className="text-base font-semibold">Technician Name</Label>
                <Input
                  id="performed_by"
                  value={maintenanceForm.performed_by}
                  onChange={(e) => setMaintenanceForm({...maintenanceForm, performed_by: e.target.value})}
                  placeholder={user?.user_metadata?.full_name || "John Smith"}
                  className="h-12"
                />
              </div>

              {/* Hours Spent */}
              <div className="space-y-3">
                <Label htmlFor="hours" className="text-base font-semibold">Hours Spent</Label>
                <Input
                  id="hours"
                  type="number"
                  step="0.5"
                  value={maintenanceForm.hours_spent}
                  onChange={(e) => setMaintenanceForm({...maintenanceForm, hours_spent: e.target.value})}
                  placeholder="2.5"
                  className="h-12"
                />
              </div>
            </div>

            <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-sm text-amber-900 dark:text-amber-200">
                This record will be permanently logged and visible in maintenance history. Ensure all information is accurate.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="gap-3">
            <Button 
              variant="outline" 
              onClick={() => setShowMaintenanceDialog(false)} 
              disabled={actionLoading}
              className="px-6 h-11 rounded-xl border-slate-200 hover:bg-slate-50"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleAddMaintenanceRecord} 
              disabled={actionLoading || !maintenanceForm.bot_id || !maintenanceForm.title}
              className="px-6 h-11 rounded-xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange/80 hover:from-botkorp-orange/90 hover:to-botkorp-orange/70 text-white shadow-lg hover:shadow-xl border-0"
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              Log Maintenance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

