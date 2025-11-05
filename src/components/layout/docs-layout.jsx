import React, { useMemo, useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useTheme } from '@/components/theme-provider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Bot,
  Menu,
  Home,
  HelpCircle,
  Shield,
  Cookie,
  FileText,
  Search,
  ArrowLeft,
  ChevronRight,
  LayoutDashboard,
  Sun,
  Moon,
  BookOpen,
  Scale,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function DocsLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  // Detect whether we're rendering under the client portal
  const isPortalDocs = location.pathname.startsWith('/portal/docs');
  const basePath = isPortalDocs ? '/portal/docs' : '/docs';

  const navigation = useMemo(() => ([
    {
      title: 'Getting Started',
      items: [
        { title: 'Documentation Home', href: `${basePath}` , icon: <Home className="h-4 w-4" /> },
        { title: 'Onboarding Guide', href: `${basePath}/onboarding-guide`, icon: <BookOpen className="h-4 w-4" /> },
        { title: 'FAQ', href: `${basePath}/faq`, icon: <HelpCircle className="h-4 w-4" /> },
      ]
    },
    {
      title: 'Legal & Terms',
      items: [
        { title: 'Bot Rental Terms', href: `${basePath}/bot-rental-terms`, icon: <Scale className="h-4 w-4" /> },
        { title: 'Terms of Service', href: `${basePath}/terms-of-service`, icon: <FileText className="h-4 w-4" /> },
        { title: 'Privacy Policy', href: `${basePath}/privacy-policy`, icon: <Shield className="h-4 w-4" /> },
        { title: 'Cookie Policy', href: `${basePath}/cookie-policy`, icon: <Cookie className="h-4 w-4" /> },
      ]
    }
  ]), [basePath]);

  const isActive = (href) => {
    if (href === basePath) {
      return location.pathname === basePath || location.pathname === `${basePath}/`;
    }
    return location.pathname === href;
  };

  // Get current page title for breadcrumbs
  const getCurrentPageTitle = () => {
    for (const section of navigation) {
      for (const item of section.items) {
        if (isActive(item.href)) {
          return item.title;
        }
      }
    }
    return 'Documentation';
  };

  const Sidebar = ({ mobile = false }) => (
    <div className={cn(
      "flex flex-col h-full backdrop-blur-xl rounded-2xl overflow-hidden",
      theme === 'dark'
        ? "bg-gradient-to-br from-[#1a1a1a]/95 via-[#2a2a2a]/90 to-[#1a1a1a]/95 shadow-2xl shadow-[#FF6B35]/5"
        : "bg-gradient-to-br from-white/95 via-[#FAFAFA]/90 to-white/95 shadow-2xl shadow-slate-200/50",
      !mobile && "border border-white/10 dark:border-white/5"
    )}>
      {/* Decorative gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#FF6B35]/5 via-transparent to-[#4F5D75]/5 pointer-events-none" />
      
      {/* Search */}
      <div className="relative p-5 border-b border-white/10 dark:border-white/5">
        <div className="relative group">
          <Search className={cn(
            "absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 transition-colors",
            theme === 'dark' ? "text-[#B0B3B8]" : "text-[#4F5D75]"
          )} />
          <Input
            placeholder="Search documentation..."
            className={cn(
              "pl-10 h-11 rounded-xl font-medium transition-all duration-300",
              "shadow-inner",
              theme === 'dark'
                ? "bg-[#121212]/50 border-white/10 text-white placeholder:text-[#B0B3B8] focus:border-[#FF6B35]/50 focus:ring-[#FF6B35]/20"
                : "bg-white/80 border-[#E5E7EB] text-[#121212] placeholder:text-[#4F5D75]/60 focus:border-[#FF6B35]/50 focus:ring-[#FF6B35]/20",
              "focus:shadow-lg focus:shadow-[#FF6B35]/10"
            )}
            disabled
          />
          <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#FF6B35]/0 via-[#FF6B35]/5 to-[#4F5D75]/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-8 scrollbar-thin scrollbar-thumb-[#4F5D75]/20 scrollbar-track-transparent">
        {navigation.map((section, idx) => (
          <div key={section.title} className="relative">
            {/* Section decorator */}
            <div className="absolute -left-2 top-0 w-1 h-6 bg-gradient-to-b from-[#FF6B35] to-[#FF6B35]/0 rounded-full" />
            
            <h3 className={cn(
              "font-bold text-xs uppercase tracking-wider mb-3 px-3 flex items-center gap-2",
              theme === 'dark' ? "text-[#B0B3B8]" : "text-[#4F5D75]"
            )}>
              <Sparkles className="h-3 w-3 text-[#FF6B35]" />
              {section.title}
            </h3>
            <ul className="space-y-1.5">
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      to={item.href}
                      onClick={() => mobile && setMobileMenuOpen(false)}
                      className={cn(
                        "group relative flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-medium transition-all duration-300",
                        "hover:translate-x-1",
                        active
                          ? theme === 'dark'
                            ? "bg-gradient-to-r from-[#FF6B35] to-[#E85A2A] text-white shadow-lg shadow-[#FF6B35]/25"
                            : "bg-gradient-to-r from-[#FF6B35] to-[#E85A2A] text-white shadow-lg shadow-[#FF6B35]/25"
                          : theme === 'dark'
                            ? "text-[#FAFAFA] hover:bg-white/5 hover:shadow-md"
                            : "text-[#121212] hover:bg-[#4F5D75]/5 hover:shadow-md"
                      )}
                    >
                      {/* Glow effect for active item */}
                      {active && (
                        <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#FF6B35]/20 to-[#E85A2A]/20 blur-xl" />
                      )}
                      
                      <div className={cn(
                        "relative z-10 transition-transform duration-300",
                        active ? "scale-110" : "group-hover:scale-110"
                      )}>
                        {item.icon}
                      </div>
                      <span className="relative z-10 flex-1">{item.title}</span>
                      {active && (
                        <ChevronRight className="relative z-10 h-4 w-4 animate-pulse" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Back to Home */}
      <div className="relative p-4 border-t border-white/10 dark:border-white/5 bg-gradient-to-t from-black/5 to-transparent">
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start gap-3 h-11 rounded-xl font-medium transition-all duration-300",
            "hover:translate-y-[-2px] hover:shadow-lg group",
            theme === 'dark'
              ? "bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-[#FF6B35]/50"
              : "bg-[#4F5D75]/5 border-[#4F5D75]/20 text-[#121212] hover:bg-[#4F5D75]/10 hover:border-[#FF6B35]/50"
          )}
          onClick={() => {
            navigate(isPortalDocs ? '/portal' : '/');
            if (mobile) setMobileMenuOpen(false);
          }}
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
          {isPortalDocs ? 'Back to Portal' : 'Back to Home'}
        </Button>
      </div>
    </div>
  );

  return (
    <div className={cn(
      "min-h-screen transition-colors duration-300",
      theme === 'dark'
        ? "bg-gradient-to-br from-[#121212] via-[#1a1a1a] to-[#121212]"
        : "bg-gradient-to-br from-[#FAFAFA] via-white to-[#FAFAFA]"
    )}>
      {/* Background decorative elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 right-20 w-96 h-96 bg-[#FF6B35]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-20 w-96 h-96 bg-[#4F5D75]/5 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header className={cn(
        "sticky top-0 z-50 backdrop-blur-xl border-b transition-all duration-300",
        theme === 'dark'
          ? "bg-[#121212]/80 border-white/10 shadow-lg shadow-black/20"
          : "bg-white/80 border-[#E5E7EB] shadow-lg shadow-slate-200/50"
      )}>
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Mobile Menu */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild className="lg:hidden">
                <Button 
                  variant="ghost" 
                  size="icon"
                  className={cn(
                    "rounded-xl transition-all duration-300",
                    theme === 'dark'
                      ? "hover:bg-white/10"
                      : "hover:bg-[#4F5D75]/10"
                  )}
                >
                  <Menu className="h-6 w-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-80 border-none">
                <Sidebar mobile />
              </SheetContent>
            </Sheet>

            {/* Logo */}
            <div
              className="flex items-center gap-2 cursor-pointer group"
              onClick={() => navigate(isPortalDocs ? '/portal' : '/')}
            >
              <div className={cn(
                "p-2 rounded-xl transition-all duration-300",
                theme === 'dark'
                  ? "bg-gradient-to-br from-[#FF6B35] to-[#E85A2A] shadow-lg shadow-[#FF6B35]/25"
                  : "bg-gradient-to-br from-[#FF6B35] to-[#E85A2A] shadow-lg shadow-[#FF6B35]/25"
              )}>
                <Bot className="h-5 w-5 text-white" />
              </div>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "font-bold text-lg hidden sm:inline transition-colors",
                  theme === 'dark' ? "text-white" : "text-[#121212]"
                )}>Bot Korp</span>
                <span className={cn(
                  "text-sm font-medium hidden md:inline",
                  theme === 'dark' ? "text-[#B0B3B8]" : "text-[#4F5D75]"
                )}>/ Documentation</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {/* Theme toggle */}
            <div className={cn(
              "hidden sm:flex items-center gap-3 px-4 py-2 rounded-xl transition-all duration-300",
              theme === 'dark'
                ? "bg-white/5 border border-white/10"
                : "bg-[#4F5D75]/5 border border-[#4F5D75]/20"
            )}>
              {theme === 'dark' ? (
                <Moon className="h-4 w-4 text-[#B0B3B8]" />
              ) : (
                <Sun className="h-4 w-4 text-[#FF6B35]" />
              )}
              <Switch
                id="docs-dark-mode"
                checked={theme === 'dark'}
                onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
                className="data-[state=checked]:bg-[#FF6B35]"
              />
            </div>

            {!isPortalDocs && (
              <Button 
                variant="ghost" 
                onClick={() => navigate('/')}
                className={cn(
                  "rounded-xl font-medium transition-all duration-300",
                  theme === 'dark'
                    ? "hover:bg-white/10"
                    : "hover:bg-[#4F5D75]/10"
                )}
              >
                Home
              </Button>
            )}
            <Button 
              onClick={() => navigate(isPortalDocs ? '/portal' : '/portal')} 
              className={cn(
                "gap-2 rounded-xl font-medium shadow-lg transition-all duration-300 hover:scale-105",
                "bg-gradient-to-r from-[#FF6B35] to-[#E85A2A] hover:from-[#E85A2A] hover:to-[#FF6B35]",
                "shadow-[#FF6B35]/25 hover:shadow-[#FF6B35]/40"
              )}
            >
              <LayoutDashboard className="h-4 w-4" />
              Portal
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 flex relative">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:block w-72 flex-shrink-0 sticky top-20 h-[calc(100vh-5rem)] py-6">
          <Sidebar />
        </aside>

        {/* Main Content */}
        <main className={cn(
          "flex-1 lg:pl-10 py-8 min-w-0 relative",
          "animate-in fade-in slide-in-from-bottom-4 duration-700"
        )}>
          {/* Breadcrumbs */}
          {location.pathname !== basePath && location.pathname !== `${basePath}/` && (
            <div className={cn(
              "flex items-center gap-2 text-sm mb-8 p-3 rounded-xl transition-all duration-300",
              theme === 'dark'
                ? "bg-white/5 text-[#B0B3B8]"
                : "bg-[#4F5D75]/5 text-[#4F5D75]"
            )}>
              <Home className="h-4 w-4" />
              <Link 
                to={basePath} 
                className={cn(
                  "font-medium transition-colors duration-300",
                  theme === 'dark'
                    ? "hover:text-[#FF6B35]"
                    : "hover:text-[#FF6B35]"
                )}
              >
                Documentation
              </Link>
              <ChevronRight className="h-4 w-4" />
              <span className={cn(
                "font-semibold",
                theme === 'dark' ? "text-white" : "text-[#121212]"
              )}>{getCurrentPageTitle()}</span>
            </div>
          )}
          
          {/* Content wrapper with soft shadow */}
          <div className={cn(
            "rounded-2xl transition-all duration-300",
            theme === 'dark'
              ? "bg-gradient-to-br from-[#1a1a1a]/50 to-[#2a2a2a]/30 backdrop-blur-sm"
              : "bg-white/50 backdrop-blur-sm"
          )}>
            <div className="p-8">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

