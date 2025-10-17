import React, { useState, useEffect } from 'react';
import { Bot, Home, Activity, Calendar, Plus, MapPin, Sprout, CheckCircle, ChevronRight, CreditCard, LayoutDashboard, Wrench, Users, Wallet, Settings, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const InteractivePreview = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);

  // Auto-advance slides every 8 seconds
  useEffect(() => {
    if (!isAutoPlaying) return;
    
    const timer = setInterval(() => {
      setCurrentStep((prev) => (prev + 1) % 4);
    }, 8000);
    
    return () => clearInterval(timer);
  }, [isAutoPlaying]);

  const steps = [
    {
      title: 'Dashboard Overview',
      description: 'Monitor all your bots from one place',
    },
    {
      title: 'Add New Service',
      description: 'Click to start setting up a new service',
    },
    {
      title: 'Choose Location',
      description: 'Select property and service area',
    },
    {
      title: 'Service Details',
      description: 'Configure your garden maintenance',
    },
  ];

  return (
    <div className="h-full flex flex-col relative bg-background">
      {/* Mobile Header Bar */}
      <div className="bg-background border-b px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Menu className="h-5 w-5 text-muted-foreground" />
          <Bot className="h-6 w-6 text-primary" />
          <span className="font-bold text-sm">Bot Korp</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center font-semibold text-xs">
            A
          </div>
        </div>
      </div>

      {/* Navigation dots */}
      <div className="absolute top-16 right-3 z-10 flex gap-1.5">
        {steps.map((_, idx) => (
          <button
            key={idx}
            onClick={() => {
              setCurrentStep(idx);
              setIsAutoPlaying(false);
            }}
            className={`h-1.5 rounded-full transition-all ${
              idx === currentStep ? 'w-6 bg-primary' : 'w-1.5 bg-slate-300'
            }`}
          />
        ))}
      </div>

      {/* Content area with smooth transitions */}
      <div className="flex-1 overflow-y-auto relative">
        {/* Step 0: Dashboard */}
        <div
          className={`absolute inset-0 p-4 transition-all duration-500 ${
            currentStep === 0 ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-full pointer-events-none'
          }`}
        >
          <div className="space-y-3 overflow-y-auto h-full">
            {/* Header */}
            <div>
              <h2 className="text-lg font-bold">Good morning! 👋</h2>
              <p className="text-xs text-muted-foreground">2 bots • 1 garden • 350 m²</p>
            </div>

            {/* Add Service Button */}
            <Button className="w-full gap-2 shadow-lg animate-pulse">
              <Plus className="h-4 w-4" />
              Add Service
            </Button>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2">
              <Card className="bg-primary text-primary-foreground">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-xs font-medium text-white/90">Active</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <div className="text-2xl font-bold">2</div>
                  <p className="text-[10px] text-white/80">bots</p>
                </CardContent>
              </Card>
              <Card className="bg-primary text-primary-foreground">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-xs font-medium text-white/90">Next</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <div className="text-sm font-bold">Dec 20</div>
                  <p className="text-[10px] text-white/80">service</p>
                </CardContent>
              </Card>
            </div>

            {/* Bot Status */}
            <Card>
              <CardHeader className="pb-2 pt-3 px-3">
                <CardTitle className="text-xs">Bot Status</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between p-2 bg-muted rounded text-xs">
                    <span>Operational</span>
                    <Badge className="bg-green-500 text-[10px] h-4">2</Badge>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted/30 rounded text-xs">
                    <span>Offline</span>
                    <Badge variant="outline" className="text-[10px] h-4">0</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card>
              <CardHeader className="pb-2 pt-3 px-3">
                <CardTitle className="text-xs">Recent Activity</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <div className="space-y-1.5 text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
                    <span>Garden 1 mowed - 2h ago</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
                    <span>Schedule published - 1d ago</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
                    <span>Firmware updated - 2d ago</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Step 1: Click Add Service */}
        <div
          className={`absolute inset-0 transition-all duration-500 ${
            currentStep === 1 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full pointer-events-none'
          }`}
        >
          {/* Overlay effect */}
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-background border-2 border-primary rounded-2xl p-6 shadow-2xl w-full max-w-sm">
              <div className="text-center space-y-3">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Plus className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-base font-bold mb-1">Add New Service</h3>
                  <p className="text-xs text-muted-foreground">
                    Set up automated maintenance
                  </p>
                </div>
                <Button className="w-full text-sm">
                  Get Started
                  <ChevronRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Step 2: Choose Location */}
        <div
          className={`absolute inset-0 p-4 transition-all duration-500 overflow-y-auto ${
            currentStep === 2 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full pointer-events-none'
          }`}
        >
          <div className="space-y-3">
            <div>
              <h1 className="text-base font-bold">Add New Service</h1>
              <p className="text-xs text-muted-foreground">Step 1 of 5: Choose Location</p>
            </div>

            {/* Progress bar */}
            <div className="flex gap-1">
              <div className="h-1.5 flex-1 rounded-full bg-primary" />
              <div className="h-1.5 flex-1 rounded-full bg-muted" />
              <div className="h-1.5 flex-1 rounded-full bg-muted" />
              <div className="h-1.5 flex-1 rounded-full bg-muted" />
              <div className="h-1.5 flex-1 rounded-full bg-muted" />
            </div>

            {/* Address Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Address</label>
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="Enter address..." 
                  className="w-full p-2 pr-8 text-xs border rounded-lg bg-background"
                  value="123 Garden St, Durban"
                  readOnly
                />
                <MapPin className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
            </div>

            {/* Google Maps-style embedded view */}
            <div className="h-48 rounded-lg overflow-hidden relative border shadow-lg">
              {/* Map Image */}
              <img 
                src="/images/maps-view.png" 
                alt="Map view" 
                className="absolute inset-0 w-full h-full object-cover"
              />
              
              {/* Location marker */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full z-10">
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-6 w-6 rounded-full bg-red-500/20 animate-ping" />
                <MapPin className="h-8 w-8 text-red-600 drop-shadow-xl" fill="currentColor" />
              </div>
              
              {/* Map controls */}
              <div className="absolute bottom-2 right-2 flex flex-col gap-1 z-10">
                <button className="h-6 w-6 bg-white rounded shadow flex items-center justify-center text-xs font-bold">
                  +
                </button>
                <button className="h-6 w-6 bg-white rounded shadow flex items-center justify-center text-xs font-bold">
                  −
                </button>
              </div>
              
              {/* Attribution */}
              <div className="absolute bottom-1 left-1 text-[7px] text-slate-500 bg-white/80 px-1 rounded">
                © Mapbox
              </div>
            </div>

            <div className="flex justify-between gap-2">
              <Button variant="outline" size="sm" className="text-xs">Cancel</Button>
              <Button size="sm" className="text-xs">
                Next
                <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </div>
        </div>

        {/* Step 3: Service Details */}
        <div
          className={`absolute inset-0 p-4 transition-all duration-500 overflow-y-auto ${
            currentStep === 3 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full pointer-events-none'
          }`}
        >
          <div className="space-y-3">
            <div>
              <h1 className="text-base font-bold">Add New Service</h1>
              <p className="text-xs text-muted-foreground">Step 3 of 5: Service Details</p>
            </div>

            {/* Progress bar */}
            <div className="flex gap-1">
              <div className="h-1.5 flex-1 rounded-full bg-primary" />
              <div className="h-1.5 flex-1 rounded-full bg-primary" />
              <div className="h-1.5 flex-1 rounded-full bg-primary" />
              <div className="h-1.5 flex-1 rounded-full bg-muted" />
              <div className="h-1.5 flex-1 rounded-full bg-muted" />
            </div>

            {/* Garden details */}
            <Card className="border-2 border-primary">
              <CardHeader className="pb-2 pt-3 px-3">
                <CardTitle className="text-xs">Garden 1</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 space-y-2">
                <div>
                  <label className="text-[10px] font-medium">Garden Name</label>
                  <div className="mt-0.5 p-1.5 border rounded bg-background text-xs">Front Lawn</div>
                </div>
                <div>
                  <label className="text-[10px] font-medium">Area (m²)</label>
                  <div className="mt-0.5 p-1.5 border rounded bg-background text-xs">250</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Sprout className="h-3 w-3 text-primary" />
                  <span className="text-[10px]">Auto-mowing every 3 days</span>
                </div>
              </CardContent>
            </Card>

            {/* Pricing preview */}
            <Card className="bg-muted/50">
              <CardHeader className="pb-2 pt-3 px-3">
                <CardTitle className="text-xs">Pricing Estimate</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 space-y-2">
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[10px]">Service Fee</span>
                    <span className="font-medium">R 450/mo</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[10px]">Installation</span>
                    <span className="font-medium">R 1,200</span>
                  </div>
                  <div className="border-t pt-1.5 flex justify-between font-semibold">
                    <span className="text-[10px]">First Month</span>
                    <span>R 1,650</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 p-1.5 bg-green-50 dark:bg-green-950 rounded text-[10px] text-green-700 dark:text-green-300">
                  <CheckCircle className="h-3 w-3" />
                  <span>20% savings vs manual</span>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-between gap-2">
              <Button variant="outline" size="sm" className="text-xs">Back</Button>
              <Button size="sm" className="text-xs">
                Review & Complete
                <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InteractivePreview;

