import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import LoadingLottie from '@/components/ui/loading-lottie';
import { ANIMATIONS } from '@/lib/animations';
import {
  Sprout,
  MapPin,
  Plus,
  ArrowRight,
  Info,
  Bot,
  Ruler,
  Search,
  Droplets,
  Shield,
  CloudSun,
  Circle,
  Activity,
  LayoutGrid,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  MoreVertical,
  Calendar,
  SortAsc,
  SortDesc,
  Filter,
  FileDown,
  Grid3x3,
  List,
  Clock,
  CheckCircle2,
  Pause,
  AlertCircle,
  BarChart3,
  Zap,
  Eye,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import LocationWizard from '@/components/services/location-wizard';
import PageHeader from '@/components/ui/page-header';
import { format, subDays, isAfter } from 'date-fns';

export default function ServicesPage() {
  const { selectedOrg, selectedLocation } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState([]);
  const [showLocationWizard, setShowLocationWizard] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [activeTab, setActiveTab] = useState('all');
  const [viewMode, setViewMode] = useState('grid'); // grid or list
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [serviceTypeFilter, setServiceTypeFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [selectedServices, setSelectedServices] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);

  useEffect(() => {
    if (selectedOrg) {
      loadData();
    }
  }, [selectedOrg]);

  const loadData = async () => {
    if (!selectedOrg?.organization_id) return;

    try {
      setLoading(true);

      const { data: locationsData } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', selectedOrg.organization_id)
        .eq('is_active', true);

      setLocations(locationsData || []);

      if (!locationsData || locationsData.length === 0) {
        setServices([]);
        setLoading(false);
        return;
      }

      const { data: servicesData, error: servicesError } = await supabase
        .from('services')
        .select(`
          *,
          location:locations(name, city, province, address)
        `)
        .in('location_id', locationsData.map(l => l.id))
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (servicesError) throw servicesError;

      const servicesWithDetails = await Promise.all((servicesData || []).map(async (service) => {
        const { data: serviceGardens } = await supabase
          .from('gardens')
          .select('id, name, area_sqm')
          .eq('service_id', service.id)
          .eq('is_active', true);
        
        const totalArea = (serviceGardens || []).reduce((sum, g) => sum + parseFloat(g.area_sqm || 0), 0);
        
        return {
          ...service,
          garden_count: (serviceGardens || []).length,
          bot_count: (serviceGardens || []).length,
          total_area: totalArea
        };
      }));
      
      setServices(servicesWithDetails);

      // Generate recent activity
      const activity = servicesWithDetails.slice(0, 6).map(service => ({
        type: service.status === 'active' ? 'activated' : 'created',
        service: service,
        timestamp: service.updated_at || service.created_at
      })).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      setRecentActivity(activity);

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

  const getServiceIcon = (type) => {
    switch (type) {
      case 'lawn': return Sprout;
      case 'pool': return Droplets;
      case 'security': return Shield;
      case 'weather': return CloudSun;
      default: return Sprout;
    }
  };

  const getStatusInfo = (service) => {
    if (service.is_paused) {
      return { text: 'Paused', color: 'bg-amber-500/80', icon: Pause };
    }
    
    switch (service.status) {
      case 'pending_setup':
      case 'pending_installation':
        return { text: 'Pending', color: 'bg-orange-500/80', icon: Clock };
      case 'installation_scheduled':
        return { text: 'Scheduled', color: 'bg-blue-500/80', icon: Calendar };
      case 'active':
        return { text: 'Active', color: 'bg-green-500/80', icon: CheckCircle2 };
      default:
        return { text: 'Active', color: 'bg-green-500/80', icon: CheckCircle2 };
    }
  };

  // Export services to CSV
  const handleExportServices = () => {
    if (filteredAndSortedServices.length === 0) {
      toast({
        title: "No data to export",
        description: "There are no services to export",
        variant: "destructive"
      });
      return;
    }

    const csvContent = [
      ['Name', 'Type', 'Status', 'Location', 'Gardens', 'Bots', 'Area (m²)', 'Created'],
      ...filteredAndSortedServices.map(service => [
        service.name,
        service.service_type || 'N/A',
        getStatusInfo(service).text,
        service.location?.name || 'N/A',
        service.garden_count,
        service.bot_count,
        Math.round(service.total_area),
        format(new Date(service.created_at), 'yyyy-MM-dd')
      ])
    ];

    const csv = csvContent.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `services-export-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    toast({
      title: "Export successful",
      description: `Exported ${filteredAndSortedServices.length} services to CSV`,
    });
  };

  // Filtering and sorting logic
  const filteredAndSortedServices = useMemo(() => {
    let filtered = services.filter(service => {
      // Search filter
      const matchesSearch = service.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           service.location?.name?.toLowerCase().includes(searchQuery.toLowerCase());
      
      if (!matchesSearch) return false;

      // Tab filter
      if (activeTab === 'active' && (service.status !== 'active' || service.is_paused)) return false;
      if (activeTab === 'pending' && service.status !== 'pending_setup' && service.status !== 'pending_installation') return false;
      if (activeTab === 'paused' && !service.is_paused) return false;

      // Type filter
      if (serviceTypeFilter !== 'all' && service.service_type !== serviceTypeFilter) return false;

      // Location filter
      if (locationFilter !== 'all' && service.location_id !== locationFilter) return false;

      return true;
    });

    // Sorting
    filtered.sort((a, b) => {
      let aVal, bVal;

      switch (sortBy) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'area':
          aVal = a.total_area;
          bVal = b.total_area;
          break;
        case 'bots':
          aVal = a.bot_count;
          bVal = b.bot_count;
          break;
        case 'created_at':
        default:
          aVal = new Date(a.created_at);
          bVal = new Date(b.created_at);
          break;
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [services, searchQuery, activeTab, serviceTypeFilter, locationFilter, sortBy, sortOrder]);

  const filteredServices = filteredAndSortedServices;

  const activeCount = services.filter(s => s.status === 'active' && !s.is_paused).length;
  const pendingCount = services.filter(s => s.status === 'pending_setup' || s.status === 'pending_installation').length;
  const pausedCount = services.filter(s => s.is_paused).length;
  const totalBots = services.reduce((sum, s) => sum + s.bot_count, 0);
  const totalArea = services.reduce((sum, s) => sum + s.total_area, 0);
  
  // Calculate trends (comparing to last week - simulated for now)
  const recentServices = services.filter(s => {
    const createdDate = new Date(s.created_at);
    return isAfter(createdDate, subDays(new Date(), 7));
  }).length;

  if (showLocationWizard) {
    return (
      <div className="p-6">
        <LocationWizard
          organizationId={selectedOrg.organization_id}
          onComplete={() => {
            setShowLocationWizard(false);
            loadData();
          }}
          onCancel={() => setShowLocationWizard(false)}
          embedded={false}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen">
        <LoadingLottie
          src={ANIMATIONS.loading}
          message="Loading services..."
          size="md"
        />
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="p-3 md:p-5 space-y-5 max-w-[1600px] mx-auto">
        <div className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-top-3 duration-500">
          <PageHeader
            title="Services"
            subtitle="Manage your automated property services"
            icon={<Sprout className="h-5 w-5 text-botkorp-orange" />}
          />
        </div>
        
        <div className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl p-12 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mb-5 animate-in zoom-in-50 duration-500 delay-100 shadow-[0_8px_30px_rgb(255,107,53,0.15)]">
            <MapPin className="h-10 w-10 text-botkorp-orange animate-pulse" />
          </div>
          <h3 className="text-xl font-bold mb-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
            Add Your First Location
          </h3>
          <p className="text-muted-foreground mb-8 max-w-sm mx-auto text-sm leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
            Before creating services, add a location where you'd like to deploy bot services
          </p>
          <Button 
            onClick={() => setShowLocationWizard(true)}
            className="h-11 px-6 text-xs font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 text-white rounded-xl shadow-[4px_4px_12px_rgba(255,107,53,0.3),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(255,107,53,0.4),-3px_-3px_10px_rgba(255,255,255,0.15)] hover:-translate-y-0.5 transition-all duration-300 active:scale-95 border-0 animate-in fade-in zoom-in-50 delay-400"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Location
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="p-3 md:p-5 space-y-5 max-w-[1600px] mx-auto">
        {/* Header Section - Soft UI */}
        <div className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-top-3 duration-500">
          <PageHeader
            title="Services"
            subtitle={`Manage your automated services across ${locations.length} location${locations.length !== 1 ? 's' : ''}`}
            icon={<Sprout className="h-5 w-5 text-botkorp-orange" />}
          />

          {/* Action Bar */}
          <div className="flex justify-end mt-4">
            <Button 
              onClick={() => navigate('/portal/services/add')}
              className="w-full sm:w-auto h-10 px-5 text-xs font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 text-white rounded-xl shadow-[4px_4px_12px_rgba(255,107,53,0.3),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(255,107,53,0.4),-3px_-3px_10px_rgba(255,255,255,0.15)] hover:-translate-y-0.5 transition-all duration-300 active:scale-95 border-0 group"
            >
              <Plus className="h-4 w-4 mr-2 group-hover:rotate-90 transition-transform duration-300" />
              Create Service
            </Button>
          </div>
        </div>

        {/* Empty State - Soft UI */}
        <div className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl p-12 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mb-5 animate-in zoom-in-50 duration-500 delay-100 shadow-[0_8px_30px_rgb(255,107,53,0.15)]">
            <Sprout className="h-10 w-10 text-botkorp-orange animate-pulse" />
          </div>
          <h3 className="text-xl font-bold mb-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
            Ready to Automate?
          </h3>
          <p className="text-muted-foreground mb-8 max-w-sm mx-auto text-sm leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
            Create your first automated service and experience the future of property management
          </p>

          <div className="grid grid-cols-2 gap-3 max-w-md mx-auto mb-8">
            {[
              { icon: Sprout, label: 'Lawn Care', color: 'text-green-600' },
              { icon: Droplets, label: 'Pool Cleaning', color: 'text-blue-600' },
              { icon: Shield, label: 'Security', color: 'text-amber-600' },
              { icon: CloudSun, label: 'Weather', color: 'text-sky-600' }
            ].map(({ icon: Icon, label, color }) => (
              <div key={label} className="p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all hover:scale-105 duration-300">
                <Icon className={`h-6 w-6 ${color} mb-2 mx-auto`} />
                <p className="text-xs font-medium">{label}</p>
              </div>
            ))}
          </div>

          <Button 
            onClick={() => navigate('/portal/services/add')} 
            className="h-11 px-6 text-xs font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 text-white rounded-xl shadow-[4px_4px_12px_rgba(255,107,53,0.3),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(255,107,53,0.4),-3px_-3px_10px_rgba(255,255,255,0.15)] hover:-translate-y-0.5 transition-all duration-300 active:scale-95 border-0 animate-in fade-in zoom-in-50 delay-400"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Your First Service
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 md:p-4 space-y-3 max-w-[1800px] mx-auto">
      {/* Header Section - Soft UI */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 animate-in fade-in slide-in-from-top-3 duration-500">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">Services</h1>
          <p className="text-xs text-muted-foreground mt-1 font-medium">
            Manage your automated property services across {locations.length} location{locations.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline"
            onClick={handleExportServices}
            className="h-9 px-3 text-xs font-semibold rounded-xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300 active:scale-95"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button 
            onClick={() => navigate('/portal/services/add')}
            className="bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 hover:from-botkorp-orange/90 hover:to-botkorp-orange text-white h-9 px-4 text-xs font-semibold rounded-xl shadow-[4px_4px_12px_rgba(255,107,53,0.3),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(255,107,53,0.4),-3px_-3px_10px_rgba(255,255,255,0.15)] transition-all duration-300 active:scale-95 border-0"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Service
          </Button>
        </div>
      </div>

      {/* Enhanced Stats - Soft UI */}
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-4 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-100">
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Services</p>
                <p className="text-2xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{services.length}</p>
                <div className="flex items-center gap-1 text-xs">
                  <TrendingUp className="h-3 w-3 text-green-600" />
                  <span className="text-green-600 font-medium">{recentServices}</span>
                  <span className="text-muted-foreground">this week</span>
                </div>
              </div>
              <img src="/images/house.png" alt="Total Services" className="h-12 w-12 object-contain group-hover:scale-110 transition-all duration-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Active Now</p>
                <p className="text-2xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{activeCount}</p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Zap className="h-3 w-3" />
                  <span>{Math.round((activeCount / (services.length || 1)) * 100)}% operational</span>
                </div>
              </div>
              <img src="/images/active-icon.png" alt="Active Now" className="h-12 w-12 object-contain group-hover:scale-110 transition-all duration-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Bots Deployed</p>
                <p className="text-2xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{totalBots}</p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Bot className="h-3 w-3" />
                  <span>Automated units</span>
                </div>
              </div>
              <img src="/images/3d-bot.png" alt="Bots Deployed" className="h-12 w-12 object-contain group-hover:scale-110 transition-all duration-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Coverage</p>
                <p className="text-2xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{(totalArea / 1000).toFixed(1)}k</p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Ruler className="h-3 w-3" />
                  <span>{Math.round(totalArea).toLocaleString()} m²</span>
                </div>
              </div>
              <img src="/images/3d-coverage.png" alt="Total Coverage" className="h-12 w-12 object-contain group-hover:scale-110 transition-all duration-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content with Tabs and Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200">
        {/* Left: Services List (2/3 width) */}
        <div className="lg:col-span-2 space-y-3">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
              <TabsList className="grid w-full sm:w-auto grid-cols-4 h-11 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 p-1.5 rounded-2xl shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] border-0">
                <TabsTrigger 
                  value="all" 
                  className="text-xs font-bold rounded-xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/90 data-[state=active]:text-white data-[state=active]:shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] transition-all duration-300"
                >
                  All ({services.length})
                </TabsTrigger>
                <TabsTrigger 
                  value="active" 
                  className="text-xs font-bold rounded-xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/90 data-[state=active]:text-white data-[state=active]:shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] transition-all duration-300"
                >
                  Active ({activeCount})
                </TabsTrigger>
                <TabsTrigger 
                  value="pending" 
                  className="text-xs font-bold rounded-xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/90 data-[state=active]:text-white data-[state=active]:shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] transition-all duration-300"
                >
                  Pending ({pendingCount})
                </TabsTrigger>
                <TabsTrigger 
                  value="paused" 
                  className="text-xs font-bold rounded-xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/90 data-[state=active]:text-white data-[state=active]:shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] transition-all duration-300"
                >
                  Paused ({pausedCount})
                </TabsTrigger>
              </TabsList>

              <div className="flex items-center gap-2">
                {/* View Toggle - Soft UI */}
                <div className="flex items-center bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 rounded-xl p-1 shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] dark:shadow-[inset_0_2px_8px_rgb(0,0,0,0.2)]">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setViewMode('grid')}
                    className={`h-8 px-3 rounded-lg transition-all duration-300 ${
                      viewMode === 'grid' 
                        ? 'bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 text-white shadow-[2px_2px_6px_rgba(0,0,0,0.2)]' 
                        : 'hover:bg-background/60'
                    }`}
                  >
                    <Grid3x3 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setViewMode('list')}
                    className={`h-8 px-3 rounded-lg transition-all duration-300 ${
                      viewMode === 'list' 
                        ? 'bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 text-white shadow-[2px_2px_6px_rgba(0,0,0,0.2)]' 
                        : 'hover:bg-background/60'
                    }`}
                  >
                    <List className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Filters and Search - Soft UI */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search services..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-sm rounded-xl border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] dark:shadow-[inset_0_2px_8px_rgb(0,0,0,0.2)] focus-visible:ring-2 focus-visible:ring-botkorp-orange/50"
                />
              </div>

              {/* Type Filter */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-9 text-xs font-semibold rounded-xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300"
                  >
                    <Filter className="h-4 w-4 mr-2" />
                    Type
                    {serviceTypeFilter !== 'all' && (
                      <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-xs bg-botkorp-orange/20 text-botkorp-orange border-0">1</Badge>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuCheckboxItem
                    checked={serviceTypeFilter === 'all'}
                    onCheckedChange={() => setServiceTypeFilter('all')}
                  >
                    All Types
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={serviceTypeFilter === 'lawn'}
                    onCheckedChange={() => setServiceTypeFilter(serviceTypeFilter === 'lawn' ? 'all' : 'lawn')}
                  >
                    <Sprout className="h-4 w-4 mr-2" />
                    Lawn Care
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={serviceTypeFilter === 'pool'}
                    onCheckedChange={() => setServiceTypeFilter(serviceTypeFilter === 'pool' ? 'all' : 'pool')}
                  >
                    <Droplets className="h-4 w-4 mr-2" />
                    Pool
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={serviceTypeFilter === 'security'}
                    onCheckedChange={() => setServiceTypeFilter(serviceTypeFilter === 'security' ? 'all' : 'security')}
                  >
                    <Shield className="h-4 w-4 mr-2" />
                    Security
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={serviceTypeFilter === 'weather'}
                    onCheckedChange={() => setServiceTypeFilter(serviceTypeFilter === 'weather' ? 'all' : 'weather')}
                  >
                    <CloudSun className="h-4 w-4 mr-2" />
                    Weather
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Location Filter */}
              {locations.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-9 text-xs font-semibold rounded-xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300"
                    >
                      <MapPin className="h-4 w-4 mr-2" />
                      Location
                      {locationFilter !== 'all' && (
                        <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-xs bg-botkorp-orange/20 text-botkorp-orange border-0">1</Badge>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuCheckboxItem
                      checked={locationFilter === 'all'}
                      onCheckedChange={() => setLocationFilter('all')}
                    >
                      All Locations
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    {locations.map(location => (
                      <DropdownMenuCheckboxItem
                        key={location.id}
                        checked={locationFilter === location.id}
                        onCheckedChange={() => setLocationFilter(locationFilter === location.id ? 'all' : location.id)}
                      >
                        {location.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Sort */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-9 text-xs font-semibold rounded-xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300"
                  >
                    {sortOrder === 'asc' ? <SortAsc className="h-4 w-4 mr-2" /> : <SortDesc className="h-4 w-4 mr-2" />}
                    Sort
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => { setSortBy('name'); setSortOrder('asc'); }}>
                    Name A-Z
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setSortBy('name'); setSortOrder('desc'); }}>
                    Name Z-A
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => { setSortBy('created_at'); setSortOrder('desc'); }}>
                    Newest First
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setSortBy('created_at'); setSortOrder('asc'); }}>
                    Oldest First
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => { setSortBy('area'); setSortOrder('desc'); }}>
                    Largest Area
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setSortBy('bots'); setSortOrder('desc'); }}>
                    Most Bots
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Services Content */}
            <TabsContent value={activeTab} className="mt-0">
              {filteredServices.length > 0 ? (
                <div className={viewMode === 'grid' 
                  ? "grid gap-3 grid-cols-1 md:grid-cols-2" 
                  : "space-y-2"
                }>
                  {filteredServices.map((service, index) => {
                    const status = getStatusInfo(service);
                    
                    return viewMode === 'grid' ? (
                      // Grid View Card - Soft UI
                      <Card 
                        key={service.id} 
                        className="relative overflow-hidden border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] transition-all duration-300 cursor-pointer group hover:-translate-y-1"
                        onClick={() => navigate(`/portal/service/${service.id}`)}
                      >
                        <CardContent className="p-3">
                          {/* Header */}
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                              <img 
                                src="/images/lawn-care.png" 
                                alt="Service" 
                                className="h-10 w-10 object-contain flex-shrink-0 group-hover:scale-105 transition-all duration-300"
                              />
                              <div className="flex-1 min-w-0">
                                <h4 className="text-sm font-bold truncate group-hover:text-botkorp-orange transition-colors">
                                  {service.name}
                                </h4>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {service.location?.name}
                                </p>
                                <Badge variant="outline" className="mt-2 text-[10px] h-5 border-none bg-botkorp-orange/10 text-botkorp-orange font-semibold px-2 rounded-full">
                                  {status.text}
                                </Badge>
                              </div>
                            </div>
                          </div>

                          {/* Stats */}
                          <div className="grid grid-cols-3 gap-2 mb-2">
                            <div className="text-center p-2 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all duration-300">
                              <div className="text-base font-bold tabular-nums">{service.garden_count}</div>
                              <p className="text-[10px] text-muted-foreground font-medium">Gardens</p>
                            </div>
                            <div className="text-center p-2 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all duration-300">
                              <div className="text-base font-bold tabular-nums">{service.bot_count}</div>
                              <p className="text-[10px] text-muted-foreground font-medium">Bots</p>
                            </div>
                            <div className="text-center p-2 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all duration-300">
                              <div className="text-base font-bold tabular-nums">{Math.round(service.total_area)}</div>
                              <p className="text-[10px] text-muted-foreground font-medium">m²</p>
                            </div>
                          </div>

                          {/* Actions */}
                          {service.status === 'active' && !service.is_paused && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full text-xs font-semibold rounded-xl border-0 bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] hover:bg-botkorp-orange hover:text-white transition-all duration-300"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/portal/service/${service.id}/bot-status`);
                              }}
                            >
                              <Eye className="h-3 w-3 mr-2" />
                              View Bot Status
                            </Button>
                          )}

                          {service.status === 'pending_setup' && (
                            <div className="flex items-start gap-2 p-2 rounded-xl bg-botkorp-orange/10 border-0">
                              <Info className="h-4 w-4 text-botkorp-orange flex-shrink-0 mt-0.5" />
                              <p className="text-xs">
                                Installation pending - we'll reach out within 24-48 hours
                              </p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ) : (
                      // List View Row - Soft UI
                      <Card
                        key={service.id}
                        className="relative overflow-hidden border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 cursor-pointer group"
                        onClick={() => navigate(`/portal/service/${service.id}`)}
                      >
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-4 flex-1 min-w-0">
                              <img 
                                src="/images/lawn-care.png" 
                                alt="Service" 
                                className="h-10 w-10 object-contain flex-shrink-0 group-hover:scale-105 transition-all duration-300"
                              />
                              <div className="flex-1 min-w-0">
                                <h4 className="text-sm font-bold truncate group-hover:text-botkorp-orange transition-colors">
                                  {service.name}
                                </h4>
                                <p className="text-xs text-muted-foreground">
                                  {service.location?.name}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-4 flex-shrink-0">
                              <div className="text-center hidden md:block">
                                <div className="text-sm font-bold tabular-nums">{service.garden_count}</div>
                                <p className="text-[10px] text-muted-foreground font-medium">Gardens</p>
                              </div>
                              <div className="text-center hidden md:block">
                                <div className="text-sm font-bold tabular-nums">{service.bot_count}</div>
                                <p className="text-[10px] text-muted-foreground font-medium">Bots</p>
                              </div>
                              <div className="text-center hidden lg:block">
                                <div className="text-sm font-bold tabular-nums">{Math.round(service.total_area)}</div>
                                <p className="text-[10px] text-muted-foreground font-medium">m²</p>
                              </div>
                              <Badge variant="outline" className="text-[10px] h-6 border-none bg-botkorp-orange/10 text-botkorp-orange font-semibold px-3 rounded-full">
                                {status.text}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 rounded-xl hover:bg-botkorp-orange/10"
                              >
                                <ArrowRight className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                  <CardContent className="p-12 text-center">
                    <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mb-5 shadow-[0_8px_30px_rgb(255,107,53,0.15)]">
                      <Sprout className="h-10 w-10 text-botkorp-orange" />
                    </div>
                    <h3 className="text-lg font-bold mb-2">
                      No services found
                    </h3>
                    <p className="text-sm text-muted-foreground mb-6">
                      {searchQuery || serviceTypeFilter !== 'all' || locationFilter !== 'all'
                        ? 'Try adjusting your filters or search criteria'
                        : 'Create your first service to get started'}
                    </p>
                    {searchQuery || serviceTypeFilter !== 'all' || locationFilter !== 'all' ? (
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setSearchQuery('');
                          setServiceTypeFilter('all');
                          setLocationFilter('all');
                        }}
                        className="h-10 px-5 text-xs font-semibold rounded-xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300 active:scale-95"
                      >
                        Clear Filters
                      </Button>
                    ) : (
                      <Button 
                        onClick={() => navigate('/portal/services/add')}
                        className="h-10 px-5 text-xs font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 text-white rounded-xl shadow-[4px_4px_12px_rgba(255,107,53,0.3),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(255,107,53,0.4),-3px_-3px_10px_rgba(255,255,255,0.15)] transition-all duration-300 active:scale-95 border-0"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Create Service
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: Activity Timeline (1/3 width) - Soft UI */}
        <div className="lg:col-span-1">
          <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 sticky top-4">
            <CardHeader className="pb-2 pt-3">
              <div className="flex items-center gap-3 mb-1">
                <img 
                  src="/images/recent-activity.png" 
                  alt="Recent Activity" 
                  className="h-10 w-10 object-contain"
                />
                <div>
                  <CardTitle className="text-sm font-bold">Recent Activity</CardTitle>
                  <CardDescription className="text-[11px] font-medium">Latest service updates</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {recentActivity.length > 0 ? (
                <div className="divide-y divide-border/50">
                  {recentActivity.map((activity, index) => (
                    <div key={index} className="px-3 py-2.5 hover:bg-botkorp-orange/5 transition-colors duration-300 cursor-pointer">
                      <p className="text-xs font-bold">
                        <span>{activity.service.name}</span>
                        <span className="text-muted-foreground font-medium">{' '}{activity.type === 'activated' ? 'activated' : 'created'}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">
                        {format(new Date(activity.timestamp), 'MMM d, h:mm a')}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <Badge variant="outline" className="text-[10px] h-5 border-none bg-botkorp-orange/10 text-botkorp-orange font-semibold px-2 rounded-full">
                          {activity.service.location?.name}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-6 py-8 text-center">
                  <img 
                    src="/images/recent-activity.png" 
                    alt="No Activity" 
                    className="h-12 w-12 object-contain mx-auto mb-3"
                  />
                  <p className="text-xs text-muted-foreground font-medium">
                    No recent activity
                  </p>
                </div>
              )}
            </CardContent>

            {/* Quick Stats in Sidebar */}
            <CardContent className="pt-3 pb-3 border-t border-border/50">
              <h4 className="text-xs font-bold mb-2">Quick Stats</h4>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs p-1.5 rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                  <span className="text-muted-foreground font-medium">Total Services</span>
                  <span className="font-bold tabular-nums">{services.length}</span>
                </div>
                <div className="flex items-center justify-between text-xs p-1.5 rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                  <span className="text-muted-foreground font-medium">Active</span>
                  <span className="font-bold text-green-600 tabular-nums">{activeCount}</span>
                </div>
                <div className="flex items-center justify-between text-xs p-1.5 rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                  <span className="text-muted-foreground font-medium">Pending</span>
                  <span className="font-bold text-orange-600 tabular-nums">{pendingCount}</span>
                </div>
                <div className="flex items-center justify-between text-xs p-1.5 rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                  <span className="text-muted-foreground font-medium">Paused</span>
                  <span className="font-bold text-amber-600 tabular-nums">{pausedCount}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
