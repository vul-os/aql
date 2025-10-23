import React, { useEffect, useState } from 'react';
import { MapPin, Navigation } from 'lucide-react';

/**
 * Bot Map Component
 * Displays bot's current location and movement trail on a map
 * Uses Leaflet for map rendering
 * 
 * Props:
 * - botId: Bot UUID
 * - currentLocation: { lat, lng, heading } - Current bot position
 * - locationHistory: Array of GPS points
 */
export default function BotMap({ botId, currentLocation, locationHistory }) {
  const [map, setMap] = useState(null);
  const [L, setL] = useState(null);
  const [layersLoaded, setLayersLoaded] = useState(false);

  useEffect(() => {
    // Dynamically import Leaflet (only on client side)
    const loadLeaflet = async () => {
      if (typeof window === 'undefined') return;

      try {
        // Import Leaflet
        const leaflet = await import('leaflet');
        setL(leaflet.default || leaflet);

        // Import Leaflet CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
        link.crossOrigin = '';
        document.head.appendChild(link);

        setLayersLoaded(true);
      } catch (error) {
        console.error('Error loading Leaflet:', error);
      }
    };

    loadLeaflet();
  }, []);

  useEffect(() => {
    if (!L || !layersLoaded) return;

    // Initialize map
    const mapInstance = L.map('bot-map', {
      center: currentLocation ? [currentLocation.lat, currentLocation.lng] : [-29.8587, 31.0218],
      zoom: 18,
      zoomControl: true
    });

    // Add tile layer (OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(mapInstance);

    setMap(mapInstance);

    return () => {
      mapInstance.remove();
    };
  }, [L, layersLoaded]);

  useEffect(() => {
    if (!map || !L || !locationHistory) return;

    // Clear existing layers (except tile layer)
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline || layer instanceof L.CircleMarker) {
        map.removeLayer(layer);
      }
    });

    // Draw location trail (polyline)
    if (locationHistory.length > 1) {
      const trail = locationHistory
        .filter(point => point.latitude && point.longitude)
        .reverse() // Oldest to newest
        .map(point => [parseFloat(point.latitude), parseFloat(point.longitude)]);

      if (trail.length > 1) {
        L.polyline(trail, {
          color: '#3b82f6',
          weight: 3,
          opacity: 0.7,
          smoothFactor: 1
        }).addTo(map);

        // Add dots along the trail
        trail.forEach((point, index) => {
          if (index % 5 === 0) { // Every 5th point
            L.circleMarker(point, {
              radius: 3,
              fillColor: '#3b82f6',
              color: '#fff',
              weight: 1,
              opacity: 1,
              fillOpacity: 0.8
            }).addTo(map);
          }
        });
      }
    }

    // Add current location marker
    if (currentLocation && currentLocation.lat && currentLocation.lng) {
      const botIcon = L.divIcon({
        className: 'bot-marker',
        html: `
          <div style="
            position: relative;
            transform: rotate(${currentLocation.heading || 0}deg);
          ">
            <div style="
              background: #22c55e;
              border: 3px solid white;
              border-radius: 50%;
              width: 20px;
              height: 20px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            "></div>
            <div style="
              position: absolute;
              top: -10px;
              left: 50%;
              transform: translateX(-50%);
              width: 0;
              height: 0;
              border-left: 8px solid transparent;
              border-right: 8px solid transparent;
              border-bottom: 15px solid #22c55e;
            "></div>
          </div>
        `,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });

      L.marker([currentLocation.lat, currentLocation.lng], { icon: botIcon })
        .addTo(map)
        .bindPopup(`
          <div style="padding: 8px;">
            <strong>${botId.substring(0, 8)}...</strong><br/>
            <small>Current Position</small><br/>
            <small>Heading: ${currentLocation.heading?.toFixed(0) || '--'}°</small>
          </div>
        `);

      // Center map on current location
      map.setView([currentLocation.lat, currentLocation.lng], map.getZoom());
    }

    // Fit bounds to show entire trail
    if (locationHistory.length > 1) {
      const bounds = locationHistory
        .filter(point => point.latitude && point.longitude)
        .map(point => [parseFloat(point.latitude), parseFloat(point.longitude)]);
      
      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }, [map, L, currentLocation, locationHistory, botId]);

  return (
    <div className="relative w-full">
      <div 
        id="bot-map" 
        className="w-full h-[500px] rounded-lg border border-gray-200"
        style={{ minHeight: '500px' }}
      />
      
      {!layersLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-lg">
          <div className="text-center">
            <MapPin className="w-8 h-8 animate-pulse mx-auto mb-2 text-gray-400" />
            <p className="text-sm text-muted-foreground">Loading map...</p>
          </div>
        </div>
      )}

      {layersLoaded && !currentLocation && locationHistory.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100/80 rounded-lg pointer-events-none">
          <div className="text-center">
            <MapPin className="w-8 h-8 mx-auto mb-2 text-gray-400" />
            <p className="text-sm text-muted-foreground">No location data available</p>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 right-4 bg-white rounded-lg shadow-lg p-3 text-xs">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-3 h-3 rounded-full bg-green-500 border-2 border-white"></div>
          <span>Current Position</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-0.5 bg-blue-500"></div>
          <span>Movement Trail</span>
        </div>
      </div>
    </div>
  );
}




