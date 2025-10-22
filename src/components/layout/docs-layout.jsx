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
  Scale
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
      "flex flex-col h-full",
      isPortalDocs && !mobile
        ? "bg-gradient-to-b from-secondary to-muted text-secondary-foreground"
        : ""
    )}>
      {/* Search */}
      <div className={cn("p-4 border-b",
        isPortalDocs ? "border-white/10" : "")}
      >
        <div className="relative">
          <Search className={cn("absolute left-3 top-3 h-4 w-4",
            isPortalDocs ? "text-white/70" : "text-muted-foreground")} />
          <Input
            placeholder="Search docs..."
            className={cn("pl-9",
              isPortalDocs ? "bg-white/10 border-white/10 text-white placeholder:text-white/60" : "")}
            disabled
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-6">
        {navigation.map((section) => (
          <div key={section.title}>
            <h3 className={cn("font-semibold text-sm mb-2 px-2",
              isPortalDocs ? "text-white/70" : "text-muted-foreground")}
            >
              {section.title}
            </h3>
            <ul className="space-y-1">
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link
                    to={item.href}
                    onClick={() => mobile && setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-2 py-2 rounded-lg text-sm transition-colors",
                      isActive(item.href)
                        ? (isPortalDocs ? "bg-white/15 text-white" : "bg-primary text-primary-foreground")
                        : (isPortalDocs ? "hover:bg-white/10 text-white/90" : "hover:bg-muted")
                    )}
                  >
                    {item.icon}
                    <span>{item.title}</span>
                    {isActive(item.href) && (
                      <ChevronRight className={cn("h-4 w-4 ml-auto", isPortalDocs ? "text-white/80" : "")} />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Back to Home */}
      <div className={cn("p-4 border-t", isPortalDocs ? "border-white/10" : "")}
      >
        <Button
          variant={isPortalDocs ? "secondary" : "outline"}
          className={cn("w-full justify-start gap-2",
            isPortalDocs ? "bg-white/10 text-white hover:bg-white/15" : "")}
          onClick={() => {
            navigate(isPortalDocs ? '/portal' : '/');
            if (mobile) setMobileMenuOpen(false);
          }}
        >
          <ArrowLeft className="h-4 w-4" />
          {isPortalDocs ? 'Back to Portal' : 'Back to Home'}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className={cn(
        "sticky top-0 z-50 border-b backdrop-blur supports-[backdrop-filter]:bg-background/60",
        isPortalDocs
          ? "bg-gradient-to-r from-primary/10 to-background dark:from-secondary dark:to-muted/80"
          : "bg-background/95"
      )}>
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Mobile Menu */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild className="lg:hidden">
                <Button variant="ghost" size="icon">
                  <Menu className="h-6 w-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-72">
                <Sidebar mobile />
              </SheetContent>
            </Sheet>

            {/* Logo */}
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => navigate(isPortalDocs ? '/portal' : '/')}
            >
              <Bot className={cn("h-6 w-6",
                isPortalDocs ? "text-primary dark:text-primary" : "text-primary")} />
              <span className="font-bold hidden sm:inline">Bot Korp</span>
              <span className="text-sm text-muted-foreground hidden md:inline">/ Docs</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {/* Theme toggle */}
            <div className="hidden sm:flex items-center gap-2 pr-2 border-r">
              {theme === 'dark' ? (
                <Moon className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Sun className="h-4 w-4 text-muted-foreground" />
              )}
              <Switch
                id="docs-dark-mode"
                checked={theme === 'dark'}
                onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
              />
            </div>

            {!isPortalDocs && (
              <Button variant="ghost" onClick={() => navigate('/')}>Home</Button>
            )}
            <Button onClick={() => navigate(isPortalDocs ? '/portal' : '/portal')} className="gap-2">
              <LayoutDashboard className="h-4 w-4" />
              {isPortalDocs ? 'Portal' : 'Portal'}
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 flex">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:block w-64 flex-shrink-0 sticky top-16 h-[calc(100vh-4rem)]">
          <Sidebar />
        </aside>

        {/* Main Content */}
        <main className="flex-1 lg:pl-8 py-8 min-w-0">
          {/* Breadcrumbs */}
          {location.pathname !== basePath && location.pathname !== `${basePath}/` && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
              <Link 
                to={basePath} 
                className="hover:text-foreground transition-colors"
              >
                Documentation
              </Link>
              <ChevronRight className="h-4 w-4" />
              <span className="text-foreground">{getCurrentPageTitle()}</span>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

