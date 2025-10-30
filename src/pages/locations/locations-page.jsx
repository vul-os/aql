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
  Bot,
  Eye,
  Settings as SettingsIcon,
  Sprout,
  Building,
  Droplets,
  ArrowUpRight
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
    <div className="p-3 md:p-5 space-y-5">
      {/* Header Section */}
      <div className="space-y-3 animate-in fade-in slide-in-from-top-3 duration-500">
        <PageHeader
          title="Locations"
          subtitle={`Manage your ${locations.length} location${locations.length !== 1 ? 's' : ''} across ${selectedOrg?.organization_name || 'your organization'}`}
          icon={<MapPin className="h-5 w-5 text-botkorp-orange" />}
        />

        {/* Action Bar */}
        <div className="flex flex-col sm:flex-row gap-2.5 justify-between items-start sm:items-center">
          <div className="relative flex-1 max-w-md w-full group">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground group-focus-within:text-botkorp-orange transition-colors duration-300" />
            <Input
              placeholder="Search locations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-sm focus:border-botkorp-orange focus:ring-2 focus:ring-botkorp-orange/20 transition-all duration-300"
            />
          </div>
          <Button 
            onClick={() => setShowAddLocationDialog(true)}
            className="w-full sm:w-auto h-8 text-sm bg-botkorp-orange hover:bg-botkorp-orange/90 text-white hover:shadow-lg transition-all duration-300 active:scale-95 group"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5 group-hover:rotate-90 transition-transform duration-300" />
            Add Location
          </Button>
        </div>
      </div>

      {/* Locations Grid */}
      {filteredLocations.length === 0 ? (
        <Card className="border-2 border-dashed bg-muted/20 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
          <CardContent className="pt-12 pb-12 text-center">
            <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-botkorp-orange/10 dark:bg-botkorp-orange/20 mb-5 animate-in zoom-in-50 duration-500 delay-100 shadow-sm">
              <MapPin className="h-10 w-10 text-botkorp-orange animate-pulse" />
            </div>
            <h3 className="text-lg font-bold mb-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
              {searchQuery ? 'No locations found' : 'No locations yet'}
            </h3>
            <p className="text-muted-foreground mb-8 max-w-sm mx-auto text-sm leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
              {searchQuery 
                ? 'Try adjusting your search terms to find what you\'re looking for'
                : 'Get started by adding your first location to begin managing your services'}
            </p>
            {!searchQuery && (
              <Button 
                onClick={() => setShowAddLocationDialog(true)}
                className="bg-botkorp-orange hover:bg-botkorp-orange/90 text-white hover:shadow-lg shadow-md transition-all duration-300 active:scale-95 animate-in fade-in zoom-in-50 duration-500 delay-400 h-10 px-6 font-medium"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Location
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Stats Overview with Premium Design */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {/* Total Locations Stat */}
            <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 shadow-sm">
              <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
              <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Locations</CardTitle>
                <div className="h-8 w-8 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-botkorp-orange transition-all duration-300">
                  <MapPin className="h-3.5 w-3.5 text-botkorp-orange group-hover:text-white transition-colors duration-300" />
                </div>
              </CardHeader>
              <CardContent className="relative">
                <div className="text-2xl font-bold tabular-nums">{locations.length}</div>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">Active</p>
              </CardContent>
            </Card>

            {/* Total Bots Stat */}
            <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-75 shadow-sm">
              <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
              <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Bots</CardTitle>
                <div className="h-8 w-8 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-botkorp-orange transition-all duration-300">
                  <Bot className="h-3.5 w-3.5 text-botkorp-orange group-hover:text-white transition-colors duration-300" />
                </div>
              </CardHeader>
              <CardContent className="relative">
                <div className="text-2xl font-bold tabular-nums">
                  {locations.reduce((sum, loc) => sum + (loc.bot_count || 0), 0)}
                </div>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">Total</p>
              </CardContent>
            </Card>

            {/* Active Services Stat */}
            <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-150 shadow-sm">
              <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
              <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Services</CardTitle>
                <div className="h-8 w-8 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-botkorp-orange transition-all duration-300">
                  <Sprout className="h-3.5 w-3.5 text-botkorp-orange group-hover:text-white transition-colors duration-300" />
                </div>
              </CardHeader>
              <CardContent className="relative">
                <div className="text-2xl font-bold tabular-nums">
                  {locations.reduce((sum, loc) => sum + (loc.service_count || 0), 0)}
                </div>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">Active</p>
              </CardContent>
            </Card>

            {/* Organization Stat */}
            <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200 shadow-sm">
              <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
              <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Organization</CardTitle>
                <div className="h-8 w-8 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-botkorp-orange transition-all duration-300">
                  <Building className="h-3.5 w-3.5 text-botkorp-orange group-hover:text-white transition-colors duration-300" />
                </div>
              </CardHeader>
              <CardContent className="relative">
                <div className="text-sm font-bold truncate">
                  {selectedOrg?.organization_name || 'N/A'}
                </div>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5 capitalize">
                  {selectedOrg?.member_role || 'Member'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Locations List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-0.5 w-8 bg-botkorp-orange rounded-full" />
                <h2 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
                  All Locations
                  <Badge variant="secondary" className="h-5 px-2 text-[10px] bg-botkorp-orange/10 text-botkorp-orange border-botkorp-orange/20 animate-in fade-in zoom-in-50 duration-300 delay-300 font-semibold">
                    {filteredLocations.length}
                  </Badge>
                </h2>
              </div>
            </div>

            <div className="grid gap-3 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
              {filteredLocations.map((location, index) => (
                <Card 
                  key={location.id} 
                  className="relative overflow-hidden border-t-4 border-t-botkorp-orange hover:shadow-2xl transition-all duration-300 cursor-pointer group animate-in fade-in slide-in-from-bottom-4 hover:-translate-y-1 shadow-md bg-card"
                  style={{ animationDelay: `${300 + index * 50}ms`, animationDuration: '500ms' }}
                  onClick={() => handleViewLocation(location.id)}
                >
                  {/* Premium subtle overlay */}
                  <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300 pointer-events-none" />
                  
                  <CardHeader className="relative pb-2 pt-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 flex-1 min-w-0">
                        <div className="h-9 w-9 rounded-lg bg-botkorp-orange flex items-center justify-center flex-shrink-0 group-hover:shadow-lg group-hover:scale-105 transition-all duration-300">
                          <MapPin className="h-4 w-4 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-sm font-bold mb-0.5 truncate group-hover:text-botkorp-orange transition-colors duration-300">
                            {location.name}
                          </CardTitle>
                          <CardDescription className="text-[11px] line-clamp-2 leading-relaxed">
                            {location.address}
                            {location.city && `, ${location.city}`}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="h-7 w-7 rounded-lg bg-muted/50 flex items-center justify-center group-hover:bg-botkorp-orange transition-all duration-300">
                        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-white group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-300" />
                      </div>
                    </div>
                  </CardHeader>
                  
                  <CardContent className="relative space-y-2.5 pb-3">
                    {/* Premium Stats Grid */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="relative group/stat">
                        <div className="text-center p-2 rounded-lg border border-border bg-muted/30 hover:border-botkorp-orange/50 hover:bg-botkorp-orange/5 transition-all duration-300">
                          <div className="flex items-center justify-center mb-1">
                            <div className="h-6 w-6 rounded-md bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover/stat:bg-botkorp-orange transition-all duration-300">
                              <Bot className="h-3 w-3 text-botkorp-orange group-hover/stat:text-white transition-colors duration-300" />
                            </div>
                          </div>
                          <div className="text-lg font-bold tabular-nums">{location.bot_count || 0}</div>
                          <p className="text-[10px] text-muted-foreground font-medium">Bots</p>
                        </div>
                      </div>
                      
                      <div className="relative group/stat">
                        <div className="text-center p-2 rounded-lg border border-border bg-muted/30 hover:border-botkorp-orange/50 hover:bg-botkorp-orange/5 transition-all duration-300">
                          <div className="flex items-center justify-center mb-1">
                            <div className="h-6 w-6 rounded-md bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover/stat:bg-botkorp-orange transition-all duration-300">
                              <Sprout className="h-3 w-3 text-botkorp-orange group-hover/stat:text-white transition-colors duration-300" />
                            </div>
                          </div>
                          <div className="text-lg font-bold tabular-nums">{location.garden_count || 0}</div>
                          <p className="text-[10px] text-muted-foreground font-medium">Gardens</p>
                        </div>
                      </div>
                      
                      <div className="relative group/stat">
                        <div className="text-center p-2 rounded-lg border border-border bg-muted/30 hover:border-botkorp-orange/50 hover:bg-botkorp-orange/5 transition-all duration-300">
                          <div className="flex items-center justify-center mb-1">
                            <div className="h-6 w-6 rounded-md bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover/stat:bg-botkorp-orange transition-all duration-300">
                              <Droplets className="h-3 w-3 text-botkorp-orange group-hover/stat:text-white transition-colors duration-300" />
                            </div>
                          </div>
                          <div className="text-lg font-bold tabular-nums">{location.pool_count || 0}</div>
                          <p className="text-[10px] text-muted-foreground font-medium">Pools</p>
                        </div>
                      </div>
                    </div>

                    {/* Premium Action Buttons */}
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        className="flex-1 h-8 text-xs bg-botkorp-orange hover:bg-botkorp-orange/90 text-white shadow-sm hover:shadow-md transition-all duration-300 active:scale-95 font-medium"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewLocation(location.id);
                        }}
                      >
                        <Eye className="h-3 w-3 mr-1.5" />
                        View
                      </Button>
                      <Button 
                        variant="outline"
                        size="sm"
                        className="h-8 w-8 p-0 border-2 hover:border-botkorp-orange hover:bg-botkorp-orange hover:text-white transition-all duration-300 active:scale-95"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate('/portal/settings?tab=locations');
                        }}
                      >
                        <SettingsIcon className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Add Location Dialog */}
      <Dialog open={showAddLocationDialog} onOpenChange={setShowAddLocationDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-300">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center">
                <MapPin className="h-4 w-4 text-botkorp-orange" />
              </div>
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

