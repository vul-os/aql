import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AddressSearch } from '@/components/ui/address-search';
import { Bot, Sprout, Droplets, Shield, MapPin, CheckCircle2, ArrowRight, LayoutDashboard, X, Facebook, Instagram, Linkedin, Mail, Clock, CreditCard, BarChart3, Wrench, User2, ChevronDown, Plus, Minus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import InteractivePreview from '@/components/ui/interactive-preview';
import SimplePriceCalculator from '@/components/services/simple-price-calculator';

export default function LandingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [searching, setSearching] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [coverageResults, setCoverageResults] = useState(() => {
    // Load from localStorage on mount
    const saved = localStorage.getItem('coverageResults');
    return saved ? JSON.parse(saved) : null;
  });
  const [hasOrganization, setHasOrganization] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState(() => {
    // Load from localStorage on mount
    const saved = localStorage.getItem('lastSearchedAddress_full');
    return saved ? JSON.parse(saved) : null;
  });
  const [activeAudience, setActiveAudience] = useState('homeowner');
  const [openFaqIndex, setOpenFaqIndex] = useState(null);

  useEffect(() => {
    checkUserOrganization();
  }, [user]);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const checkUserOrganization = async () => {
    if (!user) {
      setHasOrganization(false);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('get_user_organizations', {
        user_uuid: user.id
      });

      if (!error && data && data.length > 0) {
        setHasOrganization(true);
      }
    } catch (error) {
      console.error('Error checking organizations:', error);
    }
  };

  const handleClearCoverage = () => {
    setCoverageResults(null);
    setSelectedAddress(null);
    localStorage.removeItem('coverageResults');
    localStorage.removeItem('lastSearchedAddress');
    localStorage.removeItem('lastSearchedAddress_full');
    toast({
      title: "Search cleared",
      description: "You can search for a new address now.",
    });
  };

  const handleAddressSelect = async (address) => {
    setSelectedAddress(address);
    setSearching(true);
    
    try {
      // Check coverage using city, province, and postal code
      const { data, error } = await supabase.rpc('check_coverage_area', {
        search_city: address.city || '',
        search_province: address.province || '',
        search_postal_code: address.postal_code || ''
      });

      if (error) throw error;

      setCoverageResults(data);
      // Save to localStorage
      localStorage.setItem('coverageResults', JSON.stringify(data));
      
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
      icon: <img src="/images/robotic-lawn-mower-icon.png" alt="Mow Bot" className="h-8 w-8" />,
      title: "Mow Bot",
      description: "Autonomous lawn mowing with precision cutting, boundary detection, and scheduled operations.",
      features: ["Smart navigation", "Multiple patterns", "Real-time tracking", "Scheduled service"]
    },
    {
      icon: <img src="/images/pool-icon.png" alt="Pool Bot" className="h-8 w-8" />,
      title: "Pool Bot",
      description: "Automated pool cleaning and water quality monitoring for crystal-clear pools year-round.",
      features: ["Auto cleaning", "pH monitoring", "Chemical balance", "Debris removal"]
    },
    {
      icon: <img src="/images/security-icon.png" alt="Security Bot" className="h-8 w-8" />,
      title: "Security Bot",
      description: "Smart security monitoring with motion detection, alerts, and 24/7 property surveillance.",
      features: ["Motion alerts", "Night vision", "Live streaming", "Incident recording"]
    },
    {
      icon: <img src="/images/weather-icon.png" alt="Weather Station" className="h-8 w-8" />,
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
      {/* Header - transparent before scroll, solid after */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all border-b ${
        scrolled ? 'bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60' : 'bg-transparent border-transparent'
      }`}>
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}> 
            <Bot className={`h-8 w-8 ${scrolled ? 'text-primary' : 'text-primary'}`} />
            <h1 className={`text-2xl font-bold ${scrolled ? '' : 'text-foreground'}`}>Bot Korp</h1>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/docs')} className={`hidden sm:flex ${scrolled ? '' : 'text-foreground hover:text-foreground/80'}`}>
              Docs
            </Button>
            {user && hasOrganization ? (
              <Button 
                size="lg"
                onClick={() => navigate('/portal')}
                className="gap-2 shadow-lg hover:shadow-xl transition-all bg-secondary hover:bg-secondary/90"
              >
                <LayoutDashboard className="h-5 w-5" />
                Go to Portal
              </Button>
            ) : user ? (
              <Button onClick={() => navigate('/portal')} className="bg-secondary hover:bg-secondary/90">
                Dashboard
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => navigate('/auth/login')} className={`${scrolled ? '' : 'text-foreground hover:text-foreground/80'}`}>
                  Login
                </Button>
                <Button 
                  size="lg"
                  onClick={() => navigate('/auth/register')}
                  className="shadow-lg hover:shadow-xl transition-all"
                >
                  Get Started
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section - full viewport with integrated coverage search */}
      <section className="relative min-h-screen">
        <img src="/images/lawn.jpg" alt="Lawn" className="absolute inset-0 w-full h-full object-cover bg-black" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/5 via-background/20 to-background/70" />
        <div className="relative container mx-auto px-4 min-h-screen pt-24 md:pt-28 lg:pt-32 pb-20 flex items-start justify-center">
          <div className="max-w-4xl mx-auto text-center mt-12 md:mt-16">
            <h2 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-foreground drop-shadow leading-[1.05]">
              Autonomous care for your
              <span className="block bg-gradient-to-r from-primary via-secondary to-primary bg-clip-text text-transparent">property</span>
            </h2>
            <p className="mt-6 text-lg md:text-xl text-foreground/90 max-w-2xl mx-auto">
              Lawn, pool, security and weather—handled by <span className="text-secondary font-semibold">smart bots</span> while you relax.
            </p>

            {/* Address Search pill */}
            <div className="mt-8 max-w-2xl mx-auto">
              <div className="rounded-2xl bg-background/90 backdrop-blur-xl shadow-2xl ring-1 ring-border">
                <AddressSearch
                  onAddressSelect={handleAddressSelect}
                  placeholder="Enter your address to check coverage"
                  storageKey="lastSearchedAddress"
                  inputClassName="h-12 text-base md:text-lg"
                />
                {searching && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                    Checking coverage in your area...
                  </div>
                )}
                {coverageResults && coverageResults.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Coverage Results</h4>
                      <Button variant="ghost" size="sm" onClick={handleClearCoverage} className="h-8 gap-1">
                        <X className="h-3 w-3" />
                        Clear
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {coverageResults.map((area) => (
                        <div key={area.area_id} className="p-3 rounded-lg border border-primary/20 bg-background/70 hover:border-secondary/30 transition-colors">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-semibold">{area.area_name}</p>
                              <p className="text-sm text-muted-foreground">{area.city}, {area.province}</p>
                            </div>
                            <CheckCircle2 className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {area.service_types.map((service, idx) => (
                              <Badge 
                                key={service} 
                                variant="secondary" 
                                className={`text-xs ${idx % 2 === 0 ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'bg-secondary/10 text-secondary hover:bg-secondary/20'}`}
                              >
                                {service.replace('_', ' ')}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Secondary CTAs removed per request */}
          </div>
        </div>
      </section>

      {/* Coverage Section - removed in favor of hero integration, keep anchor for links */}
      <section id="coverage" className="relative overflow-hidden hidden">
        {/* Background gradient + subtle grid pattern */}
        <div className="absolute inset-0 -z-20 bg-gradient-to-br from-primary/5 to-background" />
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-60" style={{backgroundImage:"radial-gradient(circle at 1px 1px, rgba(2,6,23,0.06) 1px, transparent 0)", backgroundSize:'22px 22px'}} />
        {/* Decorative blur blobs */}
        <div className="absolute -top-10 left-1/3 -z-10 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 -z-10 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
        <div className="container mx-auto px-4 py-20 md:py-28">
          <div className="max-w-3xl mx-auto text-center mb-10">
            <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-primary/10 ring-8 ring-background/60 text-primary shadow-md mb-5">
              <MapPin className="h-6 w-6" />
            </div>
            <h3 className="text-3xl md:text-4xl font-extrabold tracking-tight">Check Coverage in Your Area</h3>
            <p className="text-muted-foreground mt-2">Find out if Bot Korp services your suburb</p>
          </div>
          <Card className="max-w-3xl mx-auto shadow-2xl border-0 ring-1 ring-black/5 rounded-2xl bg-white/90 backdrop-blur-xl">
            <CardContent className="py-10">
              <div className="space-y-4">
                <AddressSearch
                  onAddressSelect={handleAddressSelect}
                  placeholder="Start typing your address (e.g. 123 Main St, Durban)"
                  storageKey="lastSearchedAddress"
                />
                {searching && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                    Checking coverage in your area...
                  </div>
                )}
              </div>
              {coverageResults && coverageResults.length > 0 && (
                <div className="mt-6">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-sm font-semibold">Coverage Results</h4>
                    <Button variant="ghost" size="sm" onClick={handleClearCoverage} className="h-8 gap-1">
                      <X className="h-3 w-3" />
                      Clear Results
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {coverageResults.map((area) => (
                      <div key={area.area_id} className="p-3 rounded-lg border border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold">{area.area_name}</p>
                            <p className="text-sm text-muted-foreground">{area.city}, {area.province}</p>
                          </div>
                          <CheckCircle2 className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {area.service_types.map((service) => (
                            <Badge key={service} variant="secondary" className="text-xs">{service.replace('_', ' ')}</Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Services Section - impactful cards */}
      <section id="services" className="container mx-auto px-4 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 mb-4">
              <div className="h-1 w-8 bg-primary rounded-full"></div>
              <div className="h-1 w-8 bg-secondary rounded-full"></div>
              <div className="h-1 w-8 bg-primary rounded-full"></div>
            </div>
            <h3 className="text-3xl md:text-4xl font-bold mb-3">Our Bot Services</h3>
            <p className="text-lg text-muted-foreground">Choose from our fleet of <span className="text-secondary font-semibold">specialized autonomous bots</span></p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Mow Bot */}
            <Card className="overflow-hidden group">
              <div className="h-28 bg-gradient-to-r from-primary/40 to-primary/20 flex items-center justify-center">
                <div className="h-16 w-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow">
                  {services[0].icon}
                </div>
              </div>
              <CardHeader>
                <CardTitle className="text-xl">{services[0].title}</CardTitle>
                <CardDescription>{services[0].description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {services[0].features.map((f,i)=> (
                    <div key={i} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /><span>{f}</span></div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Pool Bot */}
            <Card className="overflow-hidden group opacity-50 pointer-events-none">
              <div className="h-28 bg-gradient-to-r from-botkorp-blue-500/40 to-botkorp-blue-500/20 flex items-center justify-center">
                <div className="h-16 w-16 rounded-full bg-botkorp-blue-500 text-white flex items-center justify-center shadow">
                  {services[1].icon}
                </div>
              </div>
              <CardHeader>
                <CardTitle className="text-xl">{services[1].title}</CardTitle>
                <CardDescription>{services[1].description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {services[1].features.map((f,i)=> (
                    <div key={i} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-botkorp-blue-500" /><span>{f}</span></div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Security Bot */}
            <Card className="overflow-hidden group opacity-50 pointer-events-none">
              <div className="h-28 bg-gradient-to-r from-botkorp-slate-700/40 to-botkorp-slate-700/20 flex items-center justify-center">
                <div className="h-16 w-16 rounded-full bg-botkorp-slate-700 text-white flex items-center justify-center shadow">
                  {services[2].icon}
                </div>
              </div>
              <CardHeader>
                <CardTitle className="text-xl">{services[2].title}</CardTitle>
                <CardDescription>{services[2].description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {services[2].features.map((f,i)=> (
                    <div key={i} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-botkorp-slate-700" /><span>{f}</span></div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Weather Station */}
            <Card className="overflow-hidden group opacity-50 pointer-events-none">
              <div className="h-28 bg-gradient-to-r from-botkorp-blue-500/30 to-botkorp-blue-500/15 flex items-center justify-center">
                <div className="h-16 w-16 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center shadow">
                  {services[3].icon}
                </div>
              </div>
              <CardHeader>
                <CardTitle className="text-xl">{services[3].title}</CardTitle>
                <CardDescription>{services[3].description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {services[3].features.map((f,i)=> (
                    <div key={i} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-secondary" /><span>{f}</span></div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works - Split Layout with Preview */}
      <section id="how" className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-botkorp-grey-900 via-botkorp-grey-800 to-botkorp-grey-700" />
        
        <div className="container mx-auto px-4 py-20 lg:py-28">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            
            {/* Left Column - Copy Content */}
            <div className="space-y-8">
              {/* Header */}
              <div>
                <h3 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4 leading-tight">
                  How Bot Korp works
                </h3>
                <p className="text-lg text-white/70 max-w-xl">
                  Simple, secure, and seamless — whether you're automating your home or installing for clients.
                </p>
              </div>

              {/* Segmented Toggle */}
              <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
                <button 
                  onClick={() => setActiveAudience('homeowner')} 
                  className={`px-6 py-3 rounded-lg text-sm font-medium transition-all ${
                    activeAudience === 'homeowner' 
                      ? 'bg-botkorp-green-600 text-white shadow-lg' 
                      : 'text-white/80 hover:text-white'
                  }`}
                >
                  Homeowners
                </button>
                <button 
                  onClick={() => setActiveAudience('installer')} 
                  className={`px-6 py-3 rounded-lg text-sm font-medium transition-all ${
                    activeAudience === 'installer' 
                      ? 'bg-accent-blue text-white shadow-lg' 
                      : 'text-white/80 hover:text-white'
                  }`}
                >
                  Installers
                </button>
              </div>

              {/* Steps - Vertical Layout */}
              {activeAudience === 'homeowner' ? (
                <div className="space-y-6">
                  <div className="flex gap-4">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-full bg-botkorp-green-600 text-white flex items-center justify-center text-xl font-bold shadow-lg">
                        1
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg mb-1">Find your perfect setup</div>
                      <div className="text-white/70 text-sm leading-relaxed">
                        Choose a bot plan tailored to your property and goals.
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-4">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-full bg-accent-blue text-white flex items-center justify-center text-xl font-bold shadow-lg">
                        2
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg mb-1">Installed in days</div>
                      <div className="text-white/70 text-sm leading-relaxed">
                        Certified pros handle setup, safety checks, and training.
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-4">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-full bg-botkorp-green-600 text-white flex items-center justify-center text-xl font-bold shadow-lg">
                        3
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg mb-1">Monitor and save</div>
                      <div className="text-white/70 text-sm leading-relaxed">
                        Automations run on schedule; you track it all from the portal.
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex gap-4">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-full bg-accent-blue text-white flex items-center justify-center text-xl font-bold shadow-lg">
                        1
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg mb-1">Fast onboarding</div>
                      <div className="text-white/70 text-sm leading-relaxed">
                        Provision devices and link clients in minutes from your dashboard.
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-4">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-full bg-botkorp-green-600 text-white flex items-center justify-center text-xl font-bold shadow-lg">
                        2
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg mb-1">Scheduled automations</div>
                      <div className="text-white/70 text-sm leading-relaxed">
                        Set safe default routines that customers can fine‑tune.
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-4">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-full bg-white/20 text-white flex items-center justify-center text-xl font-bold shadow-lg">
                        3
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg mb-1">Simple billing</div>
                      <div className="text-white/70 text-sm leading-relaxed">
                        Subscription plans and add‑ons handled automatically.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <Button 
                  size="lg" 
                  onClick={() => navigate('/auth/register')} 
                  className="shadow-xl hover:shadow-2xl transition-all"
                >
                  Get started
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
                <Button 
                  size="lg" 
                  variant="outline" 
                  onClick={() => navigate('/docs')} 
                  className="bg-white/5 text-white border-white/10 hover:bg-white/10 shadow-lg"
                >
                  View docs
                </Button>
              </div>
            </div>

            {/* Right Column - Mobile Phone Preview */}
            <div className="relative flex justify-center items-center">
              {/* Phone Frame with Image */}
              <div className="relative w-72 max-w-full">
                {/* Phone Template Image */}
                <img 
                  src="/images/phone-template.png" 
                  alt="Phone Frame" 
                  className="relative w-full h-auto z-10 pointer-events-none select-none drop-shadow-xl"
                />
                
                {/* Preview Container - positioned absolutely inside the phone screen */}
                <div className="absolute top-[3.2%] left-[4.8%] right-[4.8%] bottom-[3.2%] rounded-[2rem] overflow-hidden">
                  <div className="w-full h-full bg-background shadow-inner">
                    <InteractivePreview />
                  </div>
                </div>

                {/* Decorative glow - subtle */}
                <div className="absolute -inset-6 bg-gradient-to-r from-botkorp-green-600/10 via-accent-blue/10 to-primary/10 blur-3xl -z-10 opacity-60" />
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Pricing Calculator Section */}
      <section className="relative overflow-hidden py-20 md:py-28 bg-gradient-to-br from-background via-muted/20 to-background">
        {/* Decorative background */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute top-20 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute bottom-20 left-1/4 w-96 h-96 bg-secondary/5 rounded-full blur-3xl" />
        </div>

        <div className="container mx-auto px-4 relative z-10">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4">Transparent Pricing</Badge>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              Calculate Your <span className="text-primary">Monthly Cost</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Simple, transparent pricing with no hidden fees. See exactly what you'll pay.
            </p>
          </div>

          <SimplePriceCalculator />
        </div>
      </section>

      {/* FAQ / Trust Building Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-background to-muted/30">
        {/* Decorative elements */}
        <div className="absolute top-20 right-10 w-72 h-72 bg-secondary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-10 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-secondary/3 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 py-20 md:py-28 relative">
          <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="text-center mb-16">
              <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-gradient-to-br from-primary/10 to-secondary/10 text-secondary mb-4 ring-4 ring-secondary/5">
                <Shield className="h-7 w-7" />
              </div>
              <h3 className="text-3xl md:text-4xl font-bold mb-4">Questions? We've got <span className="text-secondary">answers</span>.</h3>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Everything you need to know about Bot Korp automation
              </p>
            </div>

            {/* FAQ Accordion Items */}
            <div className="space-y-4">
              {[
                {
                  icon: Shield,
                  question: "Is it safe for my pets and children?",
                  answer: "Absolutely. Our bots are equipped with advanced sensors and boundary detection systems. They automatically stop when they detect obstacles, pets, or people. The Mow Bot uses lift and tilt sensors that immediately halt the blades if picked up or tipped over. All bots undergo rigorous safety testing and meet international safety standards.",
                  gradient: "from-emerald-500/10 via-primary/5 to-transparent"
                },
                {
                  icon: Droplets,
                  question: "What happens if it rains?",
                  answer: "Our bots are weather-smart! The Mow Bot has a rain sensor that automatically sends it back to the charging station during rain and resumes once conditions improve. The Weather Station continuously monitors conditions and adjusts all bot schedules accordingly. All outdoor bots are IP65-rated for water resistance.",
                  gradient: "from-blue-500/10 via-primary/5 to-transparent"
                },
                {
                  icon: CreditCard,
                  question: "How much does installation cost?",
                  answer: "Installation costs vary by service type and property size. Mow Bot installation typically ranges from R4,500-R8,500 (includes boundary wire setup and configuration). Pool Bot installation starts at R3,000. We offer free site assessments to give you an accurate quote. Installation is included in some premium subscription plans.",
                  gradient: "from-purple-500/10 via-primary/5 to-transparent"
                },
                {
                  icon: Wrench,
                  question: "Who handles maintenance and repairs?",
                  answer: "All maintenance is included in your subscription! Our certified technicians perform regular check-ups, blade replacements, software updates, and repairs at no extra cost. If anything goes wrong, simply report it through the portal and we'll send a technician within 24-48 hours. We also provide a replacement bot if repairs take longer than 3 days.",
                  gradient: "from-orange-500/10 via-primary/5 to-transparent"
                },
                {
                  icon: Clock,
                  question: "Can I control the schedule?",
                  answer: "Yes! You have full control through our mobile-friendly portal. Set custom schedules, adjust mowing patterns, enable/disable services, and get real-time notifications. Want the lawn mowed before a weekend BBQ? Just trigger it manually. You can also set quiet hours to ensure bots don't run when you're sleeping or entertaining guests.",
                  gradient: "from-pink-500/10 via-primary/5 to-transparent"
                },
                {
                  icon: MapPin,
                  question: "What if you don't service my area yet?",
                  answer: "We're rapidly expanding across South Africa! If we don't currently service your area, join our waitlist and we'll notify you as soon as we launch nearby. We prioritize expansion based on demand, so the more interest we get from an area, the sooner we'll be there. You'll also receive an early-bird discount when we launch.",
                  gradient: "from-cyan-500/10 via-primary/5 to-transparent"
                }
              ].map((faq, index) => {
                const Icon = faq.icon;
                const isOpen = openFaqIndex === index;
                
                return (
                  <div
                    key={index}
                    className={`group relative rounded-2xl border-2 transition-all duration-300 overflow-hidden ${
                      isOpen 
                        ? 'border-primary/40 shadow-xl shadow-primary/5' 
                        : 'border-border/50 hover:border-primary/20 shadow-lg'
                    }`}
                  >
                    {/* Background gradient */}
                    <div className={`absolute inset-0 bg-gradient-to-r ${faq.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                    
                    {/* Question Button */}
                    <button
                      onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                      className="w-full text-left p-6 relative z-10 flex items-start gap-4 transition-all"
                    >
                      {/* Icon */}
                      <div className={`flex-shrink-0 transition-all duration-300 ${
                        isOpen ? 'scale-110' : 'scale-100'
                      }`}>
                        <div className={`h-12 w-12 rounded-xl flex items-center justify-center transition-all duration-300 ${
                          isOpen 
                            ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' 
                            : 'bg-primary/10 text-primary group-hover:bg-primary/20'
                        }`}>
                          <Icon className="h-6 w-6" />
                        </div>
                      </div>
                      
                      {/* Question */}
                      <div className="flex-1 pt-1">
                        <h4 className={`text-lg md:text-xl font-semibold transition-colors ${
                          isOpen ? 'text-primary' : 'text-foreground group-hover:text-primary'
                        }`}>
                          {faq.question}
                        </h4>
                      </div>
                      
                      {/* Toggle Icon */}
                      <div className={`flex-shrink-0 transition-all duration-300 ${
                        isOpen ? 'rotate-180' : 'rotate-0'
                      }`}>
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center transition-all ${
                          isOpen 
                            ? 'bg-primary/10 text-primary' 
                            : 'bg-muted/50 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary'
                        }`}>
                          <ChevronDown className="h-5 w-5" />
                        </div>
                      </div>
                    </button>
                    
                    {/* Answer - Collapsible */}
                    <div 
                      className={`relative z-10 overflow-hidden transition-all duration-300 ease-in-out ${
                        isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                      }`}
                    >
                      <div className="px-6 pb-6 pl-[88px]">
                        <div className="border-l-2 border-primary/20 pl-6">
                          <p className="text-muted-foreground leading-relaxed">
                            {faq.answer}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer note */}
            <div className="text-center mt-12 p-6 rounded-2xl bg-gradient-to-r from-primary/5 via-transparent to-primary/5 border border-primary/10">
              <p className="text-sm text-muted-foreground">
                Still have questions? <a href="mailto:support@botkorp.com" className="text-primary hover:underline font-semibold">Contact our team</a> — we're here to help!
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-botkorp-slate-900 text-white/70 overflow-hidden">
        <div className="container mx-auto px-4 py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
            {/* Brand + intro */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Bot className="h-7 w-7 text-primary" />
                <span className="font-semibold text-white text-lg">Bot Korp</span>
              </div>
              <h4 className="text-2xl font-semibold text-white mb-2">Automation starts here.</h4>
              <p className="text-sm leading-relaxed text-white/60">We turn everyday property tasks into set‑and‑forget automation. Reliable results for owners, peace of mind for everyone.</p>
              <div className="mt-5 flex items-center gap-3">
                <a href="#" aria-label="Facebook" className="h-9 w-9 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/80 hover:text-white transition-colors"><Facebook className="h-4 w-4" /></a>
                <a href="#" aria-label="Instagram" className="h-9 w-9 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/80 hover:text-white transition-colors"><Instagram className="h-4 w-4" /></a>
                <a href="#" aria-label="LinkedIn" className="h-9 w-9 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/80 hover:text-white transition-colors"><Linkedin className="h-4 w-4" /></a>
                <a href="mailto:support@botkorp.com" aria-label="Email" className="h-9 w-9 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/80 hover:text-white transition-colors"><Mail className="h-4 w-4" /></a>
              </div>
            </div>

            {/* Support & Guides */}
            <div>
              <h3 className="font-semibold text-white mb-3">Support & Guides</h3>
              <ul className="space-y-2 text-sm">
                <li><a href="mailto:support@botkorp.com" className="text-white/70 hover:text-primary transition-colors">Support</a></li>
                <li><a href="/docs" className="text-white/70 hover:text-primary transition-colors">Help Center</a></li>
                <li><a href="/#services" className="text-white/70 hover:text-primary transition-colors">For Homeowners</a></li>
                <li><a href="/#services" className="text-white/70 hover:text-primary transition-colors">For Installers</a></li>
                <li><a href="/docs/faq" className="text-white/70 hover:text-primary transition-colors">Safety & Security</a></li>
              </ul>
            </div>

            {/* Product */}
            <div>
              <h3 className="font-semibold text-white mb-3">Product</h3>
              <ul className="space-y-2 text-sm">
                <li><a href="/#services" className="text-white/70 hover:text-primary transition-colors">Services</a></li>
                <li><a href="/#how" className="text-white/70 hover:text-primary transition-colors">How it Works</a></li>
                <li><a href="/#coverage" className="text-white/70 hover:text-primary transition-colors">Coverage</a></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h3 className="font-semibold text-white mb-3">Legal</h3>
              <ul className="space-y-2 text-sm">
                <li><a href="/docs/privacy-policy" className="text-white/70 hover:text-primary transition-colors">Privacy Policy</a></li>
                <li><a href="/docs/terms-of-service" className="text-white/70 hover:text-primary transition-colors">Terms of Service</a></li>
                <li><a href="/docs/cookie-policy" className="text-white/70 hover:text-primary transition-colors">Cookie Policy</a></li>
              </ul>
            </div>
          </div>

          {/* Contact strip */}
          <div className="flex items-center gap-3 text-sm border-y border-white/10 py-4">
            <Mail className="h-4 w-4 text-primary" />
            <a href="mailto:support@botkorp.com" className="text-white/80 hover:text-primary transition-colors">support@botkorp.com</a>
          </div>

          {/* Bottom bar */}
          <div className="pt-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-white/60">
            <p>© 2024 Bot Korp. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <a href="/docs/privacy-policy" className="text-white/60 hover:text-primary transition-colors">Privacy Policy</a>
              <a href="/docs/terms-of-service" className="text-white/60 hover:text-primary transition-colors">Terms of Service</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

