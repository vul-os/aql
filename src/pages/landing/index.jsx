import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MapPin, Bot, Clock, Shield, CheckCircle, XCircle, Mail, Zap, Sparkles, Play, Menu, X, Wifi, Thermometer, Camera, Lock, Home, Smartphone, Globe, Battery, Droplets } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
 
const LandingPage = () => {
  const [searchLocation, setSearchLocation] = useState('')
  const [searchResult, setSearchResult] = useState(null)
  const [searching, setSearching] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const navigate = useNavigate()
  const { user, profile } = useAuth()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Feature cards trail animation
  const features = [
    { icon: Bot, title: "Unified Control Hub", description: "Command all your bots from one intelligent dashboard with real-time insights and predictive maintenance." },
    { icon: Zap, title: "AI-Powered Automation", description: "Smart schedules that learn from weather patterns, usage data, and seasonal changes." },
    { icon: Shield, title: "Enterprise Security", description: "Bank-grade encryption with biometric access and comprehensive audit trails." }
  ]

  // Bot types data
  const botTypes = [
    { 
      icon: Bot, 
      name: "MowBots", 
      description: "Intelligent lawn mowing robots with weather integration and GPS mapping",
      features: ["Weather-aware scheduling", "GPS precision cutting", "Anti-theft protection", "Remote monitoring"]
    },
    { 
      icon: Droplets, 
      name: "PoolBots", 
      description: "Advanced pool cleaning robots with water quality monitoring",
      features: ["Automatic cleaning cycles", "Water chemistry alerts", "Energy optimization", "Filter maintenance"]
    },
    { 
      icon: Thermometer, 
      name: "Weather Stations", 
      description: "Environmental monitoring with predictive analytics",
      features: ["Micro-climate tracking", "Predictive weather alerts", "Soil moisture sensing", "UV monitoring"]
    }
  ]

  // Smart home integrations
  const integrations = [
    { icon: Home, name: "Lighting", description: "Smart bulbs, strips, switches" },
    { icon: Thermometer, name: "Climate", description: "AC, heaters, thermostats" },
    { icon: Smartphone, name: "Entertainment", description: "TVs, soundbars, streaming" },
    { icon: Lock, name: "Security", description: "Cameras, locks, sensors" },
    { icon: Wifi, name: "Network", description: "Routers, extenders, IoT hubs" },
    { icon: Camera, name: "Monitoring", description: "Indoor/outdoor cameras" },
    { icon: Battery, name: "Energy", description: "Solar panels, batteries" },
    { icon: Globe, name: "Connectivity", description: "Smart displays, assistants" }
  ]

  const handleCoverageSearch = (e) => {
    e.preventDefault()
    if (!searchLocation.trim()) return

    setSearching(true)
    // Simulate API call
    setTimeout(() => {
      const isAvailable = Math.random() > 0.4
      setSearchResult({ 
        is_covered: isAvailable, 
        coverage_area_name: isAvailable ? "Greater Metro Area" : null 
      })
      setSearching(false)
    }, 1500)
  }

  const copyEmailTemplate = () => {
    const template = `Subject: Coverage Request for ${searchLocation}

Hi Botserv Team,

I would like to request coverage for my area: ${searchLocation}

Please let me know when service becomes available.

Thank you!`
    
    navigator.clipboard.writeText(template)
  }

  const scrollToSection = (sectionId) => {
    const element = document.getElementById(sectionId)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      {/* Header */}
      <header 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-transparent' : 'bg-black/40 backdrop-blur-md md:bg-transparent'}`}
      >
        <div className={`${scrolled ? 'mx-4 md:mx-6 mt-3 rounded-2xl bg-white shadow-lg border border-black/10' : ''}`}>
        <div className="container mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div 
              className="flex items-center"
            >
              <div className="relative w-14 h-14 md:w-16 md:h-16 rounded-lg overflow-hidden">
                <img src="/images/icon.png" alt="Botserv" className="w-full h-full object-contain" />
              </div>
            </div>

            <nav className="hidden md:flex items-center space-x-8">
              {[
                { name: 'Features', id: 'features' },
                { name: 'Bot Types', id: 'bot-types' },
                { name: 'Integrations', id: 'integrations' }
              ].map((item, i) => (
                <button
                  key={item.name}
                  onClick={() => scrollToSection(item.id)}
                  className={`${scrolled ? 'text-black' : 'text-white/90'} hover:text-[#63A504] transition-colors relative group font-medium`}
                >
                  {item.name}
                  <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-[#63A504] group-hover:w-full transition-all duration-300" />
                </button>
              ))}
            </nav>

            <div className="flex items-center space-x-3">
              {user ? (
                <>
                  <Button variant="ghost" className={`${scrolled ? 'text-black hover:bg-black/5 hover:text-black' : 'text-white/90 hover:bg-white/10 hover:text-white'}`} onClick={() => navigate('/dashboard')}>
                    Dashboard
                  </Button>
                  <Avatar className={`h-9 w-9 border ${scrolled ? 'border-black/10' : 'border-white/20'}`}>
                    <AvatarImage src={profile?.avatar_url || ''} alt={profile?.full_name || user.email} />
                  <AvatarFallback className="bg-[#63A504]/20 text-[#63A504] text-sm font-semibold">
                      {(profile?.full_name || user?.email || '?')?.trim()?.charAt(0)?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </>
              ) : (
                <>
                  <Button variant="ghost" className={`${scrolled ? 'text-black hover:bg-black/5 hover:text-black' : 'text-white/90 hover:bg-white/10 hover:text-white'}`} onClick={() => navigate('/auth/signin')}>
                    Sign In
                  </Button>
                  <Button className="bg-[#63A504] hover:bg-[#63A504]/90 text-black shadow-lg shadow-[#63A504]/25" onClick={() => navigate('/auth/signup')}>
                    Get Started
                  </Button>
                </>
              )}
              
              {/* Mobile menu button */}
              <button
                className={`md:hidden ${scrolled ? 'text-black' : 'text-white'}`}
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>

          {/* Mobile menu */}
          {mobileMenuOpen && (
            <div
              className={`md:hidden mt-4 py-4 border-t ${scrolled ? 'border-black/10 bg-white shadow-md' : 'border-white/10 bg-black/30 backdrop-blur-md'} rounded-lg`}
            >
                <div className="flex flex-col space-y-4 px-4">
                  {[
                    { name: 'Features', id: 'features' },
                    { name: 'Bot Types', id: 'bot-types' },
                    { name: 'Integrations', id: 'integrations' }
                  ].map((item) => (
                    <button
                      key={item.name}
                      onClick={() => {
                        scrollToSection(item.id)
                        setMobileMenuOpen(false)
                      }}
                      className={`${scrolled ? 'text-black' : 'text-white/90'} hover:text-[#63A504] transition-colors text-left font-medium`}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
            </div>
          )}
        </div>
        </div>
      </header>

      {/* Hero Section - grayscale gradient overlays for clarity */}
      <section className="relative min-h-[100svh] overflow-hidden flex items-center">
        {/* Background Image with neutral overlays (colorless) */}
        <div className="absolute inset-0 z-0">
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: 'url(/images/lawn.jpg)', filter: 'grayscale(0%)' }}
          />
          {/* Colorless transparent gradient overlays */}
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(0,0,0,0.15), rgba(0,0,0,0.35))'
          }} />
        </div>

        {/* Hero Content - Two Column Layout */}
        <div className="relative z-10 w-full h-full flex items-center pt-24 sm:pt-28 pb-10">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="grid lg:grid-cols-2 gap-12 items-center h-full">
              
              {/* Left Column - Text Content */}
              <div className="flex flex-col justify-center">
                <h1
                  className="text-3xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight font-urbanist"
                >
                  <span className="text-white drop-shadow-2xl">
                    Smart Lawn
                  </span>
                  <br />
                  <span className="text-[#63A504] drop-shadow-lg">Automation</span>
                </h1>

                <p
                  className="text-base sm:text-xl text-white/90 mb-8 leading-relaxed drop-shadow-lg font-urbanist max-w-xl"
                >
                  Transform your outdoor space with intelligent mowing bots, smart irrigation, and automated garden care. The future of lawn management is here.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                  <div>
                    <Button size="lg" className="bg-[#63A504] hover:bg-[#63A504]/90 text-white px-6 py-3 sm:px-8 sm:py-3 text-base font-semibold shadow-2xl shadow-[#63A504]/40">
                      <Play className="w-5 h-5 mr-3" />
                      Get Started
                    </Button>
                  </div>
                </div>
              </div>

              {/* Right Column - Coverage Search Card */}
              <div
                className="flex flex-col justify-center"
              >
                <Card className="bg-white/5 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/20 max-w-md sm:max-w-lg mx-auto w-full">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center justify-center space-x-3 text-white text-lg font-semibold">
                      <MapPin className="w-5 h-5 text-emerald-400" />
                      <span>Check Service Area</span>
                    </CardTitle>
                  </CardHeader>
                  
                  <CardContent className="space-y-4 pt-0">
                    <div className="relative">
                      <Input
                        placeholder="Enter your location..."
                        value={searchLocation}
                        onChange={(e) => setSearchLocation(e.target.value)}
                        disabled={searching}
                        className="bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-[#63A504] focus:ring-[#63A504]/20 backdrop-blur-sm h-12 px-4"
                      />
                    </div>
                    
                    <Button 
                      onClick={handleCoverageSearch}
                      className="w-full bg-[#63A504] hover:bg-[#63A504]/90 text-white shadow-lg h-12 font-semibold"
                      disabled={searching}
                    >
                      {searching ? (
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Checking...
                        </div>
                      ) : (
                        'Check Coverage'
                      )}
                    </Button>

                    {searchResult && (
                      <div
                        className="p-4 rounded-lg bg-white/10 backdrop-blur-sm border border-white/10"
                      >
                          {searchResult.is_covered ? (
                            <div className="text-center space-y-3">
                              <CheckCircle className="w-10 h-10 text-[#63A504] mx-auto" />
                              <div>
                                <p className="text-white font-semibold">Available in your area!</p>
                                <p className="text-white/70 text-sm">Coverage: {searchResult.coverage_area_name}</p>
                              </div>
                              <Button className="w-full bg-[#63A504] hover:bg-[#63A504]/90 text-white font-semibold">
                                Get Started Now
                              </Button>
                            </div>
                          ) : (
                            <div className="text-center space-y-3">
                              <XCircle className="w-10 h-10 text-orange-400 mx-auto" />
                              <div>
                                <p className="text-white font-semibold">Coming Soon</p>
                                <p className="text-white/70 text-sm">Join the waitlist!</p>
                              </div>
                              <Button 
                                variant="outline" 
                                className="w-full border-white/40 text-white hover:bg-white/10 font-semibold"
                                onClick={copyEmailTemplate}
                              >
                                <Mail className="w-4 h-4 mr-2" />
                                Join Waitlist
                              </Button>
                            </div>
                          )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-16 sm:py-24 lg:py-32 relative bg-background">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="text-center mb-12 sm:mb-16 lg:mb-24">
            <Badge className="mb-8 bg-[#63A504]/10 border border-[#63A504]/30 text-[#63A504] px-6 py-3 text-base font-medium">
              <Zap className="w-4 h-4 mr-2" />
              Why Choose Botserv
            </Badge>
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-8 leading-tight font-urbanist">
              <span className="text-white">Everything you need to manage</span>
              <br />
              <span className="text-[#63A504]">your smart ecosystem</span>
            </h2>
            <p className="text-xl text-white/80 max-w-4xl mx-auto leading-relaxed">
              Powerful tools and AI-driven insights to transform how you control and monitor your automated devices
            </p>
          </div>

            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8 lg:gap-10">
            {features.map((feature, index) => {
              const Icon = feature.icon
              
              return (
                <div key={index}>
                  <div className="group cursor-pointer h-full">
                    <Card className="relative overflow-hidden bg-slate-900/50 backdrop-blur-xl border border-[#63A504]/25 hover:border-[#63A504]/40 transition-all duration-300 h-full shadow-2xl shadow-[#63A504]/10 hover:shadow-[#63A504]/25 hover:scale-105">
                      <CardHeader className="relative z-10 pb-8 p-8">
                        <div className="w-20 h-20 rounded-3xl bg-[#63A504]/10 border border-[#63A504]/30 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-300">
                          <Icon className="w-10 h-10 text-[#63A504]" />
                        </div>
                        
                        <CardTitle className="text-2xl font-bold text-white mb-6 group-hover:text-[#63A504] transition-colors font-urbanist">
                          {feature.title}
                        </CardTitle>
                        
                        <CardDescription className="text-white/80 text-lg leading-relaxed">
                          {feature.description}
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Bot Types Section */}
      <section id="bot-types" className="py-16 sm:py-24 lg:py-32 relative bg-background">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="text-center mb-12 sm:mb-16 lg:mb-24">
            <Badge className="mb-8 bg-[#63A504]/10 border border-[#63A504]/30 text-[#63A504] px-6 py-3 text-base font-medium">
              <Bot className="w-4 h-4 mr-2" />
              Supported Devices
            </Badge>
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-8 leading-tight font-urbanist">
              <span className="text-white">Advanced Bot Management</span>
              <br />
              <span className="text-[#63A504]">for Every Need</span>
            </h2>
            <p className="text-xl text-white/80 max-w-4xl mx-auto leading-relaxed">
              From lawn care to pool maintenance, our platform supports all major bot types with intelligent automation
            </p>
          </div>

          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8 lg:gap-10">
            {botTypes.map((bot, index) => {
              const Icon = bot.icon
              
              return (
                <div key={index}>
                  <div className="group h-full">
                    <Card className="relative overflow-hidden bg-slate-900/60 backdrop-blur-xl border border-[#63A504]/20 hover:border-[#63A504]/40 transition-all duration-300 h-full shadow-2xl hover:shadow-[#63A504]/20 hover:scale-105">
                      <CardHeader className="relative z-10 text-center p-8">
                        <div className="w-24 h-24 rounded-3xl bg-[#63A504]/10 border border-[#63A504]/30 flex items-center justify-center mx-auto mb-8 group-hover:scale-110 transition-transform duration-300">
                          <Icon className="w-12 h-12 text-[#63A504]" />
                        </div>
                        
                        <CardTitle className="text-2xl font-bold text-white mb-4 group-hover:text-[#63A504] transition-colors font-urbanist">
                          {bot.name}
                        </CardTitle>
                        
                        <CardDescription className="text-white/80 text-lg leading-relaxed mb-8">
                          {bot.description}
                        </CardDescription>

                        {/* Feature list */}
                        <div className="space-y-3">
                          {bot.features.map((feature, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-3 text-base text-[#63A504]/80"
                            >
                              <CheckCircle className="w-5 h-5 text-[#63A504] flex-shrink-0" />
                              <span>{feature}</span>
                            </div>
                          ))}
                        </div>
                      </CardHeader>
                    </Card>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Smart Home Integration Section */}
      <section id="integrations" className="py-16 sm:py-24 lg:py-32 relative bg-background">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="text-center mb-12 sm:mb-16 lg:mb-24">
            <Badge className="mb-8 bg-[#63A504]/10 border border-[#63A504]/30 text-[#63A504] px-6 py-3 text-base font-medium">
              <Home className="w-4 h-4 mr-2" />
              Smart Home Ready
            </Badge>
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-8 leading-tight font-urbanist">
              <span className="text-white">Seamless Integration</span>
              <br />
              <span className="text-[#63A504]">with Your Smart Home</span>
            </h2>
            <p className="text-xl text-white/80 max-w-4xl mx-auto leading-relaxed">
              Connect and control all your smart devices from one unified dashboard with intelligent automation
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
            {integrations.map((integration, index) => {
              const Icon = integration.icon
              
              return (
                <div key={index}>
                  <div className="h-full">
                    <Card className="relative overflow-hidden bg-slate-900/50 backdrop-blur-xl border border-[#63A504]/20 hover:border-[#63A504]/40 transition-all duration-300 text-center group h-full hover:scale-105 hover:shadow-[#63A504]/20 shadow-xl">
                      <CardHeader className="relative z-10 p-8">
                        <div className="w-16 h-16 rounded-2xl bg-[#63A504]/10 border border-[#63A504]/30 flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-300">
                          <Icon className="w-8 h-8 text-[#63A504]" />
                        </div>
                        
                        <CardTitle className="text-xl font-bold text-white mb-4 group-hover:text-[#63A504] transition-colors font-urbanist">
                          {integration.name}
                        </CardTitle>
                        
                        <CardDescription className="text-white/70 text-base">
                          {integration.description}
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Integration stats */}
          <div className="mt-12 sm:mt-16 lg:mt-20 text-center">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6 sm:gap-10 lg:gap-12 max-w-4xl mx-auto">
              {[
                { number: "500+", label: "Device Models" },
                { number: "50+", label: "Brands Supported" },
                { number: "99.9%", label: "Uptime" },
                { number: "24/7", label: "Monitoring" }
              ].map((stat, i) => (
                <div key={i} className="text-center">
                  <div className="text-4xl font-bold text-[#63A504] mb-2">
                    {stat.number}
                  </div>
                  <div className="text-white/70 text-lg">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Enhanced CTA Section */}
      <section className="py-16 sm:py-24 lg:py-32 relative overflow-hidden bg-background">
        <div className="container mx-auto px-4 sm:px-6 text-center relative z-10">
          <div>
            <Badge className="mb-12 bg-[#63A504]/10 border border-[#63A504]/30 text-[#63A504] px-8 py-4 text-lg font-medium">
              <Sparkles className="w-5 h-5 mr-2" />
              Ready to Transform Your Home?
            </Badge>
            
            <h2 className="text-4xl sm:text-6xl lg:text-7xl font-bold mb-8 sm:mb-12 leading-tight font-urbanist">
              <span className="text-white">Start Your Smart</span>
              <br />
              <span className="text-[#63A504]">Automation Journey</span>
            </h2>
            
            <p className="text-lg sm:text-2xl text-white/90 mb-10 sm:mb-16 max-w-4xl mx-auto leading-relaxed px-2">
              Join thousands of users who trust Botserv to manage their smart devices with intelligence and style
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-8 justify-center mb-10 sm:mb-16">
              <div>
                <Button size="lg" className="bg-[#63A504] hover:bg-[#63A504]/90 text-white px-10 py-6 sm:px-16 sm:py-8 text-lg sm:text-xl shadow-2xl shadow-[#63A504]/30 hover:scale-105 transition-transform">
                  <Play className="w-6 h-6 mr-3" />
                  Start Free Trial
                </Button>
              </div>
              
              <div>
                <Button size="lg" variant="outline" className="border-[#63A504]/50 text-[#63A504] hover:bg-[#63A504]/20 px-10 py-6 sm:px-16 sm:py-8 text-lg sm:text-xl backdrop-blur-sm hover:scale-105 transition-transform">
                  <Mail className="w-6 h-6 mr-3" />
                  Contact Sales
                </Button>
              </div>
            </div>

            {/* Trust indicators */}
            <div className="flex flex-wrap justify-center items-center gap-6 sm:gap-12 text-white/70 text-base sm:text-lg px-2">
              <div className="flex items-center gap-3">
                <Shield className="w-6 h-6" />
                <span>Enterprise Security</span>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="w-6 h-6" />
                <span>24/7 Support</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle className="w-6 h-6" />
                <span>30-Day Money Back</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Enhanced Footer */}
      <footer className="bg-background border-t border-[#63A504]/20 py-12 sm:py-16 lg:py-20">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-8 sm:gap-12 lg:gap-16 mb-10 sm:mb-16">
            {/* Brand */}
            <div className="md:col-span-1">
              <div className="flex items-center space-x-3 mb-8">
                <div className="relative w-10 h-10 rounded-lg overflow-hidden">
                  <img src="/images/icon.png" alt="Botserv" className="w-full h-full object-contain" />
                </div>
                <span className="text-3xl font-bold text-[#63A504]">
                  Botserv
                </span>
              </div>
              <p className="text-white/70 mb-8 leading-relaxed text-base sm:text-lg">
                The future of smart home automation. Intelligent, secure, and beautifully designed for modern living.
              </p>
              <div className="flex space-x-3 sm:space-x-4">
                {['twitter', 'linkedin', 'github'].map((social) => (
                  <button
                    key={social}
                    className="w-12 h-12 rounded-full bg-[#63A504]/20 border border-[#63A504]/30 flex items-center justify-center text-[#63A504] hover:bg-[#63A504]/30 transition-all duration-300 hover:scale-110"
                  >
                    <Globe className="w-5 h-5" />
                  </button>
                ))}
              </div>
            </div>

            {/* Product Links */}
            <div>
              <h3 className="text-white font-semibold mb-6 sm:mb-8 text-lg sm:text-xl">Product</h3>
              <ul className="space-y-4">
                {['Features', 'Bot Types', 'Integrations', 'API', 'Documentation'].map((item) => (
                  <li key={item}>
                    <button className="text-white/70 hover:text-[#63A504] transition-colors text-base sm:text-lg">
                      {item}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company Links */}
            <div>
              <h3 className="text-white font-semibold mb-6 sm:mb-8 text-lg sm:text-xl">Company</h3>
              <ul className="space-y-4">
                {['About', 'Careers', 'Press', 'Blog', 'Contact'].map((item) => (
                  <li key={item}>
                    <button className="text-white/70 hover:text-[#63A504] transition-colors text-base sm:text-lg">
                      {item}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Legal Links */}
            <div>
              <h3 className="text-white font-semibold mb-6 sm:mb-8 text-lg sm:text-xl">Legal</h3>
              <ul className="space-y-4">
                {['Privacy Policy', 'Terms of Service', 'Cookie Policy', 'Security', 'Compliance'].map((item) => (
                  <li key={item}><button className="text-white/70 hover:text-[#63A504] transition-colors text-base sm:text-lg">
                  {item}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Footer bottom */}
      <div className="border-t border-[#63A504]/20 pt-8 sm:pt-12 flex flex-col md:flex-row justify-between items-center gap-4">
        <p className="text-white/60 text-base sm:text-lg text-center md:text-left">
          © 2024 Botserv. All rights reserved. Made with ❤️ for the future of smart homes.
        </p>
        <div className="flex items-center gap-6 sm:gap-8 mt-4 md:mt-0">
          <div className="flex items-center gap-2 sm:gap-3 text-white/70 text-base sm:text-lg">
            <div className="w-3 h-3 bg-[#63A504] rounded-full animate-pulse" />
            <span>All systems operational</span>
          </div>
        </div>
      </div>
    </div>
  </footer>
</div>
)
}

export default LandingPage