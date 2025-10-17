import React, { useState, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Sprout, 
  Droplets, 
  Plus, 
  MapPin, 
  Calendar,
  Eye,
  Loader2,
  CircleDot,
  Ruler,
  ArrowRight,
  AlertCircle,
  Pause,
  Bot
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import PageHeader from '@/components/ui/page-header';
import LocationWizard from '@/components/services/location-wizard';
import { format } from 'date-fns';

export default function ServicesPage() {
  const { selectedOrg } = useOutletContext();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [gardens, setGardens] = useState([]);
  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState([]);
  const [showLocationWizard, setShowLocationWizard] = useState(false);

  useEffect(() => {
    if (selectedOrg) {
      loadData();
    }
  }, [selectedOrg]);

  const loadData = async () => {
    if (!selectedOrg?.organization_id) return;

    try {
      setLoading(true);

      // Load locations first
      const { data: locationsData } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', selectedOrg.organization_id)
        .eq('is_active', true);

      setLocations(locationsData || []);

      if (!locationsData || locationsData.length === 0) {
        setGardens([]);
        setPools([]);
        setLoading(false);
        return;
      }

      // Load gardens with bot count
      const { data: gardensData, error: gardensError } = await supabase
        .from('gardens')
        .select(`
          *,
          location:locations(name, city, province),
          bot_garden_assignments(count)
        `)
        .in('location_id', locationsData.map(l => l.id))
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (gardensError) throw gardensError;
      
      // Add bot count to each garden
      const gardensWithBotCount = (gardensData || []).map(garden => ({
        ...garden,
        bot_count: garden.bot_garden_assignments?.[0]?.count || 0
      }));
      
      setGardens(gardensWithBotCount);

      // Load pools
      const { data: poolsData, error: poolsError } = await supabase
        .from('pools')
        .select(`
          *,
          location:locations(name, city, province)
        `)
        .in('location_id', locationsData.map(l => l.id))
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (poolsError) throw poolsError;
      setPools(poolsData || []);

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

  const GardenCard = ({ garden }) => {
    // Determine service stage
    const stage = garden.stage || 'pending_installation';
    const isInstalled = ['installed', 'active'].includes(stage);
    
    // Count bots (placeholder - will be fetched with garden data)
    const botCount = garden.bot_count || 1;
    
    // Stage badge configuration
    const getStageDisplay = () => {
      if (garden.is_paused) {
        return { label: 'Paused', variant: 'outline', color: 'bg-amber-100 text-amber-700 border-amber-300' };
      }
      switch (stage) {
        case 'pending_installation':
          return { label: 'Pending Setup', variant: 'secondary', color: 'bg-blue-100 text-blue-700 border-blue-300' };
        case 'installation_scheduled':
          return { label: 'Setup Scheduled', variant: 'default', color: 'bg-purple-100 text-purple-700 border-purple-300' };
        case 'installing':
          return { label: 'Installing', variant: 'default', color: 'bg-indigo-100 text-indigo-700 border-indigo-300' };
        case 'installed':
        case 'active':
          return { label: 'Active', variant: 'default', color: 'bg-green-100 text-green-700 border-green-300' };
        default:
          return { label: 'Active', variant: 'default', color: 'bg-green-100 text-green-700 border-green-300' };
      }
    };
    
    const stageDisplay = getStageDisplay();
    
    return (
      <Card className="group hover:shadow-xl hover:scale-[1.02] transition-all duration-200 border-2 hover:border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shrink-0 shadow-md">
                <Sprout className="h-7 w-7 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <CardTitle className="text-xl font-bold truncate">{garden.name}</CardTitle>
                <CardDescription className="flex items-center gap-1.5 mt-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{garden.location?.name || 'Unknown Location'}</span>
                </CardDescription>
              </div>
            </div>
            <Badge variant="secondary" className={`gap-1.5 px-2.5 py-1 font-medium shrink-0 ${stageDisplay.color} border`}>
              {garden.is_paused ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <CircleDot className="h-3.5 w-3.5" />
              )}
              {stageDisplay.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Bot Count & Quick Stats */}
          <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {botCount} Bot{botCount !== 1 ? 's' : ''} • {garden.area_sqm} m²
            </span>
          </div>

          {/* Show installation message or stats */}
          {!isInstalled ? (
            <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-sm text-blue-900 dark:text-blue-100">
                {stage === 'pending_installation' && 'Awaiting installation - we\'ll contact you soon'}
                {stage === 'installation_scheduled' && `Setup: ${garden.installation_scheduled_date ? format(new Date(garden.installation_scheduled_date), 'MMM d') : 'scheduled'}`}
                {stage === 'installing' && 'Installation in progress'}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Grass Type</p>
                <p className="text-sm font-medium capitalize">{garden.grass_type || 'Standard'}</p>
              </div>
              {garden.last_mowed_at && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Last Service</p>
                  <p className="text-sm font-medium flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(garden.last_mowed_at), 'MMM d')}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Action Button */}
          <Button
            variant={isInstalled ? "default" : "outline"}
            size="sm"
            className="w-full group-hover:shadow-md transition-shadow"
            onClick={() => navigate(`/portal/garden/${garden.id}`)}
          >
            <Eye className="h-4 w-4 mr-2" />
            View Details
            <ArrowRight className="h-4 w-4 ml-auto" />
          </Button>

          {garden.is_paused && garden.paused_at && (
            <p className="text-xs text-muted-foreground text-center pt-2 border-t">
              Paused since {format(new Date(garden.paused_at), 'MMM d, yyyy')}
            </p>
          )}
        </CardContent>
      </Card>
    );
  };

  // Show location wizard if requested
  if (showLocationWizard) {
    return (
      <div className="p-6 space-y-6">
        <LocationWizard
          organizationId={selectedOrg.organization_id}
          onComplete={(newLocation) => {
            setShowLocationWizard(false);
            loadData();
            toast({
              title: 'Location Created!',
              description: 'You can now add services to this location',
            });
          }}
          onCancel={() => setShowLocationWizard(false)}
          embedded={false}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Services"
        subtitle="Manage your automated services and schedules"
        actions={
          locations.length > 0 ? (
            <Button onClick={() => navigate('/portal/services/add')} size="lg" className="gap-2">
              <Plus className="h-5 w-5" />
              Add New Service
            </Button>
          ) : null
        }
      />

      {/* Services Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : locations.length === 0 ? (
        <Card className="border-2 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-6">
            <div className="rounded-full bg-orange-100 dark:bg-orange-950 p-8">
              <MapPin className="h-16 w-16 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="space-y-3 max-w-xl">
              <h3 className="text-3xl font-bold">Location Required</h3>
              <p className="text-muted-foreground text-lg">
                Before you can add services, you need to create a location for your property. 
                This tells us where to deploy your bots and ensures we service your area.
              </p>
            </div>
            
            <Alert className="max-w-xl">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                A location is required to add any service (lawn, pool, security). This ensures accurate coverage and bot deployment.
              </AlertDescription>
            </Alert>

            <Button size="lg" onClick={() => setShowLocationWizard(true)} className="text-lg px-8 py-6">
              <MapPin className="h-6 w-6 mr-2" />
              Create Your First Location
              <ArrowRight className="h-6 w-6 ml-2" />
            </Button>
          </CardContent>
        </Card>
      ) : gardens.length === 0 && pools.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Sprout className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Services Yet</h3>
            <p className="text-muted-foreground text-center mb-6">
              Get started by adding your first automated service
            </p>
            <Button onClick={() => navigate('/portal/services/add')} size="lg">
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Service
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Garden Services */}
          {gardens.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Sprout className="h-5 w-5 text-green-600" />
                <h2 className="text-xl font-semibold">Services</h2>
                <Badge variant="secondary">{gardens.length}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {gardens.map(garden => (
                  <GardenCard key={garden.id} garden={garden} />
                ))}
              </div>
            </div>
          )}

          {/* Pool Services */}
          {pools.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Droplets className="h-5 w-5 text-blue-600" />
                <h2 className="text-xl font-semibold">Pools</h2>
                <Badge variant="secondary">{pools.length}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {pools.map(pool => (
                  <Card key={pool.id} className="hover:shadow-lg transition-all">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-lg bg-blue-100 flex items-center justify-center">
                            <img src="/images/pool-icon.png" alt="Pool" className="h-6 w-6" />
                          </div>
                          <div>
                            <CardTitle className="text-xl">{pool.name}</CardTitle>
                            <CardDescription className="flex items-center gap-2 mt-1">
                              <MapPin className="h-3 w-3" />
                              {pool.location?.name || 'Unknown Location'}
                            </CardDescription>
                          </div>
                        </div>
                        <Badge variant="secondary">Pool</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {pool.pool_type} • {pool.volume_liters}L
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}

