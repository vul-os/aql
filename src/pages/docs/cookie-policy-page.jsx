import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Cookie, Mail } from 'lucide-react';

export default function CookiePolicyPage() {
  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-4">
        <Badge variant="secondary">Legal</Badge>
        <div className="flex items-center gap-3 mb-2">
          <Cookie className="h-8 w-8 text-primary" />
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Cookie Policy
          </h1>
        </div>
        <p className="text-lg text-muted-foreground">
          Last updated: December 12, 2024
        </p>
      </div>

      <Alert>
        <AlertDescription>
          This Cookie Policy explains how Bot Korp uses cookies and similar tracking technologies.
        </AlertDescription>
      </Alert>

      <div className="prose prose-slate dark:prose-invert max-w-none space-y-8">
        <section>
          <h2 className="text-2xl font-bold mb-4">1. What Are Cookies?</h2>
          <p className="text-muted-foreground leading-relaxed">
            Cookies are small text files that are stored on your computer or mobile device when you visit a website. They are widely used to make websites work more efficiently and provide information to website owners.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">2. How We Use Cookies</h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            Bot Korp uses cookies to:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Keep you signed in to your account</li>
            <li>Remember your preferences and settings</li>
            <li>Understand how you use our platform</li>
            <li>Improve our services and user experience</li>
            <li>Provide personalized content and features</li>
            <li>Analyze platform performance and usage</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">3. Types of Cookies We Use</h2>
          
          <h3 className="text-xl font-semibold mt-6 mb-3">3.1 Essential Cookies</h3>
          <p className="text-muted-foreground leading-relaxed">
            These cookies are necessary for the website to function properly. They enable core functionality such as security, authentication, and accessibility. You cannot opt-out of these cookies.
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground mt-3">
            <li><strong>Session cookies:</strong> Keep you logged in during your session</li>
            <li><strong>Authentication cookies:</strong> Verify your identity</li>
            <li><strong>Security cookies:</strong> Protect against fraud and abuse</li>
          </ul>

          <h3 className="text-xl font-semibold mt-6 mb-3">3.2 Preference Cookies</h3>
          <p className="text-muted-foreground leading-relaxed">
            These cookies remember your settings and preferences to provide a personalized experience.
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground mt-3">
            <li><strong>Theme preference:</strong> Remember your dark/light mode choice</li>
            <li><strong>Language settings:</strong> Store your language preference</li>
            <li><strong>Dashboard layout:</strong> Remember your customizations</li>
          </ul>

          <h3 className="text-xl font-semibold mt-6 mb-3">3.3 Analytics Cookies</h3>
          <p className="text-muted-foreground leading-relaxed">
            These cookies help us understand how visitors interact with our website by collecting anonymous information.
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground mt-3">
            <li><strong>Usage analytics:</strong> Track page views and user flows</li>
            <li><strong>Performance monitoring:</strong> Identify technical issues</li>
            <li><strong>Feature usage:</strong> Understand which features are most popular</li>
          </ul>

          <h3 className="text-xl font-semibold mt-6 mb-3">3.4 Marketing Cookies</h3>
          <p className="text-muted-foreground leading-relaxed">
            These cookies track your browsing activity to deliver relevant advertising (with your consent).
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">4. Third-Party Cookies</h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            We use services from trusted third parties that may also set cookies. These include:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li><strong>Analytics providers:</strong> Google Analytics (anonymous usage data)</li>
            <li><strong>Payment processors:</strong> Secure payment handling</li>
            <li><strong>Cloud services:</strong> Platform hosting and data storage</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">5. Cookie Duration</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li><strong>Session cookies:</strong> Deleted when you close your browser</li>
            <li><strong>Persistent cookies:</strong> Remain until expiration date or manual deletion</li>
            <li>Our persistent cookies typically last between 30 days to 2 years</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">6. Managing Cookies</h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            You have several options for managing cookies:
          </p>
          
          <h3 className="text-xl font-semibold mt-6 mb-3">6.1 Browser Settings</h3>
          <p className="text-muted-foreground leading-relaxed">
            Most web browsers allow you to control cookies through their settings. You can:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground mt-3">
            <li>View what cookies are stored and delete them individually</li>
            <li>Block third-party cookies</li>
            <li>Block all cookies from specific websites</li>
            <li>Block all cookies (may affect website functionality)</li>
            <li>Delete all cookies when you close your browser</li>
          </ul>

          <h3 className="text-xl font-semibold mt-6 mb-3">6.2 Platform Settings</h3>
          <p className="text-muted-foreground leading-relaxed">
            Within Bot Korp, you can manage certain cookie preferences in your account settings. However, disabling essential cookies may prevent you from using parts of our service.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">7. Do Not Track</h2>
          <p className="text-muted-foreground leading-relaxed">
            Some browsers have a "Do Not Track" feature that signals websites you visit that you do not want your online activity tracked. Bot Korp currently does not respond to Do Not Track signals.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">8. Changes to This Cookie Policy</h2>
          <p className="text-muted-foreground leading-relaxed">
            We may update this Cookie Policy from time to time to reflect changes in technology, legislation, or our business practices. We will notify you of any significant changes by posting the new policy on this page.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">9. More Information</h2>
          <p className="text-muted-foreground leading-relaxed">
            For more information about cookies and how they work, visit:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground mt-3">
            <li><a href="https://www.allaboutcookies.org" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">All About Cookies</a></li>
            <li><a href="https://www.youronlinechoices.eu" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Your Online Choices</a></li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">10. Contact Us</h2>
          <p className="text-muted-foreground leading-relaxed">
            If you have questions about our use of cookies:
          </p>
          <Card className="p-6 mt-4 bg-muted/50">
            <div className="space-y-2">
              <p className="font-semibold">Bot Korp Privacy Team</p>
              <p className="text-muted-foreground flex items-center gap-2">
                <Mail className="h-4 w-4" />
                <a href="mailto:privacy@botkorp.com" className="text-primary hover:underline">
                  privacy@botkorp.com
                </a>
              </p>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}

