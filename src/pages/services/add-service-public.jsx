import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Bot, ArrowRight, MapPin } from 'lucide-react';
import LocationChecker from '@/components/services/location-checker';
import PriceCalculator from '@/components/services/price-calculator';

export default function AddServicePublic() {
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedLocation, setSelectedLocation] = useState(location.state?.location || null);

  const handleGetStarted = () => {
    // Store location in session storage to persist through auth flow
    if (selectedLocation) {
      sessionStorage.setItem('pendingServiceLocation', JSON.stringify(selectedLocation));
    }
    
    // Redirect to registration
    navigate('/auth/register', {
      state: { 
        returnTo: '/portal/services/add',
        location: selectedLocation
      }
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-white sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-8 w-8 text-primary" />
            <span className="text-xl font-bold">Bot Korp</span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/auth/login')}>
              Sign In
            </Button>
            <Button onClick={() => navigate('/auth/register')}>
              Register
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-4">Get Started with Bot Korp</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Check if we service your area and see instant pricing for your property
          </p>
        </div>

        <Alert className="mb-8">
          <MapPin className="h-5 w-5" />
          <AlertDescription className="ml-2">
            Enter your location below to check coverage and get a personalized quote. You'll need to create an account to complete your service setup.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Location Checker */}
          <Card>
            <CardContent className="pt-6">
              <LocationChecker 
                onLocationSelect={(loc) => setSelectedLocation(loc)}
                embedded={true}
              />
            </CardContent>
          </Card>
          
          {/* Price Calculator */}
          <PriceCalculator serviceType="garden" />
        </div>

        {/* CTA */}
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-8 text-center space-y-4">
            <h3 className="text-2xl font-bold">Ready to Get Started?</h3>
            <p className="text-muted-foreground">
              Create your free account to complete your service setup
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button size="lg" onClick={handleGetStarted}>
                Create Account & Continue
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate('/auth/login')}>
                I Already Have an Account
              </Button>
            </div>
            {selectedLocation && (
              <p className="text-sm text-muted-foreground">
                📍 We'll save your location: {selectedLocation.address?.split(',')[0]}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

