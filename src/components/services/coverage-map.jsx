import React, { useEffect, useRef, useState } from 'react';
import * as maptilersdk from '@maptiler/sdk';
import '@maptiler/sdk/dist/maptiler-sdk.css';
import { Loader2, MapPin, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * Coverage Map Component
 * Displays coverage areas on an interactive MapTiler map
 * 
 * Props:
 * - coverageAreas: Array of coverage area objects with boundary_geojson, center coordinates, etc.
 * - apiKey: MapTiler API key
 * - height: Map height (default: '600px')
 * - showLegend: Show/hide legend (default: true)
 * - onAreaClick: Callback when an area is clicked
 */
export default function CoverageMap({ 
  coverageAreas = [], 
  apiKey = 'YOUR_MAPTILER_API_KEY', // Replace with your actual API key
  height = '600px',
  showLegend = true,
  onAreaClick = null
}) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [loading, setLoading] = useState(true);
  const [selectedArea, setSelectedArea] = useState(null);
  const [mapError, setMapError] = useState(null);

  useEffect(() => {
    // Prevent multiple initializations
    if (map.current) return;

    // Check if we have coverage areas to display
    if (!coverageAreas || coverageAreas.length === 0) {
      setLoading(false);
      return;
    }

    try {
      // Set MapTiler API key
      maptilersdk.config.apiKey = apiKey;

      // Calculate map center from all coverage areas
      const validAreas = coverageAreas.filter(
        area => area.center_latitude && area.center_longitude
      );

      if (validAreas.length === 0) {
        setLoading(false);
        setMapError('No valid coordinates found in coverage areas');
        return;
      }

      // Calculate center point
      const avgLat = validAreas.reduce((sum, area) => 
        sum + parseFloat(area.center_latitude), 0
      ) / validAreas.length;
      
      const avgLng = validAreas.reduce((sum, area) => 
        sum + parseFloat(area.center_longitude), 0
      ) / validAreas.length;

      // Initialize map with professional styling
      const mapInstance = new maptilersdk.Map({
        container: mapContainer.current,
        style: maptilersdk.MapStyle.STREETS, // You can change to SATELLITE, OUTDOOR, etc.
        center: [avgLng, avgLat],
        zoom: 9,
        navigationControl: 'top-right',
        geolocateControl: false,
        fullscreenControl: 'top-right',
        scaleControl: 'bottom-left',
        pitch: 0, // Slight tilt for depth
        bearing: 0,
        antialias: true,
      });

      map.current = mapInstance;

      mapInstance.on('load', () => {
        // Add coverage areas as beautiful gradient circles
        coverageAreas.forEach((area, index) => {
          // Skip if no center coordinates
          if (!area.center_latitude || !area.center_longitude) return;

          const sourceId = `coverage-area-${area.id || index}`;
          const outerCircleId = `coverage-outer-${area.id || index}`;
          const middleCircleId = `coverage-middle-${area.id || index}`;
          const innerCircleId = `coverage-inner-${area.id || index}`;
          const centerCircleId = `coverage-center-${area.id || index}`;

          // Create a point feature for the coverage area
          mapInstance.addSource(sourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [parseFloat(area.center_longitude), parseFloat(area.center_latitude)]
              },
              properties: {
                name: area.area_name || area.city,
                city: area.city,
                province: area.province,
                serviceTypes: area.service_types || []
              }
            }
          });

          // Outer gradient circle (largest, most transparent)
          mapInstance.addLayer({
            id: outerCircleId,
            type: 'circle',
            source: sourceId,
            paint: {
              'circle-radius': [
                'interpolate',
                ['exponential', 1.5],
                ['zoom'],
                8, 40,
                10, 60,
                12, 80,
                14, 100
              ],
              'circle-color': '#fed7aa',
              'circle-opacity': 0.08,
              'circle-blur': 1
            }
          });

          // Middle gradient circle
          mapInstance.addLayer({
            id: middleCircleId,
            type: 'circle',
            source: sourceId,
            paint: {
              'circle-radius': [
                'interpolate',
                ['exponential', 1.5],
                ['zoom'],
                8, 25,
                10, 40,
                12, 55,
                14, 70
              ],
              'circle-color': '#fdba74',
              'circle-opacity': 0.12,
              'circle-blur': 0.8
            }
          });

          // Inner gradient circle
          mapInstance.addLayer({
            id: innerCircleId,
            type: 'circle',
            source: sourceId,
            paint: {
              'circle-radius': [
                'interpolate',
                ['exponential', 1.5],
                ['zoom'],
                8, 15,
                10, 25,
                12, 35,
                14, 45
              ],
              'circle-color': '#fb923c',
              'circle-opacity': 0.15,
              'circle-blur': 0.5
            }
          });

          // Center circle with stroke
          mapInstance.addLayer({
            id: centerCircleId,
            type: 'circle',
            source: sourceId,
            paint: {
              'circle-radius': [
                'interpolate',
                ['exponential', 1.5],
                ['zoom'],
                8, 6,
                10, 8,
                12, 10,
                14, 12
              ],
              'circle-color': '#f97316',
              'circle-opacity': 0.9,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-opacity': 0.8
            }
          });

          // Add click handler for all circles
          [outerCircleId, middleCircleId, innerCircleId, centerCircleId].forEach(layerId => {
            mapInstance.on('click', layerId, (e) => {
              setSelectedArea(area);
              if (onAreaClick) onAreaClick(area);
              
              // Create popup
              new maptilersdk.Popup()
                .setLngLat([parseFloat(area.center_longitude), parseFloat(area.center_latitude)])
                .setHTML(`
                  <div class="p-2">
                    <h3 class="font-bold text-sm mb-1">${area.area_name || area.city}</h3>
                    <p class="text-xs text-gray-600">${area.city}, ${area.province}</p>
                    ${area.service_types ? `
                      <div class="flex flex-wrap gap-1 mt-2">
                        ${area.service_types.map(service => 
                          `<span class="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded">${service.replace('_', ' ')}</span>`
                        ).join('')}
                      </div>
                    ` : ''}
                  </div>
                `)
                .addTo(mapInstance);
            });

            // Change cursor on hover
            mapInstance.on('mouseenter', layerId, () => {
              mapInstance.getCanvas().style.cursor = 'pointer';
            });

            mapInstance.on('mouseleave', layerId, () => {
              mapInstance.getCanvas().style.cursor = '';
            });
          });
        });

        // Fit map to show all coverage areas
        if (validAreas.length > 1) {
          const bounds = new maptilersdk.LngLatBounds();
          validAreas.forEach(area => {
            bounds.extend([
              parseFloat(area.center_longitude),
              parseFloat(area.center_latitude)
            ]);
          });
          mapInstance.fitBounds(bounds, { padding: 50, maxZoom: 11 });
        }

        setLoading(false);
      });

      mapInstance.on('error', (e) => {
        console.error('MapTiler error:', e);
        setMapError('Failed to load map');
        setLoading(false);
      });

    } catch (error) {
      console.error('Error initializing map:', error);
      setMapError(error.message);
      setLoading(false);
    }

    // Cleanup
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [coverageAreas, apiKey, onAreaClick]);

  // No coverage areas
  if (!coverageAreas || coverageAreas.length === 0) {
    return (
      <Card className="border-dashed border-2 border-gray-300 dark:border-gray-700">
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <MapPin className="h-16 w-16 text-gray-400 mb-4" />
          <h3 className="text-xl font-semibold mb-2 text-gray-700 dark:text-gray-300">
            No Coverage Areas Yet
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            Coverage areas will appear here once they're added.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="relative w-full">
      {/* Soft Professional Map Container */}
      <div 
        ref={mapContainer} 
        className="w-full rounded-3xl overflow-hidden border border-gray-200/60 dark:border-gray-700/60 shadow-xl ring-1 ring-gray-100/80 dark:ring-gray-800/80 backdrop-blur-sm"
        style={{ height }}
      />

      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-lg z-10">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500 mx-auto mb-2" />
            <p className="text-sm text-gray-600 dark:text-gray-400">Loading map...</p>
          </div>
        </div>
      )}

      {/* Error Overlay */}
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-lg z-10">
          <div className="text-center px-4">
            <Info className="h-12 w-12 text-red-500 mx-auto mb-3" />
            <p className="text-sm text-gray-700 dark:text-gray-300 font-medium mb-1">Map Error</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{mapError}</p>
          </div>
        </div>
      )}

      {/* Soft Modern Legend */}
      {showLegend && !loading && !mapError && (
        <div className="absolute bottom-6 left-6 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-xl p-5 max-w-xs border border-gray-200/60 dark:border-gray-700/60 z-20">
          <div className="flex items-start gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-orange-400 to-orange-500 flex items-center justify-center shadow-md">
              <MapPin className="h-5 w-5 text-white" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-1">
                Service Coverage
              </h4>
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                Interactive zones showing coverage
              </p>
            </div>
          </div>
          
          <div className="space-y-3 border-t border-gray-200/50 dark:border-gray-700/50 pt-4">
            <div className="flex items-center gap-3 group cursor-pointer">
              <div className="relative w-8 h-8 flex items-center justify-center">
                <div className="absolute w-8 h-8 rounded-full bg-orange-200/20"></div>
                <div className="absolute w-6 h-6 rounded-full bg-orange-300/30"></div>
                <div className="absolute w-4 h-4 rounded-full bg-orange-400/40"></div>
                <div className="absolute w-2 h-2 rounded-full bg-orange-500 shadow-sm"></div>
              </div>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 group-hover:text-orange-500 transition-colors">Coverage Area</span>
            </div>
            <div className="flex items-center gap-3 group cursor-pointer">
              <div className="w-8 h-8 flex items-center justify-center">
                <div className="relative">
                  <div className="w-3 h-3 rounded-full bg-orange-500 shadow-md border-2 border-white"></div>
                  <div className="absolute inset-0 w-3 h-3 rounded-full bg-orange-400 animate-ping opacity-60"></div>
                </div>
              </div>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 group-hover:text-orange-500 transition-colors">Service Center</span>
            </div>
          </div>

          {selectedArea && (
            <div className="mt-4 pt-4 border-t border-gray-200/50 dark:border-gray-700/50 bg-gradient-to-br from-orange-50/80 to-orange-100/60 dark:from-orange-900/10 dark:to-orange-800/10 -mx-5 -mb-5 px-5 py-4 rounded-b-2xl">
              <p className="text-xs font-bold text-orange-700 dark:text-orange-300 mb-1 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-orange-500 shadow-sm"></div>
                {selectedArea.area_name}
              </p>
              <p className="text-xs text-orange-600 dark:text-orange-400">
                {selectedArea.city}, {selectedArea.province}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Soft Stats Badge - Only show when legend is hidden */}
      {!showLegend && coverageAreas.length > 0 && !loading && (
        <div className="absolute top-6 right-6 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-lg px-5 py-3 border border-gray-200/60 dark:border-gray-700/60 z-20">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-orange-400 to-orange-500 flex items-center justify-center shadow-md">
                <MapPin className="h-6 w-6 text-white" />
              </div>
              <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-green-500 border-2 border-white dark:border-gray-900 shadow-sm"></div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">Active</p>
              <p className="text-2xl font-bold bg-gradient-to-r from-orange-500 to-orange-600 bg-clip-text text-transparent">
                {coverageAreas.length}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

