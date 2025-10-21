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
  ChevronRight
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

/**
 * My Locations Bot Status Component
 * Shows all user's locations with current bot status
 * Uses RPC function with RLS
 */
export default function MyLocationsBotStatus() {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchLocations();
    
    // Refresh every minute
    const interval = setInterval(fetchLocations, 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchLocations = async () => {
    try {
      setError(null);
      
      // Call RPC function
      const { data, error: rpcError } = await supabase
        .rpc('get_my_locations_with_bots');
      
      if (rpcError) {
        throw rpcError;
      }
      
      setLocations(data || []);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching locations:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      online: 'bg-green-500',
      offline: 'bg-gray-500',
      active: 'bg-blue-500',
      idle: 'bg-yellow-500',
      charging: 'bg-purple-500',
      error: 'bg-red-500',
      maintenance: 'bg-orange-500'
    };
    return colors[status] || 'bg-gray-500';
  };

  const getBatteryColor = (level) => {
    if (level > 60) return 'text-green-600';
    if (level > 30) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getBotTypeIcon = (botType) => {
    switch (botType) {
      case 'mow_bot':
        return '🤖';
      case 'pool_bot':
        return '🏊';
      case 'weather_station':
        return '🌦️';
      default:
        return '🤖';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading your locations...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-2" />
          <p className="font-semibold mb-2">Error loading locations</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={fetchLocations} className="mt-4">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Locations</CardTitle>
          <CardDescription>No locations found</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            You don't have any locations with active services yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">My Locations</h2>
          <p className="text-muted-foreground">
            {locations.length} location{locations.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchLocations}>
          <Activity className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {locations.map((location) => (
          <Card key={location.location_id} className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    {location.location_name}
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    {location.location_address || 'No address'}
                  </CardDescription>
                </div>
                {location.bot_id && (
                  <span className="text-2xl">
                    {getBotTypeIcon(location.bot_type)}
                  </span>
                )}
              </div>
            </CardHeader>
            
            <CardContent className="space-y-3">
              {location.bot_id ? (
                <>
                  {/* Bot Name & Status */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{location.bot_name}</span>
                    <Badge className={getStatusColor(location.bot_status)} variant="outline">
                      {location.bot_status}
                    </Badge>
                  </div>

                  {/* Battery */}
                  {location.battery_level !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground flex items-center gap-2">
                        <Battery className={`w-4 h-4 ${getBatteryColor(location.battery_level)}`} />
                        Battery
                      </span>
                      <span className="text-sm font-semibold">
                        {location.battery_level}%
                      </span>
                    </div>
                  )}

                  {/* Temperature */}
                  {location.current_temperature !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground flex items-center gap-2">
                        <Thermometer className="w-4 h-4" />
                        Temperature
                      </span>
                      <span className="text-sm font-semibold">
                        {location.current_temperature?.toFixed(1)}°C
                      </span>
                    </div>
                  )}

                  {/* Activity Status */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <Badge variant={location.is_on ? "default" : "outline"}>
                      {location.is_on ? 'Active' : 'Idle'}
                    </Badge>
                  </div>

                  {/* Last Online */}
                  {location.last_online_at && (
                    <div className="text-xs text-muted-foreground">
                      Last online: {formatDistanceToNow(new Date(location.last_online_at), { addSuffix: true })}
                    </div>
                  )}

                  {/* View Details Button */}
                  <Link to={`/portal/location/${location.location_id}/bot-status`}>
                    <Button variant="outline" size="sm" className="w-full mt-2">
                      View Details
                      <ChevronRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                </>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-4">
                  No bot assigned to this location
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

