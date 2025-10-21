import React, { useState } from 'react';
import { Calendar, MapPin } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ServiceCalendar from '@/components/services/service-calendar';
import ServiceLocationsMap from '@/components/services/service-locations-map';
import Navbar from '@/components/layout/navbar';
import { useAuth } from '@/context/auth-context';

export default function ServiceCalendarPage() {
  const { user, selectedOrg } = useAuth();
  const [activeTab, setActiveTab] = useState('calendar');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Service Calendar & Locations</h1>
          <p className="text-gray-600 mt-2">
            View and manage service appointments across all locations
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="calendar" className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Calendar View
            </TabsTrigger>
            <TabsTrigger value="map" className="flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Map View
            </TabsTrigger>
          </TabsList>

          <TabsContent value="calendar">
            <ServiceCalendar />
          </TabsContent>

          <TabsContent value="map">
            <ServiceLocationsMap />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

