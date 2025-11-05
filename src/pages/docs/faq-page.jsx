import React from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
import { Mail, HelpCircle, Sparkles } from 'lucide-react';

export default function FAQPage() {
  const { theme } = useTheme();
  const faqs = [
    {
      category: 'General',
      questions: [
        {
          q: 'What is Bot Korp?',
          a: 'Bot Korp is a comprehensive platform for managing autonomous robots that handle property maintenance tasks such as lawn mowing, pool cleaning, security monitoring, and weather tracking. We provide both the hardware (bots) and software (dashboard) to automate your property management.'
        },
        {
          q: 'How does Bot Korp work?',
          a: 'Bot Korp connects your autonomous bots to our cloud platform, allowing you to monitor and control them from anywhere. You can set schedules, receive alerts, view analytics, and manage multiple properties all from one dashboard.'
        },
        {
          q: 'What areas do you service?',
          a: 'Bot Korp currently operates in South Africa, with a focus on KwaZulu-Natal. Use our coverage search tool on the homepage to check if your area is serviced. We\'re constantly expanding to new regions.'
        },
        {
          q: 'Do I need technical knowledge to use Bot Korp?',
          a: 'No! Bot Korp is designed to be user-friendly and intuitive. Our bots handle the technical complexity, while you simply use the dashboard to set preferences and monitor operations. We also provide full installation and setup support.'
        }
      ]
    },
    {
      category: 'Bots & Services',
      questions: [
        {
          q: 'What types of bots do you offer?',
          a: 'We offer four types of bots: Mow Bots for autonomous lawn mowing, Pool Bots for automated pool cleaning, Security Bots for property surveillance, and Weather Stations for environmental monitoring. Each bot type can be customized to your specific needs.'
        },
        {
          q: 'Can I use multiple bots on one property?',
          a: 'Yes! You can have multiple bots of the same or different types on a single property. For example, you might have two Mow Bots for large garden areas and one Pool Bot for your pool. All bots are managed from the same dashboard.'
        },
        {
          q: 'How often do bots need maintenance?',
          a: 'Our bots are designed for reliability with minimal maintenance. Typically, bots need servicing every 90 days, which includes blade sharpening, sensor calibration, and software updates. You\'ll receive automatic reminders when maintenance is due.'
        },
        {
          q: 'What happens if a bot breaks down?',
          a: 'We offer comprehensive support for all hardware issues. If a bot malfunctions, our team will diagnose the issue remotely and dispatch a technician if needed. All repairs are covered under warranty, and we provide replacement bots for extended repairs.'
        },
        {
          q: 'Are the bots safe around children and pets?',
          a: 'Yes! All our bots are equipped with advanced safety sensors that detect obstacles, including children and pets. They will automatically stop or navigate around any detected obstacles. Mow Bots have emergency stop features and blade guards.'
        }
      ]
    },
    {
      category: 'Pricing & Subscription',
      questions: [
        {
          q: 'How much does Bot Korp cost?',
          a: 'Bot Korp operates on a subscription model with monthly billing. Pricing varies by bot type, property size, service frequency (bi-weekly or monthly), and region. Contact us for a customized quote based on your specific needs. No long-term commitment required - cancel anytime.'
        },
        {
          q: 'What\'s included in the subscription?',
          a: 'Your subscription includes the bot hardware, installation, software access, regular maintenance, firmware updates, technical support, and cloud storage for your data and analytics. There are no hidden fees.'
        },
        {
          q: 'Is there a setup fee?',
          a: 'Yes, there may be a one-time setup fee depending on your location and the complexity of installation. This covers initial site assessment, bot installation, boundary setup, and team training. The fee is clearly stated before you commit.'
        },
        {
          q: 'Can I cancel my subscription?',
          a: 'Yes, you can cancel your subscription at any time. Depending on your contract terms, you may need to give 30 days notice. The bot hardware must be returned in good condition, and you\'ll have access to your data for 90 days after cancellation.'
        },
        {
          q: 'Do you offer trial periods?',
          a: 'Yes! We offer a 30-day trial period for new customers. This allows you to experience Bot Korp risk-free. If you\'re not satisfied, you can cancel within the trial period for a full refund (excluding setup fees).'
        }
      ]
    },
    {
      category: 'Technical',
      questions: [
        {
          q: 'What internet connection do I need?',
          a: 'Bots require a stable WiFi connection to communicate with the platform. We recommend at least 5 Mbps upload/download speed. Some bots also support cellular connectivity as a backup option.'
        },
        {
          q: 'How is data stored and secured?',
          a: 'All data is encrypted in transit and at rest. We use industry-standard security practices and comply with data protection regulations. Your data is stored on secure cloud servers with regular backups. See our Privacy Policy for full details.'
        },
        {
          q: 'Can I access Bot Korp from my mobile device?',
          a: 'Yes! Bot Korp is fully responsive and works on all devices including smartphones and tablets. We\'re also developing dedicated iOS and Android apps for an even better mobile experience.'
        },
        {
          q: 'Does Bot Korp work offline?',
          a: 'Bots can continue operating based on their last programmed schedule if the internet connection is temporarily lost. However, real-time monitoring and control require an active internet connection. The platform will sync data once connectivity is restored.'
        },
        {
          q: 'How do I update my bot\'s software?',
          a: 'Software updates are automatic and happen over-the-air (OTA). You\'ll receive a notification before an update, and you can schedule it for a convenient time. Critical security updates may be applied automatically.'
        }
      ]
    },
    {
      category: 'Account & Team',
      questions: [
        {
          q: 'Can I have multiple users on one account?',
          a: 'Yes! You can invite team members to your organization and assign different roles and permissions. Owners and admins can manage bots, locations, and billing. Other roles have view-only or limited access.'
        },
        {
          q: 'How do I invite team members?',
          a: 'From the Members page in your portal, click "Invite Member", enter their email, and assign a role. They\'ll receive an invitation email with a link to accept. They can create an account or sign in if they already have one.'
        },
        {
          q: 'Can I manage multiple properties?',
          a: 'Yes! Bot Korp supports multiple locations under one organization. Each location can have its own set of bots, gardens, and pools. You can easily switch between locations in the dashboard.'
        },
        {
          q: 'How do I reset my password?',
          a: 'Click "Forgot Password" on the login page, enter your email, and you\'ll receive a password reset link. Follow the link to set a new password. For security, reset links expire after 24 hours.'
        }
      ]
    }
  ];

  return (
    <div className="max-w-4xl space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
      {/* Header */}
      <div className={cn(
        "relative space-y-6 pb-8 overflow-hidden rounded-3xl p-10",
        theme === 'dark'
          ? "bg-gradient-to-br from-[#1a1a1a] via-[#2a2a2a] to-[#1a1a1a] border border-white/5"
          : "bg-gradient-to-br from-white via-[#FAFAFA] to-white border border-[#E5E7EB]",
        "shadow-2xl shadow-[#4F5D75]/5"
      )}>
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#4F5D75]/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-[#FF6B35]/10 rounded-full blur-3xl" />
        
        <div className="relative z-10">
          <Badge 
            className={cn(
              "mb-4 px-4 py-1.5 rounded-full font-semibold shadow-lg",
              "bg-gradient-to-r from-[#4F5D75] to-[#6B7A94] text-white",
              "border-none"
            )}
          >
            <HelpCircle className="h-3 w-3 mr-1.5 inline" />
            Help Center
          </Badge>
          <h1 className={cn(
            "text-5xl md:text-6xl font-bold tracking-tight mb-4",
            "bg-gradient-to-r from-[#4F5D75] via-[#FF6B35] to-[#E85A2A] bg-clip-text text-transparent"
          )}>
            Frequently Asked Questions
          </h1>
          <p className={cn(
            "text-xl leading-relaxed",
            theme === 'dark' ? "text-[#B0B3B8]" : "text-[#4F5D75]"
          )}>
            Find answers to common questions about Bot Korp.
          </p>
        </div>
      </div>

      {/* FAQ Sections */}
      <div className="space-y-10">
        {faqs.map((category, catIdx) => (
          <div key={category.category} className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="h-1 w-12 bg-gradient-to-r from-[#FF6B35] to-transparent rounded-full" />
              <h2 className={cn(
                "text-3xl font-bold",
                theme === 'dark' ? "text-white" : "text-[#121212]"
              )}>{category.category}</h2>
            </div>
            <Accordion 
              type="single" 
              collapsible 
              className="space-y-3"
            >
              {category.questions.map((faq, index) => (
                <AccordionItem
                  key={index}
                  value={`${category.category}-${index}`}
                  className={cn(
                    "border rounded-2xl px-5 overflow-hidden transition-all duration-300",
                    theme === 'dark'
                      ? "bg-gradient-to-br from-[#1a1a1a] to-[#2a2a2a] border-white/10 hover:border-[#FF6B35]/50"
                      : "bg-gradient-to-br from-white to-[#FAFAFA] border-[#E5E7EB] hover:border-[#FF6B35]/50",
                    "shadow-lg hover:shadow-xl hover:shadow-[#FF6B35]/5",
                    "animate-in fade-in slide-in-from-bottom-4 duration-500",
                    `delay-${index * 100}`
                  )}
                >
                  <AccordionTrigger className={cn(
                    "text-left hover:no-underline py-5 transition-all",
                    theme === 'dark' ? "hover:text-[#FF6B35]" : "hover:text-[#FF6B35]"
                  )}>
                    <span className={cn(
                      "font-bold text-base pr-4",
                      theme === 'dark' ? "text-white" : "text-[#121212]"
                    )}>{faq.q}</span>
                  </AccordionTrigger>
                  <AccordionContent className={cn(
                    "text-base leading-relaxed pb-5",
                    theme === 'dark' ? "text-[#B0B3B8]" : "text-[#4F5D75]"
                  )}>
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        ))}
      </div>

      {/* Contact Card */}
      <Card className={cn(
        "relative overflow-hidden border-2 p-8 transition-all duration-500",
        theme === 'dark'
          ? "bg-gradient-to-br from-[#1a1a1a] via-[#2a2a2a] to-[#1a1a1a] border-[#4F5D75]/30"
          : "bg-gradient-to-br from-white via-[#FAFAFA] to-white border-[#4F5D75]/30",
        "shadow-2xl shadow-[#4F5D75]/10"
      )}>
        {/* Decorative background */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#4F5D75]/5 via-transparent to-[#FF6B35]/5" />
        
        <div className="relative z-10 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-[#4F5D75] to-[#6B7A94] shadow-lg">
              <HelpCircle className="h-6 w-6 text-white" />
            </div>
            <h3 className={cn(
              "text-2xl font-bold",
              theme === 'dark' ? "text-white" : "text-[#121212]"
            )}>Still have questions?</h3>
          </div>
          <p className={cn(
            "text-lg",
            theme === 'dark' ? "text-[#B0B3B8]" : "text-[#4F5D75]"
          )}>
            Can't find the answer you're looking for? Our support team is here to help.
          </p>
          <Button 
            onClick={() => window.location.href = 'mailto:support@botkorp.com'}
            className={cn(
              "gap-3 h-12 px-6 rounded-xl font-bold shadow-xl transition-all duration-300",
              "bg-gradient-to-r from-[#4F5D75] to-[#6B7A94] hover:from-[#6B7A94] hover:to-[#4F5D75]",
              "hover:scale-105"
            )}
          >
            <Mail className="h-5 w-5" />
            Contact Support
          </Button>
        </div>
      </Card>
    </div>
  );
}

