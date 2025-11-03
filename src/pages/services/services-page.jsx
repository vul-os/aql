import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
      <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
        <div className="bg-gradient-to-br from-background via-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-top-3 duration-500">
          <PageHeader
            title="Services"
            subtitle="Manage your automated property services"
            icon={<Sprout className="h-5 w-5 text-botkorp-orange" />}
          />
        </div>
        
        <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-12 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mb-5 animate-in zoom-in-50 duration-500 delay-100 shadow-[0_8px_30px_rgb(255,107,53,0.15)]">
            <MapPin className="h-10 w-10 text-botkorp-orange animate-pulse" />
          </div>
          <h3 className="text-xl font-bold mb-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
            Add Your First Location
          </h3>
          <p className="text-muted-foreground/70 mb-8 max-w-sm mx-auto text-sm leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
            Before creating services, add a location where you'd like to deploy bot services
          </p>
          <Button 
            onClick={() => setShowLocationWizard(true)}
            className="h-11 px-6 font-medium bg-botkorp-orange hover:bg-botkorp-orange/90 text-white rounded-xl shadow-[0_8px_30px_rgb(255,107,53,0.25)] hover:shadow-[0_8px_30px_rgb(255,107,53,0.35)] hover:-translate-y-0.5 transition-all animate-in fade-in zoom-in-50 duration-500 delay-400"
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
      <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
        {/* Header Section */}
        <div className="bg-gradient-to-br from-background via-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-top-3 duration-500">
          <PageHeader
            title="Services"
            subtitle={`Manage your automated services across ${locations.length} location${locations.length !== 1 ? 's' : ''}`}
            icon={<Sprout className="h-5 w-5 text-botkorp-orange" />}
          />

          {/* Action Bar */}
          <div className="flex justify-end mt-4">
            <Button 
              onClick={() => navigate('/portal/services/add')}
              className="w-full sm:w-auto h-10 px-5 font-medium bg-botkorp-orange hover:bg-botkorp-orange/90 text-white rounded-xl shadow-[0_8px_30px_rgb(255,107,53,0.25)] hover:shadow-[0_8px_30px_rgb(255,107,53,0.35)] hover:-translate-y-0.5 transition-all group"
            >
              <Plus className="h-4 w-4 mr-2 group-hover:rotate-90 transition-transform duration-300" />
              Create Service
            </Button>
          </div>
        </div>

        {/* Empty State */}
        <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-12 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mb-5 animate-in zoom-in-50 duration-500 delay-100 shadow-[0_8px_30px_rgb(255,107,53,0.15)]">
            <Sprout className="h-10 w-10 text-botkorp-orange animate-pulse" />
          </div>
          <h3 className="text-xl font-bold mb-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
            Ready to Automate?
          </h3>
          <p className="text-muted-foreground/70 mb-8 max-w-sm mx-auto text-sm leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
            Create your first automated service and experience the future of property management
          </p>

          <div className="grid grid-cols-2 gap-3 max-w-md mx-auto mb-8">
            {[
              { icon: Sprout, label: 'Lawn Care', color: 'text-green-600' },
              { icon: Droplets, label: 'Pool Cleaning', color: 'text-blue-600' },
              { icon: Shield, label: 'Security', color: 'text-amber-600' },
              { icon: CloudSun, label: 'Weather', color: 'text-sky-600' }
            ].map(({ icon: Icon, label, color }) => (
              <div key={label} className="p-4 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all">
                <Icon className={`h-6 w-6 ${color} mb-2 mx-auto`} />
                <p className="text-xs font-medium">{label}</p>
              </div>
            ))}
          </div>

          <Button 
            onClick={() => navigate('/portal/services/add')} 
            className="h-11 px-6 font-medium bg-botkorp-orange hover:bg-botkorp-orange/90 text-white rounded-xl shadow-[0_8px_30px_rgb(255,107,53,0.25)] hover:shadow-[0_8px_30px_rgb(255,107,53,0.35)] hover:-translate-y-0.5 transition-all animate-in fade-in zoom-in-50 duration-500 delay-400"
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
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto min-h-screen">
      <div className="space-y-6">
        {/* Header Section - Soft UI Background */}
        <div className="bg-gradient-to-br from-background via-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-top-3 duration-500">
          <PageHeader
            title="Services"
            subtitle={`Manage your ${services.length} service${services.length !== 1 ? 's' : ''} across ${locations.length} location${locations.length !== 1 ? 's' : ''}`}
            icon={<Sprout className="h-5 w-5 text-botkorp-orange" />}
          />

          {/* Action Bar */}
          <div className="flex flex-col sm:flex-row gap-3 justify-between items-stretch sm:items-center mt-4">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
              <Input
                placeholder="Search services or locations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-10 bg-background/60 backdrop-blur-sm border-none shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] focus:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06),0_0_0_3px_rgb(255,107,53,0.1)] transition-all rounded-xl"
              />
            </div>
            <Button 
              onClick={() => navigate('/portal/services/add')}
              className="w-full sm:w-auto h-10 px-5 font-medium bg-botkorp-orange hover:bg-botkorp-orange/90 text-white rounded-xl shadow-[0_8px_30px_rgb(255,107,53,0.25)] hover:shadow-[0_8px_30px_rgb(255,107,53,0.35)] hover:-translate-y-0.5 transition-all group"
            >
              <Plus className="h-4 w-4 mr-2 group-hover:rotate-90 transition-transform duration-300" />
              New Service
            </Button>
          </div>
        </div>

        {/* Stats Overview - Soft UI Cards */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 animate-in fade-in slide-in-from-bottom-3 duration-700">
          {/* Total Services Card */}
          <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Services</span>
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                <LayoutGrid className="h-4 w-4 text-botkorp-orange" />
              </div>
            </div>
            <div className="text-3xl font-bold mb-1">{services.length}</div>
            <p className="text-xs text-muted-foreground/60">
              {locations.length} location{locations.length !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Active Services Card */}
          <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Active</span>
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-green-500/15 to-green-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(34,197,94,0.15)]">
                <Activity className="h-4 w-4 text-green-600" />
              </div>
            </div>
            <div className="text-3xl font-bold mb-1">{activeCount}</div>
            <p className="text-xs text-muted-foreground/60">
              {Math.round((activeCount / (services.length || 1)) * 100)}% operational
            </p>
          </div>

          {/* Bots Deployed Card */}
          <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Bots</span>
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                <Bot className="h-4 w-4 text-botkorp-orange" />
              </div>
            </div>
            <div className="text-3xl font-bold mb-1">{totalBots}</div>
            <p className="text-xs text-muted-foreground/60">Automated maintenance</p>
          </div>

          {/* Coverage Area Card */}
          <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Coverage</span>
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-500/15 to-blue-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(59,130,246,0.15)]">
                <Ruler className="h-4 w-4 text-blue-600" />
              </div>
            </div>
            <div className="text-3xl font-bold mb-1">{Math.round(totalArea / 1000)}k</div>
            <p className="text-xs text-muted-foreground/60">
              {Math.round(totalArea).toLocaleString()} m²
            </p>
          </div>
        </div>

        {/* Filter Section - Soft UI */}
        <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold mb-1">Filter Services</h3>
              <p className="text-xs text-muted-foreground/60">View by status category</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {['all', 'active', 'pending', 'paused'].map((status) => (
                <Button
                  key={status}
                  variant={filterStatus === status ? 'default' : 'outline'}
                  onClick={() => setFilterStatus(status)}
                  size="sm"
                  className={`h-8 px-3 text-xs capitalize font-medium rounded-xl transition-all ${
                    filterStatus === status 
                      ? 'bg-botkorp-orange hover:bg-botkorp-orange/90 text-white shadow-[0_4px_20px_rgb(255,107,53,0.25)] hover:shadow-[0_4px_20px_rgb(255,107,53,0.35)]' 
                      : 'border-none bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] hover:text-botkorp-orange'
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
        </div>

        {/* Services List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold flex items-center gap-2">
                All Services
                <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-botkorp-orange/15 text-botkorp-orange text-[10px] font-bold">
                  {filteredServices.length}
                </span>
              </h3>
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                {searchQuery || filterStatus !== 'all' 
                  ? `${filteredServices.length} of ${services.length} services match your filters`
                  : 'All active services across your locations'
                }
              </p>
            </div>
          </div>

          {filteredServices.length > 0 ? (
            <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
              {filteredServices.map((service, index) => {
                const Icon = getServiceIcon(service.service_type);
                const status = getStatusInfo(service);
                
                return (
                  <div 
                    key={service.id} 
                    className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] transition-all duration-300 cursor-pointer group hover:-translate-y-1 animate-in fade-in slide-in-from-bottom-4"
                    style={{ animationDelay: `${300 + index * 50}ms`, animationDuration: '500ms' }}
                    onClick={() => navigate(`/portal/service/${service.id}`)}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="relative h-12 w-12 rounded-2xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center flex-shrink-0 shadow-[0_4px_20px_rgb(255,107,53,0.15)] group-hover:shadow-[0_4px_20px_rgb(255,107,53,0.25)] transition-all duration-300">
                          <Icon className="h-6 w-6 text-botkorp-orange" />
                          {/* Status Dot */}
                          <div className={`absolute -top-1 -right-1 h-3 w-3 ${status.color} rounded-full border-2 border-background`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-bold mb-1 truncate group-hover:text-botkorp-orange transition-colors duration-300">
                            {service.name}
                          </h4>
                          <p className="text-xs text-muted-foreground/70 line-clamp-1 flex items-center gap-1.5">
                            <MapPin className="h-3 w-3 flex-shrink-0" />
                            {service.location?.name}
                          </p>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-background/60 text-[10px] font-medium mt-2 shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                            <Circle className={`h-1.5 w-1.5 fill-current ${status.color.replace('bg-', 'text-')}`} />
                            {status.text}
                          </span>
                        </div>
                      </div>
                      <div className="h-9 w-9 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] flex items-center justify-center group-hover:bg-botkorp-orange transition-all duration-300 flex-shrink-0">
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-white group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-300" />
                      </div>
                    </div>
                    
                    {/* Stats Grid */}
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="text-center p-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all group/stat">
                        <div className="flex items-center justify-center mb-2">
                          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-green-500/15 to-green-500/5 flex items-center justify-center shadow-[0_2px_10px_rgb(34,197,94,0.1)]">
                            <Sprout className="h-3.5 w-3.5 text-green-600" />
                          </div>
                        </div>
                        <div className="text-xl font-bold mb-0.5">{service.garden_count}</div>
                        <p className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wide">Gardens</p>
                      </div>
                      
                      <div className="text-center p-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all group/stat">
                        <div className="flex items-center justify-center mb-2">
                          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_2px_10px_rgb(255,107,53,0.1)]">
                            <Bot className="h-3.5 w-3.5 text-botkorp-orange" />
                          </div>
                        </div>
                        <div className="text-xl font-bold mb-0.5">{service.bot_count}</div>
                        <p className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wide">Bots</p>
                      </div>
                      
                      <div className="text-center p-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all group/stat">
                        <div className="flex items-center justify-center mb-2">
                          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue-500/15 to-blue-500/5 flex items-center justify-center shadow-[0_2px_10px_rgb(59,130,246,0.1)]">
                            <Ruler className="h-3.5 w-3.5 text-blue-600" />
                          </div>
                        </div>
                        <div className="text-xl font-bold mb-0.5">{Math.round(service.total_area)}</div>
                        <p className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wide">m²</p>
                      </div>
                    </div>

                    {/* Alert if pending */}
                    {service.status === 'pending_setup' && (
                      <div className="flex items-start gap-2 p-3 rounded-xl bg-botkorp-orange/10 mb-3">
                        <Info className="h-3.5 w-3.5 text-botkorp-orange flex-shrink-0 mt-0.5" />
                        <p className="text-[10px] text-foreground/90 font-medium leading-relaxed">
                          Installation pending - we'll reach out within 24-48 hours
                        </p>
                      </div>
                    )}

                    {/* Action Button */}
                    {service.status === 'active' && !service.is_paused && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full h-9 text-xs font-medium border-none bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] hover:bg-botkorp-orange hover:text-white transition-all duration-300 rounded-xl"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/portal/service/${service.id}/bot-status`);
                        }}
                      >
                        <Activity className="h-3.5 w-3.5 mr-2" />
                        View Bot Status
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-12 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mb-5 shadow-[0_8px_30px_rgb(255,107,53,0.15)]">
                <Search className="h-10 w-10 text-botkorp-orange" />
              </div>
              <h3 className="text-xl font-bold mb-2">No services found</h3>
              <p className="text-muted-foreground/70 mb-8 max-w-sm mx-auto text-sm leading-relaxed">
                Try adjusting your search or filters to find the services you're looking for
              </p>
              <Button 
                variant="outline" 
                onClick={() => {
                  setSearchQuery('');
                  setFilterStatus('all');
                }}
                className="h-10 px-5 font-medium border-none bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] hover:bg-botkorp-orange hover:text-white transition-all rounded-xl"
              >
                Clear All Filters
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
