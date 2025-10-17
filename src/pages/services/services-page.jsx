import React, { useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
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
  LayoutGrid
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import LocationWizard from '@/components/services/location-wizard';

export default function ServicesPage() {
  const { selectedOrg } = useOutletContext();
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
      case 'lawn': return { bg: 'bg-emerald-500', light: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' };
      case 'pool': return { bg: 'bg-blue-500', light: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' };
      case 'security': return { bg: 'bg-purple-500', light: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200' };
      case 'weather': return { bg: 'bg-orange-500', light: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-200' };
      default: return { bg: 'bg-slate-500', light: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' };
    }
  };

  const getStatusInfo = (service) => {
    if (service.is_paused) {
      return { text: 'Paused', color: 'bg-amber-500/80' };
    }
    
    switch (service.status) {
      case 'pending_setup':
      case 'pending_installation':
        return { text: 'Pending', color: 'bg-blue-500/80' };
      case 'installation_scheduled':
        return { text: 'Scheduled', color: 'bg-purple-500/80' };
      case 'active':
        return { text: 'Active', color: 'bg-emerald-500' };
      default:
        return { text: 'Active', color: 'bg-emerald-500' };
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <Loader2 className="h-16 w-16 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading services...</p>
        </div>
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-2xl w-full border-2 border-dashed shadow-xl">
          <CardContent className="flex flex-col items-center py-20 text-center space-y-8">
            <div className="relative">
              <div className="h-32 w-32 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center">
                <MapPin className="h-16 w-16 text-slate-400" />
              </div>
            </div>
            <div className="space-y-3">
              <h2 className="text-3xl font-bold">Add Your First Location</h2>
              <p className="text-muted-foreground text-lg max-w-md">
                Before creating services, add a location where you'd like to deploy bot services.
              </p>
            </div>
            <Button size="lg" onClick={() => setShowLocationWizard(true)} className="h-14 px-8 text-lg">
              <Plus className="h-6 w-6 mr-2" />
              Add Location
              <ArrowRight className="h-6 w-6 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
        <div className="p-6 md:p-12 space-y-12 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">
                Services
              </h1>
              <p className="text-muted-foreground text-lg">Automated property management</p>
            </div>
            <Button onClick={() => navigate('/portal/services/add')} size="lg" className="shadow-lg h-12">
              <Plus className="h-5 w-5 mr-2" />
              Create Service
            </Button>
          </div>

          {/* Empty State */}
          <div className="max-w-4xl mx-auto">
            <Card className="border-0 shadow-2xl overflow-hidden">
              <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-12 md:p-16 text-center space-y-8">
                <div className="relative inline-block">
                  <div className="h-40 w-40 rounded-3xl bg-white/10 backdrop-blur-sm flex items-center justify-center mx-auto">
                    <Sprout className="h-20 w-20 text-white" />
                  </div>
                  <div className="absolute -bottom-3 -right-3 h-16 w-16 rounded-2xl bg-primary shadow-xl flex items-center justify-center">
                    <Plus className="h-8 w-8 text-white" />
                  </div>
                </div>
                
                <div className="space-y-4">
                  <h2 className="text-4xl md:text-5xl font-bold text-white">Ready to Automate?</h2>
                  <p className="text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
                    Create your first automated service and experience the future of property management
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto pt-8">
                  {[
                    { icon: Sprout, label: 'Lawn Care', color: 'emerald' },
                    { icon: Droplets, label: 'Pool Cleaning', color: 'blue' },
                    { icon: Shield, label: 'Security', color: 'purple' },
                    { icon: CloudSun, label: 'Weather Station', color: 'orange' }
                  ].map(({ icon: Icon, label, color }) => (
                    <div key={label} className="p-5 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 transition-all">
                      <Icon className={`h-8 w-8 text-${color}-400 mb-3 mx-auto`} />
                      <p className="text-sm font-medium text-white">{label}</p>
                    </div>
                  ))}
                </div>

                <Button 
                  size="lg" 
                  onClick={() => navigate('/portal/services/add')} 
                  className="bg-white text-slate-900 hover:bg-slate-100 shadow-2xl h-16 px-10 text-lg font-semibold mt-8"
                >
                  <Plus className="h-6 w-6 mr-3" />
                  Create Your First Service
                  <ArrowRight className="h-6 w-6 ml-3" />
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="p-6 md:p-8 lg:p-12 space-y-8 max-w-[1800px] mx-auto">
        
        {/* Modern Header */}
        <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-white/70 to-accent/10 dark:from-secondary dark:via-secondary/40 dark:to-muted/40 p-4 md:p-6 shadow-md">
          <div className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/20 blur-2xl"></div>
          <div className="pointer-events-none absolute -bottom-12 -left-12 h-40 w-40 rounded-full bg-accent/20 blur-2xl"></div>
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Services</h1>
                <p className="text-sm md:text-base text-muted-foreground mt-1">Manage your automated property services</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                onClick={() => navigate('/portal/services/add')} 
                className="h-9 px-4 py-2"
              >
                <Plus className="h-4 w-4 mr-2" />
                New Service
              </Button>
            </div>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="group p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-3">
                <div className="h-12 w-12 rounded-xl bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center">
                  <Activity className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                <TrendingUp className="h-4 w-4 text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">{activeCount}</p>
              <p className="text-sm text-muted-foreground mt-1">Active Services</p>
            </div>

            <div className="group p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-3">
                <div className="h-12 w-12 rounded-xl bg-blue-100 dark:bg-blue-950 flex items-center justify-center">
                  <MapPin className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <TrendingUp className="h-4 w-4 text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">{locations.length}</p>
              <p className="text-sm text-muted-foreground mt-1">Locations</p>
            </div>

            <div className="group p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-3">
                <div className="h-12 w-12 rounded-xl bg-purple-100 dark:bg-purple-950 flex items-center justify-center">
                  <Bot className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                </div>
                <TrendingUp className="h-4 w-4 text-purple-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">{totalBots}</p>
              <p className="text-sm text-muted-foreground mt-1">Bots Deployed</p>
            </div>

            <div className="group p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-3">
                <div className="h-12 w-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Ruler className="h-6 w-6 text-slate-600 dark:text-slate-400" />
                </div>
                <TrendingUp className="h-4 w-4 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">{Math.round(totalArea).toLocaleString()}</p>
              <p className="text-sm text-muted-foreground mt-1">Total Area (m²)</p>
            </div>
          </div>

        {/* Search & Filter */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search by service or location name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12 h-12 text-base bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-xl shadow-sm"
            />
          </div>
          <div className="flex gap-2">
            {['all', 'active', 'pending'].map((status) => (
              <Button
                key={status}
                variant={filterStatus === status ? 'default' : 'outline'}
                onClick={() => setFilterStatus(status)}
                size="sm"
                className={`h-12 px-5 capitalize rounded-xl ${filterStatus === status ? 'shadow-md' : ''}`}
              >
                {status} ({status === 'all' ? services.length : 
                          status === 'active' ? activeCount :
                          services.filter(s => s.status === 'pending_setup' || s.status === 'pending_installation').length})
              </Button>
            ))}
          </div>
        </div>

        {/* Services Grid */}
        {filteredServices.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredServices.map((service) => {
              const Icon = getServiceIcon(service.service_type);
              const colors = getServiceColor(service.service_type);
              const status = getStatusInfo(service);
              
              return (
                <Card 
                  key={service.id} 
                  className="group relative overflow-hidden border-0 shadow-lg hover:shadow-2xl transition-all duration-300 cursor-pointer bg-white dark:bg-slate-900"
                  onClick={() => navigate(`/portal/service/${service.id}`)}
                >
                  {/* Gradient Top Border */}
                  <div className={`absolute top-0 left-0 right-0 h-1 ${colors.bg}`} />
                  
                  {/* Hover Glow Effect */}
                  <div className={`absolute inset-0 ${colors.light} opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none`} />
                  
                  <CardHeader className="relative pb-4 pt-6">
                    <div className="flex items-start gap-4">
                      {/* Icon */}
                      <div className={`relative h-16 w-16 rounded-2xl ${colors.light} dark:${colors.bg}/20 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-300`}>
                        <Icon className={`h-8 w-8 ${colors.text}`} />
                        {/* Status Dot */}
                        <div className={`absolute -top-1 -right-1 h-4 w-4 ${status.color} rounded-full border-2 border-white dark:border-slate-900`} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-xl font-bold mb-2 truncate group-hover:text-primary transition-colors">
                          {service.name}
                        </CardTitle>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <MapPin className="h-4 w-4 flex-shrink-0" />
                          <span className="truncate">{service.location?.name}</span>
                        </div>
                        <Badge variant="outline" className="mt-3 text-xs">
                          <Circle className={`h-2 w-2 mr-1.5 fill-current ${status.color.replace('bg-', 'text-')}`} />
                          {status.text}
                        </Badge>
                      </div>

                      {/* Arrow */}
                      <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-300">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <ArrowRight className="h-5 w-5 text-primary group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="relative space-y-4 pt-2">
                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                        <Sprout className="h-4 w-4 text-slate-400 mx-auto mb-1.5" />
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">{service.garden_count}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Gardens</p>
                      </div>
                      <div className="text-center p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                        <Bot className="h-4 w-4 text-slate-400 mx-auto mb-1.5" />
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">{service.bot_count}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Bots</p>
                      </div>
                      <div className="text-center p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                        <Ruler className="h-4 w-4 text-slate-400 mx-auto mb-1.5" />
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">{Math.round(service.total_area)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Area m²</p>
                      </div>
                    </div>

                    {/* Alert if pending */}
                    {service.status === 'pending_setup' && (
                      <Alert className="border-l-4 border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20">
                        <Info className="h-4 w-4 text-blue-600" />
                        <AlertDescription className="text-xs text-blue-900 dark:text-blue-200">
                          Installation pending - we'll reach out within 24-48 hours
                        </AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-20">
            <Card className="max-w-md mx-auto border-dashed">
              <CardContent className="py-12">
                <Search className="h-16 w-16 mx-auto text-slate-300 mb-4" />
                <h3 className="text-lg font-semibold mb-2">No services found</h3>
                <p className="text-sm text-muted-foreground mb-4">Try adjusting your search or filters</p>
                <Button variant="outline" onClick={() => {
                  setSearchQuery('');
                  setFilterStatus('all');
                }}>
                  Clear All Filters
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
