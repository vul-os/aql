import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AddressSearch } from '@/components/ui/address-search';
import { Bot, Sprout, Droplets, Shield, MapPin, CheckCircle2, ArrowRight, LayoutDashboard, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';

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
      icon: <Sprout className="h-8 w-8" />,
      title: "Mow Bot",
      description: "Autonomous lawn mowing with precision cutting, boundary detection, and scheduled operations.",
      features: ["Smart navigation", "Multiple patterns", "Real-time tracking", "Scheduled service"]
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
      {/* Header - transparent before scroll, solid after */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all border-b ${
        scrolled ? 'bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60' : 'bg-transparent border-transparent'
      }`}>
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}> 
            <Bot className={`h-8 w-8 ${scrolled ? 'text-primary' : 'text-white'}`} />
            <h1 className={`text-2xl font-bold ${scrolled ? '' : 'text-white'}`}>Bot Korp</h1>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/docs')} className={`hidden sm:flex ${scrolled ? '' : 'text-white hover:text-white/80'}`}>
              Docs
            </Button>
            {user && hasOrganization ? (
              <Button 
                size="lg"
                onClick={() => navigate('/portal')}
                className="gap-2 shadow-lg hover:shadow-xl transition-all"
              >
                <LayoutDashboard className="h-5 w-5" />
                Go to Portal
              </Button>
            ) : user ? (
              <Button onClick={() => navigate('/portal')}>
                Dashboard
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => navigate('/auth/login')} className={`${scrolled ? '' : 'text-white hover:text-white/80'}`}>
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
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/40 to-black/80" />
        <div className="relative container mx-auto px-4 min-h-screen pt-28 md:pt-32 lg:pt-36 flex items-center">
          <div className="max-w-4xl">
            <h2 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white drop-shadow leading-[1.05]">
              Autonomous care for your
              <span className="block text-primary">property</span>
            </h2>
            <p className="mt-6 text-lg md:text-xl text-white/90 max-w-2xl">
              Lawn, pool, security and weather—handled by smart bots while you relax.
            </p>

            {/* Address Search pill */}
            <div className="mt-8">
              <div className="rounded-2xl bg-white/90 backdrop-blur-xl shadow-2xl ring-1 ring-black/5 p-4">
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
                        <div key={area.area_id} className="p-3 rounded-lg border border-primary/20 bg-white/70">
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
              </div>
            </div>

            {/* Secondary CTAs */}
            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <Button size="lg" onClick={() => navigate('/auth/register')}>
                Get Started
              </Button>
              <Button 
                size="lg" 
                variant="outline" 
                onClick={() => navigate('/docs')} 
                className="bg-white/10 text-white border-white/30 hover:bg-white/20"
              >
                View Docs
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Coverage Section - removed in favor of hero integration, keep anchor for links */}
      <section id="coverage" className="relative overflow-hidden hidden">
        {/* Background gradient + subtle grid pattern */}
        <div className="absolute inset-0 -z-20 bg-gradient-to-br from-botkorp-green-50 to-white" />
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-60" style={{backgroundImage:"radial-gradient(circle at 1px 1px, rgba(2,6,23,0.06) 1px, transparent 0)", backgroundSize:'22px 22px'}} />
        {/* Decorative blur blobs */}
        <div className="absolute -top-10 left-1/3 -z-10 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 -z-10 h-40 w-40 rounded-full bg-[rgba(66,165,245,0.2)] blur-3xl" />
        <div className="container mx-auto px-4 py-20 md:py-28">
          <div className="max-w-3xl mx-auto text-center mb-10">
            <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-botkorp-green-100 ring-8 ring-white/60 text-primary shadow-md mb-5">
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
            <h3 className="text-3xl md:text-4xl font-bold mb-3">Our Bot Services</h3>
            <p className="text-lg text-muted-foreground">Choose from our fleet of specialized autonomous bots</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Mow Bot */}
            <Card className="overflow-hidden group">
              <div className="h-28 bg-gradient-to-r from-botkorp.green-100 to-botkorp.green-50 flex items-center justify-center">
                <div className="h-16 w-16 rounded-full bg-white text-primary flex items-center justify-center shadow">
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
            <Card className="overflow-hidden group">
              <div className="h-28 bg-gradient-to-r from-[#BBDEFB] to-[#E3F2FD] flex items-center justify-center">
                <div className="h-16 w-16 rounded-full bg-white text-[#42A5F5] flex items-center justify-center shadow">
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
                    <div key={i} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#42A5F5]" /><span>{f}</span></div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Security Bot */}
            <Card className="overflow-hidden group">
              <div className="h-28 bg-gradient-to-r from-[#E1BEE7] to-[#F3E5F5] flex items-center justify-center">
                <div className="h-16 w-16 rounded-full bg-white text-[#AB47BC] flex items-center justify-center shadow">
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
                    <div key={i} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#AB47BC]" /><span>{f}</span></div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Weather Station */}
            <Card className="overflow-hidden group">
              <div className="h-28 bg-gradient-to-r from-[#FFE0B2] to-[#FFF3E0] flex items-center justify-center">
                <div className="h-16 w-16 rounded-full bg-white text-[#FF9800] flex items-center justify-center shadow">
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
                    <div key={i} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#FF9800]" /><span>{f}</span></div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works - dark contrast section */}
      <section id="how" className="relative">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-slate-900 to-slate-800" />
        <div className="container mx-auto px-4 py-20">
          <div className="text-center mb-12">
            <h3 className="text-3xl md:text-4xl font-bold text-white mb-3">How Bot Korp Works</h3>
            <p className="text-slate-300">From setup to maintenance‑free lawns in 3 simple steps</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-white">
              <div className="text-6xl font-extrabold bg-gradient-to-r from-botkorp.green-400 to-white bg-clip-text text-transparent">1</div>
              <h4 className="mt-3 text-xl font-semibold">Choose</h4>
              <p className="mt-1 text-slate-300">Select the bot service that fits your property.</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-white">
              <div className="text-6xl font-extrabold bg-gradient-to-r from-botkorp.green-400 to-white bg-clip-text text-transparent">2</div>
              <h4 className="mt-3 text-xl font-semibold">Install</h4>
              <p className="mt-1 text-slate-300">Our team installs and configures your bot system.</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-white">
              <div className="text-6xl font-extrabold bg-gradient-to-r from-botkorp.green-400 to-white bg-clip-text text-transparent">3</div>
              <h4 className="mt-3 text-xl font-semibold">Enjoy</h4>
              <p className="mt-1 text-slate-300">Sit back while automation takes care of everything.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section - bold gradient */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-botkorp-green-600 to-accent-blue" />
        <div className="absolute inset-0 -z-10 bg-black/15" />
        <div className="container mx-auto px-4 py-20">
          <div className="max-w-3xl mx-auto text-center text-white space-y-6">
            <h3 className="text-3xl md:text-4xl font-bold drop-shadow-md">Ready to Get Started?</h3>
            <p className="text-lg text-white/95 drop-shadow">Join hundreds of property owners who trust Bot Korp for their automation needs</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" onClick={() => navigate('/auth/register')} className="bg-white text-foreground hover:bg-white/90">
                Create Account
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
            <div className="text-sm text-white/90">
              ✓ No credit card required · ✓ Free consultation · ✓ 30-day money-back guarantee
            </div>
          </div>
        </div>
      </section>

      {/* Footer - dark with newsletter */}
      <footer className="bg-botkorp-grey-900 text-slate-300 overflow-hidden">
        <div className="container mx-auto px-4 py-14">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 mb-10">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Bot className="h-6 w-6 text-primary" />
                <span className="font-semibold text-white">Bot Korp</span>
              </div>
              <p className="text-sm">Smart property automation with autonomous bots.</p>
            </div>
            <div>
              <h3 className="font-semibold text-white mb-3">Product</h3>
              <ul className="space-y-2 text-sm">
                <li><a href="/#services" className="hover:text-primary">Services</a></li>
                <li><a href="/#how" className="hover:text-primary">How it Works</a></li>
                <li><a href="/#coverage" className="hover:text-primary">Coverage</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-white mb-3">Resources</h3>
              <ul className="space-y-2 text-sm">
                <li><a href="/docs" className="hover:text-primary">Documentation</a></li>
                <li><a href="/docs/faq" className="hover:text-primary">FAQ</a></li>
                <li><a href="mailto:support@botkorp.com" className="hover:text-primary">Support</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm">© 2024 Bot Korp. All rights reserved.</p>
            <p className="text-sm">Made with ❤️ in South Africa</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

