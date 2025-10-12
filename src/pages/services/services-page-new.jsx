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
import { 
  Sprout, 
  Droplets, 
  Plus, 
  MapPin, 
  Calendar, 
  Pause, 
  Play,
  Eye,
  Loader2,
  CircleDot,
  Ruler
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import { format } from 'date-fns';
import ServiceWizard from '@/components/services/service-wizard';

export default function ServicesPage() {
  const { selectedOrg } = useOutletContext();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [gardens, setGardens] = useState([]);
  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [pausingId, setPausingId] = useState(null);
  const [resumingId, setResumingId] = useState(null);

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

      if (!locationsData || locationsData.length === 0) {
        setGardens([]);
        setPools([]);
        setLoading(false);
        return;
      }

      // Load gardens
      const { data: gardensData, error: gardensError } = await supabase
        .from('gardens')
        .select(`
          *,
          location:locations(name, city, province)
        `)
        .in('location_id', locationsData.map(l => l.id))
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (gardensError) throw gardensError;
      setGardens(gardensData || []);

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

  const handlePauseGarden = async (gardenId) => {
    setPausingId(gardenId);
    try {
      const { data, error } = await supabase.rpc('pause_garden_service', {
        p_garden_id: gardenId,
        p_user_id: user.id,
        p_reason: 'Paused by user'
      });

      if (error) throw error;

      toast({
        title: 'Service paused',
        description: 'Garden service has been paused. No charges will apply.',
      });

      loadData();
    } catch (error) {
      console.error('Error pausing service:', error);
      toast({
        title: 'Failed to pause',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setPausingId(null);
    }
  };

  const handleResumeGarden = async (gardenId) => {
    setResumingId(gardenId);
    try {
      const { data, error } = await supabase.rpc('resume_garden_service', {
        p_garden_id: gardenId,
        p_user_id: user.id
      });

      if (error) throw error;

      toast({
        title: 'Service resumed',
        description: 'Garden service has been resumed. Billing will continue.',
      });

      loadData();
    } catch (error) {
      console.error('Error resuming service:', error);
      toast({
        title: 'Failed to resume',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setResumingId(null);
    }
  };

  const GardenCard = ({ garden }) => (
    <Card className="hover:shadow-lg transition-all">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-lg bg-green-100 flex items-center justify-center">
              <Sprout className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <CardTitle className="text-xl">{garden.name}</CardTitle>
              <CardDescription className="flex items-center gap-2 mt-1">
                <MapPin className="h-3 w-3" />
                {garden.location?.name || 'Unknown Location'}
              </CardDescription>
            </div>
          </div>
          {garden.is_paused ? (
            <Badge variant="outline" className="gap-1">
              <Pause className="h-3 w-3" />
              Paused
            </Badge>
          ) : (
            <Badge variant="default" className="gap-1">
              <CircleDot className="h-3 w-3" />
              Active
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs text-muted-foreground">Area</p>
            <p className="font-medium flex items-center gap-1">
              <Ruler className="h-3 w-3" />
              {garden.area_sqm} m²
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Grass Type</p>
            <p className="font-medium capitalize">{garden.grass_type || 'Not specified'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Service Frequency</p>
            <p className="font-medium">
              {garden.service_frequency === 'bi-weekly' ? 'Bi-Weekly' : 'Monthly'}
            </p>
          </div>
          {garden.last_mowed_at && (
            <div>
              <p className="text-xs text-muted-foreground">Last Serviced</p>
              <p className="font-medium flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {format(new Date(garden.last_mowed_at), 'MMM d, yyyy')}
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-4 border-t">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => navigate(`/portal/garden/${garden.id}`)}
          >
            <Eye className="h-4 w-4 mr-1" />
            View Details
          </Button>
          
          {garden.is_paused ? (
            <Button
              variant="default"
              size="sm"
              className="flex-1 gap-1"
              onClick={() => handleResumeGarden(garden.id)}
              disabled={resumingId === garden.id}
            >
              {resumingId === garden.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Resume
                </>
              )}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1"
              onClick={() => handlePauseGarden(garden.id)}
              disabled={pausingId === garden.id}
            >
              {pausingId === garden.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Pause className="h-4 w-4" />
                  Pause
                </>
              )}
            </Button>
          )}
        </div>

        {garden.is_paused && garden.paused_at && (
          <div className="mt-3 p-2 bg-muted/50 rounded text-xs text-muted-foreground">
            Paused since {format(new Date(garden.paused_at), 'MMM d, yyyy')}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Services</h1>
          <p className="text-muted-foreground mt-1">
            Manage your automated services and schedules
          </p>
        </div>
        <Button onClick={() => setWizardOpen(true)} size="lg" className="gap-2">
          <Plus className="h-5 w-5" />
          Add New Service
        </Button>
      </div>

      {/* Services Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : gardens.length === 0 && pools.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Sprout className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Services Yet</h3>
            <p className="text-muted-foreground text-center mb-6">
              Get started by adding your first automated service
            </p>
            <Button onClick={() => setWizardOpen(true)} size="lg">
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
                <h2 className="text-xl font-semibold">Garden Services</h2>
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
                <h2 className="text-xl font-semibold">Pool Services</h2>
                <Badge variant="secondary">{pools.length}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {pools.map(pool => (
                  <Card key={pool.id} className="hover:shadow-lg transition-all">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-lg bg-blue-100 flex items-center justify-center">
                            <Droplets className="h-6 w-6 text-blue-600" />
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

      {/* Service Wizard */}
      <ServiceWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        organizationId={selectedOrg?.organization_id}
        onComplete={() => {
          loadData();
          setWizardOpen(false);
        }}
      />
    </div>
  );
}

