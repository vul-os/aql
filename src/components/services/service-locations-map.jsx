import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Navigation, Calendar, CheckCircle, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function ServiceLocationsMap() {
  const { selectedOrg } = useAuth();
  const { toast } = useToast();
  const mapRef = useRef(null);
  const googleMapRef = useRef(null);
  const markersRef = useRef([]);
  
  const [currentDate, setCurrentDate] = useState(new Date());
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mapLoaded, setMapLoaded] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  // Load Google Maps API
  useEffect(() => {
    if (!window.google) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=YOUR_GOOGLE_MAPS_API_KEY`;
      script.async = true;
      script.defer = true;
      script.onload = () => setMapLoaded(true);
      document.head.appendChild(script);
    } else {
      setMapLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (selectedOrg) {
      loadLocations();
    }
  }, [selectedOrg, year, month]);

  useEffect(() => {
    if (mapLoaded && locations.length > 0) {
      initializeMap();
    }
  }, [mapLoaded, locations]);

  const loadLocations = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .rpc('get_monthly_service_locations', {
          p_year: year,
          p_month: month,
          p_organization_id: selectedOrg.organization_id
        });

      if (error) throw error;
      setLocations(data || []);

    } catch (error) {
      console.error('Error loading locations:', error);
      toast({
        title: 'Error Loading Locations',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const initializeMap = () => {
    if (!mapRef.current || !window.google || locations.length === 0) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = [];

    // Get valid locations with coordinates
    const validLocations = locations.filter(loc => loc.latitude && loc.longitude);
    
    if (validLocations.length === 0) {
      return;
    }

    // Calculate center
    const avgLat = validLocations.reduce((sum, loc) => sum + parseFloat(loc.latitude), 0) / validLocations.length;
    const avgLng = validLocations.reduce((sum, loc) => sum + parseFloat(loc.longitude), 0) / validLocations.length;

    // Create map
    const map = new window.google.maps.Map(mapRef.current, {
      center: { lat: avgLat, lng: avgLng },
      zoom: 11,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
    });

    googleMapRef.current = map;

    // Add markers
    validLocations.forEach((location) => {
      const position = {
        lat: parseFloat(location.latitude),
        lng: parseFloat(location.longitude)
      };

      // Determine marker color based on completion status
      const completionRate = location.appointment_count > 0 
        ? location.completed_count / location.appointment_count 
        : 0;
      
      let pinColor = '#3B82F6'; // blue - default
      if (completionRate === 1) {
        pinColor = '#10B981'; // green - all completed
      } else if (completionRate > 0) {
        pinColor = '#F59E0B'; // amber - partially completed
      }

      const marker = new window.google.maps.Marker({
        position,
        map,
        title: location.location_name,
        label: {
          text: String(location.appointment_count),
          color: 'white',
          fontSize: '12px',
          fontWeight: 'bold'
        },
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 15,
          fillColor: pinColor,
          fillOpacity: 0.9,
          strokeColor: 'white',
          strokeWeight: 2,
        }
      });

      // Info window
      const infoWindow = new window.google.maps.InfoWindow({
        content: createInfoWindowContent(location)
      });

      marker.addListener('click', () => {
        // Close all other info windows
        markersRef.current.forEach(m => {
          if (m.infoWindow) m.infoWindow.close();
        });
        
        infoWindow.open(map, marker);
        setSelectedLocation(location);
      });

      marker.infoWindow = infoWindow;
      markersRef.current.push(marker);
    });
  };

  const createInfoWindowContent = (location) => {
    return `
      <div style="padding: 8px; max-width: 250px;">
        <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">${location.location_name}</h3>
        <p style="margin: 0 0 4px 0; font-size: 12px; color: #666;">${location.address || ''}</p>
        <p style="margin: 0 0 4px 0; font-size: 12px; color: #666;">${location.city || ''}, ${location.province || ''}</p>
        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">
          <div style="font-size: 13px; margin-bottom: 4px;">
            <strong>Appointments:</strong> ${location.appointment_count}
          </div>
          <div style="font-size: 13px; margin-bottom: 4px;">
            <strong>Completed:</strong> ${location.completed_count}
          </div>
          <div style="font-size: 13px; margin-bottom: 4px;">
            <strong>Scheduled:</strong> ${location.scheduled_count}
          </div>
          ${location.next_appointment_date ? `
            <div style="font-size: 13px; margin-top: 8px; color: #2563eb;">
              <strong>Next:</strong> ${new Date(location.next_appointment_date).toLocaleDateString()}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  };

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const centerOnLocation = (location) => {
    if (!googleMapRef.current || !location.latitude || !location.longitude) return;
    
    googleMapRef.current.setCenter({
      lat: parseFloat(location.latitude),
      lng: parseFloat(location.longitude)
    });
    googleMapRef.current.setZoom(15);

    // Find and open the marker's info window
    const marker = markersRef.current.find(m => 
      m.getPosition().lat() === parseFloat(location.latitude) &&
      m.getPosition().lng() === parseFloat(location.longitude)
    );

    if (marker && marker.infoWindow) {
      marker.infoWindow.open(googleMapRef.current, marker);
    }

    setSelectedLocation(location);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500">Loading service locations...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold">Service Locations</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToPreviousMonth}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToToday}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={goToNextMonth}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <div className="ml-4 text-lg font-semibold">
            {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-primary" />
              <div>
                <div className="text-sm text-gray-600">Total Locations</div>
                <div className="text-2xl font-bold">{locations.length}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" />
              <div>
                <div className="text-sm text-gray-600">Total Appointments</div>
                <div className="text-2xl font-bold">
                  {locations.reduce((sum, loc) => sum + loc.appointment_count, 0)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <div>
                <div className="text-sm text-gray-600">Completed</div>
                <div className="text-2xl font-bold text-green-700">
                  {locations.reduce((sum, loc) => sum + loc.completed_count, 0)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" />
              <div>
                <div className="text-sm text-gray-600">Scheduled</div>
                <div className="text-2xl font-bold text-blue-700">
                  {locations.reduce((sum, loc) => sum + loc.scheduled_count, 0)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Location List */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Locations ({locations.length})</CardTitle>
            <CardDescription>
              Click on a location to view on map
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {locations.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <MapPin className="w-12 h-12 mx-auto mb-2 opacity-20" />
                  <p>No service locations for this month</p>
                </div>
              ) : (
                locations.map((location) => (
                  <div
                    key={location.location_id}
                    onClick={() => centerOnLocation(location)}
                    className={`
                      p-3 rounded-lg border cursor-pointer transition-all
                      ${selectedLocation?.location_id === location.location_id
                        ? 'bg-primary/10 border-primary'
                        : 'bg-white hover:bg-gray-50 border-gray-200'
                      }
                    `}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="font-medium text-sm mb-1">
                          {location.location_name}
                        </div>
                        <div className="text-xs text-gray-600 mb-2">
                          {location.city}, {location.province}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline" className="text-xs">
                            <Calendar className="w-3 h-3 mr-1" />
                            {location.appointment_count}
                          </Badge>
                          <Badge variant="outline" className="text-xs text-green-700 border-green-300">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            {location.completed_count}
                          </Badge>
                          {location.scheduled_count > 0 && (
                            <Badge variant="outline" className="text-xs text-blue-700 border-blue-300">
                              <Clock className="w-3 h-3 mr-1" />
                              {location.scheduled_count}
                            </Badge>
                          )}
                        </div>
                        {location.next_appointment_date && (
                          <div className="text-xs text-primary mt-2">
                            Next: {new Date(location.next_appointment_date).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                      <Navigation className="w-4 h-4 text-gray-400" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Map */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Map View</CardTitle>
            <CardDescription>
              Service locations with appointment counts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {locations.filter(loc => loc.latitude && loc.longitude).length === 0 ? (
                <div className="h-[600px] flex items-center justify-center bg-gray-50 rounded-lg">
                  <div className="text-center text-gray-500">
                    <MapPin className="w-16 h-16 mx-auto mb-4 opacity-20" />
                    <p className="text-lg font-medium mb-2">No Location Coordinates</p>
                    <p className="text-sm">
                      Locations need latitude/longitude data to display on the map
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div 
                    ref={mapRef} 
                    className="w-full h-[600px] rounded-lg border border-gray-200"
                  />
                  {/* Legend */}
                  <div className="flex items-center justify-center gap-6 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-green-500 border-2 border-white"></div>
                      <span>All Completed</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-amber-500 border-2 border-white"></div>
                      <span>Partially Completed</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white"></div>
                      <span>Scheduled</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

