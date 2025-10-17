import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AddressSearch } from '@/components/ui/address-search';
import { Bot, Sprout, Droplets, Shield, MapPin, CheckCircle2, ArrowRight, LayoutDashboard, X, Facebook, Instagram, Linkedin, Mail, Clock, CreditCard, BarChart3, Wrench, User2, ChevronDown, Plus, Minus, Loader2 } from 'lucide-react';
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
  const [coverageAreas, setCoverageAreas] = useState([]);
  const [loadingCoverageAreas, setLoadingCoverageAreas] = useState(true);

  useEffect(() => {
    checkUserOrganization();
    loadCoverageAreas();
  }, [user]);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const loadCoverageAreas = async () => {
    try {
      setLoadingCoverageAreas(true);
      const { data, error } = await supabase
        .from('coverage_areas')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: false })
        .order('city', { ascending: true });

      if (error) throw error;
      setCoverageAreas(data || []);
    } catch (error) {
      console.error('Error loading coverage areas:', error);
    } finally {
      setLoadingCoverageAreas(false);
    }
  };

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
      // Save to localStorage for later use
      localStorage.setItem('coverageResults', JSON.stringify(data));
      localStorage.setItem('pendingLocationAddress', JSON.stringify(address));
      
      if (data && data.length > 0) {
        // Coverage found! Guide user to sign up
        toast({
          title: "Great news! We cover your area! 🎉",
          description: "Let's get you started with your automated property care.",
        });
        
        // If user is not logged in, redirect to sign up with location data
        if (!user) {
          setTimeout(() => {
            navigate('/auth/register', { 
              state: { 
                address: address,
                coverageData: data 
              }
            });
          }, 1500);
        } else {
          // User is logged in, check if they have an organization
          if (hasOrganization) {
            // Navigate to add service/location
            setTimeout(() => {
              navigate('/portal/services/add', {
                state: {
                  address: address,
                  coverageData: data
                }
              });
            }, 1500);
          } else {
            // Need to create organization first
            setTimeout(() => {
              navigate('/portal/dashboard', {
                state: {
                  address: address,
                  coverageData: data
                }
              });
            }, 1500);
          }
        }
      } else {
        toast({
          title: "Not yet available",
          description: "We don't service your area yet, but we're expanding soon! Join our waitlist.",
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
      {/* Header - Modern, Clean Design */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled 
          ? 'bg-white/95 dark:bg-slate-950/95 backdrop-blur-lg border-b border-slate-200 dark:border-slate-800 shadow-sm' 
          : 'bg-white/50 dark:bg-slate-950/50 backdrop-blur-md border-b border-white/10'
      }`}>
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-18">
            {/* Logo */}
            <div className="flex items-center gap-2.5 cursor-pointer group" onClick={() => navigate('/')}> 
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-md group-hover:shadow-lg transition-all group-hover:scale-105">
                <Bot className="h-5 w-5 text-white" />
          </div>
              <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent">
                Bot Korp
              </h1>
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-2 sm:gap-3">
              <Button 
                variant="ghost" 
                onClick={() => navigate('/docs')} 
                className="hidden sm:flex text-foreground/70 hover:text-primary hover:bg-primary/5 font-medium"
              >
              Docs
            </Button>
              
            {user && hasOrganization ? (
              <Button 
                onClick={() => navigate('/portal')}
                  className="gap-2 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-md hover:shadow-lg transition-all hover:scale-105 font-semibold"
              >
                  <LayoutDashboard className="h-4 w-4" />
                  <span className="hidden sm:inline">Dashboard</span>
                  <span className="sm:hidden">Portal</span>
              </Button>
            ) : user ? (
                <Button 
                  onClick={() => navigate('/portal')} 
                  className="gap-2 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-md hover:shadow-lg transition-all hover:scale-105 font-semibold"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  <span className="hidden sm:inline">Dashboard</span>
                  <span className="sm:hidden">Portal</span>
              </Button>
            ) : (
              <>
                  <Button 
                    variant="ghost" 
                    onClick={() => navigate('/auth/login')} 
                    className="text-foreground/70 hover:text-primary hover:bg-primary/5 font-medium"
                  >
                  Login
                </Button>
                <Button 
                  onClick={() => navigate('/auth/register')}
                    className="bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-md hover:shadow-lg transition-all hover:scale-105 font-semibold"
                >
                    <span className="hidden sm:inline">Get Started</span>
                    <span className="sm:hidden">Sign Up</span>
                </Button>
              </>
            )}
            </div>
          </div>
        </div>
      </header>

      {/* Pilot Banner - Below Header */}
      <div className="fixed top-16 sm:top-[72px] left-0 right-0 z-40 bg-gradient-to-r from-muted/50 via-accent/10 to-muted/50 dark:from-botkorp-black dark:via-botkorp-slate-blue dark:to-botkorp-black border-b border-accent/20 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-2.5">
          <div className="flex items-center justify-center gap-2 text-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            <p className="text-foreground">
              <strong className="font-semibold text-primary">Pilot Program Now Active</strong> — Be among the first to experience automated property care in South Africa!
            </p>
          </div>
        </div>
      </div>

      {/* Hero Section - full viewport with integrated coverage search */}
      <section className="relative h-screen flex items-center mt-[110px] overflow-hidden">
        {/* Background Image with Overlays */}
        <div className="absolute inset-0 overflow-hidden">
          <img 
            src="/images/lawn.jpg" 
            alt="Automated lawn care" 
            className="w-full h-full object-cover object-center transition-transform duration-[10000ms] hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-black/40 via-black/25 to-black/40" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/20" />
        </div>

        {/* Content */}
        <div className="relative w-full max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center">
          
          {/* Headline */}
          <div className="text-center mb-12 lg:mb-16 animate-[fadeIn_1s_ease-out]">
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-white leading-tight tracking-tight drop-shadow-2xl">
              Property services managed
            </h1>
            <h1 className="mt-2 text-5xl md:text-[4.125rem] lg:text-7xl font-bold text-white leading-tight tracking-tight drop-shadow-2xl">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-primary/90 to-primary/70">
                automatically.
              </span>
            </h1>
            <p className="mt-8 text-xl md:text-2xl text-white/95 font-light max-w-3xl mx-auto drop-shadow-lg leading-relaxed">
              Professional lawn, pool, and security automation for homes and businesses across South Africa.
            </p>
          </div>

          {/* Search Box - Clean StorNextDoor Style */}
          <div className="w-full max-w-3xl mx-auto animate-[fadeInUp_0.7s_ease-out_0.3s_both]">
            <div className="relative bg-white rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-xl">
              <div className="flex items-center px-3 sm:px-4 py-3 sm:py-3">
                <MapPin className="text-primary mr-2 sm:mr-3 flex-shrink-0 h-5 w-5" />
                <div className="flex-1 min-w-0">
                <AddressSearch
                  onAddressSelect={handleAddressSelect}
                    placeholder="Enter Address"
                  storageKey="lastSearchedAddress"
                    className="border-none shadow-none focus-visible:ring-0 py-2 sm:py-3 text-base sm:text-lg placeholder:text-gray-400 px-0 h-auto outline-none"
                />
                  </div>
                <Button
                  className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium bg-primary text-white hover:bg-gradient-to-r from-primary to-primary/80 hover:scale-105 active:scale-95 transition-all duration-200 shadow-sm hover:shadow-md h-12 rounded-lg px-6 ml-2 sm:ml-3 text-sm"
                  disabled={searching}
                  onClick={() => {
                    // Trigger search if needed
                  }}
                >
                  {searching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <ArrowRight className="h-4 w-4" />
                      <span className="hidden md:inline">Find</span>
                    </>
                  )}
                      </Button>
                    </div>
                            </div>

            {/* Feature Cards */}
            <div className="mt-8 sm:mt-12 flex flex-col sm:flex-row justify-center items-center gap-3 sm:gap-6 animate-[fadeIn_1s_ease-out_0.6s_both]">
              <div className="flex items-center bg-gray-900/80 backdrop-blur-sm rounded-xl sm:rounded-2xl px-4 sm:px-6 py-3 sm:py-4 border border-primary/30 shadow-lg hover:shadow-xl hover:bg-gray-900/90 hover:border-primary/50 transition-all w-full sm:w-auto">
                <div className="bg-primary/20 p-2 sm:p-3 rounded-full mr-3 sm:mr-4">
                  <Bot className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                          </div>
                <div className="text-white">
                  <p className="font-medium text-xs sm:text-sm">Automated lawn</p>
                  <p className="font-medium text-xs sm:text-sm">mowing service</p>
                          </div>
                        </div>
              <div className="flex items-center bg-gray-900/80 backdrop-blur-sm rounded-xl sm:rounded-2xl px-4 sm:px-6 py-3 sm:py-4 border border-accent/30 shadow-lg hover:shadow-xl hover:bg-gray-900/90 hover:border-accent/50 transition-all w-full sm:w-auto">
                <div className="bg-accent/20 p-2 sm:p-3 rounded-full mr-3 sm:mr-4">
                  <Sprout className="w-5 h-5 sm:w-6 sm:h-6 text-accent" />
                    </div>
                <div className="text-white">
                  <p className="font-medium text-xs sm:text-sm">Professional results,</p>
                  <p className="font-medium text-xs sm:text-sm">effortless care</p>
                  </div>
              </div>
            </div>

            {/* Trust Indicators */}
            <div className="mt-8 sm:mt-12 pt-4 sm:pt-6 border-t border-white/10 flex flex-col sm:flex-row justify-center items-center gap-4 sm:gap-8 text-white/90 animate-[fadeIn_1s_ease-out_0.9s_both]">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-accent" />
                <span className="text-xs sm:text-sm font-light">No Long-term Contracts</span>
              </div>
              <div className="flex items-center gap-2">
                <Sprout className="w-4 h-4 sm:w-5 sm:h-5 text-accent" />
                <span className="text-xs sm:text-sm font-light">Eco-friendly Technology</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 sm:w-5 sm:h-5 text-secondary" />
                <span className="text-xs sm:text-sm font-light">South African Based</span>
              </div>
            </div>
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
      <section id="services" className="container mx-auto px-4 py-20 md:py-28">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 mb-6">
              <div className="h-1 w-12 bg-primary rounded-full"></div>
              <Bot className="h-5 w-5 text-primary" />
              <div className="h-1 w-12 bg-primary rounded-full"></div>
            </div>
            <h2 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              Automated Property Services
            </h2>
            <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
              Specialized bots designed for <span className="text-primary font-semibold">effortless maintenance</span> across homes and businesses
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
            {/* Mow Bot */}
            <Card className="overflow-hidden group hover:shadow-2xl transition-all duration-300 border-2 hover:border-primary/30">
              <div className="h-32 bg-gradient-to-br from-primary/30 via-primary/20 to-primary/10 flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
                <div className="relative h-20 w-20 rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform">
                  {services[0].icon}
                </div>
              </div>
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold">{services[0].title}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">{services[0].description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5">
                  {services[0].features.map((f,i)=> (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Pool Bot */}
            <Card className="overflow-hidden group opacity-60 relative">
              <Badge className="absolute top-3 right-3 z-10 bg-yellow-500/90 text-yellow-950">Coming Soon</Badge>
              <div className="h-32 bg-gradient-to-br from-blue-500/30 via-blue-500/20 to-blue-500/10 flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
                <div className="relative h-20 w-20 rounded-full bg-gradient-to-br from-blue-500 to-blue-500/70 text-white flex items-center justify-center shadow-xl">
                  {services[1].icon}
                </div>
              </div>
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold">{services[1].title}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">{services[1].description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5">
                  {services[1].features.map((f,i)=> (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Security Bot */}
            <Card className="overflow-hidden group opacity-60 relative">
              <Badge className="absolute top-3 right-3 z-10 bg-yellow-500/90 text-yellow-950">Coming Soon</Badge>
              <div className="h-32 bg-gradient-to-br from-slate-700/30 via-slate-700/20 to-slate-700/10 flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
                <div className="relative h-20 w-20 rounded-full bg-gradient-to-br from-slate-700 to-slate-700/70 text-white flex items-center justify-center shadow-xl">
                  {services[2].icon}
                </div>
              </div>
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold">{services[2].title}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">{services[2].description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5">
                  {services[2].features.map((f,i)=> (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-slate-700 mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Weather Station */}
            <Card className="overflow-hidden group opacity-60 relative">
              <Badge className="absolute top-3 right-3 z-10 bg-yellow-500/90 text-yellow-950">Coming Soon</Badge>
              <div className="h-32 bg-gradient-to-br from-orange-500/30 via-orange-500/20 to-orange-500/10 flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
                <div className="relative h-20 w-20 rounded-full bg-gradient-to-br from-orange-500 to-orange-500/70 text-white flex items-center justify-center shadow-xl">
                  {services[3].icon}
                </div>
              </div>
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold">{services[3].title}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">{services[3].description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5">
                  {services[3].features.map((f,i)=> (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works - Split Layout with Preview */}
      <section id="how" className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-botkorp-black via-botkorp-slate-blue to-botkorp-black" />
        
        <div className="container mx-auto px-4 py-20 md:py-28">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center max-w-7xl mx-auto">
            
            {/* Left Column - Copy Content */}
            <div className="space-y-8 lg:space-y-10">
              {/* Header */}
              <div>
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4 leading-tight">
                  How Bot Korp works
                </h2>
                <p className="text-base sm:text-lg text-white/70 max-w-xl leading-relaxed">
                  Simple, secure, and seamless automation for homes and businesses across South Africa.
                </p>
              </div>

              {/* Segmented Toggle */}
              <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1 w-full sm:w-auto">
                <button 
                  onClick={() => setActiveAudience('homeowner')} 
                  className={`flex-1 sm:flex-none px-4 sm:px-6 py-3 rounded-lg text-sm font-medium transition-all ${
                    activeAudience === 'homeowner' 
                      ? 'bg-primary text-white shadow-lg' 
                      : 'text-white/80 hover:text-white'
                  }`}
                >
                  Homeowners
                </button>
                <button 
                  onClick={() => setActiveAudience('installer')} 
                  className={`flex-1 sm:flex-none px-4 sm:px-6 py-3 rounded-lg text-sm font-medium transition-all ${
                    activeAudience === 'installer' 
                      ? 'bg-blue-600 text-white shadow-lg' 
                      : 'text-white/80 hover:text-white'
                  }`}
                >
                  Businesses
                </button>
              </div>

              {/* Steps - Vertical Layout */}
              {activeAudience === 'homeowner' ? (
                <div className="space-y-6 md:space-y-8">
                  <div className="flex gap-4 md:gap-6 group">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 md:h-14 md:w-14 rounded-full bg-primary text-white flex items-center justify-center text-xl font-bold shadow-lg group-hover:scale-110 transition-transform">
                        1
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg md:text-xl mb-2">Check Coverage</div>
                      <div className="text-white/70 text-sm md:text-base leading-relaxed">
                        Enter your address to verify we service your area.
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-4 md:gap-6 group">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 md:h-14 md:w-14 rounded-full bg-blue-600 text-white flex items-center justify-center text-xl font-bold shadow-lg group-hover:scale-110 transition-transform">
                        2
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg md:text-xl mb-2">Installation in Days</div>
                      <div className="text-white/70 text-sm md:text-base leading-relaxed">
                        Certified professionals handle setup, safety checks, and training.
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-4 md:gap-6 group">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 md:h-14 md:w-14 rounded-full bg-accent text-white flex items-center justify-center text-xl font-bold shadow-lg group-hover:scale-110 transition-transform">
                        3
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg md:text-xl mb-2">Monitor & Save</div>
                      <div className="text-white/70 text-sm md:text-base leading-relaxed">
                        Track everything from your dashboard. Automation runs on schedule.
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6 md:space-y-8">
                  <div className="flex gap-4 md:gap-6 group">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 md:h-14 md:w-14 rounded-full bg-primary text-white flex items-center justify-center text-xl font-bold shadow-lg group-hover:scale-110 transition-transform">
                        1
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg md:text-xl mb-2">Partner with Us</div>
                      <div className="text-white/70 text-sm md:text-base leading-relaxed">
                        Join our network and offer automated services to your clients.
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-4 md:gap-6 group">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 md:h-14 md:w-14 rounded-full bg-secondary text-white flex items-center justify-center text-xl font-bold shadow-lg group-hover:scale-110 transition-transform">
                        2
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg md:text-xl mb-2">Manage Deployments</div>
                      <div className="text-white/70 text-sm md:text-base leading-relaxed">
                        Track all installations and client services from one dashboard.
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-4 md:gap-6 group">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 md:h-14 md:w-14 rounded-full bg-accent text-white flex items-center justify-center text-xl font-bold shadow-lg group-hover:scale-110 transition-transform">
                        3
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg md:text-xl mb-2">Scale Revenue</div>
                      <div className="text-white/70 text-sm md:text-base leading-relaxed">
                        Build recurring revenue with automated property management.
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
                <div className="absolute -inset-6 bg-gradient-to-r from-accent/10 via-secondary/10 to-accent/10 blur-3xl -z-10 opacity-60" />
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

      {/* Coverage Areas Section */}
      <section id="coverage-map" className="relative overflow-hidden bg-gradient-to-b from-muted/30 to-background py-20 md:py-28">
        <div className="container mx-auto px-4">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12 md:mb-16">
              <div className="inline-flex items-center gap-2 mb-6">
                <div className="h-1 w-12 bg-primary rounded-full"></div>
                <MapPin className="h-5 w-5 text-primary" />
                <div className="h-1 w-12 bg-primary rounded-full"></div>
              </div>
              <h2 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                Where We Serve
              </h2>
              <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                Currently operating across key areas in South Africa, with expansion plans nationwide
              </p>
            </div>

            {loadingCoverageAreas ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : coverageAreas.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {coverageAreas.map((area) => (
                  <Card key={area.id} className="overflow-hidden group hover:shadow-xl transition-all duration-300 border-2 hover:border-primary/30">
                    <CardHeader className="bg-gradient-to-br from-primary/5 to-primary/10 pb-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-xl font-bold mb-1">{area.area_name}</CardTitle>
                          <CardDescription className="flex items-center gap-1.5 text-sm">
                            <MapPin className="h-3.5 w-3.5" />
                            {area.city}, {area.province}
                          </CardDescription>
                        </div>
                        <CheckCircle2 className="h-6 w-6 text-primary flex-shrink-0" />
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4">
                      {/* Service Types */}
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Available Services</p>
                        <div className="flex flex-wrap gap-1.5">
                          {area.service_types?.map((service, idx) => (
                            <Badge 
                              key={service} 
                              variant="outline"
                              className={`text-xs ${
                                service === 'mow_bot' ? 'border-primary/30 bg-primary/5 text-primary' :
                                service === 'pool_bot' ? 'border-blue-500/30 bg-blue-500/5 text-blue-600' :
                                service === 'security_bot' ? 'border-slate-500/30 bg-slate-500/5 text-slate-600' :
                                'border-orange-500/30 bg-orange-500/5 text-orange-600'
                              }`}
                            >
                              {service.replace('_', ' ').replace('bot', '').trim()}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {/* Postal Codes */}
                      {area.postal_codes && area.postal_codes.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Postal Codes</p>
                          <div className="flex flex-wrap gap-1.5">
                            {area.postal_codes.slice(0, 4).map((code) => (
                              <Badge key={code} variant="secondary" className="text-xs font-mono">
                                {code}
                              </Badge>
                            ))}
                            {area.postal_codes.length > 4 && (
                              <Badge variant="secondary" className="text-xs">
                                +{area.postal_codes.length - 4} more
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="border-dashed border-2">
                <CardContent className="py-16 text-center">
                  <MapPin className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-xl font-semibold mb-2">Coverage Areas Coming Soon</h3>
                  <p className="text-muted-foreground">
                    We're currently setting up our service areas. Check back soon!
                  </p>
                </CardContent>
              </Card>
            )}

            {/* CTA */}
            {coverageAreas.length > 0 && (
              <div className="mt-12 text-center">
                <p className="text-muted-foreground mb-4">
                  Don't see your area? We're expanding rapidly!
                </p>
                <Button 
                  onClick={() => navigate('/auth/register')} 
                  variant="outline"
                  size="lg"
                  className="group"
                >
                  Join Waitlist
                  <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </div>
            )}
          </div>
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
      <footer className="bg-gradient-to-b from-botkorp-black to-botkorp-slate-blue text-white/70 overflow-hidden border-t border-white/5">
        <div className="container mx-auto px-4 py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
            {/* Brand + intro */}
            <div className="lg:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <Bot className="h-8 w-8 text-primary" />
                <span className="font-bold text-white text-xl">Bot Korp</span>
              </div>
              <h4 className="text-xl font-semibold text-white mb-3 leading-tight">Automated property care, simplified.</h4>
              <p className="text-sm leading-relaxed text-white/50 mb-6">
                Professional-grade automation for lawns, pools, and security. Reliable, eco-friendly, and effortless.
              </p>
              <div className="flex items-center gap-3">
                <a href="https://facebook.com/botkorp" target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="h-10 w-10 rounded-full bg-white/5 hover:bg-primary/20 border border-white/10 hover:border-primary/30 flex items-center justify-center text-white/60 hover:text-primary transition-all">
                  <Facebook className="h-4 w-4" />
                </a>
                <a href="https://instagram.com/botkorp" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="h-10 w-10 rounded-full bg-white/5 hover:bg-primary/20 border border-white/10 hover:border-primary/30 flex items-center justify-center text-white/60 hover:text-primary transition-all">
                  <Instagram className="h-4 w-4" />
                </a>
                <a href="https://linkedin.com/company/botkorp" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="h-10 w-10 rounded-full bg-white/5 hover:bg-primary/20 border border-white/10 hover:border-primary/30 flex items-center justify-center text-white/60 hover:text-primary transition-all">
                  <Linkedin className="h-4 w-4" />
                </a>
                <a href="mailto:support@botkorp.com" aria-label="Email" className="h-10 w-10 rounded-full bg-white/5 hover:bg-primary/20 border border-white/10 hover:border-primary/30 flex items-center justify-center text-white/60 hover:text-primary transition-all">
                  <Mail className="h-4 w-4" />
                </a>
              </div>
            </div>

            {/* Documentation & Support */}
            <div>
              <h3 className="font-semibold text-white text-base mb-4 uppercase tracking-wide">Documentation</h3>
              <ul className="space-y-2.5 text-sm">
                <li><a href="/docs" className="text-white/60 hover:text-primary transition-colors flex items-center gap-1.5 group"><ArrowRight className="h-3 w-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all" />Getting Started</a></li>
                <li><a href="/docs/services" className="text-white/60 hover:text-primary transition-colors flex items-center gap-1.5 group"><ArrowRight className="h-3 w-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all" />Services Guide</a></li>
                <li><a href="/docs/faq" className="text-white/60 hover:text-primary transition-colors flex items-center gap-1.5 group"><ArrowRight className="h-3 w-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all" />FAQ</a></li>
                <li><a href="/docs/bot-rental-terms" className="text-white/60 hover:text-primary transition-colors flex items-center gap-1.5 group"><ArrowRight className="h-3 w-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all" />Rental Terms</a></li>
                <li><a href="mailto:support@botkorp.com" className="text-white/60 hover:text-primary transition-colors flex items-center gap-1.5 group"><ArrowRight className="h-3 w-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all" />Contact Support</a></li>
              </ul>
            </div>

            {/* Product */}
            <div>
              <h3 className="font-semibold text-white text-base mb-4 uppercase tracking-wide">Product</h3>
              <ul className="space-y-2.5 text-sm">
                <li><a href="/#services" className="text-white/60 hover:text-primary transition-colors flex items-center gap-1.5 group"><ArrowRight className="h-3 w-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all" />Our Services</a></li>
                <li><a href="/#how" className="text-white/60 hover:text-primary transition-colors flex items-center gap-1.5 group"><ArrowRight className="h-3 w-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all" />How It Works</a></li>
                <li><a href="/#pricing" className="text-white/60 hover:text-primary transition-colors flex items-center gap-1.5 group"><ArrowRight className="h-3 w-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all" />Pricing</a></li>
                <li><a href="/#coverage" className="text-white/60 hover:text-primary transition-colors flex items-center gap-1.5 group"><ArrowRight className="h-3 w-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all" />Coverage Areas</a></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h3 className="font-semibold text-white text-base mb-4 uppercase tracking-wide">Legal</h3>
              <ul className="space-y-2.5 text-sm">
                <li><a href="/docs/privacy-policy" className="text-white/60 hover:text-primary transition-colors flex items-center gap-1.5 group"><ArrowRight className="h-3 w-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all" />Privacy Policy</a></li>
                <li><a href="/docs/terms-of-service" className="text-white/60 hover:text-primary transition-colors flex items-center gap-1.5 group"><ArrowRight className="h-3 w-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all" />Terms of Service</a></li>
                <li><a href="/docs/cookie-policy" className="text-white/60 hover:text-primary transition-colors flex items-center gap-1.5 group"><ArrowRight className="h-3 w-3 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all" />Cookie Policy</a></li>
              </ul>
            </div>
          </div>

          {/* Contact strip */}
          <div className="border-t border-white/10 pt-8 pb-8">
            <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Mail className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-white/40 mb-0.5">Get in touch</p>
                  <a href="mailto:support@botkorp.com" className="text-white font-medium hover:text-primary transition-colors">support@botkorp.com</a>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-white/10 pt-8">
            <div className="flex flex-col lg:flex-row items-center justify-between gap-4 text-sm">
              <div className="text-center lg:text-left">
                <p className="text-white/50 mb-1">
                  © 2025 <span className="text-white/70 font-medium">Bot Korp (Pty) Ltd</span>. All rights reserved.
                </p>
                <p className="text-xs text-white/30">
                  A member of <span className="text-white/40 font-medium">Exolution Technologies (Pty) Ltd</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-6">
                <a href="/docs/privacy-policy" className="text-white/50 hover:text-primary transition-colors text-sm">Privacy</a>
                <span className="text-white/20">•</span>
                <a href="/docs/terms-of-service" className="text-white/50 hover:text-primary transition-colors text-sm">Terms</a>
                <span className="text-white/20">•</span>
                <a href="/docs" className="text-white/50 hover:text-primary transition-colors text-sm">Docs</a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

