import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
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
  Shield as ShieldLock,
  Sparkles,
  Star
} from 'lucide-react';

export default function DocsHome() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();
  const basePath = location.pathname.startsWith('/portal/docs') ? '/portal/docs' : '/docs';

  const quickLinks = [
    {
      icon: <BookOpen className="h-6 w-6" />,
      title: 'Getting Started Guide',
      description: 'Complete step-by-step onboarding walkthrough',
      href: `${basePath}/onboarding-guide`,
      featured: true
    },
    {
      icon: <FileText className="h-6 w-6" />,
      title: 'Bot Rental Terms',
      description: 'Complete bot rental terms and conditions',
      href: `${basePath}/bot-rental-terms`
    },
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
      description: 'General terms and conditions for using Bot Korp',
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
    <div className="max-w-5xl space-y-16 animate-in fade-in slide-in-from-bottom-8 duration-700">
      {/* Hero Section */}
      <div className={cn(
        "relative space-y-6 pb-12 overflow-hidden rounded-3xl p-10",
        theme === 'dark'
          ? "bg-gradient-to-br from-[#1a1a1a] via-[#2a2a2a] to-[#1a1a1a] border border-white/5"
          : "bg-gradient-to-br from-white via-[#FAFAFA] to-white border border-[#E5E7EB]",
        "shadow-2xl shadow-[#FF6B35]/5"
      )}>
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#FF6B35]/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-[#4F5D75]/10 rounded-full blur-3xl" />
        
        <div className="relative z-10">
          <Badge 
            variant="secondary" 
            className={cn(
              "mb-4 px-4 py-1.5 rounded-full font-semibold shadow-lg",
              "bg-gradient-to-r from-[#FF6B35] to-[#E85A2A] text-white",
              "border-none"
            )}
          >
            <Sparkles className="h-3 w-3 mr-1.5 inline" />
            Documentation
          </Badge>
          <h1 className={cn(
            "text-5xl md:text-6xl font-bold tracking-tight mb-4",
            "bg-gradient-to-r from-[#FF6B35] via-[#E85A2A] to-[#4F5D75] bg-clip-text text-transparent"
          )}>
            Welcome to Bot Korp
          </h1>
          <p className={cn(
            "text-xl leading-relaxed max-w-3xl",
            theme === 'dark' ? "text-[#B0B3B8]" : "text-[#4F5D75]"
          )}>
            Everything you need to know about managing your autonomous bots and automating your property with cutting-edge technology.
          </p>
        </div>
      </div>

      {/* Quick Links */}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-1 w-12 bg-gradient-to-r from-[#FF6B35] to-transparent rounded-full" />
          <h2 className={cn(
            "text-3xl font-bold",
            theme === 'dark' ? "text-white" : "text-[#121212]"
          )}>Quick Links</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {quickLinks.map((link, idx) => (
            <Card
              key={link.href}
              className={cn(
                "group cursor-pointer overflow-hidden transition-all duration-500 hover:scale-[1.02] hover:-translate-y-1",
                theme === 'dark'
                  ? "bg-gradient-to-br from-[#1a1a1a] to-[#2a2a2a] border-white/10 hover:border-[#FF6B35]/50"
                  : "bg-gradient-to-br from-white to-[#FAFAFA] border-[#E5E7EB] hover:border-[#FF6B35]/50",
                link.featured && "ring-2 ring-[#FF6B35]/30",
                "shadow-xl hover:shadow-2xl hover:shadow-[#FF6B35]/10",
                "animate-in fade-in slide-in-from-bottom-4 duration-500",
                `style-delay-${idx * 100}`
              )}
              onClick={() => navigate(link.href)}
            >
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#FF6B35]/0 via-[#FF6B35]/0 to-[#FF6B35]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              
              <CardHeader className="relative z-10">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "h-14 w-14 rounded-2xl flex items-center justify-center transition-all duration-500",
                    "shadow-lg group-hover:scale-110 group-hover:rotate-3",
                    link.featured
                      ? "bg-gradient-to-br from-[#FF6B35] to-[#E85A2A] text-white shadow-[#FF6B35]/25"
                      : theme === 'dark'
                        ? "bg-[#FF6B35]/10 text-[#FF6B35]"
                        : "bg-[#FF6B35]/10 text-[#FF6B35]"
                  )}>
                    {link.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <CardTitle className={cn(
                        "text-lg font-bold",
                        theme === 'dark' ? "text-white" : "text-[#121212]"
                      )}>{link.title}</CardTitle>
                      {link.featured && (
                        <Badge className="bg-[#FF6B35] text-white border-none shadow-md">
                          <Star className="h-3 w-3 mr-1" />
                          Start Here
                        </Badge>
                      )}
                    </div>
                    <CardDescription className={cn(
                      "text-sm",
                      theme === 'dark' ? "text-[#B0B3B8]" : "text-[#4F5D75]"
                    )}>{link.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>

      {/* Bot Types */}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-1 w-12 bg-gradient-to-r from-[#4F5D75] to-transparent rounded-full" />
          <h2 className={cn(
            "text-3xl font-bold",
            theme === 'dark' ? "text-white" : "text-[#121212]"
          )}>Supported Bot Types</h2>
        </div>
        <p className={cn(
          "text-lg",
          theme === 'dark' ? "text-[#B0B3B8]" : "text-[#4F5D75]"
        )}>
          Bot Korp supports multiple types of autonomous bots for different property management needs.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {botTypes.map((bot, idx) => (
            <Card 
              key={bot.name}
              className={cn(
                "group overflow-hidden transition-all duration-500 hover:scale-[1.02]",
                theme === 'dark'
                  ? "bg-gradient-to-br from-[#1a1a1a] to-[#2a2a2a] border-white/10"
                  : "bg-gradient-to-br from-white to-[#FAFAFA] border-[#E5E7EB]",
                "shadow-xl hover:shadow-2xl",
                "animate-in fade-in slide-in-from-bottom-4 duration-500",
                `delay-${idx * 100}`
              )}
            >
              {/* Gradient overlay based on bot type */}
              <div className={cn(
                "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500",
                "bg-gradient-to-br from-transparent via-transparent to-current/5"
              )} />
              
              <CardHeader className="relative z-10">
                <div className="flex items-center gap-4 mb-3">
                  <div className={cn(
                    "p-3 rounded-2xl shadow-lg transition-transform duration-500 group-hover:scale-110"
                  )}>
                    {bot.icon}
                  </div>
                  <CardTitle className={cn(
                    "text-xl font-bold",
                    theme === 'dark' ? "text-white" : "text-[#121212]"
                  )}>{bot.name}</CardTitle>
                </div>
                <CardDescription className={cn(
                  theme === 'dark' ? "text-[#B0B3B8]" : "text-[#4F5D75]"
                )}>{bot.description}</CardDescription>
              </CardHeader>
              <CardContent className="relative z-10">
                <ul className="space-y-2.5">
                  {bot.features.map((feature, featureIdx) => (
                    <li 
                      key={feature} 
                      className={cn(
                        "flex items-center gap-3 text-sm animate-in fade-in slide-in-from-left-2 duration-300",
                        `delay-${featureIdx * 50}`
                      )}
                    >
                      <div className="h-2 w-2 rounded-full bg-gradient-to-r from-[#FF6B35] to-[#E85A2A] shadow-md" />
                      <span className={theme === 'dark' ? "text-[#FAFAFA]" : "text-[#121212]"}>{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Key Features */}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-1 w-12 bg-gradient-to-r from-[#FF6B35] to-transparent rounded-full" />
          <h2 className={cn(
            "text-3xl font-bold",
            theme === 'dark' ? "text-white" : "text-[#121212]"
          )}>Key Features</h2>
        </div>
        <p className={cn(
          "text-lg",
          theme === 'dark' ? "text-[#B0B3B8]" : "text-[#4F5D75]"
        )}>
          Bot Korp provides a comprehensive platform for managing your autonomous bots.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {features.map((feature, idx) => (
            <div 
              key={feature.title} 
              className={cn(
                "group flex gap-4 p-6 rounded-2xl transition-all duration-500 hover:scale-[1.02]",
                theme === 'dark'
                  ? "bg-gradient-to-br from-[#1a1a1a] to-[#2a2a2a] border border-white/10"
                  : "bg-gradient-to-br from-white to-[#FAFAFA] border border-[#E5E7EB]",
                "shadow-lg hover:shadow-2xl hover:shadow-[#FF6B35]/5",
                "animate-in fade-in slide-in-from-bottom-4 duration-500",
                `delay-${idx * 100}`
              )}
            >
              <div className={cn(
                "h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0",
                "bg-gradient-to-br from-[#FF6B35]/10 to-[#E85A2A]/10 text-[#FF6B35]",
                "shadow-md group-hover:scale-110 transition-transform duration-500"
              )}>
                {feature.icon}
              </div>
              <div>
                <h3 className={cn(
                  "font-bold text-lg mb-2",
                  theme === 'dark' ? "text-white" : "text-[#121212]"
                )}>{feature.title}</h3>
                <p className={cn(
                  "text-sm leading-relaxed",
                  theme === 'dark' ? "text-[#B0B3B8]" : "text-[#4F5D75]"
                )}>{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Getting Started */}
      <Card className={cn(
        "relative overflow-hidden border-2 transition-all duration-500",
        theme === 'dark'
          ? "bg-gradient-to-br from-[#1a1a1a] via-[#2a2a2a] to-[#1a1a1a] border-[#FF6B35]/30"
          : "bg-gradient-to-br from-white via-[#FAFAFA] to-white border-[#FF6B35]/30",
        "shadow-2xl shadow-[#FF6B35]/10"
      )}>
        {/* Decorative background */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#FF6B35]/5 via-transparent to-[#4F5D75]/5" />
        
        <CardHeader className="relative z-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-[#FF6B35] to-[#E85A2A] shadow-lg shadow-[#FF6B35]/25">
              <BookOpen className="h-6 w-6 text-white" />
            </div>
            <CardTitle className={cn(
              "text-2xl font-bold",
              theme === 'dark' ? "text-white" : "text-[#121212]"
            )}>Getting Started</CardTitle>
          </div>
          <CardDescription className={cn(
            "text-lg",
            theme === 'dark' ? "text-[#B0B3B8]" : "text-[#4F5D75]"
          )}>
            Ready to automate your property with Bot Korp?
          </CardDescription>
        </CardHeader>
        <CardContent className="relative z-10">
          <ol className="space-y-5 mb-8">
            {[
              { title: 'Create an Account', desc: 'Sign up and set up your organization' },
              { title: 'Add Your Location', desc: 'Set up your property locations and areas' },
              { title: 'Configure Your Bots', desc: 'Add bots and assign them to your gardens or pools' },
              { title: 'Start Automating', desc: 'Set schedules and let your bots handle the rest' }
            ].map((step, idx) => (
              <li key={idx} className="flex gap-4 group">
                <span className={cn(
                  "flex-shrink-0 h-10 w-10 rounded-xl flex items-center justify-center text-base font-bold shadow-lg",
                  "bg-gradient-to-br from-[#FF6B35] to-[#E85A2A] text-white",
                  "transition-transform duration-300 group-hover:scale-110"
                )}>
                  {idx + 1}
                </span>
                <div className="pt-1">
                  <p className={cn(
                    "font-bold text-base mb-1",
                    theme === 'dark' ? "text-white" : "text-[#121212]"
                  )}>{step.title}</p>
                  <p className={cn(
                    "text-sm",
                    theme === 'dark' ? "text-[#B0B3B8]" : "text-[#4F5D75]"
                  )}>{step.desc}</p>
                </div>
              </li>
            ))}
          </ol>
          <Button 
            onClick={() => navigate('/auth/register')}
            className={cn(
              "gap-3 h-12 px-6 rounded-xl font-bold shadow-xl transition-all duration-300",
              "bg-gradient-to-r from-[#FF6B35] to-[#E85A2A] hover:from-[#E85A2A] hover:to-[#FF6B35]",
              "shadow-[#FF6B35]/25 hover:shadow-[#FF6B35]/40 hover:scale-105"
            )}
          >
            Get Started Now
            <ArrowRight className="h-5 w-5" />
          </Button>
        </CardContent>
      </Card>

      {/* Support */}
      <div className={cn(
        "border-t pt-10 space-y-6",
        theme === 'dark' ? "border-white/10" : "border-[#E5E7EB]"
      )}>
        <div className="flex items-center gap-3">
          <div className="h-1 w-12 bg-gradient-to-r from-[#4F5D75] to-transparent rounded-full" />
          <h2 className={cn(
            "text-3xl font-bold",
            theme === 'dark' ? "text-white" : "text-[#121212]"
          )}>Need Help?</h2>
        </div>
        <p className={cn(
          "text-lg",
          theme === 'dark' ? "text-[#B0B3B8]" : "text-[#4F5D75]"
        )}>
          Can't find what you're looking for? We're here to help.
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <Button 
            variant="outline" 
            onClick={() => navigate(`${basePath}/faq`)}
            className={cn(
              "gap-3 h-12 px-6 rounded-xl font-medium transition-all duration-300 hover:scale-105",
              theme === 'dark'
                ? "bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-[#FF6B35]/50"
                : "bg-[#4F5D75]/5 border-[#4F5D75]/20 text-[#121212] hover:bg-[#4F5D75]/10 hover:border-[#FF6B35]/50",
              "shadow-lg hover:shadow-xl"
            )}
          >
            <HelpCircle className="h-5 w-5" />
            View FAQ
          </Button>
          <Button 
            variant="outline" 
            onClick={() => window.location.href = 'mailto:support@botkorp.com'}
            className={cn(
              "gap-3 h-12 px-6 rounded-xl font-medium transition-all duration-300 hover:scale-105",
              theme === 'dark'
                ? "bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-[#FF6B35]/50"
                : "bg-[#4F5D75]/5 border-[#4F5D75]/20 text-[#121212] hover:bg-[#4F5D75]/10 hover:border-[#FF6B35]/50",
              "shadow-lg hover:shadow-xl"
            )}
          >
            <Bell className="h-5 w-5" />
            Contact Support
          </Button>
        </div>
      </div>
    </div>
  );
}

