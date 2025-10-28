import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Battery, 
  Thermometer, 
  MapPin,
  Activity,
  AlertTriangle,
  Loader2,
  ChevronRight,
  Droplets
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

/**
 * My Locations Service Status Component
 * Shows all user's services with current status and performance
 * Organized by service (garden/pool) rather than by bot
 */
export default function MyLocationsBotStatus() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchServices();
    
    // Refresh every minute
    const interval = setInterval(fetchServices, 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchServices = async () => {
    try {
      setError(null);
      
      // Get user's services with latest data
      const { data: servicesData, error: servicesError } = await supabase
        .from('services')
        .select(`
          id,
          name,
          service_type,
          status,
          location:locations(id, name, address, city),
          gardens(
            id,
            name,
            area_sqm,
            latest_environmental:garden_environmental_data(
              temperature_celsius,
              humidity_percentage,
              soil_moisture_percentage,
              is_raining,
              recorded_at
            ),
            recent_sessions:garden_mowing_sessions(
              id,
              session_start,
              completion_status,
              area_covered_sqm,
              duration_minutes
            )
          )
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      
      if (servicesError) {
        throw servicesError;
      }
      
      setServices(servicesData || []);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching services:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const getServiceStatusColor = (status) => {
    const colors = {
      'active': 'bg-green-500',
      'pending_setup': 'bg-yellow-500',
      'pending_installation': 'bg-blue-500',
      'installation_scheduled': 'bg-blue-500',
      'installing': 'bg-purple-500',
      'paused': 'bg-orange-500',
      'cancelled': 'bg-red-500'
    };
    return colors[status] || 'bg-gray-500';
  };

  const getServiceTypeIcon = (serviceType) => {
    switch (serviceType) {
      case 'garden':
        return '🌿';
      case 'pool':
        return '🏊';
      case 'security':
        return '🔒';
      default:
        return '🏡';
    }
  };

  const getMoistureStatus = (percentage) => {
    if (percentage > 60) return { label: 'Wet', color: 'text-blue-600' };
    if (percentage > 40) return { label: 'Good', color: 'text-green-600' };
    return { label: 'Dry', color: 'text-orange-600' };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading your services...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-2" />
          <p className="font-semibold mb-2">Error loading services</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={fetchServices} className="mt-4">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Services</CardTitle>
          <CardDescription>No active services found</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            You don't have any active services yet. Add your first service to get started!
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">My Services</h2>
          <p className="text-muted-foreground">
            {services.length} active service{services.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchServices}>
          <Activity className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {services.map((service) => {
          // Get first garden for this service (if garden service)
          const garden = service.gardens?.[0];
          const latestEnv = garden?.latest_environmental?.[0];
          const recentSessions = garden?.recent_sessions || [];
          const completedSessions = recentSessions.filter(s => s.completion_status === 'completed');
          
          return (
            <Card key={service.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <span className="text-xl">{getServiceTypeIcon(service.service_type)}</span>
                      {service.name}
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">
                      {service.location?.name || 'No location'}
                    </CardDescription>
                  </div>
                  <Badge className={getServiceStatusColor(service.status)} variant="outline">
                    {service.status}
                  </Badge>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-3">
                {garden ? (
                  <>
                    {/* Garden Name */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium flex items-center gap-2">
                        <MapPin className="w-3 h-3" />
                        {garden.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {Math.round(garden.area_sqm)} m²
                      </span>
                    </div>

                    {/* Environmental Data */}
                    {latestEnv && (
                      <>
                        {/* Temperature */}
                        {latestEnv.temperature_celsius !== null && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground flex items-center gap-2">
                              <Thermometer className="w-4 h-4 text-orange-500" />
                              Temperature
                            </span>
                            <span className="text-sm font-semibold">
                              {latestEnv.temperature_celsius?.toFixed(1)}°C
                            </span>
                          </div>
                        )}

                        {/* Humidity */}
                        {latestEnv.humidity_percentage !== null && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground flex items-center gap-2">
                              <Droplets className="w-4 h-4 text-blue-500" />
                              Humidity
                            </span>
                            <span className="text-sm font-semibold">
                              {latestEnv.humidity_percentage?.toFixed(0)}%
                            </span>
                          </div>
                        )}

                        {/* Soil Moisture */}
                        {latestEnv.soil_moisture_percentage !== null && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Soil</span>
                            <Badge variant="outline" className={getMoistureStatus(latestEnv.soil_moisture_percentage).color}>
                              {getMoistureStatus(latestEnv.soil_moisture_percentage).label} ({latestEnv.soil_moisture_percentage?.toFixed(0)}%)
                            </Badge>
                          </div>
                        )}

                        {/* Last Updated */}
                        {latestEnv.recorded_at && (
                          <div className="text-xs text-muted-foreground">
                            Updated {formatDistanceToNow(new Date(latestEnv.recorded_at), { addSuffix: true })}
                          </div>
                        )}
                      </>
                    )}

                    {/* Recent Session Stats */}
                    {recentSessions.length > 0 && (
                      <div className="pt-2 border-t">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Recent Sessions</span>
                          <span className="font-semibold">{completedSessions.length} completed</span>
                        </div>
                        {completedSessions.length > 0 && (
                          <div className="flex items-center justify-between text-xs mt-1">
                            <span className="text-muted-foreground">Avg Coverage</span>
                            <span className="font-semibold">
                              {(completedSessions.reduce((sum, s) => sum + (s.area_covered_sqm || 0), 0) / completedSessions.length).toFixed(0)} m²
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* View Details Button */}
                    <Link to={`/portal/service/${service.id}/service-data`}>
                      <Button variant="outline" size="sm" className="w-full mt-2">
                        View Service Details
                        <ChevronRight className="w-4 h-4 ml-2" />
                      </Button>
                    </Link>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    Service pending setup
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

