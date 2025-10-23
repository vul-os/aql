import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import LoadingLottie from '@/components/ui/loading-lottie';
import {
  MapPin,
  Plus,
  Search,
  Home,
  Bot,
  Activity,
  AlertTriangle,
  Eye,
  Settings as SettingsIcon,
  Sprout,
  ChevronRight,
  Building
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import PageHeader from '@/components/ui/page-header';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import LocationWizard from '@/components/services/location-wizard';

export default function LocationsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { selectedOrg } = useAuth();
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddLocationDialog, setShowAddLocationDialog] = useState(false);

  useEffect(() => {
    if (selectedOrg) {
      loadLocations();
    }
  }, [selectedOrg]);

  const loadLocations = async () => {
    setLoading(true);
    try {
      // Get locations with bot counts and service counts
      const { data, error } = await supabase
        .from('locations')
        .select(`
          *,
          organization:organizations(id, name),
          bots:bots(count),
          gardens:gardens(count),
          pools:pools(count)
        `)
        .eq('organization_id', selectedOrg.organization_id)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      // Transform data to include counts
      const locationsWithCounts = (data || []).map(loc => ({
        ...loc,
        bot_count: loc.bots?.[0]?.count || 0,
        garden_count: loc.gardens?.[0]?.count || 0,
        pool_count: loc.pools?.[0]?.count || 0,
        service_count: (loc.gardens?.[0]?.count || 0) + (loc.pools?.[0]?.count || 0)
      }));

      setLocations(locationsWithCounts);
    } catch (error) {
      console.error('Error loading locations:', error);
      toast({
        title: "Error",
        description: "Failed to load locations",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredLocations = locations.filter(loc =>
    loc.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    loc.city?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    loc.address?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleViewLocation = (locationId) => {
    navigate(`/portal/location/${locationId}/bot-status`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen">
        <LoadingLottie
          src="https://lottie.host/51fee83a-3e79-41b0-8a20-77f890b9b6f1/iUangPxwIF.lottie"
          message="Loading locations..."
          size="md"
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="Locations"
        subtitle={`Manage your ${locations.length} location${locations.length !== 1 ? 's' : ''} across ${selectedOrg?.organization_name || 'your organization'}`}
        icon={<MapPin className="h-6 w-6 text-primary" />}
      />

      {/* Action Bar */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search locations by name, city, or address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button 
          onClick={() => setShowAddLocationDialog(true)}
          className="w-full sm:w-auto"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Location
        </Button>
      </div>

      {/* Locations Grid */}
      {filteredLocations.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="pt-6 pb-8 text-center">
            <MapPin className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-semibold mb-2">
              {searchQuery ? 'No locations found' : 'No locations yet'}
            </h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              {searchQuery 
                ? 'Try adjusting your search terms'
                : 'Get started by adding your first location to manage services and bots'}
            </p>
            {!searchQuery && (
              <Button onClick={() => setShowAddLocationDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Location
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Quick Stats */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Locations</CardTitle>
                <MapPin className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{locations.length}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Active locations
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Bots</CardTitle>
                <Bot className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {locations.reduce((sum, loc) => sum + (loc.bot_count || 0), 0)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Across all locations
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Services</CardTitle>
                <Sprout className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {locations.reduce((sum, loc) => sum + (loc.service_count || 0), 0)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Gardens and pools
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Organization</CardTitle>
                <Building className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold truncate">
                  {selectedOrg?.organization_name || 'N/A'}
                </div>
                <p className="text-xs text-muted-foreground mt-1 capitalize">
                  {selectedOrg?.member_role || 'Member'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Locations List */}
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
            {filteredLocations.map((location) => (
              <Card 
                key={location.id} 
                className="hover:shadow-lg transition-all duration-200 cursor-pointer group"
                onClick={() => handleViewLocation(location.id)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-botkorp-orange to-red-500 flex items-center justify-center flex-shrink-0 shadow-lg group-hover:scale-110 transition-transform">
                        <MapPin className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg mb-1 truncate group-hover:text-botkorp-orange transition-colors">
                          {location.name}
                        </CardTitle>
                        <CardDescription className="text-sm line-clamp-2">
                          {location.address}
                          {location.city && `, ${location.city}`}
                          {location.province && `, ${location.province}`}
                        </CardDescription>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-botkorp-orange group-hover:translate-x-1 transition-all flex-shrink-0" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <Bot className="h-4 w-4 text-botkorp-orange" />
                        <span className="text-2xl font-bold">{location.bot_count || 0}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Bots</p>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <Sprout className="h-4 w-4 text-green-600" />
                        <span className="text-2xl font-bold">{location.garden_count || 0}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Gardens</p>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <Activity className="h-4 w-4 text-blue-600" />
                        <span className="text-2xl font-bold">{location.pool_count || 0}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Pools</p>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewLocation(location.id);
                      }}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View Details
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate('/portal/settings?tab=locations');
                      }}
                    >
                      <SettingsIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Add Location Dialog */}
      <Dialog open={showAddLocationDialog} onOpenChange={setShowAddLocationDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              Add New Location
            </DialogTitle>
            <DialogDescription>
              Add a new location for {selectedOrg?.organization_name}
            </DialogDescription>
          </DialogHeader>
          <LocationWizard
            organizationId={selectedOrg?.organization_id}
            onComplete={(newLocation) => {
              setShowAddLocationDialog(false);
              loadLocations();
              toast({
                variant: 'success',
                title: 'Location Added! 🎉',
                description: `${newLocation.name} has been added successfully.`,
              });
            }}
            onCancel={() => setShowAddLocationDialog(false)}
            embedded={true}
            showCancel={true}
            title=""
            description=""
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

