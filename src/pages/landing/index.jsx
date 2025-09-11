import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MapPin, Bot, Clock, Shield, CheckCircle, XCircle, Mail, User } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/auth-context'

const LandingPage = () => {
  const [searchLocation, setSearchLocation] = useState('')
  const [searchResult, setSearchResult] = useState(null)
  const [searching, setSearching] = useState(false)
  const { user, profile } = useAuth()

  const handleCoverageSearch = async (e) => {
    e.preventDefault()
    if (!searchLocation.trim()) return

    setSearching(true)
    try {
      // For now, we'll do a simple text search
      // In a real implementation, you'd use geocoding to get coordinates
      const { data, error } = await supabase
        .rpc('check_coverage', {
          lat: null,
          lng: null,
          city: searchLocation,
          state: null,
          postal_code: null
        })

      if (error) {
        console.error('Error checking coverage:', error)
        setSearchResult({ is_covered: false, error: error.message })
      } else {
        setSearchResult(data[0] || { is_covered: false })
      }
    } catch (error) {
      console.error('Error checking coverage:', error)
      setSearchResult({ is_covered: false, error: 'Failed to check coverage' })
    } finally {
      setSearching(false)
    }
  }

  const copyEmailTemplate = () => {
    const template = `Subject: Coverage Request for ${searchLocation}

Hi Botserv Team,

I would like to request coverage for my area: ${searchLocation}

Please let me know when service becomes available in my area.

Thank you,
[Your Name]`
    
    navigator.clipboard.writeText(template)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Bot className="h-8 w-8 text-green-600" />
            <span className="text-2xl font-bold text-gray-900">Botserv</span>
          </div>
          <div className="flex items-center space-x-4">
            {user ? (
              <>
                <div className="flex items-center space-x-2">
                  <User className="h-5 w-5 text-gray-600" />
                  <span className="text-sm text-gray-600">
                    {profile?.full_name || user?.email}
                  </span>
                </div>
                <Link to="/dashboard">
                  <Button>Dashboard</Button>
                </Link>
              </>
            ) : (
              <>
                <Link to="/auth/signin">
                  <Button variant="ghost">Sign In</Button>
                </Link>
                <Link to="/auth/signup">
                  <Button>Get Started</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            Smart Bot Management
            <span className="text-green-600"> Made Simple</span>
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Manage your mowing bots, pool cleaners, and smart home devices from one platform. 
            Schedule, monitor, and control your smart devices with ease.
          </p>
          
          {/* Coverage Search */}
          <Card className="max-w-md mx-auto mb-12">
            <CardHeader>
              <CardTitle className="flex items-center justify-center space-x-2">
                <MapPin className="h-5 w-5" />
                <span>Check Coverage</span>
              </CardTitle>
              <CardDescription>
                Enter your location to see if we service your area
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCoverageSearch} className="space-y-4">
                <Input
                  placeholder="Enter your city or area..."
                  value={searchLocation}
                  onChange={(e) => setSearchLocation(e.target.value)}
                  disabled={searching}
                />
                <Button type="submit" className="w-full" disabled={searching}>
                  {searching ? 'Checking...' : 'Check Coverage'}
                </Button>
              </form>
              
              {/* Search Results */}
              {searchResult && (
                <div className="mt-4 p-4 rounded-lg border">
                  {searchResult.is_covered ? (
                    <div className="text-center">
                      <CheckCircle className="h-8 w-8 text-green-600 mx-auto mb-2" />
                      <p className="text-green-600 font-semibold mb-2">We service your area!</p>
                      <p className="text-sm text-gray-600 mb-3">
                        Coverage: {searchResult.coverage_area_name}
                      </p>
                      {user ? (
                        <Link to="/dashboard">
                          <Button className="w-full">Go to Dashboard</Button>
                        </Link>
                      ) : (
                        <Link to="/auth/signup">
                          <Button className="w-full">Sign Up Now</Button>
                        </Link>
                      )}
                    </div>
                  ) : (
                    <div className="text-center">
                      <XCircle className="h-8 w-8 text-red-600 mx-auto mb-2" />
                      <p className="text-red-600 font-semibold mb-2">Not yet available</p>
                      <p className="text-sm text-gray-600 mb-3">
                        We don't currently service this area, but we're expanding!
                      </p>
                      <Button 
                        variant="outline" 
                        className="w-full"
                        onClick={copyEmailTemplate}
                      >
                        <Mail className="h-4 w-4 mr-2" />
                        Request Coverage
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            Everything You Need to Manage Your Bots
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <Card>
              <CardHeader>
                <Bot className="h-12 w-12 text-green-600 mb-4" />
                <CardTitle>Bot Management</CardTitle>
                <CardDescription>
                  Register and manage all your smart devices from one dashboard
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <Clock className="h-12 w-12 text-blue-600 mb-4" />
                <CardTitle>Smart Scheduling</CardTitle>
                <CardDescription>
                  Set up automated schedules for your bots based on your needs
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <Shield className="h-12 w-12 text-purple-600 mb-4" />
                <CardTitle>Secure & Reliable</CardTitle>
                <CardDescription>
                  Enterprise-grade security with real-time monitoring and alerts
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* Bot Types Section */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            Supported Bot Types
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <Card className="text-center">
              <CardHeader>
                <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Bot className="h-8 w-8 text-green-600" />
                </div>
                <CardTitle>MowBots</CardTitle>
                <CardDescription>
                  Automated lawn mowing robots with smart scheduling and weather integration
                </CardDescription>
              </CardHeader>
            </Card>
            <Card className="text-center">
              <CardHeader>
                <div className="h-16 w-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Bot className="h-8 w-8 text-blue-600" />
                </div>
                <CardTitle>PoolBots</CardTitle>
                <CardDescription>
                  Pool cleaning robots with maintenance scheduling and water quality monitoring
                </CardDescription>
              </CardHeader>
            </Card>
            <Card className="text-center">
              <CardHeader>
                <div className="h-16 w-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Bot className="h-8 w-8 text-purple-600" />
                </div>
                <CardTitle>Weather Stations</CardTitle>
                <CardDescription>
                  Environmental sensors providing real-time weather and soil data
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* Smart Home Section */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            Smart Home Integration
          </h2>
          <div className="grid md:grid-cols-4 gap-6">
            <Card className="text-center">
              <CardHeader>
                <div className="h-12 w-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Bot className="h-6 w-6 text-yellow-600" />
                </div>
                <CardTitle className="text-lg">Lighting</CardTitle>
                <CardDescription className="text-sm">
                  Smart bulbs, strips, switches, dimmers
                </CardDescription>
              </CardHeader>
            </Card>
            <Card className="text-center">
              <CardHeader>
                <div className="h-12 w-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Bot className="h-6 w-6 text-red-600" />
                </div>
                <CardTitle className="text-lg">Climate</CardTitle>
                <CardDescription className="text-sm">
                  AC, heaters, fans, thermostats
                </CardDescription>
              </CardHeader>
            </Card>
            <Card className="text-center">
              <CardHeader>
                <div className="h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Bot className="h-6 w-6 text-blue-600" />
                </div>
                <CardTitle className="text-lg">Entertainment</CardTitle>
                <CardDescription className="text-sm">
                  Smart TVs, soundbars, streaming
                </CardDescription>
              </CardHeader>
            </Card>
            <Card className="text-center">
              <CardHeader>
                <div className="h-12 w-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Bot className="h-6 w-6 text-gray-600" />
                </div>
                <CardTitle className="text-lg">Security</CardTitle>
                <CardDescription className="text-sm">
                  Cameras, door locks, sensors
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-green-600">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-white mb-6">
            Ready to Get Started?
          </h2>
          <p className="text-xl text-green-100 mb-8 max-w-2xl mx-auto">
            Join thousands of users who trust Botserv to manage their smart devices
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {user ? (
              <Link to="/dashboard">
                <Button size="lg" variant="secondary">
                  Go to Dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/auth/signup">
                  <Button size="lg" variant="secondary">
                    Start Free Trial
                  </Button>
                </Link>
                <Link to="/auth/signin">
                  <Button size="lg" variant="outline" className="text-white border-white hover:bg-white hover:text-green-600">
                    Sign In
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <Bot className="h-6 w-6 text-green-400" />
                <span className="text-xl font-bold">Botserv</span>
              </div>
              <p className="text-gray-400">
                Smart bot management platform for modern homes and businesses.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Product</h3>
              <ul className="space-y-2 text-gray-400">
                <li><Link to="/docs" className="hover:text-white">Documentation</Link></li>
                <li><Link to="/docs" className="hover:text-white">Features</Link></li>
                <li><Link to="/docs" className="hover:text-white">Support</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Company</h3>
              <ul className="space-y-2 text-gray-400">
                <li><a href="mailto:botservza@gmail.com" className="hover:text-white">Contact</a></li>
                <li><Link to="/docs/privacy" className="hover:text-white">Privacy</Link></li>
                <li><Link to="/docs/terms" className="hover:text-white">Terms</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Legal</h3>
              <ul className="space-y-2 text-gray-400">
                <li><Link to="/docs/privacy" className="hover:text-white">Privacy Policy</Link></li>
                <li><Link to="/docs/terms" className="hover:text-white">Terms of Service</Link></li>
                <li><Link to="/docs/cookies" className="hover:text-white">Cookie Policy</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
            <p>&copy; 2024 Botserv. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
