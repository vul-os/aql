import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Bot,
  Sprout,
  Droplets,
  Shield as ShieldIcon,
  Cloud,
  Zap,
  Users,
  Settings,
  Bell,
  ArrowRight,
  BookOpen,
  HelpCircle,
  FileText,
  Cookie,
  Shield as ShieldLock
} from 'lucide-react';

export default function DocsHome() {
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = location.pathname.startsWith('/portal/docs') ? '/portal/docs' : '/docs';

  const quickLinks = [
    {
      icon: <HelpCircle className="h-6 w-6" />,
      title: 'FAQ',
      description: 'Frequently asked questions about Bot Korp',
      href: `${basePath}/faq`
    },
    {
      icon: <ShieldLock className="h-6 w-6" />,
      title: 'Privacy Policy',
      description: 'How we handle and protect your data',
      href: `${basePath}/privacy-policy`
    },
    {
      icon: <FileText className="h-6 w-6" />,
      title: 'Terms of Service',
      description: 'Terms and conditions for using Bot Korp',
      href: `${basePath}/terms-of-service`
    },
    {
      icon: <Cookie className="h-6 w-6" />,
      title: 'Cookie Policy',
      description: 'Information about cookies we use',
      href: `${basePath}/cookie-policy`
    }
  ];

  const botTypes = [
    {
      icon: <Sprout className="h-8 w-8 text-green-600" />,
      name: 'Mow Bot',
      description: 'Autonomous lawn mowing with smart scheduling, boundary detection, and weather-aware operation.',
      features: ['Precision cutting', 'Pattern variety', 'Obstacle detection', 'Session history']
    },
    {
      icon: <Droplets className="h-8 w-8 text-blue-600" />,
      name: 'Pool Bot',
      description: 'Automated pool cleaning with water quality monitoring for crystal-clear pools year-round.',
      features: ['Auto cleaning', 'pH monitoring', 'Chemical balance', 'Debris removal']
    },
    {
      icon: <ShieldIcon className="h-8 w-8 text-purple-600" />,
      name: 'Security Bot',
      description: 'Smart property surveillance with motion detection, alerts, and 24/7 monitoring capabilities.',
      features: ['Motion detection', 'Night vision', 'Live streaming', 'Alert system']
    },
    {
      icon: <Cloud className="h-8 w-8 text-sky-600" />,
      name: 'Weather Station',
      description: 'Comprehensive weather monitoring with local forecasts and environmental data collection.',
      features: ['Temperature', 'Humidity', 'Rain detection', 'Wind speed']
    }
  ];

  const features = [
    {
      icon: <Zap className="h-5 w-5" />,
      title: 'Real-time Control',
      description: 'Send commands and monitor your bots in real-time from anywhere'
    },
    {
      icon: <Users className="h-5 w-5" />,
      title: 'Team Collaboration',
      description: 'Invite team members and manage permissions for your organization'
    },
    {
      icon: <Settings className="h-5 w-5" />,
      title: 'Automation',
      description: 'Set up schedules and automated workflows for your bots'
    },
    {
      icon: <Bell className="h-5 w-5" />,
      title: 'Smart Alerts',
      description: 'Get notified about important events and maintenance needs'
    }
  ];

  return (
    <div className="max-w-4xl space-y-12">
      {/* Hero Section */}
      <div className="space-y-4">
        <Badge variant="secondary">Documentation</Badge>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          Welcome to Bot Korp Docs
        </h1>
        <p className="text-xl text-muted-foreground">
          Everything you need to know about managing your autonomous bots and automating your property.
        </p>
      </div>

      {/* Quick Links */}
      <div>
        <h2 className="text-2xl font-bold mb-6">Quick Links</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {quickLinks.map((link) => (
            <Card
              key={link.href}
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => navigate(link.href)}
            >
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    {link.icon}
                  </div>
                  <div>
                    <CardTitle className="text-lg">{link.title}</CardTitle>
                    <CardDescription className="mt-1">{link.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>

      {/* Bot Types */}
      <div>
        <h2 className="text-2xl font-bold mb-4">Supported Bot Types</h2>
        <p className="text-muted-foreground mb-6">
          Bot Korp supports multiple types of autonomous bots for different property management needs.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {botTypes.map((bot) => (
            <Card key={bot.name}>
              <CardHeader>
                <div className="flex items-center gap-3 mb-2">
                  {bot.icon}
                  <CardTitle>{bot.name}</CardTitle>
                </div>
                <CardDescription>{bot.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {bot.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-sm">
                      <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Key Features */}
      <div>
        <h2 className="text-2xl font-bold mb-4">Key Features</h2>
        <p className="text-muted-foreground mb-6">
          Bot Korp provides a comprehensive platform for managing your autonomous bots.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {features.map((feature) => (
            <div key={feature.title} className="flex gap-4 p-4 rounded-lg border">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                {feature.icon}
              </div>
              <div>
                <h3 className="font-semibold mb-1">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Getting Started */}
      <Card className="border-2 border-primary/20 bg-primary/5">
        <CardHeader>
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="h-6 w-6 text-primary" />
            <CardTitle>Getting Started</CardTitle>
          </div>
          <CardDescription>
            Ready to automate your property with Bot Korp?
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 mb-6">
            <li className="flex gap-3">
              <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">1</span>
              <div>
                <p className="font-medium">Create an Account</p>
                <p className="text-sm text-muted-foreground">Sign up and set up your organization</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">2</span>
              <div>
                <p className="font-medium">Add Your Location</p>
                <p className="text-sm text-muted-foreground">Set up your property locations and areas</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">3</span>
              <div>
                <p className="font-medium">Configure Your Bots</p>
                <p className="text-sm text-muted-foreground">Add bots and assign them to your gardens or pools</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">4</span>
              <div>
                <p className="font-medium">Start Automating</p>
                <p className="text-sm text-muted-foreground">Set schedules and let your bots handle the rest</p>
              </div>
            </li>
          </ol>
          <Button onClick={() => navigate('/auth/register')}>
            Get Started
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      {/* Support */}
      <div className="border-t pt-8">
        <h2 className="text-2xl font-bold mb-4">Need Help?</h2>
        <p className="text-muted-foreground mb-6">
          Can't find what you're looking for? We're here to help.
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <Button variant="outline" onClick={() => navigate(`${basePath}/faq`)}>
            <HelpCircle className="mr-2 h-4 w-4" />
            View FAQ
          </Button>
          <Button variant="outline" onClick={() => window.location.href = 'mailto:support@botkorp.com'}>
            <Bell className="mr-2 h-4 w-4" />
            Contact Support
          </Button>
        </div>
      </div>
    </div>
  );
}

