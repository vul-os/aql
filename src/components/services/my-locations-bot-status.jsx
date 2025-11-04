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
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-[#FF6B35]" />
          <p className="text-xs text-[#4F5D75] dark:text-[#B0B3B8] font-medium uppercase tracking-wide">Loading your services...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-0 shadow-lg bg-white dark:bg-[#1a1a1a]">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center">
          <AlertTriangle className="h-12 w-12 text-[#EF4444] mx-auto mb-4" />
          <p className="font-bold text-sm uppercase tracking-wide mb-2 text-[#121212] dark:text-white">Error loading services</p>
          <p className="text-xs text-[#4F5D75] dark:text-[#B0B3B8] mb-4">{error}</p>
          <Button 
            onClick={fetchServices}
            className="bg-gradient-to-r from-[#FF6B35] to-[#E85A2A] hover:from-[#E85A2A] hover:to-[#FF6B35] text-white shadow-sm hover:shadow-md transition-all duration-300 font-bold uppercase tracking-wide text-xs"
          >
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (services.length === 0) {
    return null; // Don't show anything if no services
  }

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-3 duration-500">
      {/* Section Header - Soft UI Design */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-1 w-1 bg-botkorp-orange rounded-full" />
          <div className="h-px w-6 bg-gradient-to-r from-botkorp-orange to-transparent" />
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            My Services
          </h2>
          <Badge className="h-4 px-1.5 text-[9px] font-semibold bg-botkorp-orange/10 text-botkorp-orange border-0">
            {services.length}
          </Badge>
          <div className="flex-1 h-px bg-gradient-to-r from-muted/30 to-transparent" />
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={fetchServices}
          className="h-8 text-xs hover:bg-muted/50 font-medium"
        >
          <Activity className="h-3 w-3 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* Services Grid - Soft UI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {services.map((service, index) => {
          // Get first garden for this service (if garden service)
          const garden = service.gardens?.[0];
          const latestEnv = garden?.latest_environmental?.[0];
          const recentSessions = garden?.recent_sessions || [];
          const completedSessions = recentSessions.filter(s => s.completion_status === 'completed');
          
          return (
            <Card 
              key={service.id} 
              className="relative overflow-hidden bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/30 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-slate-200/50 dark:border-slate-800/50 transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3"
              style={{ animationDelay: `${index * 100}ms`, animationDuration: '500ms' }}
            >
              
              <CardHeader className="pb-3 pt-5 px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center text-2xl shadow-[0_4px_20px_rgba(255,107,53,0.15)] group-hover:scale-110 transition-transform duration-300 flex-shrink-0">
                      {getServiceTypeIcon(service.service_type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm font-semibold truncate mb-1">
                        {service.name}
                      </CardTitle>
                      <CardDescription className="text-xs flex items-center gap-1.5 truncate">
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                        {service.location?.name || service.location?.city || 'No location'}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge 
                    className={`${getServiceStatusColor(service.status)} h-5 px-2.5 text-[9px] font-semibold uppercase text-white border-0 shadow-sm flex-shrink-0`}
                  >
                    {service.status.replace(/_/g, ' ')}
                  </Badge>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-3 px-5 pb-5">
                {garden ? (
                  <>
                    {/* Garden Area - Soft Design */}
                    <div className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                      <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-medium">
                        {garden.name}
                      </span>
                      <span className="text-sm font-bold">
                        {Math.round(garden.area_sqm)} m²
                      </span>
                    </div>

                    {/* Environmental Data - Soft Grid */}
                    {latestEnv && (
                      <div className="grid grid-cols-2 gap-2">
                        {/* Temperature */}
                        {latestEnv.temperature_celsius !== null && (
                          <div className="flex flex-col gap-1.5 py-2.5 px-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all">
                            <div className="flex items-center gap-1.5">
                              <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-orange-500/15 to-orange-500/5 flex items-center justify-center">
                                <Thermometer className="h-3.5 w-3.5 text-orange-600" />
                              </div>
                              <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wider font-medium">Temp</span>
                            </div>
                            <span className="text-base font-bold">
                              {latestEnv.temperature_celsius?.toFixed(1)}°C
                            </span>
                          </div>
                        )}

                        {/* Humidity */}
                        {latestEnv.humidity_percentage !== null && (
                          <div className="flex flex-col gap-1.5 py-2.5 px-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all">
                            <div className="flex items-center gap-1.5">
                              <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-blue-500/15 to-blue-500/5 flex items-center justify-center">
                                <Droplets className="h-3.5 w-3.5 text-blue-600" />
                              </div>
                              <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wider font-medium">Humid</span>
                            </div>
                            <span className="text-base font-bold">
                              {latestEnv.humidity_percentage?.toFixed(0)}%
                            </span>
                          </div>
                        )}

                        {/* Soil Moisture - Full Width */}
                        {latestEnv.soil_moisture_percentage !== null && (
                          <div className="col-span-2 flex items-center justify-between py-2.5 px-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-medium">Soil Moisture</span>
                            <Badge className={`${getMoistureStatus(latestEnv.soil_moisture_percentage).color} h-5 px-2.5 text-[9px] font-semibold bg-opacity-10 border-0`}>
                              {getMoistureStatus(latestEnv.soil_moisture_percentage).label} ({latestEnv.soil_moisture_percentage?.toFixed(0)}%)
                            </Badge>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Last Updated */}
                    {latestEnv?.recorded_at && (
                      <div className="text-[9px] text-muted-foreground/60 text-center py-1">
                        Updated {formatDistanceToNow(new Date(latestEnv.recorded_at), { addSuffix: true })}
                      </div>
                    )}

                    {/* Recent Session Stats - Soft Design */}
                    {recentSessions.length > 0 && (
                      <div className="pt-3 mt-3 border-t border-muted/20 space-y-2">
                        <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                          <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-medium">Sessions</span>
                          <span className="text-sm font-bold">{completedSessions.length} completed</span>
                        </div>
                        {completedSessions.length > 0 && (
                          <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-medium">Avg Coverage</span>
                            <span className="text-sm font-bold">
                              {(completedSessions.reduce((sum, s) => sum + (s.area_covered_sqm || 0), 0) / completedSessions.length).toFixed(0)} m²
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* View Details Button - Soft Style */}
                    <Link to={`/portal/service/${service.id}/service-data`}>
                      <Button 
                        size="sm" 
                        className="w-full mt-3 h-9 text-xs bg-gradient-to-r from-botkorp-orange to-botkorp-orange/90 hover:shadow-lg text-white transition-all duration-300 font-semibold rounded-xl shadow-sm"
                      >
                        View Service Details
                        <ChevronRight className="h-3.5 w-3.5 ml-1.5" />
                      </Button>
                    </Link>
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground text-center py-8 font-medium">
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

