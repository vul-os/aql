import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import LoadingLottie from '@/components/ui/loading-lottie';
import { ANIMATIONS } from '@/lib/animations';
import {
  Sprout,
  MapPin,
  Plus,
  ArrowRight,
  Loader2,
  Info,
  Bot,
  Ruler,
  Search,
  Droplets,
  Shield,
  CloudSun,
  Circle,
  TrendingUp,
  Activity,
  LayoutGrid,
  ArrowUpRight,
  Building
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import LocationWizard from '@/components/services/location-wizard';
import PageHeader from '@/components/ui/page-header';

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

  const getServiceColor = (type) => {
    switch (type) {
      case 'lawn': return { bg: 'bg-accent', light: 'bg-accent/5', text: 'text-accent', border: 'border-accent/20' };
      case 'pool': return { bg: 'bg-secondary', light: 'bg-secondary/5', text: 'text-secondary', border: 'border-secondary/20' };
      case 'security': return { bg: 'bg-botkorp-silver', light: 'bg-muted', text: 'text-foreground', border: 'border-border' };
      case 'weather': return { bg: 'bg-accent', light: 'bg-accent/5', text: 'text-accent', border: 'border-accent/20' };
      default: return { bg: 'bg-muted', light: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' };
    }
  };

  const getStatusInfo = (service) => {
    if (service.is_paused) {
      return { text: 'Paused', color: 'bg-amber-500/80' };
    }
    
    switch (service.status) {
      case 'pending_setup':
      case 'pending_installation':
        return { text: 'Pending', color: 'bg-accent/80' };
      case 'installation_scheduled':
        return { text: 'Scheduled', color: 'bg-secondary/80' };
      case 'active':
        return { text: 'Active', color: 'bg-accent' };
      default:
        return { text: 'Active', color: 'bg-accent' };
    }
  };

  const filteredServices = services.filter(service => {
    const matchesSearch = service.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         service.location?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === 'all' || 
                         (filterStatus === 'active' && service.status === 'active' && !service.is_paused) ||
                         (filterStatus === 'paused' && service.is_paused) ||
                         (filterStatus === 'pending' && (service.status === 'pending_setup' || service.status === 'pending_installation'));
    return matchesSearch && matchesFilter;
  });

  const activeCount = services.filter(s => s.status === 'active' && !s.is_paused).length;
  const totalBots = services.reduce((sum, s) => sum + s.bot_count, 0);
  const totalArea = services.reduce((sum, s) => sum + s.total_area, 0);

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
      <div className="p-3 md:p-5 space-y-4">
        <div className="space-y-2.5 animate-in fade-in slide-in-from-top-3 duration-500">
          <PageHeader
            title="Services"
            subtitle="Manage your automated property services"
            icon={<Sprout className="h-5 w-5 text-botkorp-orange" />}
          />
        </div>
        
        <Card className="border-2 border-dashed bg-muted/20 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
          <CardContent className="pt-10 pb-10 text-center">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-xl bg-botkorp-orange/10 dark:bg-botkorp-orange/20 mb-4 animate-in zoom-in-50 duration-500 delay-100 shadow-sm">
              <MapPin className="h-8 w-8 text-botkorp-orange animate-pulse" />
            </div>
            <h3 className="text-base font-bold mb-1.5 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
              Add Your First Location
            </h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto text-xs leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
              Before creating services, add a location where you'd like to deploy bot services
            </p>
            <Button 
              onClick={() => setShowLocationWizard(true)}
              className="bg-botkorp-orange hover:bg-botkorp-orange/90 text-white hover:shadow-lg shadow-md transition-all duration-300 active:scale-95 animate-in fade-in zoom-in-50 duration-500 delay-400 h-9 px-5 font-medium text-xs"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Location
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="p-3 md:p-5 space-y-4">
        {/* Header Section */}
        <div className="space-y-2.5 animate-in fade-in slide-in-from-top-3 duration-500">
          <PageHeader
            title="Services"
            subtitle={`Manage your automated services across ${locations.length} location${locations.length !== 1 ? 's' : ''}`}
            icon={<Sprout className="h-5 w-5 text-botkorp-orange" />}
          />

          {/* Action Bar */}
          <div className="flex justify-end">
            <Button 
              onClick={() => navigate('/portal/services/add')}
              className="w-full sm:w-auto h-8 text-sm bg-botkorp-orange hover:bg-botkorp-orange/90 text-white hover:shadow-lg transition-all duration-300 active:scale-95 group"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5 group-hover:rotate-90 transition-transform duration-300" />
              Create Service
            </Button>
          </div>
        </div>

        {/* Empty State */}
        <Card className="border-2 border-dashed bg-muted/20 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
          <CardContent className="pt-10 pb-10 text-center">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-xl bg-botkorp-orange/10 dark:bg-botkorp-orange/20 mb-4 animate-in zoom-in-50 duration-500 delay-100 shadow-sm">
              <Sprout className="h-8 w-8 text-botkorp-orange animate-pulse" />
            </div>
            <h3 className="text-base font-bold mb-1.5 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
              Ready to Automate?
            </h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto text-xs leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
              Create your first automated service and experience the future of property management
            </p>

            <div className="grid grid-cols-2 gap-2 max-w-md mx-auto mb-6">
              {[
                { icon: Sprout, label: 'Lawn Care', color: 'text-green-600 dark:text-green-500' },
                { icon: Droplets, label: 'Pool Cleaning', color: 'text-blue-600 dark:text-blue-500' },
                { icon: Shield, label: 'Security', color: 'text-amber-600 dark:text-amber-500' },
                { icon: CloudSun, label: 'Weather', color: 'text-sky-600 dark:text-sky-500' }
              ].map(({ icon: Icon, label, color }) => (
                <div key={label} className="p-2 rounded-lg bg-muted/50 border border-border hover:bg-muted transition-all">
                  <Icon className={`h-4 w-4 ${color} mb-1.5 mx-auto`} />
                  <p className="text-[10px] font-medium">{label}</p>
                </div>
              ))}
            </div>

            <Button 
              onClick={() => navigate('/portal/services/add')} 
              className="bg-botkorp-orange hover:bg-botkorp-orange/90 text-white hover:shadow-lg shadow-md transition-all duration-300 active:scale-95 animate-in fade-in zoom-in-50 duration-500 delay-400 h-9 px-5 font-medium text-xs"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Create Your First Service
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-3 md:p-5 space-y-4">
      {/* Header Section */}
      <div className="space-y-2.5 animate-in fade-in slide-in-from-top-3 duration-500">
        <PageHeader
          title="Services"
          subtitle={`Manage your ${services.length} service${services.length !== 1 ? 's' : ''} across ${locations.length} location${locations.length !== 1 ? 's' : ''}`}
          icon={<Sprout className="h-5 w-5 text-botkorp-orange" />}
        />

        {/* Action Bar */}
        <div className="flex flex-col sm:flex-row gap-2.5 justify-between items-start sm:items-center">
          <div className="relative flex-1 max-w-md w-full group">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground group-focus-within:text-botkorp-orange transition-colors duration-300" />
            <Input
              placeholder="Search services or locations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-sm focus:border-botkorp-orange focus:ring-2 focus:ring-botkorp-orange/20 transition-all duration-300"
            />
          </div>
          <Button 
            onClick={() => navigate('/portal/services/add')}
            className="w-full sm:w-auto h-8 text-sm bg-botkorp-orange hover:bg-botkorp-orange/90 text-white hover:shadow-lg transition-all duration-300 active:scale-95 group"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5 group-hover:rotate-90 transition-transform duration-300" />
            New Service
          </Button>
        </div>
      </div>

      {/* Stats Overview with Premium Design */}
      <div className="grid gap-2.5 grid-cols-2 lg:grid-cols-4">
        {/* Active Services Stat */}
        <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 shadow-sm">
          <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3">
            <CardTitle className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Active Services</CardTitle>
            <div className="h-7 w-7 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-botkorp-orange transition-all duration-300">
              <Activity className="h-3 w-3 text-botkorp-orange group-hover:text-white transition-colors duration-300" />
            </div>
          </CardHeader>
          <CardContent className="relative pb-3">
            <div className="text-xl font-bold tabular-nums">{activeCount}</div>
            <p className="text-[9px] text-muted-foreground font-medium mt-0.5">Running</p>
          </CardContent>
        </Card>

        {/* Locations Stat */}
        <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-75 shadow-sm">
          <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3">
            <CardTitle className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Locations</CardTitle>
            <div className="h-7 w-7 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-botkorp-orange transition-all duration-300">
              <MapPin className="h-3 w-3 text-botkorp-orange group-hover:text-white transition-colors duration-300" />
            </div>
          </CardHeader>
          <CardContent className="relative pb-3">
            <div className="text-xl font-bold tabular-nums">{locations.length}</div>
            <p className="text-[9px] text-muted-foreground font-medium mt-0.5">Total</p>
          </CardContent>
        </Card>

        {/* Bots Deployed Stat */}
        <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-150 shadow-sm">
          <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3">
            <CardTitle className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Bots</CardTitle>
            <div className="h-7 w-7 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-botkorp-orange transition-all duration-300">
              <Bot className="h-3 w-3 text-botkorp-orange group-hover:text-white transition-colors duration-300" />
            </div>
          </CardHeader>
          <CardContent className="relative pb-3">
            <div className="text-xl font-bold tabular-nums">{totalBots}</div>
            <p className="text-[9px] text-muted-foreground font-medium mt-0.5">Deployed</p>
          </CardContent>
        </Card>

        {/* Total Area Stat */}
        <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200 shadow-sm">
          <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3">
            <CardTitle className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Coverage</CardTitle>
            <div className="h-7 w-7 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-botkorp-orange transition-all duration-300">
              <Ruler className="h-3 w-3 text-botkorp-orange group-hover:text-white transition-colors duration-300" />
            </div>
          </CardHeader>
          <CardContent className="relative pb-3">
            <div className="text-xl font-bold tabular-nums">{Math.round(totalArea).toLocaleString()}</div>
            <p className="text-[9px] text-muted-foreground font-medium mt-0.5">Area m²</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter Section */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-2">
          <div className="h-0.5 w-6 bg-botkorp-orange rounded-full" />
          <h2 className="text-xs font-bold uppercase tracking-wide">Filter</h2>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {['all', 'active', 'pending', 'paused'].map((status) => (
            <Button
              key={status}
              variant={filterStatus === status ? 'default' : 'outline'}
              onClick={() => setFilterStatus(status)}
              size="sm"
              className={`h-6 px-2.5 text-[10px] capitalize ${
                filterStatus === status 
                  ? 'bg-botkorp-orange hover:bg-botkorp-orange/90 text-white shadow-sm' 
                  : 'hover:border-botkorp-orange hover:text-botkorp-orange'
              }`}
            >
              {status} ({status === 'all' ? services.length : 
                        status === 'active' ? activeCount :
                        status === 'paused' ? services.filter(s => s.is_paused).length :
                        services.filter(s => s.status === 'pending_setup' || s.status === 'pending_installation').length})
            </Button>
          ))}
        </div>
      </div>

      {/* Services List */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-6 bg-botkorp-orange rounded-full" />
            <h2 className="text-xs font-bold uppercase tracking-wide flex items-center gap-2">
              All Services
              <Badge variant="secondary" className="h-4 px-1.5 text-[9px] bg-botkorp-orange/10 text-botkorp-orange border-botkorp-orange/20 animate-in fade-in zoom-in-50 duration-300 delay-300 font-semibold">
                {filteredServices.length}
              </Badge>
            </h2>
          </div>
        </div>

        {filteredServices.length > 0 ? (
          <div className="grid gap-2.5 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
            {filteredServices.map((service, index) => {
              const Icon = getServiceIcon(service.service_type);
              const colors = getServiceColor(service.service_type);
              const status = getStatusInfo(service);
              
              return (
                <Card 
                  key={service.id} 
                  className="relative overflow-hidden border-t-3 border-t-botkorp-orange hover:shadow-xl transition-all duration-300 cursor-pointer group animate-in fade-in slide-in-from-bottom-4 hover:-translate-y-1 shadow-sm bg-card"
                  style={{ animationDelay: `${300 + index * 50}ms`, animationDuration: '500ms' }}
                  onClick={() => navigate(`/portal/service/${service.id}`)}
                >
                  {/* Premium subtle overlay */}
                  <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300 pointer-events-none" />
                  
                  <CardHeader className="relative pb-1.5 pt-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <div className={`relative h-8 w-8 rounded-lg ${colors.bg} flex items-center justify-center flex-shrink-0 group-hover:shadow-lg group-hover:scale-105 transition-all duration-300`}>
                          <Icon className={`h-3.5 w-3.5 ${colors.text === 'text-accent' || colors.text === 'text-secondary' ? 'text-white' : colors.text}`} />
                          {/* Status Dot */}
                          <div className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 ${status.color} rounded-full border-2 border-card`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-xs font-bold mb-0.5 truncate group-hover:text-botkorp-orange transition-colors duration-300">
                            {service.name}
                          </CardTitle>
                          <CardDescription className="text-[10px] line-clamp-1 leading-relaxed flex items-center gap-0.5">
                            <MapPin className="h-2.5 w-2.5 flex-shrink-0" />
                            {service.location?.name}
                          </CardDescription>
                          <Badge variant="outline" className="mt-1 text-[9px] h-4 px-1">
                            <Circle className={`h-1 w-1 mr-0.5 fill-current ${status.color.replace('bg-', 'text-')}`} />
                            {status.text}
                          </Badge>
                        </div>
                      </div>
                      <div className="h-6 w-6 rounded-lg bg-muted/50 flex items-center justify-center group-hover:bg-botkorp-orange transition-all duration-300">
                        <ArrowUpRight className="h-3 w-3 text-muted-foreground group-hover:text-white group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-300" />
                      </div>
                    </div>
                  </CardHeader>
                  
                  <CardContent className="relative space-y-2 pb-2.5">
                    {/* Premium Stats Grid */}
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="relative group/stat">
                        <div className="text-center p-1.5 rounded-lg border border-border bg-muted/30 hover:border-botkorp-orange/50 hover:bg-botkorp-orange/5 transition-all duration-300">
                          <div className="flex items-center justify-center mb-0.5">
                            <div className="h-5 w-5 rounded-md bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover/stat:bg-botkorp-orange transition-all duration-300">
                              <Sprout className="h-2.5 w-2.5 text-botkorp-orange group-hover/stat:text-white transition-colors duration-300" />
                            </div>
                          </div>
                          <div className="text-base font-bold tabular-nums">{service.garden_count}</div>
                          <p className="text-[9px] text-muted-foreground font-medium">Gardens</p>
                        </div>
                      </div>
                      
                      <div className="relative group/stat">
                        <div className="text-center p-1.5 rounded-lg border border-border bg-muted/30 hover:border-botkorp-orange/50 hover:bg-botkorp-orange/5 transition-all duration-300">
                          <div className="flex items-center justify-center mb-0.5">
                            <div className="h-5 w-5 rounded-md bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover/stat:bg-botkorp-orange transition-all duration-300">
                              <Bot className="h-2.5 w-2.5 text-botkorp-orange group-hover/stat:text-white transition-colors duration-300" />
                            </div>
                          </div>
                          <div className="text-base font-bold tabular-nums">{service.bot_count}</div>
                          <p className="text-[9px] text-muted-foreground font-medium">Bots</p>
                        </div>
                      </div>
                      
                      <div className="relative group/stat">
                        <div className="text-center p-1.5 rounded-lg border border-border bg-muted/30 hover:border-botkorp-orange/50 hover:bg-botkorp-orange/5 transition-all duration-300">
                          <div className="flex items-center justify-center mb-0.5">
                            <div className="h-5 w-5 rounded-md bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover/stat:bg-botkorp-orange transition-all duration-300">
                              <Ruler className="h-2.5 w-2.5 text-botkorp-orange group-hover/stat:text-white transition-colors duration-300" />
                            </div>
                          </div>
                          <div className="text-base font-bold tabular-nums">{Math.round(service.total_area)}</div>
                          <p className="text-[9px] text-muted-foreground font-medium">Area m²</p>
                        </div>
                      </div>
                    </div>

                    {/* Alert if pending */}
                    {service.status === 'pending_setup' && (
                      <Alert className="border-l-2 border-l-botkorp-orange bg-botkorp-orange/5 dark:bg-botkorp-orange/10 p-1.5">
                        <Info className="h-2.5 w-2.5 text-botkorp-orange" />
                        <AlertDescription className="text-[9px] text-foreground/90 ml-1">
                          Installation pending - we'll reach out within 24-48 hours
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Premium Action Button */}
                    {service.status === 'active' && !service.is_paused && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full h-7 text-[10px] border hover:border-botkorp-orange hover:bg-botkorp-orange hover:text-white transition-all duration-300 active:scale-95 font-medium"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/portal/service/${service.id}/bot-status`);
                        }}
                      >
                        <Activity className="h-2.5 w-2.5 mr-1" />
                        View Bot Status
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="border-2 border-dashed bg-muted/20 shadow-sm">
            <CardContent className="pt-8 pb-8 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-muted mb-3">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-sm font-bold mb-1.5">No services found</h3>
              <p className="text-muted-foreground mb-4 max-w-sm mx-auto text-xs">
                Try adjusting your search or filters
              </p>
              <Button 
                variant="outline" 
                onClick={() => {
                  setSearchQuery('');
                  setFilterStatus('all');
                }}
                className="h-8 px-4 text-xs border-2 hover:border-botkorp-orange hover:bg-botkorp-orange hover:text-white transition-all duration-300"
              >
                Clear All Filters
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
