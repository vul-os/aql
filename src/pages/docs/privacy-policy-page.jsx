import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, Mail } from 'lucide-react';

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl space-y-8">
      {/* Header */}
      <div className="space-y-4">
        <Badge variant="secondary">Legal</Badge>
        <div className="flex items-center gap-3 mb-2">
          <Shield className="h-8 w-8 text-primary" />
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Privacy Policy
          </h1>
        </div>
        <p className="text-lg text-muted-foreground">
          Last updated: December 12, 2024
        </p>
      </div>

      <Alert>
        <AlertDescription>
          Your privacy is important to us. This Privacy Policy explains how Bot Korp collects, uses, and protects your personal information.
        </AlertDescription>
      </Alert>

      {/* Content */}
      <div className="prose prose-slate dark:prose-invert max-w-none space-y-8">
        <section>
          <h2 className="text-2xl font-bold mb-4">1. Introduction</h2>
          <p className="text-muted-foreground leading-relaxed">
            Welcome to Bot Korp ("we," "our," or "us"). We are committed to protecting your personal information and your right to privacy. This Privacy Policy explains what information we collect, how we use it, and what rights you have in relation to it.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-4">
            By using Bot Korp's services, you agree to the collection and use of information in accordance with this policy.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">2. Information We Collect</h2>
          
          <h3 className="text-xl font-semibold mt-6 mb-3">2.1 Personal Information</h3>
          <p className="text-muted-foreground leading-relaxed">
            We collect personal information that you provide to us, including:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground mt-3">
            <li>Name, email address, and phone number</li>
            <li>Billing and payment information</li>
            <li>Property addresses and location details</li>
            <li>Account credentials and preferences</li>
          </ul>

          <h3 className="text-xl font-semibold mt-6 mb-3">2.2 Bot Data</h3>
          <p className="text-muted-foreground leading-relaxed">
            Our bots collect operational data, including:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground mt-3">
            <li>Bot location, status, and telemetry data</li>
            <li>Garden and pool measurements and conditions</li>
            <li>Operational logs and maintenance records</li>
            <li>Images and sensor data from security bots (if applicable)</li>
          </ul>

          <h3 className="text-xl font-semibold mt-6 mb-3">2.3 Usage Data</h3>
          <p className="text-muted-foreground leading-relaxed">
            We automatically collect certain information when you use our services:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground mt-3">
            <li>IP address and device information</li>
            <li>Browser type and version</li>
            <li>Pages visited and time spent on the platform</li>
            <li>Actions taken within the dashboard</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">3. How We Use Your Information</h2>
          <p className="text-muted-foreground leading-relaxed">
            We use the collected information for various purposes:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground mt-3">
            <li><strong>Service Delivery:</strong> To provide, maintain, and improve our bot services</li>
            <li><strong>Customer Support:</strong> To respond to your inquiries and provide assistance</li>
            <li><strong>Billing:</strong> To process payments and manage subscriptions</li>
            <li><strong>Analytics:</strong> To analyze usage patterns and optimize our platform</li>
            <li><strong>Communications:</strong> To send service updates, maintenance notifications, and marketing (with your consent)</li>
            <li><strong>Security:</strong> To detect, prevent, and address technical issues and security threats</li>
            <li><strong>Legal Compliance:</strong> To comply with legal obligations and enforce our terms</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">4. Data Sharing and Disclosure</h2>
          <p className="text-muted-foreground leading-relaxed">
            We do not sell your personal information. We may share your information with:
          </p>
          
          <h3 className="text-xl font-semibold mt-6 mb-3">4.1 Service Providers</h3>
          <p className="text-muted-foreground leading-relaxed">
            Third-party companies that help us provide our services, such as:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground mt-3">
            <li>Cloud hosting providers (data storage and processing)</li>
            <li>Payment processors (billing and transactions)</li>
            <li>Email service providers (communications)</li>
            <li>Analytics providers (platform optimization)</li>
          </ul>

          <h3 className="text-xl font-semibold mt-6 mb-3">4.2 Legal Requirements</h3>
          <p className="text-muted-foreground leading-relaxed">
            We may disclose your information if required by law, court order, or government request, or to protect our rights and safety.
          </p>

          <h3 className="text-xl font-semibold mt-6 mb-3">4.3 Business Transfers</h3>
          <p className="text-muted-foreground leading-relaxed">
            If Bot Korp is involved in a merger, acquisition, or sale of assets, your information may be transferred. We will notify you before your information becomes subject to a different privacy policy.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">5. Data Security</h2>
          <p className="text-muted-foreground leading-relaxed">
            We implement appropriate technical and organizational measures to protect your personal information:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground mt-3">
            <li>Encryption of data in transit (TLS/SSL) and at rest</li>
            <li>Regular security audits and vulnerability assessments</li>
            <li>Access controls and authentication mechanisms</li>
            <li>Employee training on data protection practices</li>
            <li>Incident response and breach notification procedures</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mt-4">
            However, no method of transmission over the Internet or electronic storage is 100% secure. While we strive to use commercially acceptable means to protect your information, we cannot guarantee absolute security.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">6. Data Retention</h2>
          <p className="text-muted-foreground leading-relaxed">
            We retain your personal information for as long as necessary to:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground mt-3">
            <li>Provide our services to you</li>
            <li>Comply with legal, accounting, or reporting requirements</li>
            <li>Resolve disputes and enforce our agreements</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mt-4">
            When we no longer need your information, we will securely delete or anonymize it. You can request deletion of your data at any time (subject to legal retention requirements).
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">7. Your Privacy Rights</h2>
          <p className="text-muted-foreground leading-relaxed">
            Depending on your location, you may have the following rights:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground mt-3">
            <li><strong>Access:</strong> Request a copy of your personal information</li>
            <li><strong>Correction:</strong> Request correction of inaccurate data</li>
            <li><strong>Deletion:</strong> Request deletion of your personal information</li>
            <li><strong>Portability:</strong> Request transfer of your data to another service</li>
            <li><strong>Objection:</strong> Object to processing of your personal information</li>
            <li><strong>Restriction:</strong> Request restriction of processing your data</li>
            <li><strong>Withdraw Consent:</strong> Withdraw consent for data processing (where applicable)</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mt-4">
            To exercise these rights, please contact us at <a href="mailto:privacy@botkorp.com" className="text-primary hover:underline">privacy@botkorp.com</a>.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">8. Cookies and Tracking</h2>
          <p className="text-muted-foreground leading-relaxed">
            We use cookies and similar tracking technologies to enhance your experience. For detailed information about our use of cookies, please see our <a href="/docs/cookie-policy" className="text-primary hover:underline">Cookie Policy</a>.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">9. Third-Party Links</h2>
          <p className="text-muted-foreground leading-relaxed">
            Our platform may contain links to third-party websites or services. We are not responsible for the privacy practices of these third parties. We encourage you to read their privacy policies before providing any information.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">10. Children's Privacy</h2>
          <p className="text-muted-foreground leading-relaxed">
            Bot Korp's services are not intended for children under 18. We do not knowingly collect personal information from children. If you believe we have collected information from a child, please contact us immediately.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">11. International Data Transfers</h2>
          <p className="text-muted-foreground leading-relaxed">
            Your information may be transferred to and processed in countries other than your country of residence. We ensure appropriate safeguards are in place to protect your information in accordance with this Privacy Policy.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">12. Changes to This Privacy Policy</h2>
          <p className="text-muted-foreground leading-relaxed">
            We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the new policy on this page and updating the "Last updated" date. We encourage you to review this Privacy Policy periodically.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4">13. Contact Us</h2>
          <p className="text-muted-foreground leading-relaxed">
            If you have any questions about this Privacy Policy or our data practices, please contact us:
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
              <p className="text-muted-foreground">South Africa</p>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}

