import React, { useState } from 'react';
import { Calendar, MapPin } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ServiceCalendar from '@/components/services/service-calendar';
import ServiceLocationsMap from '@/components/services/service-locations-map';
import Navbar from '@/components/layout/navbar';
import PageHeader from '@/components/ui/page-header';
import { useAuth } from '@/context/auth-context';

export default function ServiceCalendarPage() {
  const { user, selectedOrg } = useAuth();
  const [activeTab, setActiveTab] = useState('calendar');

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="p-3 md:p-5 space-y-5 max-w-[1800px] mx-auto">
        <div className="space-y-3 animate-in fade-in slide-in-from-top-3 duration-500">
          <PageHeader
            title="Service Calendar & Locations"
            subtitle="View and manage service appointments across all locations"
            icon={<Calendar className="h-5 w-5 text-botkorp-orange" />}
          />
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
          <TabsList className="grid w-full max-w-md grid-cols-2 h-9">
            <TabsTrigger value="calendar" className="flex items-center gap-1.5 text-xs">
              <Calendar className="h-3.5 w-3.5" />
              Calendar View
            </TabsTrigger>
            <TabsTrigger value="map" className="flex items-center gap-1.5 text-xs">
              <MapPin className="h-3.5 w-3.5" />
              Map View
            </TabsTrigger>
          </TabsList>

          <TabsContent value="calendar" className="animate-in fade-in slide-in-from-bottom-3 duration-500">
            <ServiceCalendar />
          </TabsContent>

          <TabsContent value="map" className="animate-in fade-in slide-in-from-bottom-3 duration-500">
            <ServiceLocationsMap />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

