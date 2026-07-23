import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { MapPin, Loader2, AlertCircle, CheckCircle, Search, Navigation } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

export default function LocationChecker({ onLocationSelect, initialAddress = '', embedded = false, autoDetect = false }) {
  const [address, setAddress] = useState(initialAddress);
  const [searching, setSearching] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [location, setLocation] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [coverageChecked, setCoverageChecked] = useState(false); // Track if we've checked yet
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const mapContainer = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);

  // Initialize Mapbox
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    // Load Mapbox GL JS dynamically
    const script = document.createElement('script');
    script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.0.1/mapbox-gl.js';
    script.onload = () => {
      const link = document.createElement('link');
      link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.0.1/mapbox-gl.css';
      link.rel = 'stylesheet';
      document.head.appendChild(link);

      window.mapboxgl.accessToken = MAPBOX_TOKEN;
      map.current = new window.mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [30.9, -29.85], // Durban area
        zoom: 10
      });

      map.current.addControl(new window.mapboxgl.NavigationControl());
    };
    document.body.appendChild(script);

    return () => {
      if (map.current) map.current.remove();
    };
  }, []);

  // Update map when location changes
  useEffect(() => {
    if (location && map.current) {
      // Remove old marker
      if (marker.current) marker.current.remove();

      // Add new marker
      marker.current = new window.mapboxgl.Marker({ color: '#22c55e' })
        .setLngLat([location.longitude, location.latitude])
        .addTo(map.current);

      // Fly to location
      map.current.flyTo({
        center: [location.longitude, location.latitude],
        zoom: 14,
        essential: true
      });
    }
  }, [location]);

  // Get browser location
  const getBrowserLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }

    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        
        // Reverse geocode to get address
        try {
          const response = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${MAPBOX_TOKEN}`
          );
          const data = await response.json();
          const place = data.features[0];
          
          // Extract city, province, and postal code from context
          const city = place.context?.find(c => c.id.includes('place'))?.text || '';
          const province = place.context?.find(c => c.id.includes('region'))?.text || '';
          const postalCode = place.context?.find(c => c.id.includes('postcode'))?.text || '';
          
          const newLocation = {
            latitude,
            longitude,
            address: place.place_name,
            city,
            province,
            postalCode
          };
          
          setLocation(newLocation);
          setAddress(place.place_name);
          const coverageResult = await checkCoverage(latitude, longitude);
          
          if (onLocationSelect) {
            onLocationSelect(newLocation, coverageResult.coverage, coverageResult.checked);
          }
        } catch (error) {
          console.error('Error reverse geocoding:', error);
        } finally {
          setGettingLocation(false);
        }
      },
      (error) => {
        console.error('Error getting location:', error);
        alert('Unable to get your location. Please enter an address manually.');
        setGettingLocation(false);
      }
    );
  };

  // Search for address suggestions
  const searchAddress = async (query) => {
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }

    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?` +
        `access_token=${MAPBOX_TOKEN}&` +
        `country=ZA&` +
        `proximity=30.9,-29.85&` +
        `limit=5`
      );
      const data = await response.json();
      setSuggestions(data.features || []);
      setShowSuggestions(true);
    } catch (error) {
      console.error('Error searching address:', error);
    }
  };

  // Handle address input change
  const handleAddressChange = (e) => {
    const value = e.target.value;
    setAddress(value);
    searchAddress(value);
  };

  // Select a suggestion
  const selectSuggestion = async (place) => {
    const [longitude, latitude] = place.center;
    
    // Extract city, province, and postal code from context
    const city = place.context?.find(c => c.id.includes('place'))?.text || '';
    const province = place.context?.find(c => c.id.includes('region'))?.text || '';
    const postalCode = place.context?.find(c => c.id.includes('postcode'))?.text || '';
    
    const newLocation = {
      latitude,
      longitude,
      address: place.place_name,
      city,
      province,
      postalCode
    };
    
    setLocation(newLocation);
    setAddress(place.place_name);
    setSuggestions([]);
    setShowSuggestions(false);
    
    const coverageResult = await checkCoverage(latitude, longitude);
    
    if (onLocationSelect) {
      onLocationSelect(newLocation, coverageResult.coverage, coverageResult.checked);
    }
  };

  // Check coverage using Supabase function
  const checkCoverage = async (latitude, longitude) => {
    try {
      setCoverageChecked(false); // Reset checked state
      
      const { data, error } = await supabase.rpc('is_point_in_coverage', {
        p_latitude: latitude,
        p_longitude: longitude,
        p_buffer_km: 2.0 // 2km leeway
      });

      if (error) {
        console.error('Error checking coverage:', error);
        setCoverage(null);
        setCoverageChecked(true);
        return { coverage: null, checked: true };
      }

      const coverageData = (data && data.length > 0) ? data[0] : null;
      setCoverage(coverageData);
      setCoverageChecked(true);
      return { coverage: coverageData, checked: true };
    } catch (error) {
      console.error('Error checking coverage:', error);
      setCoverage(null);
      setCoverageChecked(true);
      return { coverage: null, checked: true };
    }
  };

  if (embedded) {
    return (
      <div className="space-y-4">
        {/* Address Search */}
        <div className="space-y-2">
          <Label htmlFor="address">Address</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="address"
                type="text"
                placeholder="Enter your address..."
                value={address}
                onChange={handleAddressChange}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              />
              
              {/* Suggestions Dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {suggestions.map((place) => (
                    <button
                      key={place.id}
                      className="w-full text-left px-4 py-2 hover:bg-muted flex items-start gap-2 border-b last:border-b-0"
                      onClick={() => selectSuggestion(place)}
                      type="button"
                    >
                      <MapPin className="h-4 w-4 mt-1 flex-shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{place.text}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {place.place_name}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={getBrowserLocation}
              disabled={gettingLocation}
            >
              {gettingLocation ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Navigation className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Click the <Navigation className="h-3 w-3 inline" /> button to use your current location
          </p>
        </div>

        {/* Map */}
        <div
          ref={mapContainer}
          className="w-full h-64 rounded-lg border"
          style={{ minHeight: '256px' }}
        />

        {/* Coverage Status - Only show after we've checked */}
        {location && coverageChecked && (
          <div className="space-y-3">
            {coverage ? (
              <Alert className={coverage.is_inside ? 'border-green-500 bg-green-50' : 'border-yellow-500 bg-yellow-50'}>
                <div className="flex items-start gap-3">
                  {coverage.is_inside ? (
                    <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <div className="font-semibold mb-1">
                      {coverage.is_inside ? (
                        <span className="text-green-900">Great news! We service your area</span>
                      ) : (
                        <span className="text-yellow-900">You're close to our service area</span>
                      )}
                    </div>
                    <AlertDescription className={coverage.is_inside ? 'text-green-800' : 'text-yellow-800'}>
                      <div className="space-y-1">
                        <div>Coverage Area: <span className="font-medium">{coverage.area_name}</span></div>
                        <div>City: <span className="font-medium">{coverage.city}</span></div>
                        {!coverage.is_inside && coverage.distance_from_boundary_km > 0 && (
                          <div>
                            Distance from service area: <span className="font-medium">{coverage.distance_from_boundary_km} km</span>
                            <div className="text-xs mt-1">
                              We may still be able to service your location. Contact us for more details.
                            </div>
                          </div>
                        )}
                      </div>
                    </AlertDescription>
                  </div>
                  <Badge variant={coverage.is_inside ? 'default' : 'secondary'}>
                    {coverage.is_inside ? 'Covered' : 'Nearby'}
                  </Badge>
                </div>
              </Alert>
            ) : (
              <Alert className="border border-primary/40 bg-primary/5">
                <div className="flex items-start gap-3 w-full">
                  <AlertCircle className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold text-foreground mb-1">
                      We're expanding to your area soon!
                    </div>
                    <AlertDescription className="text-foreground/80 mb-3">
                      We're not quite in your neighborhood yet, but we're growing fast! Let us know you're interested and we'll prioritize your area.
                    </AlertDescription>
                    <Button
                      size="sm"
                      className="bg-primary hover:bg-primary/90"
                      onClick={() => {
                        const subject = encodeURIComponent('Request Coverage - Bot Korp Service');
                        const body = encodeURIComponent(
                          `Hi Bot Korp Team,\n\n` +
                          `I would like to request Bot Korp services for my location:\n\n` +
                          `Address: ${location.address}\n` +
                          `GPS Coordinates: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}\n` +
                          `Google Maps: https://www.google.com/maps?q=${location.latitude},${location.longitude}\n\n` +
                          `Please let me know when services become available in my area.\n\n` +
                          `Thank you!`
                        );
                        window.location.href = `mailto:botkorpza@gmail.com?subject=${subject}&body=${body}`;
                      }}
                    >
                      <MapPin className="h-4 w-4 mr-2" />
                      Request Coverage for My Area
                    </Button>
                  </div>
                </div>
              </Alert>
            )}

            {/* Location Details */}
            <div className="text-sm text-muted-foreground space-y-1 pt-2 border-t">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <span className="font-mono text-xs">
                  {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Non-embedded version with Card wrapper
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          Location & Coverage Check
        </CardTitle>
        <CardDescription>
          Find your location and check if Bot Korp services are available in your area
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Address Search */}
        <div className="space-y-2">
          <Label htmlFor="address-card">Address</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="address-card"
                type="text"
                placeholder="Enter your address..."
                value={address}
                onChange={handleAddressChange}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              />
              
              {/* Suggestions Dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {suggestions.map((place) => (
                    <button
                      key={place.id}
                      className="w-full text-left px-4 py-2 hover:bg-muted flex items-start gap-2 border-b last:border-b-0"
                      onClick={() => selectSuggestion(place)}
                      type="button"
                    >
                      <MapPin className="h-4 w-4 mt-1 flex-shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{place.text}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {place.place_name}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={getBrowserLocation}
              disabled={gettingLocation}
            >
              {gettingLocation ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Navigation className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Click the <Navigation className="h-3 w-3 inline" /> button to use your current location
          </p>
        </div>

        {/* Map */}
        <div
          ref={mapContainer}
          className="w-full h-64 rounded-lg border"
          style={{ minHeight: '256px' }}
        />

        {/* Coverage Status - Only show after we've checked */}
        {location && coverageChecked && (
          <div className="space-y-3">
            {coverage ? (
              <Alert className={coverage.is_inside ? 'border-green-500 bg-green-50' : 'border-yellow-500 bg-yellow-50'}>
                <div className="flex items-start gap-3">
                  {coverage.is_inside ? (
                    <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <div className="font-semibold mb-1">
                      {coverage.is_inside ? (
                        <span className="text-green-900">Great news! We service your area</span>
                      ) : (
                        <span className="text-yellow-900">You're close to our service area</span>
                      )}
                    </div>
                    <AlertDescription className={coverage.is_inside ? 'text-green-800' : 'text-yellow-800'}>
                      <div className="space-y-1">
                        <div>Coverage Area: <span className="font-medium">{coverage.area_name}</span></div>
                        <div>City: <span className="font-medium">{coverage.city}</span></div>
                        {!coverage.is_inside && coverage.distance_from_boundary_km > 0 && (
                          <div>
                            Distance from service area: <span className="font-medium">{coverage.distance_from_boundary_km} km</span>
                            <div className="text-xs mt-1">
                              We may still be able to service your location. Contact us for more details.
                            </div>
                          </div>
                        )}
                      </div>
                    </AlertDescription>
                  </div>
                  <Badge variant={coverage.is_inside ? 'default' : 'secondary'}>
                    {coverage.is_inside ? 'Covered' : 'Nearby'}
                  </Badge>
                </div>
              </Alert>
            ) : (
              <Alert className="border border-primary/40 bg-primary/5">
                <div className="flex items-start gap-3 w-full">
                  <AlertCircle className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold text-foreground mb-1">
                      We're expanding to your area soon!
                    </div>
                    <AlertDescription className="text-foreground/80 mb-3">
                      We're not quite in your neighborhood yet, but we're growing fast! Let us know you're interested and we'll prioritize your area.
                    </AlertDescription>
                    <Button
                      size="sm"
                      className="bg-primary hover:bg-primary/90"
                      onClick={() => {
                        const subject = encodeURIComponent('Request Coverage - Bot Korp Service');
                        const body = encodeURIComponent(
                          `Hi Bot Korp Team,\n\n` +
                          `I would like to request Bot Korp services for my location:\n\n` +
                          `Address: ${location.address}\n` +
                          `GPS Coordinates: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}\n` +
                          `Google Maps: https://www.google.com/maps?q=${location.latitude},${location.longitude}\n\n` +
                          `Please let me know when services become available in my area.\n\n` +
                          `Thank you!`
                        );
                        window.location.href = `mailto:botkorpza@gmail.com?subject=${subject}&body=${body}`;
                      }}
                    >
                      <MapPin className="h-4 w-4 mr-2" />
                      Request Coverage for My Area
                    </Button>
                  </div>
                </div>
              </Alert>
            )}

            {/* Location Details */}
            <div className="text-sm text-muted-foreground space-y-1 pt-2 border-t">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <span className="font-mono text-xs">
                  {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

