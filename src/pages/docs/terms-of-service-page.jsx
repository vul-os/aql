import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FileText, Mail } from 'lucide-react';

export default function TermsOfServicePage() {
  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-4">
        <Badge variant="secondary">Legal</Badge>
        <div className="flex items-center gap-3 mb-2">
          <FileText className="h-8 w-8 text-primary" />
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Terms of Service
          </h1>
        </div>
        <p className="text-lg text-muted-foreground">
          Last updated: December 12, 2024
        </p>
      </div>

      <Alert>
        <AlertDescription>
          Please read these Terms of Service carefully before using Bot Korp's services.
        </AlertDescription>
      </Alert>

      <div className="prose prose-slate dark:prose-invert max-w-none space-y-8">
        <section>
          <h2 className="text-2xl font-bold mb-4">1. Acceptance of Terms</h2>
          <p className="text-muted-foreground leading-relaxed">
            By accessing or using Bot Korp's services, you agree to be bound by these Terms of Service and all applicable laws and regulations. If you do not agree with any of these terms, you are prohibited from using our services.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">2. Description of Service</h2>
          <p className="text-muted-foreground leading-relaxed">
            Bot Korp provides autonomous robot management services for property maintenance, including lawn mowing, pool cleaning, security monitoring, and weather tracking. Our service includes hardware (bots), software (platform), and support services.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">3. User Accounts</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>You must create an account to use our services</li>
            <li>You are responsible for maintaining the security of your account</li>
            <li>You must provide accurate and complete information</li>
            <li>You must be at least 18 years old to create an account</li>
            <li>One person or entity may not maintain more than one account</li>
            <li>You are responsible for all activities under your account</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">4. Subscription and Payment</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Services are provided on a subscription basis</li>
            <li>Payment is due in advance based on your chosen billing cycle</li>
            <li>Prices are subject to change with 30 days notice</li>
            <li>You authorize recurring charges to your payment method</li>
            <li>Refunds are provided according to our refund policy</li>
            <li>Failure to pay may result in service suspension</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">5. Hardware and Equipment</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Bot hardware remains the property of Bot Korp</li>
            <li>You are responsible for the care and security of the equipment</li>
            <li>Damage or loss may result in replacement fees</li>
            <li>Equipment must be returned upon subscription termination</li>
            <li>You must not modify, tamper with, or misuse the equipment</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">6. Use of Service</h2>
          <p className="text-muted-foreground leading-relaxed mb-3">You agree not to:</p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Use the service for any illegal purpose</li>
            <li>Violate any laws in your jurisdiction</li>
            <li>Infringe on intellectual property rights</li>
            <li>Transmit malicious code or viruses</li>
            <li>Attempt to gain unauthorized access to systems</li>
            <li>Interfere with or disrupt the service</li>
            <li>Impersonate any person or entity</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">7. Intellectual Property</h2>
          <p className="text-muted-foreground leading-relaxed">
            All content, software, and technology used in Bot Korp's services are the property of Bot Korp or its licensors. You may not copy, modify, distribute, sell, or lease any part of our services without explicit permission.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">8. Warranties and Disclaimers</h2>
          <p className="text-muted-foreground leading-relaxed mb-3">
            Our services are provided "as is" without warranties of any kind. We do not warrant that:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>The service will be uninterrupted or error-free</li>
            <li>Bots will operate perfectly at all times</li>
            <li>All errors or defects will be corrected</li>
            <li>The service will meet all your requirements</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">9. Limitation of Liability</h2>
          <p className="text-muted-foreground leading-relaxed">
            To the maximum extent permitted by law, Bot Korp shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">10. Indemnification</h2>
          <p className="text-muted-foreground leading-relaxed">
            You agree to indemnify and hold Bot Korp harmless from any claims, damages, losses, or expenses (including legal fees) arising from your use of the service or violation of these terms.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">11. Termination</h2>
          <p className="text-muted-foreground leading-relaxed">
            We may terminate or suspend your account and access to services immediately, without prior notice, for any breach of these Terms. Upon termination, your right to use the service will immediately cease.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">12. Changes to Terms</h2>
          <p className="text-muted-foreground leading-relaxed">
            We reserve the right to modify these terms at any time. Material changes will be notified via email or through the platform. Continued use of services after changes constitutes acceptance of new terms.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">13. Governing Law</h2>
          <p className="text-muted-foreground leading-relaxed">
            These Terms shall be governed by the laws of South Africa, without regard to conflict of law provisions. Any disputes shall be resolved in the courts of South Africa.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">14. Contact Information</h2>
          <p className="text-muted-foreground leading-relaxed">
            For questions about these Terms of Service:
          </p>
          <Card className="p-6 mt-4 bg-muted/50">
            <div className="space-y-2">
              <p className="font-semibold">Bot Korp Legal Team</p>
              <p className="text-muted-foreground flex items-center gap-2">
                <Mail className="h-4 w-4" />
                <a href="mailto:legal@botkorp.com" className="text-primary hover:underline">
                  legal@botkorp.com
                </a>
              </p>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}

