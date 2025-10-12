import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
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
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function DocsLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navigation = [
    {
      title: 'Getting Started',
      items: [
        { title: 'Home', href: '/docs', icon: <Home className="h-4 w-4" /> },
        { title: 'FAQ', href: '/docs/faq', icon: <HelpCircle className="h-4 w-4" /> },
      ]
    },
    {
      title: 'Legal',
      items: [
        { title: 'Privacy Policy', href: '/docs/privacy-policy', icon: <Shield className="h-4 w-4" /> },
        { title: 'Terms of Service', href: '/docs/terms-of-service', icon: <FileText className="h-4 w-4" /> },
        { title: 'Cookie Policy', href: '/docs/cookie-policy', icon: <Cookie className="h-4 w-4" /> },
      ]
    }
  ];

  const isActive = (href) => {
    if (href === '/docs') {
      return location.pathname === '/docs' || location.pathname === '/docs/';
    }
    return location.pathname === href;
  };

  const Sidebar = ({ mobile = false }) => (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-4 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search docs..."
            className="pl-9"
            disabled
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-6">
        {navigation.map((section) => (
          <div key={section.title}>
            <h3 className="font-semibold text-sm text-muted-foreground mb-2 px-2">
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
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    )}
                  >
                    {item.icon}
                    <span>{item.title}</span>
                    {isActive(item.href) && (
                      <ChevronRight className="h-4 w-4 ml-auto" />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Back to Home */}
      <div className="p-4 border-t">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={() => {
            navigate('/');
            if (mobile) setMobileMenuOpen(false);
          }}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
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
              onClick={() => navigate('/')}
            >
              <Bot className="h-6 w-6 text-primary" />
              <span className="font-bold hidden sm:inline">Bot Korp</span>
              <span className="text-sm text-muted-foreground hidden md:inline">/ Docs</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => navigate('/')}>
              Home
            </Button>
            <Button onClick={() => navigate('/portal')}>
              Portal
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
          <Outlet />
        </main>
      </div>
    </div>
  );
}

