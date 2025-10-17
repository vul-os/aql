import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, FileText, Eye, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/auth-context';

export default function BotRentalTerms() {
  const { user } = useAuth();
  const [agreement, setAgreement] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAgreement();
  }, [user]);

  const loadAgreement = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      // Get user's most recent active agreement
      const { data, error } = await supabase
        .from('rental_agreements')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!error && data) {
        setAgreement(data);
      }
    } catch (error) {
      console.error('Error loading agreement:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (agreement?.agreement_pdf_url) {
      const a = document.createElement('a');
      a.href = agreement.agreement_pdf_url;
      a.download = `${agreement.agreement_number}.pdf`;
      a.click();
    }
  };

  const handleView = () => {
    if (agreement?.agreement_pdf_url) {
      window.open(agreement.agreement_pdf_url, '_blank');
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header with Download */}
      <Card className="border-2 border-primary/20">
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-6 w-6 text-primary" />
                <h1 className="text-2xl md:text-3xl font-bold">Bot Rental Terms of Service</h1>
              </div>
              <p className="text-muted-foreground">
                Complete terms and conditions for BotKorp bot rental services
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Last updated: October 17, 2025
              </p>
            </div>
            {loading ? (
              <Button disabled className="gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </Button>
            ) : agreement?.agreement_pdf_url ? (
              <div className="flex gap-2">
                <Button onClick={handleView} variant="outline" className="gap-2">
                  <Eye className="h-4 w-4" />
                  View My Agreement
                </Button>
                <Button onClick={handleDownload} className="gap-2">
                  <Download className="h-4 w-4" />
                  Download PDF
                </Button>
              </div>
            ) : user ? (
              <Badge variant="outline" className="px-4 py-2">
                No active agreement
              </Badge>
            ) : (
              <Badge variant="outline" className="px-4 py-2">
                Sign in to view your agreement
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Printable Content */}
      <div className="bg-white p-8 rounded-lg print:p-0">
        <div className="space-y-8">
          {/* Title for Print */}
          <div className="text-center mb-8 print:block hidden">
            <h1 className="text-3xl font-bold mb-2">BotKorp Bot Rental Terms of Service</h1>
            <p className="text-muted-foreground">BotKorp (Pty) Ltd</p>
            <p className="text-sm text-muted-foreground">
              A member of Exolution Technologies (Pty) Ltd
            </p>
            <p className="text-sm text-muted-foreground">Last updated: October 17, 2025</p>
          </div>

          {/* 1. Introduction */}
          <section>
            <h2 className="text-2xl font-bold mb-4 text-primary">1. Introduction and Acceptance</h2>
            <div className="space-y-4 text-muted-foreground">
              <p>
                These Bot Rental Terms of Service ("Terms") constitute a binding legal agreement between you ("Customer," "you," or "your") and BotKorp (Pty) Ltd, registration number 2024/567890/07, a member of Exolution Technologies (Pty) Ltd ("BotKorp," "we," "us," or "our").
              </p>
              <p>
                By signing a rental agreement, using our services, or allowing installation of our equipment on your property, you acknowledge that you have read, understood, and agree to be bound by these Terms, our Privacy Policy, and all applicable laws and regulations of the Republic of South Africa.
              </p>
              <p>
                <strong>If you do not agree to these Terms, you may not use our services or rent our equipment.</strong>
              </p>
            </div>
          </section>

          {/* 2. Definitions */}
          <section>
            <h2 className="text-2xl font-bold mb-4 text-primary">2. Definitions</h2>
            <div className="space-y-3 text-muted-foreground">
              <p><strong>"Bot"</strong> means any autonomous robotic equipment provided by BotKorp, including but not limited to lawn mowing bots, pool cleaning bots, security bots, and weather stations.</p>
              <p><strong>"Equipment"</strong> includes the Bot and all associated hardware, boundary wire, charging station, accessories, and components provided as part of the rental service.</p>
              <p><strong>"Service"</strong> means the rental of Equipment and provision of maintenance, support, and scheduled service visits as specified in your rental agreement.</p>
              <p><strong>"Service Visit"</strong> means a scheduled visit by BotKorp technicians for maintenance, battery swap, edge trimming, or other services as outlined in your service plan.</p>
              <p><strong>"Rental Agreement"</strong> means the specific contract executed between you and BotKorp detailing the services, pricing, schedule, and property location.</p>
              <p><strong>"Installation"</strong> means the initial setup of Equipment at your property, including boundary wire installation, Bot configuration, and customer training.</p>
            </div>
          </section>

          {/* 3. Rental Terms */}
          <section>
            <h2 className="text-2xl font-bold mb-4 text-primary">3. Rental Terms and Duration</h2>
            <div className="space-y-4 text-muted-foreground">
              <h3 className="text-lg font-semibold text-foreground mt-6">3.1 Rental Period</h3>
              <p>
                The rental is on a month-to-month basis with no fixed end date unless otherwise specified in writing. Either party may terminate the agreement with thirty (30) days written notice.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">3.2 Ownership</h3>
              <p>
                All Equipment remains the sole and exclusive property of BotKorp at all times. Customer acquires no ownership rights or interests in the Equipment. The Equipment may not be sold, pledged, mortgaged, or otherwise encumbered by Customer.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">3.3 Use Restrictions</h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>Equipment may only be used at the property address specified in the Rental Agreement</li>
                <li>Equipment must be used solely for its intended purpose as a lawn maintenance, pool cleaning, security, or weather monitoring device</li>
                <li>Equipment may not be relocated to another property without written consent from BotKorp</li>
                <li>Customer may not modify, disassemble, reverse engineer, or tamper with the Equipment</li>
                <li>Equipment may not be used for commercial purposes unless specifically agreed in writing</li>
              </ul>

              <h3 className="text-lg font-semibold text-foreground mt-6">3.4 Geographic Limitations</h3>
              <p>
                Services are only provided within BotKorp's designated service areas. Customer acknowledges that service may be suspended if the property is outside our service coverage area.
              </p>
            </div>
          </section>

          {/* 4. Fees and Payment */}
          <section>
            <h2 className="text-2xl font-bold mb-4 text-primary">4. Fees and Payment</h2>
            <div className="space-y-4 text-muted-foreground">
              <h3 className="text-lg font-semibold text-foreground mt-6">4.1 Rental Fees</h3>
              <p>
                Monthly rental fees are specified in your Rental Agreement and include:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Bot rental fee: R150 per Bot per month</li>
                <li>Service visit fees: R150 per visit, frequency as selected</li>
                <li>All maintenance and repairs (excluding damage caused by misuse)</li>
                <li>Software updates and technical support</li>
              </ul>

              <h3 className="text-lg font-semibold text-foreground mt-6">4.2 One-Time Fees</h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>Setup fee: R450 for first Bot, R200 for each additional Bot</li>
                <li>Refundable deposit: R500 per Bot</li>
              </ul>

              <h3 className="text-lg font-semibold text-foreground mt-6">4.3 Payment Terms</h3>
              <p>
                All fees are payable in South African Rand (ZAR). Monthly fees are due on the billing date specified in your Rental Agreement. Customer authorizes BotKorp to automatically charge the payment method on file.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">4.4 Late Payment</h3>
              <p>
                Late payments may incur a fee of R100 per week. Failure to pay for thirty (30) days may result in service suspension and Equipment retrieval.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">4.5 Price Changes</h3>
              <p>
                BotKorp reserves the right to adjust prices with sixty (60) days written notice. Customer may terminate the agreement if they do not accept the price increase.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">4.6 Deposit Refund</h3>
              <p>
                The deposit will be refunded within fourteen (14) business days after Equipment return, less any deductions for damage, missing parts, or outstanding fees.
              </p>
            </div>
          </section>

          {/* 5. Installation */}
          <section>
            <h2 className="text-2xl font-bold mb-4 text-primary">5. Installation and Setup</h2>
            <div className="space-y-4 text-muted-foreground">
              <h3 className="text-lg font-semibold text-foreground mt-6">5.1 Installation Schedule</h3>
              <p>
                BotKorp will schedule installation within 3-5 business days of service activation. Customer must provide reasonable access to the property for installation.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">5.2 Installation Requirements</h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>An adult (18+) must be present during installation and training</li>
                <li>Property must be clear of major obstacles that would prevent boundary wire installation</li>
                <li>Customer must provide access to electrical outlets for charging stations</li>
                <li>Property boundaries must be clearly defined</li>
              </ul>

              <h3 className="text-lg font-semibold text-foreground mt-6">5.3 Boundary Wire</h3>
              <p>
                BotKorp will install boundary wire to define the operating area. Customer agrees not to damage, remove, or modify the boundary wire without permission. Customer is responsible for notifying BotKorp of any damage to boundary wire.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">5.4 Training</h3>
              <p>
                BotKorp will provide basic training on Bot operation, safety features, and portal usage. Customer agrees to follow all safety guidelines and operating instructions.
              </p>
            </div>
          </section>

          {/* 6. Service and Maintenance */}
          <section>
            <h2 className="text-2xl font-bold mb-4 text-primary">6. Service Visits and Maintenance</h2>
            <div className="space-y-4 text-muted-foreground">
              <h3 className="text-lg font-semibold text-foreground mt-6">6.1 Scheduled Services</h3>
              <p>
                Service visits will occur according to the schedule selected in your Rental Agreement. Each visit includes:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Edge trimming along boundaries and obstacles</li>
                <li>Bot battery swap with fully charged battery</li>
                <li>Visual inspection and cleaning</li>
                <li>Blade sharpness check and minor adjustments</li>
                <li>Reporting of any issues or concerns</li>
              </ul>

              <h3 className="text-lg font-semibold text-foreground mt-6">6.2 Access Requirements</h3>
              <p>
                Customer must ensure reasonable access to the property during scheduled service times (10:00 AM - 4:00 PM). If access cannot be provided, Customer must reschedule with 24 hours notice.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">6.3 Repairs and Replacements</h3>
              <p>
                All maintenance, repairs, and replacements are included in the rental fee, except for:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Damage caused by misuse, abuse, or negligence</li>
                <li>Damage from theft, vandalism, or acts of third parties</li>
                <li>Damage from natural disasters or acts of God</li>
                <li>Damage to boundary wire caused by Customer or their contractors</li>
              </ul>

              <h3 className="text-lg font-semibold text-foreground mt-6">6.4 Replacement Equipment</h3>
              <p>
                If repairs require more than three (3) business days, BotKorp will provide replacement Equipment at no additional charge.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">6.5 Emergency Support</h3>
              <p>
                For urgent issues, Customer may contact BotKorp support. Response time for non-life-threatening issues is 24-48 hours during business days.
              </p>
            </div>
          </section>

          {/* 7. Customer Responsibilities */}
          <section>
            <h2 className="text-2xl font-bold mb-4 text-primary">7. Customer Responsibilities</h2>
            <div className="space-y-4 text-muted-foreground">
              <h3 className="text-lg font-semibold text-foreground mt-6">7.1 Care of Equipment</h3>
              <p>Customer agrees to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Use the Equipment in accordance with provided instructions</li>
                <li>Keep the Equipment reasonably clean and free from excessive debris</li>
                <li>Store charging stations in a dry, protected location</li>
                <li>Report any malfunction or damage immediately</li>
                <li>Not attempt to repair or modify the Equipment</li>
                <li>Protect the Equipment from theft or vandalism to the best of their ability</li>
              </ul>

              <h3 className="text-lg font-semibold text-foreground mt-6">7.2 Property Preparation</h3>
              <p>Customer agrees to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Remove large obstacles, toys, tools, or debris before Bot operation</li>
                <li>Ensure property is free of hazards that could damage the Bot</li>
                <li>Secure pets during Bot operation or service visits</li>
                <li>Notify BotKorp of any property changes that might affect Bot operation</li>
                <li>Maintain reasonable lawn or pool conditions</li>
              </ul>

              <h3 className="text-lg font-semibold text-foreground mt-6">7.3 Safety</h3>
              <p>Customer agrees to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Not allow children under 12 to operate or interfere with the Equipment</li>
                <li>Supervise children and pets around operating Equipment</li>
                <li>Not override safety features or sensors</li>
                <li>Immediately stop and report any unsafe behavior of Equipment</li>
              </ul>

              <h3 className="text-lg font-semibold text-foreground mt-6">7.4 Notification Requirements</h3>
              <p>Customer must notify BotKorp within 24 hours of:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Equipment malfunction or unusual behavior</li>
                <li>Damage to Equipment or boundary wire</li>
                <li>Theft or attempted theft of Equipment</li>
                <li>Changes to property that affect service delivery</li>
              </ul>
            </div>
          </section>

          {/* 8. Liability */}
          <section>
            <h2 className="text-2xl font-bold mb-4 text-primary">8. Liability and Indemnification</h2>
            <div className="space-y-4 text-muted-foreground">
              <h3 className="text-lg font-semibold text-foreground mt-6">8.1 Equipment Insurance</h3>
              <p>
                BotKorp maintains equipment insurance. However, Customer is encouraged to ensure their homeowner's or property insurance covers rental equipment on the premises.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">8.2 Limitation of Liability</h3>
              <p>
                <strong>TO THE MAXIMUM EXTENT PERMITTED BY LAW:</strong>
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>BotKorp is not liable for damage to property caused by proper use of Equipment</li>
                <li>BotKorp is not liable for consequential, incidental, or special damages</li>
                <li>BotKorp's total liability shall not exceed the total rental fees paid in the preceding 12 months</li>
              </ul>

              <h3 className="text-lg font-semibold text-foreground mt-6">8.3 Customer Liability</h3>
              <p>Customer is liable for:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Damage to Equipment caused by misuse, negligence, or violation of these Terms</li>
                <li>Theft of Equipment if property was left unsecured</li>
                <li>Damage caused by failure to maintain property in reasonable condition</li>
                <li>Costs of retrieving Equipment if Customer relocates without notice</li>
              </ul>

              <h3 className="text-lg font-semibold text-foreground mt-6">8.4 Indemnification</h3>
              <p>
                Customer agrees to indemnify and hold harmless BotKorp, its officers, employees, and affiliates from any claims, damages, or expenses arising from Customer's use of Equipment, violation of these Terms, or negligence.
              </p>
            </div>
          </section>

          {/* 9. Service Suspension and Termination */}
          <section>
            <h2 className="text-2xl font-bold mb-4 text-primary">9. Service Suspension and Termination</h2>
            <div className="space-y-4 text-muted-foreground">
              <h3 className="text-lg font-semibold text-foreground mt-6">9.1 Pause Service</h3>
              <p>
                Customer may pause service (e.g., for winter months, travel, or property work) with seven (7) days notice. No rental fees apply during pause periods, but the deposit remains held. Service resumes upon request with seven (7) days notice.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">9.2 Customer Cancellation</h3>
              <p>
                Customer may cancel service with thirty (30) days written notice. Customer must return all Equipment within seven (7) days of cancellation in good working condition. Deposit will be refunded per Section 4.6.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">9.3 BotKorp Termination</h3>
              <p>BotKorp may terminate service immediately if:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Customer fails to pay for thirty (30) days</li>
                <li>Customer violates these Terms and fails to cure within seven (7) days of notice</li>
                <li>Customer uses Equipment for prohibited purposes</li>
                <li>Customer damages Equipment through gross negligence or intentional misuse</li>
                <li>Property becomes inaccessible or outside service area</li>
              </ul>

              <h3 className="text-lg font-semibold text-foreground mt-6">9.4 Equipment Return</h3>
              <p>
                Upon termination, Customer must make Equipment available for retrieval within seven (7) days. Customer is responsible for rental fees until Equipment is returned. If Equipment is not returned within thirty (30) days, Customer may be charged the full replacement value.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">9.5 No Refunds</h3>
              <p>
                Monthly fees are not prorated. Cancellation takes effect at the end of the billing cycle. No refunds are provided for partial months except at BotKorp's sole discretion.
              </p>
            </div>
          </section>

          {/* 10. Data and Privacy */}
          <section>
            <h2 className="text-2xl font-bold mb-4 text-primary">10. Data and Privacy</h2>
            <div className="space-y-4 text-muted-foreground">
              <h3 className="text-lg font-semibold text-foreground mt-6">10.1 Data Collection</h3>
              <p>
                Equipment may collect operational data including location, usage patterns, performance metrics, and environmental data. This data is used to improve service quality, diagnose issues, and optimize Equipment performance.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">10.2 Privacy Policy</h3>
              <p>
                Customer data is processed in accordance with our Privacy Policy and the Protection of Personal Information Act (POPIA). We do not sell or share personal data with third parties except as necessary to provide services.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">10.3 Cameras and Sensors</h3>
              <p>
                Some Equipment includes cameras or sensors for navigation and obstacle detection. These are not used for surveillance purposes. Images are processed locally and not transmitted unless required for technical support.
              </p>
            </div>
          </section>

          {/* 11. Warranties and Disclaimers */}
          <section>
            <h2 className="text-2xl font-bold mb-4 text-primary">11. Warranties and Disclaimers</h2>
            <div className="space-y-4 text-muted-foreground">
              <h3 className="text-lg font-semibold text-foreground mt-6">11.1 Service Warranty</h3>
              <p>
                BotKorp warrants that services will be performed in a professional and workmanlike manner. Equipment will be maintained in good working condition as part of the service.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">11.2 Performance Disclaimer</h3>
              <p>
                <strong>BOTKORP MAKES NO WARRANTIES REGARDING:</strong>
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Specific results or lawn quality improvements</li>
                <li>Uninterrupted or error-free operation</li>
                <li>Compatibility with all property types or conditions</li>
                <li>Weather-dependent performance</li>
              </ul>

              <h3 className="text-lg font-semibold text-foreground mt-6">11.3 No Other Warranties</h3>
              <p>
                EXCEPT AS EXPRESSLY STATED, ALL SERVICES AND EQUIPMENT ARE PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.
              </p>
            </div>
          </section>

          {/* 12. Force Majeure */}
          <section>
            <h2 className="text-2xl font-bold mb-4 text-primary">12. Force Majeure</h2>
            <div className="space-y-4 text-muted-foreground">
              <p>
                BotKorp shall not be liable for failure to perform obligations due to causes beyond reasonable control, including but not limited to:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Natural disasters, severe weather, or acts of God</li>
                <li>War, terrorism, civil unrest, or government action</li>
                <li>Labor disputes or strikes</li>
                <li>Pandemics or public health emergencies</li>
                <li>Telecommunications or internet failures</li>
                <li>Supply chain disruptions or equipment shortages</li>
              </ul>
              <p className="mt-4">
                Service may be suspended during force majeure events. Rental fees may be waived at BotKorp's discretion during extended force majeure periods.
              </p>
            </div>
          </section>

          {/* 13. General Provisions */}
          <section>
            <h2 className="text-2xl font-bold mb-4 text-primary">13. General Provisions</h2>
            <div className="space-y-4 text-muted-foreground">
              <h3 className="text-lg font-semibold text-foreground mt-6">13.1 Governing Law</h3>
              <p>
                These Terms are governed by the laws of the Republic of South Africa. Any disputes shall be subject to the exclusive jurisdiction of the courts of KwaZulu-Natal.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">13.2 Dispute Resolution</h3>
              <p>
                Before initiating legal proceedings, parties agree to attempt resolution through good faith negotiations for thirty (30) days.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">13.3 Amendments</h3>
              <p>
                BotKorp may amend these Terms with sixty (60) days written notice. Continued use of services after notice constitutes acceptance. Customer may terminate if they do not accept amendments.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">13.4 Assignment</h3>
              <p>
                Customer may not assign or transfer rights under this agreement without written consent. BotKorp may assign this agreement to affiliates or in connection with a business sale.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">13.5 Severability</h3>
              <p>
                If any provision is found invalid or unenforceable, the remaining provisions shall continue in full force and effect.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">13.6 Entire Agreement</h3>
              <p>
                These Terms, together with the Rental Agreement and Privacy Policy, constitute the entire agreement between parties and supersede all prior agreements or understandings.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">13.7 Waiver</h3>
              <p>
                Failure to enforce any provision does not constitute a waiver of future enforcement of that provision or any other provision.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">13.8 Notices</h3>
              <p>
                All notices must be in writing and sent to the addresses specified in the Rental Agreement. Email notices are acceptable if sent to registered email addresses.
              </p>

              <h3 className="text-lg font-semibold text-foreground mt-6">13.9 Electronic Signatures</h3>
              <p>
                The parties agree that electronic signatures are legally binding and equivalent to handwritten signatures.
              </p>
            </div>
          </section>

          {/* Contact Information */}
          <section className="border-t-2 pt-6">
            <h2 className="text-2xl font-bold mb-4 text-primary">Contact Information</h2>
            <div className="space-y-2 text-muted-foreground">
              <p><strong>BotKorp (Pty) Ltd</strong></p>
              <p>A member of Exolution Technologies (Pty) Ltd</p>
              <p>Registration No: 2024/567890/07</p>
              <p>VAT No: 4123456789</p>
              <p className="mt-4"><strong>Physical Address:</strong></p>
              <p>MAP HOUSE, Umbilo</p>
              <p>Durban, 4061</p>
              <p>KwaZulu-Natal, South Africa</p>
              <p className="mt-4"><strong>Contact:</strong></p>
              <p>Phone: +27 31 123 4567</p>
              <p>Email: legal@botkorp.co.za</p>
              <p>Support: support@botkorp.co.za</p>
              <p>Website: www.botkorp.co.za</p>
            </div>
          </section>

          {/* Acknowledgment */}
          <section className="border-t-2 pt-6 bg-muted/30 p-6 rounded-lg print:bg-gray-50">
            <h3 className="font-bold text-lg mb-4">Customer Acknowledgment</h3>
            <p className="text-sm text-muted-foreground mb-4">
              By signing the Rental Agreement, you acknowledge that you have read, understood, and agree to be bound by these Bot Rental Terms of Service. You confirm that you have had the opportunity to seek independent legal advice if desired.
            </p>
            <p className="text-xs text-muted-foreground italic">
              These terms are incorporated by reference into all Bot Korp rental agreements.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

