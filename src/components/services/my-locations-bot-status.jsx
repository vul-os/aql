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
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-500">
      {/* Section Header - Corporate Design */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-1 w-1 bg-[#FF6B35] rounded-full" />
          <div className="h-1 w-8 bg-gradient-to-r from-[#FF6B35] to-[#E85A2A] rounded-full" />
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-[#121212] dark:text-white">
            My Services
          </h2>
          <Badge className="h-5 px-2.5 text-[10px] font-bold bg-[#FF6B35]/10 text-[#FF6B35] dark:bg-[#FF6B35]/20 dark:text-[#FF6B35] border-0">
            {services.length}
          </Badge>
          <div className="flex-1 h-[1px] bg-gradient-to-r from-[#B0B3B8]/30 to-transparent" />
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={fetchServices}
          className="h-8 text-xs hover:bg-[#FF6B35]/10 text-[#4F5D75] dark:text-[#B0B3B8] font-bold uppercase tracking-wide"
        >
          <Activity className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {services.map((service, index) => {
          // Get first garden for this service (if garden service)
          const garden = service.gardens?.[0];
          const latestEnv = garden?.latest_environmental?.[0];
          const recentSessions = garden?.recent_sessions || [];
          const completedSessions = recentSessions.filter(s => s.completion_status === 'completed');
          
          return (
            <Card 
              key={service.id} 
              className="relative overflow-hidden border-0 shadow-md hover:shadow-xl transition-all duration-500 group bg-white dark:bg-[#1a1a1a] animate-in fade-in slide-in-from-bottom-3"
              style={{ animationDelay: `${index * 100}ms`, animationDuration: '500ms' }}
            >
              {/* Left accent bar */}
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-[#FF6B35] to-[#E85A2A]" />
              
              {/* Subtle gradient background */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#FF6B35]/5 to-[#E85A2A]/5 dark:from-[#FF6B35]/10 dark:to-[#E85A2A]/10" />
              
              <CardHeader className="pb-3 pt-4 px-4 relative">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-[#FF6B35] to-[#E85A2A] flex items-center justify-center text-white text-xl shadow-md group-hover:scale-110 transition-transform duration-300 flex-shrink-0">
                      {getServiceTypeIcon(service.service_type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm font-bold uppercase tracking-wide truncate text-[#121212] dark:text-white">
                        {service.name}
                      </CardTitle>
                      <CardDescription className="text-[10px] mt-1 text-[#4F5D75] dark:text-[#B0B3B8] flex items-center gap-1 truncate">
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                        {service.location?.name || 'No location'}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge 
                    className={`${getServiceStatusColor(service.status)} h-5 px-2 text-[9px] font-bold uppercase tracking-wide text-white border-0 shadow-sm flex-shrink-0`}
                  >
                    {service.status.replace(/_/g, ' ')}
                  </Badge>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-2.5 px-4 pb-4 relative">
                {garden ? (
                  <>
                    {/* Garden Area */}
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#FAFAFA] dark:bg-[#121212] border border-[#E5E7EB] dark:border-[#2a2a2a]">
                      <span className="text-[10px] text-[#B0B3B8] uppercase tracking-[0.08em] font-bold">
                        {garden.name}
                      </span>
                      <span className="text-xs font-bold text-[#121212] dark:text-white">
                        {Math.round(garden.area_sqm)} m²
                      </span>
                    </div>

                    {/* Environmental Data */}
                    {latestEnv && (
                      <div className="space-y-2">
                        {/* Temperature */}
                        {latestEnv.temperature_celsius !== null && (
                          <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#FAFAFA] dark:bg-[#121212]">
                            <span className="text-[10px] text-[#B0B3B8] uppercase tracking-[0.08em] font-bold flex items-center gap-1.5">
                              <Thermometer className="h-3.5 w-3.5 text-[#FF6B35]" />
                              Temperature
                            </span>
                            <span className="text-xs font-bold text-[#121212] dark:text-white">
                              {latestEnv.temperature_celsius?.toFixed(1)}°C
                            </span>
                          </div>
                        )}

                        {/* Humidity */}
                        {latestEnv.humidity_percentage !== null && (
                          <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#FAFAFA] dark:bg-[#121212]">
                            <span className="text-[10px] text-[#B0B3B8] uppercase tracking-[0.08em] font-bold flex items-center gap-1.5">
                              <Droplets className="h-3.5 w-3.5 text-[#4F5D75]" />
                              Humidity
                            </span>
                            <span className="text-xs font-bold text-[#121212] dark:text-white">
                              {latestEnv.humidity_percentage?.toFixed(0)}%
                            </span>
                          </div>
                        )}

                        {/* Soil Moisture */}
                        {latestEnv.soil_moisture_percentage !== null && (
                          <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#FAFAFA] dark:bg-[#121212]">
                            <span className="text-[10px] text-[#B0B3B8] uppercase tracking-[0.08em] font-bold">Soil</span>
                            <Badge className={`${getMoistureStatus(latestEnv.soil_moisture_percentage).color} h-5 px-2 text-[9px] font-bold uppercase tracking-wide border-0`}>
                              {getMoistureStatus(latestEnv.soil_moisture_percentage).label} ({latestEnv.soil_moisture_percentage?.toFixed(0)}%)
                            </Badge>
                          </div>
                        )}

                        {/* Last Updated */}
                        {latestEnv.recorded_at && (
                          <div className="text-[9px] text-[#B0B3B8] text-center py-1">
                            Updated {formatDistanceToNow(new Date(latestEnv.recorded_at), { addSuffix: true })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Recent Session Stats */}
                    {recentSessions.length > 0 && (
                      <div className="pt-2 mt-2 border-t border-[#E5E7EB] dark:border-[#2a2a2a] space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-[#B0B3B8] uppercase tracking-[0.08em] font-bold">Sessions</span>
                          <span className="text-xs font-bold text-[#121212] dark:text-white">{completedSessions.length} completed</span>
                        </div>
                        {completedSessions.length > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] text-[#B0B3B8] uppercase tracking-[0.08em] font-bold">Avg Coverage</span>
                            <span className="text-xs font-bold text-[#121212] dark:text-white">
                              {(completedSessions.reduce((sum, s) => sum + (s.area_covered_sqm || 0), 0) / completedSessions.length).toFixed(0)} m²
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* View Details Button */}
                    <Link to={`/portal/service/${service.id}/service-data`}>
                      <Button 
                        size="sm" 
                        className="w-full mt-3 h-9 text-xs bg-gradient-to-r from-[#4F5D75] to-[#6B7A94] hover:from-[#6B7A94] hover:to-[#4F5D75] text-white shadow-sm hover:shadow-md transition-all duration-300 font-bold uppercase tracking-wide border-0"
                      >
                        View Service Details
                        <ChevronRight className="h-3.5 w-3.5 ml-1.5" />
                      </Button>
                    </Link>
                  </>
                ) : (
                  <div className="text-xs text-[#4F5D75] dark:text-[#B0B3B8] text-center py-8 font-medium uppercase tracking-wide">
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

