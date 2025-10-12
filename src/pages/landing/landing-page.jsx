import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Bot, Sprout, Droplets, Shield, MapPin, CheckCircle2, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

export default function LandingPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [coverageResults, setCoverageResults] = useState(null);

  const handleCoverageSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    try {
      const { data, error } = await supabase.rpc('check_coverage_area', {
        search_city: searchQuery,
        search_province: searchQuery,
        search_postal_code: searchQuery
      });

      if (error) throw error;

      setCoverageResults(data);
      
      if (data && data.length > 0) {
        toast({
          title: "Great news!",
          description: `We service your area! Found ${data.length} coverage zone(s).`,
        });
      } else {
        toast({
          title: "Not yet available",
          description: "We don't service your area yet, but we're expanding soon!",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Coverage search error:', error);
      toast({
        title: "Search failed",
        description: "Unable to check coverage. Please try again.",
        variant: "destructive"
      });
    } finally {
      setSearching(false);
    }
  };

  const services = [
    {
      icon: <Sprout className="h-8 w-8" />,
      title: "Mow Bot",
      description: "Autonomous lawn mowing with precision cutting, boundary detection, and scheduled operations.",
      features: ["Smart navigation", "Weather-aware", "Multiple patterns", "Real-time tracking"]
    },
    {
      icon: <Droplets className="h-8 w-8" />,
      title: "Pool Bot",
      description: "Automated pool cleaning and water quality monitoring for crystal-clear pools year-round.",
      features: ["Auto cleaning", "pH monitoring", "Chemical balance", "Debris removal"]
    },
    {
      icon: <Shield className="h-8 w-8" />,
      title: "Security Bot",
      description: "Smart security monitoring with motion detection, alerts, and 24/7 property surveillance.",
      features: ["Motion alerts", "Night vision", "Live streaming", "Incident recording"]
    },
    {
      icon: <Bot className="h-8 w-8" />,
      title: "Weather Station",
      description: "Comprehensive weather monitoring with local forecasts and environmental data collection.",
      features: ["Temperature", "Humidity", "Rain detection", "Wind speed"]
    }
  ];

  const benefits = [
    "24/7 automated operations",
    "Real-time monitoring & alerts",
    "Reduce manual labor costs",
    "Eco-friendly & energy efficient",
    "Professional-grade results",
    "Subscription-based pricing"
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-8 w-8 text-primary" />
            <h1 className="text-2xl font-bold">Bot Korp</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => navigate('/auth/login')}>
              Login
            </Button>
            <Button onClick={() => navigate('/auth/register')}>
              Get Started
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-16 md:py-24">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <Badge variant="secondary" className="mb-4">
            Automated Property Management
          </Badge>
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight">
            Smart Bots for Your
            <span className="text-primary"> Property</span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Bot Korp delivers autonomous robots for lawn mowing, pool cleaning, security, and weather monitoring. 
            Let our bots handle the work while you enjoy the results.
          </p>

          {/* Coverage Search */}
          <Card className="max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Check Coverage in Your Area
              </CardTitle>
              <CardDescription>
                Enter your city, province, or postal code to see if we service your location
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCoverageSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="e.g. Durban, KwaZulu-Natal, 4001"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Button type="submit" disabled={searching}>
                  {searching ? 'Searching...' : 'Search'}
                </Button>
              </form>

              {coverageResults && coverageResults.length > 0 && (
                <div className="mt-4 space-y-2">
                  {coverageResults.map((area) => (
                    <div key={area.area_id} className="p-3 bg-primary/10 rounded-lg">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold">{area.area_name}</p>
                          <p className="text-sm text-muted-foreground">
                            {area.city}, {area.province}
                          </p>
                        </div>
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {area.service_types.map((service) => (
                          <Badge key={service} variant="secondary" className="text-xs">
                            {service.replace('_', ' ')}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Services Section */}
      <section className="container mx-auto px-4 py-16 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h3 className="text-3xl md:text-4xl font-bold mb-4">Our Bot Services</h3>
            <p className="text-lg text-muted-foreground">
              Choose from our fleet of specialized autonomous bots
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {services.map((service, idx) => (
              <Card key={idx} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-3">
                    {service.icon}
                  </div>
                  <CardTitle className="text-xl">{service.title}</CardTitle>
                  <CardDescription>{service.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {service.features.map((feature, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h3 className="text-3xl md:text-4xl font-bold mb-4">Why Choose Bot Korp?</h3>
            <p className="text-lg text-muted-foreground">
              Experience the future of property management
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {benefits.map((benefit, idx) => (
              <div key={idx} className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
                <CheckCircle2 className="h-6 w-6 text-primary flex-shrink-0" />
                <span className="text-lg">{benefit}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-16 bg-primary/5">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <h3 className="text-3xl md:text-4xl font-bold">Ready to Get Started?</h3>
          <p className="text-lg text-muted-foreground">
            Join hundreds of property owners who trust Bot Korp for their automation needs
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" onClick={() => navigate('/auth/register')}>
              Create Account
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate('/portal')}>
              View Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Bot className="h-6 w-6 text-primary" />
              <span className="font-semibold">Bot Korp</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2024 Bot Korp. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

