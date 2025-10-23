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
    <div className="min-h-screen bg-white dark:bg-botkorp-black">
      {/* Header - Professional, Solid Colors */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled 
          ? 'bg-white dark:bg-botkorp-black border-b border-gray-200 dark:border-botkorp-slate-blue/30 shadow-md' 
          : 'bg-white/98 dark:bg-botkorp-black/98 backdrop-blur-sm border-b border-gray-100 dark:border-botkorp-slate-blue/20'
      }`}>
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            {/* Logo */}
            <div className="flex items-center gap-2 cursor-pointer group" onClick={() => navigate('/')}> 
              <div className="h-9 w-9 rounded-lg bg-botkorp-orange flex items-center justify-center shadow-sm group-hover:shadow-md transition-all group-hover:scale-105">
                <Bot className="h-5 w-5 text-white" />
              </div>
              <h1 className="text-lg sm:text-xl font-bold text-botkorp-black dark:text-white">
                Bot Korp
              </h1>
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-2 sm:gap-3">
              <Button 
                variant="ghost" 
                onClick={() => navigate('/docs')} 
                className="hidden sm:flex text-botkorp-slate-blue hover:text-botkorp-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-botkorp-slate-blue/20 font-medium"
              >
                Docs
              </Button>
              
            {user && hasOrganization ? (
              <Button 
                onClick={() => navigate('/portal')}
                className="gap-2 bg-botkorp-black dark:bg-botkorp-orange hover:bg-botkorp-slate-blue dark:hover:bg-botkorp-orange-dark text-white shadow-sm hover:shadow-md transition-all font-semibold"
              >
                <LayoutDashboard className="h-4 w-4" />
                <span className="hidden sm:inline">Dashboard</span>
                <span className="sm:hidden">Portal</span>
              </Button>
            ) : user ? (
              <Button 
                onClick={() => navigate('/portal')} 
                className="gap-2 bg-botkorp-black dark:bg-botkorp-orange hover:bg-botkorp-slate-blue dark:hover:bg-botkorp-orange-dark text-white shadow-sm hover:shadow-md transition-all font-semibold"
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
                  className="text-botkorp-slate-blue hover:text-botkorp-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-botkorp-slate-blue/20 font-medium"
                >
                  Login
                </Button>
                <Button 
                  onClick={() => navigate('/auth/register')}
                  className="bg-botkorp-orange hover:bg-botkorp-orange-dark text-white shadow-sm hover:shadow-md transition-all font-semibold"
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

      {/* Pilot Banner - Subtle Animation */}
      <div className="fixed top-14 sm:top-16 left-0 right-0 z-40 bg-botkorp-orange dark:bg-botkorp-slate-blue border-b border-botkorp-orange-dark dark:border-botkorp-slate-blue/50 overflow-hidden">
        <div className="container mx-auto px-4 py-2">
          <div className="flex items-center justify-center gap-2 text-sm animate-[fadeIn_1s_ease-out]">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
            <p className="text-white">
              <strong className="font-semibold">Pilot Program Now Active</strong> <span className="hidden sm:inline">— Be among the first to experience automated property care in South Africa!</span>
            </p>
          </div>
        </div>
        {/* Subtle sliding gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[slideInRight_3s_ease-in-out_infinite] pointer-events-none"></div>
      </div>

      {/* Hero Section - Fits in viewport */}
      <section className="relative mt-20 sm:mt-24 h-[calc(100vh-96px)] sm:h-[calc(100vh-104px)] flex items-center pb-8 sm:pb-12 overflow-hidden">
        {/* Background Image with Solid Overlay */}
        <div className="absolute inset-0">
          <img 
            src="/images/lawn.jpg" 
            alt="Automated lawn care" 
            className="absolute inset-0 w-full h-full min-w-full min-h-full object-cover object-center"
          />
          {/* Solid color overlay - no gradients */}
          <div className="absolute inset-0 bg-botkorp-black/50 dark:bg-botkorp-black/70" />
        </div>

        {/* Content */}
        <div className="relative w-full max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center">
          
          {/* Headline - More compact */}
          <div className="text-center mb-6 lg:mb-8 animate-[fadeIn_1s_ease-out]">
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight tracking-tight drop-shadow-2xl">
              Property services managed
            </h1>
            <h1 className="mt-1 text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold leading-tight tracking-tight drop-shadow-2xl">
              <span className="text-botkorp-orange">
                automatically.
              </span>
            </h1>
            <p className="mt-4 sm:mt-6 text-base sm:text-lg md:text-xl text-white/90 font-light max-w-2xl mx-auto drop-shadow-lg leading-relaxed">
              Professional lawn, pool, and security automation for homes and businesses across South Africa.
            </p>
          </div>

          {/* Search Box - Professional Solid Design */}
          <div className="w-full max-w-2xl mx-auto animate-[fadeInUp_0.7s_ease-out_0.3s_both]">
            <div className="relative bg-white dark:bg-botkorp-black-light rounded-xl shadow-xl transition-all duration-300 hover:shadow-2xl border-2 border-gray-200 dark:border-botkorp-slate-blue/30">
              <div className="flex items-center px-3 sm:px-4 py-2.5 sm:py-3">
                <MapPin className="text-botkorp-orange mr-2 sm:mr-3 flex-shrink-0 h-5 w-5" />
                <div className="flex-1 min-w-0">
                  <AddressSearch
                    onAddressSelect={handleAddressSelect}
                    placeholder="Enter your address"
                    storageKey="lastSearchedAddress"
                    className="border-none shadow-none focus-visible:ring-0 py-1.5 sm:py-2 text-sm sm:text-base placeholder:text-gray-400 dark:placeholder:text-botkorp-silver px-0 h-auto outline-none dark:text-white"
                  />
                </div>
                <Button
                  className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold bg-botkorp-orange hover:bg-botkorp-orange-dark text-white transition-all duration-200 shadow-sm hover:shadow-md h-10 rounded-lg px-4 sm:px-6 ml-2 sm:ml-3 text-sm"
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
                      <span className="hidden md:inline">Check</span>
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Feature Cards - Compact */}
            <div className="mt-5 flex flex-col sm:flex-row justify-center items-center gap-2 sm:gap-4 animate-[fadeIn_1s_ease-out_0.6s_both]">
              <div className="flex items-center bg-botkorp-slate-blue rounded-lg px-4 py-2.5 border border-botkorp-silver/20 shadow-md hover:shadow-lg hover:bg-botkorp-slate-blue/90 transition-all w-full sm:w-auto">
                <div className="bg-botkorp-orange rounded-full p-2 mr-3">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="text-white">
                  <p className="font-semibold text-xs">Automated lawn mowing</p>
                </div>
              </div>
              <div className="flex items-center bg-botkorp-slate-blue rounded-lg px-4 py-2.5 border border-botkorp-silver/20 shadow-md hover:shadow-lg hover:bg-botkorp-slate-blue/90 transition-all w-full sm:w-auto">
                <div className="bg-botkorp-orange rounded-full p-2 mr-3">
                  <Sprout className="w-4 h-4 text-white" />
                </div>
                <div className="text-white">
                  <p className="font-semibold text-xs">Professional results</p>
                </div>
              </div>
            </div>

            {/* Trust Indicators - Compact */}
            <div className="mt-5 pt-4 border-t border-white/20 flex flex-col sm:flex-row justify-center items-center gap-3 sm:gap-6 text-white/90 animate-[fadeIn_1s_ease-out_0.9s_both]">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-botkorp-orange" />
                <span className="text-xs font-medium">No Contracts</span>
              </div>
              <div className="flex items-center gap-2">
                <Sprout className="w-4 h-4 text-botkorp-orange" />
                <span className="text-xs font-medium">Eco-friendly</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-botkorp-orange" />
                <span className="text-xs font-medium">SA Based</span>
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

      {/* Services Section - Solid Colors */}
      <section id="services" className="bg-gray-50 dark:bg-botkorp-black-light py-16 md:py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 mb-4">
                <div className="h-1 w-12 bg-botkorp-orange rounded-full"></div>
                <Bot className="h-5 w-5 text-botkorp-orange" />
                <div className="h-1 w-12 bg-botkorp-orange rounded-full"></div>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold mb-3 text-botkorp-black dark:text-white">
                Automated Property Services
              </h2>
              <p className="text-base md:text-lg text-botkorp-slate-blue dark:text-botkorp-silver max-w-3xl mx-auto">
                Specialized bots designed for <span className="text-botkorp-orange font-semibold">effortless maintenance</span> across homes and businesses
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Mow Bot */}
              <Card className="overflow-hidden group hover:shadow-xl transition-all duration-300 border-2 border-gray-200 dark:border-botkorp-slate-blue/30 hover:border-botkorp-orange">
                <div className="h-28 bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center relative">
                  <div className="h-16 w-16 rounded-full bg-botkorp-orange text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                    {services[0].icon}
                  </div>
                </div>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-bold text-botkorp-black dark:text-white">{services[0].title}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed text-botkorp-slate-blue dark:text-botkorp-silver">{services[0].description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {services[0].features.map((f,i)=> (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-botkorp-orange mt-0.5 flex-shrink-0" />
                        <span className="text-sm text-botkorp-slate-blue dark:text-botkorp-silver">{f}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              {/* Pool Bot */}
              <Card className="overflow-hidden group opacity-60 relative border-2 border-gray-200 dark:border-botkorp-slate-blue/30">
                <Badge className="absolute top-3 right-3 z-10 bg-yellow-500 text-yellow-950 font-semibold">Coming Soon</Badge>
                <div className="h-28 bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center relative">
                  <div className="h-16 w-16 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-lg">
                    {services[1].icon}
                  </div>
                </div>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-bold text-botkorp-black dark:text-white">{services[1].title}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed text-botkorp-slate-blue dark:text-botkorp-silver">{services[1].description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {services[1].features.map((f,i)=> (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                        <span className="text-sm text-botkorp-slate-blue dark:text-botkorp-silver">{f}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              {/* Security Bot */}
              <Card className="overflow-hidden group opacity-60 relative border-2 border-gray-200 dark:border-botkorp-slate-blue/30">
                <Badge className="absolute top-3 right-3 z-10 bg-yellow-500 text-yellow-950 font-semibold">Coming Soon</Badge>
                <div className="h-28 bg-botkorp-slate-blue/10 dark:bg-botkorp-slate-blue/30 flex items-center justify-center relative">
                  <div className="h-16 w-16 rounded-full bg-botkorp-slate-blue text-white flex items-center justify-center shadow-lg">
                    {services[2].icon}
                  </div>
                </div>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-bold text-botkorp-black dark:text-white">{services[2].title}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed text-botkorp-slate-blue dark:text-botkorp-silver">{services[2].description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {services[2].features.map((f,i)=> (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-botkorp-slate-blue mt-0.5 flex-shrink-0" />
                        <span className="text-sm text-botkorp-slate-blue dark:text-botkorp-silver">{f}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              {/* Weather Station */}
              <Card className="overflow-hidden group opacity-60 relative border-2 border-gray-200 dark:border-botkorp-slate-blue/30">
                <Badge className="absolute top-3 right-3 z-10 bg-yellow-500 text-yellow-950 font-semibold">Coming Soon</Badge>
                <div className="h-28 bg-orange-500/10 dark:bg-orange-500/20 flex items-center justify-center relative">
                  <div className="h-16 w-16 rounded-full bg-orange-500 text-white flex items-center justify-center shadow-lg">
                    {services[3].icon}
                  </div>
                </div>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-bold text-botkorp-black dark:text-white">{services[3].title}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed text-botkorp-slate-blue dark:text-botkorp-silver">{services[3].description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {services[3].features.map((f,i)=> (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
                        <span className="text-sm text-botkorp-slate-blue dark:text-botkorp-silver">{f}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works - Solid Colors */}
      <section id="how" className="relative overflow-hidden bg-botkorp-slate-blue dark:bg-botkorp-black">
        <div className="container mx-auto px-4 py-16 md:py-20">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center max-w-7xl mx-auto">
            
            {/* Left Column - Copy Content */}
            <div className="space-y-6 lg:space-y-8">
              {/* Header */}
              <div>
                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3 leading-tight">
                  How Bot Korp works
                </h2>
                <p className="text-base sm:text-lg text-white/80 max-w-xl leading-relaxed">
                  Simple, secure, and seamless automation for homes and businesses across South Africa.
                </p>
              </div>

              {/* Segmented Toggle */}
              <div className="inline-flex rounded-lg border-2 border-white/20 bg-botkorp-black/30 p-1 w-full sm:w-auto">
                <button 
                  onClick={() => setActiveAudience('homeowner')} 
                  className={`flex-1 sm:flex-none px-4 sm:px-6 py-2.5 rounded-md text-sm font-semibold transition-all ${
                    activeAudience === 'homeowner' 
                      ? 'bg-botkorp-orange text-white shadow-md' 
                      : 'text-white/70 hover:text-white'
                  }`}
                >
                  Homeowners
                </button>
                <button 
                  onClick={() => setActiveAudience('installer')} 
                  className={`flex-1 sm:flex-none px-4 sm:px-6 py-2.5 rounded-md text-sm font-semibold transition-all ${
                    activeAudience === 'installer' 
                      ? 'bg-botkorp-orange text-white shadow-md' 
                      : 'text-white/70 hover:text-white'
                  }`}
                >
                  Businesses
                </button>
              </div>

              {/* Steps - Vertical Layout */}
              {activeAudience === 'homeowner' ? (
                <div className="space-y-5">
                  <div className="flex gap-4 group">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-full bg-botkorp-orange text-white flex items-center justify-center text-lg font-bold shadow-md group-hover:scale-110 transition-transform">
                        1
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg mb-1.5">Check Coverage</div>
                      <div className="text-white/70 text-sm leading-relaxed">
                        Enter your address to verify we service your area.
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-4 group">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-full bg-botkorp-orange text-white flex items-center justify-center text-lg font-bold shadow-md group-hover:scale-110 transition-transform">
                        2
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg mb-1.5">Installation in Days</div>
                      <div className="text-white/70 text-sm leading-relaxed">
                        Certified professionals handle setup, safety checks, and training.
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-4 group">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-full bg-botkorp-orange text-white flex items-center justify-center text-lg font-bold shadow-md group-hover:scale-110 transition-transform">
                        3
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg mb-1.5">Monitor & Save</div>
                      <div className="text-white/70 text-sm leading-relaxed">
                        Track everything from your dashboard. Automation runs on schedule.
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex gap-4 group">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-full bg-botkorp-orange text-white flex items-center justify-center text-lg font-bold shadow-md group-hover:scale-110 transition-transform">
                        1
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg mb-1.5">Partner with Us</div>
                      <div className="text-white/70 text-sm leading-relaxed">
                        Join our network and offer automated services to your clients.
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-4 group">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-full bg-botkorp-orange text-white flex items-center justify-center text-lg font-bold shadow-md group-hover:scale-110 transition-transform">
                        2
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg mb-1.5">Manage Deployments</div>
                      <div className="text-white/70 text-sm leading-relaxed">
                        Track all installations and client services from one dashboard.
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-4 group">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-full bg-botkorp-orange text-white flex items-center justify-center text-lg font-bold shadow-md group-hover:scale-110 transition-transform">
                        3
                      </div>
                    </div>
                    <div className="text-white pt-1">
                      <div className="font-semibold text-lg mb-1.5">Scale Revenue</div>
                      <div className="text-white/70 text-sm leading-relaxed">
                        Build recurring revenue with automated property management.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <Button 
                  size="lg" 
                  onClick={() => navigate('/auth/register')} 
                  className="bg-botkorp-orange hover:bg-botkorp-orange-dark text-white shadow-lg hover:shadow-xl transition-all font-semibold"
                >
                  Get started
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
                <Button 
                  size="lg" 
                  variant="outline" 
                  onClick={() => navigate('/docs')} 
                  className="bg-white/10 text-white border-2 border-white/30 hover:bg-white/20 shadow-md"
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
                  className="relative w-full h-auto z-10 pointer-events-none select-none drop-shadow-2xl"
                />
                
                {/* Preview Container - positioned absolutely inside the phone screen */}
                <div className="absolute top-[3.2%] left-[4.8%] right-[4.8%] bottom-[3.2%] rounded-[2rem] overflow-hidden">
                  <div className="w-full h-full bg-background shadow-inner">
                    <InteractivePreview />
                  </div>
                </div>

                {/* Subtle shadow glow */}
                <div className="absolute -inset-6 bg-botkorp-orange/10 blur-3xl -z-10 opacity-40" />
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Pricing Calculator Section */}
      <section className="relative overflow-hidden py-16 md:py-20 bg-white dark:bg-botkorp-black">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4 border-botkorp-orange text-botkorp-orange font-semibold">Transparent Pricing</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-3 text-botkorp-black dark:text-white">
              Calculate Your <span className="text-botkorp-orange">Monthly Cost</span>
            </h2>
            <p className="text-base md:text-lg text-botkorp-slate-blue dark:text-botkorp-silver max-w-2xl mx-auto">
              Simple, transparent pricing with no hidden fees. See exactly what you'll pay.
            </p>
          </div>

          <SimplePriceCalculator />
        </div>
      </section>

      {/* Coverage Areas Section */}
      <section id="coverage-map" className="relative overflow-hidden bg-gray-50 dark:bg-botkorp-black-light py-16 md:py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 mb-4">
                <div className="h-1 w-12 bg-botkorp-orange rounded-full"></div>
                <MapPin className="h-5 w-5 text-botkorp-orange" />
                <div className="h-1 w-12 bg-botkorp-orange rounded-full"></div>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold mb-3 text-botkorp-black dark:text-white">
                Where We Serve
              </h2>
              <p className="text-base md:text-lg text-botkorp-slate-blue dark:text-botkorp-silver max-w-2xl mx-auto leading-relaxed">
                Currently operating across key areas in South Africa, with expansion plans nationwide
              </p>
            </div>

            {loadingCoverageAreas ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-botkorp-orange" />
              </div>
            ) : coverageAreas.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {coverageAreas.map((area) => (
                  <Card key={area.id} className="overflow-hidden group hover:shadow-xl transition-all duration-300 border-2 border-gray-200 dark:border-botkorp-slate-blue/30 hover:border-botkorp-orange">
                    <CardHeader className="bg-botkorp-orange/10 dark:bg-botkorp-orange/20 pb-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-lg font-bold mb-1 text-botkorp-black dark:text-white">{area.area_name}</CardTitle>
                          <CardDescription className="flex items-center gap-1.5 text-sm text-botkorp-slate-blue dark:text-botkorp-silver">
                            <MapPin className="h-3.5 w-3.5" />
                            {area.city}, {area.province}
                          </CardDescription>
                        </div>
                        <CheckCircle2 className="h-6 w-6 text-botkorp-orange flex-shrink-0" />
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4">
                      {/* Service Types */}
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-botkorp-slate-blue dark:text-botkorp-silver mb-2 uppercase">Available Services</p>
                        <div className="flex flex-wrap gap-1.5">
                          {area.service_types?.map((service, idx) => (
                            <Badge 
                              key={service} 
                              variant="outline"
                              className={`text-xs ${
                                service === 'mow_bot' ? 'border-botkorp-orange bg-botkorp-orange/10 text-botkorp-orange' :
                                service === 'pool_bot' ? 'border-blue-500 bg-blue-500/10 text-blue-600' :
                                service === 'security_bot' ? 'border-botkorp-slate-blue bg-botkorp-slate-blue/10 text-botkorp-slate-blue' :
                                'border-orange-500 bg-orange-500/10 text-orange-600'
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
                          <p className="text-xs font-semibold text-botkorp-slate-blue dark:text-botkorp-silver mb-2 uppercase">Postal Codes</p>
                          <div className="flex flex-wrap gap-1.5">
                            {area.postal_codes.slice(0, 4).map((code) => (
                              <Badge key={code} className="text-xs font-mono bg-botkorp-slate-blue/20 text-botkorp-black dark:text-white border-0">
                                {code}
                              </Badge>
                            ))}
                            {area.postal_codes.length > 4 && (
                              <Badge className="text-xs bg-botkorp-slate-blue/20 text-botkorp-black dark:text-white border-0">
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
              <Card className="border-dashed border-2 border-gray-300 dark:border-botkorp-slate-blue/30">
                <CardContent className="py-16 text-center">
                  <MapPin className="h-16 w-16 text-botkorp-slate-blue dark:text-botkorp-silver mx-auto mb-4" />
                  <h3 className="text-xl font-semibold mb-2 text-botkorp-black dark:text-white">Coverage Areas Coming Soon</h3>
                  <p className="text-botkorp-slate-blue dark:text-botkorp-silver">
                    We're currently setting up our service areas. Check back soon!
                  </p>
                </CardContent>
              </Card>
            )}

            {/* CTA */}
            {coverageAreas.length > 0 && (
              <div className="mt-12 text-center">
                <p className="text-botkorp-slate-blue dark:text-botkorp-silver mb-4">
                  Don't see your area? We're expanding rapidly!
                </p>
                <Button 
                  onClick={() => navigate('/auth/register')} 
                  variant="outline"
                  size="lg"
                  className="group border-2 border-botkorp-orange text-botkorp-orange hover:bg-botkorp-orange hover:text-white"
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
      <section className="relative overflow-hidden bg-white dark:bg-botkorp-black">
        <div className="container mx-auto px-4 py-16 md:py-20">
          <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="text-center mb-12">
              <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-botkorp-orange/20 text-botkorp-orange mb-4 ring-4 ring-botkorp-orange/10">
                <Shield className="h-7 w-7" />
              </div>
              <h3 className="text-3xl md:text-4xl font-bold mb-3 text-botkorp-black dark:text-white">Questions? We've got <span className="text-botkorp-orange">answers</span>.</h3>
              <p className="text-base md:text-lg text-botkorp-slate-blue dark:text-botkorp-silver max-w-2xl mx-auto">
                Everything you need to know about Bot Korp automation
              </p>
            </div>

            {/* FAQ Accordion Items */}
            <div className="space-y-3">
              {[
                {
                  icon: Shield,
                  question: "Is it safe for my pets and children?",
                  answer: "Absolutely. Our bots are equipped with advanced sensors and boundary detection systems. They automatically stop when they detect obstacles, pets, or people. The Mow Bot uses lift and tilt sensors that immediately halt the blades if picked up or tipped over. All bots undergo rigorous safety testing and meet international safety standards."
                },
                {
                  icon: Droplets,
                  question: "What happens if it rains?",
                  answer: "Our bots are weather-smart! The Mow Bot has a rain sensor that automatically sends it back to the charging station during rain and resumes once conditions improve. The Weather Station continuously monitors conditions and adjusts all bot schedules accordingly. All outdoor bots are IP65-rated for water resistance."
                },
                {
                  icon: CreditCard,
                  question: "How much does installation cost?",
                  answer: "Installation costs vary by service type and property size. Mow Bot installation typically ranges from R4,500-R8,500 (includes boundary wire setup and configuration). Pool Bot installation starts at R3,000. We offer free site assessments to give you an accurate quote. Installation is included in some premium subscription plans."
                },
                {
                  icon: Wrench,
                  question: "Who handles maintenance and repairs?",
                  answer: "All maintenance is included in your subscription! Our certified technicians perform regular check-ups, blade replacements, software updates, and repairs at no extra cost. If anything goes wrong, simply report it through the portal and we'll send a technician within 24-48 hours. We also provide a replacement bot if repairs take longer than 3 days."
                },
                {
                  icon: Clock,
                  question: "Can I control the schedule?",
                  answer: "Yes! You have full control through our mobile-friendly portal. Set custom schedules, adjust mowing patterns, enable/disable services, and get real-time notifications. Want the lawn mowed before a weekend BBQ? Just trigger it manually. You can also set quiet hours to ensure bots don't run when you're sleeping or entertaining guests."
                },
                {
                  icon: MapPin,
                  question: "What if you don't service my area yet?",
                  answer: "We're rapidly expanding across South Africa! If we don't currently service your area, join our waitlist and we'll notify you as soon as we launch nearby. We prioritize expansion based on demand, so the more interest we get from an area, the sooner we'll be there. You'll also receive an early-bird discount when we launch."
                }
              ].map((faq, index) => {
                const Icon = faq.icon;
                const isOpen = openFaqIndex === index;
                
                return (
                  <div
                    key={index}
                    className={`group relative rounded-xl border-2 transition-all duration-300 overflow-hidden ${
                      isOpen 
                        ? 'border-botkorp-orange shadow-xl' 
                        : 'border-gray-200 dark:border-botkorp-slate-blue/30 hover:border-botkorp-orange/50 shadow-md'
                    }`}
                  >
                    {/* Question Button */}
                    <button
                      onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                      className="w-full text-left p-5 relative z-10 flex items-start gap-4 transition-all bg-white dark:bg-botkorp-black-light hover:bg-gray-50 dark:hover:bg-botkorp-slate-blue/10"
                    >
                      {/* Icon */}
                      <div className={`flex-shrink-0 transition-all duration-300 ${
                        isOpen ? 'scale-110' : 'scale-100'
                      }`}>
                        <div className={`h-11 w-11 rounded-lg flex items-center justify-center transition-all duration-300 ${
                          isOpen 
                            ? 'bg-botkorp-orange text-white shadow-md' 
                            : 'bg-botkorp-orange/10 text-botkorp-orange group-hover:bg-botkorp-orange/20'
                        }`}>
                          <Icon className="h-5 w-5" />
                        </div>
                      </div>
                      
                      {/* Question */}
                      <div className="flex-1 pt-1">
                        <h4 className={`text-base md:text-lg font-semibold transition-colors ${
                          isOpen ? 'text-botkorp-orange' : 'text-botkorp-black dark:text-white group-hover:text-botkorp-orange'
                        }`}>
                          {faq.question}
                        </h4>
                      </div>
                      
                      {/* Toggle Icon */}
                      <div className={`flex-shrink-0 transition-all duration-300 ${
                        isOpen ? 'rotate-180' : 'rotate-0'
                      }`}>
                        <div className={`h-9 w-9 rounded-full flex items-center justify-center transition-all ${
                          isOpen 
                            ? 'bg-botkorp-orange/10 text-botkorp-orange' 
                            : 'bg-gray-100 dark:bg-botkorp-slate-blue/20 text-botkorp-slate-blue dark:text-botkorp-silver group-hover:bg-botkorp-orange/10 group-hover:text-botkorp-orange'
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
                      <div className="px-5 pb-5 pl-[76px] bg-white dark:bg-botkorp-black-light">
                        <div className="border-l-2 border-botkorp-orange/30 pl-5">
                          <p className="text-sm text-botkorp-slate-blue dark:text-botkorp-silver leading-relaxed">
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
            <div className="text-center mt-12 p-6 rounded-xl bg-botkorp-orange/10 dark:bg-botkorp-orange/20 border-2 border-botkorp-orange/30">
              <p className="text-sm text-botkorp-black dark:text-white">
                Still have questions? <a href="mailto:support@botkorp.com" className="text-botkorp-orange hover:underline font-semibold">Contact our team</a> — we're here to help!
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

