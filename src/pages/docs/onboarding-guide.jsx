import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import {
  MapPin,
  Sprout,
  Calendar,
  FileSignature,
  CreditCard,
  CheckCircle,
  ChevronRight,
  Info,
  AlertCircle,
  PlayCircle,
  Bot,
  Clock,
  DollarSign,
  Shield
} from 'lucide-react';

export default function OnboardingGuide() {
  const [checkedSteps, setCheckedSteps] = useState({});

  const toggleStep = (step) => {
    setCheckedSteps(prev => ({ ...prev, [step]: !prev[step] }));
  };

  const onboardingSteps = [
    { id: 'account', label: 'Create account' },
    { id: 'location', label: 'Add first location' },
    { id: 'legal', label: 'Complete legal profile (optional)' },
    { id: 'service', label: 'Add service (gardens)' },
    { id: 'schedule', label: 'Set up schedule' },
    { id: 'contract', label: 'Sign rental agreement' },
    { id: 'payment', label: 'Add payment method' },
    { id: 'complete', label: 'Service activated!' }
  ];

  return (
    <div className="max-w-5xl space-y-12">
      {/* Hero */}
      <div className="space-y-4">
        <Badge variant="secondary" className="mb-2">Complete Guide</Badge>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          Getting Started with BotKorp
        </h1>
        <p className="text-xl text-muted-foreground max-w-3xl">
          Follow this step-by-step guide to set up your automated bot service. We'll walk you through every step from creating your account to activating your first service.
        </p>
      </div>

      {/* Quick Setup Checklist */}
      <Card className="border-2 border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-6 w-6 text-primary" />
            Setup Checklist
          </CardTitle>
          <CardDescription>
            Track your progress as you set up your BotKorp service
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {onboardingSteps.map((step) => (
              <div
                key={step.id}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <Checkbox
                  id={step.id}
                  checked={checkedSteps[step.id] || false}
                  onCheckedChange={() => toggleStep(step.id)}
                />
                <label
                  htmlFor={step.id}
                  className={`flex-1 cursor-pointer ${
                    checkedSteps[step.id] ? 'line-through text-muted-foreground' : ''
                  }`}
                >
                  {step.label}
                </label>
                {checkedSteps[step.id] && (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-semibold">
                {Object.values(checkedSteps).filter(Boolean).length} / {onboardingSteps.length}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step 1: Create Account */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold">
              1
            </div>
            <CardTitle className="text-2xl">Create Your Account</CardTitle>
          </div>
          <CardDescription>Set up your BotKorp account to get started</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Your BotKorp journey begins with creating an account. This gives you access to the portal where you'll manage all your bot services.
          </p>
          
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <ChevronRight className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium">Visit the registration page</p>
                <p className="text-sm text-muted-foreground">Click "Get Started" on the homepage</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <ChevronRight className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium">Enter your email and password</p>
                <p className="text-sm text-muted-foreground">Use a secure password with at least 6 characters</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <ChevronRight className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium">Verify your email</p>
                <p className="text-sm text-muted-foreground">Check your inbox for a verification email</p>
              </div>
            </div>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>Automatic setup:</strong> When you create an account, we automatically create an organization for you. You'll be the owner and can invite team members later.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Step 2: Add Location */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold">
              2
            </div>
            <CardTitle className="text-2xl flex items-center gap-2">
              <MapPin className="h-6 w-6" />
              Add Your First Location
            </CardTitle>
          </div>
          <CardDescription>Tell us where you want bot services</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Locations represent physical properties where bots will operate. You can have multiple locations (e.g., home, vacation property, rental property).
          </p>

          <div className="bg-muted/50 p-4 rounded-lg space-y-3">
            <h4 className="font-semibold">Location Wizard Features:</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                <span><strong>Interactive Map:</strong> Search your address and see it on the map</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                <span><strong>Coverage Check:</strong> Instant verification that we service your area</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                <span><strong>GPS Coordinates:</strong> Automatic latitude/longitude capture</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                <span><strong>Quick Start:</strong> Use your current location with one click</span>
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold">How to Add a Location:</h4>
            <div className="pl-4 space-y-3 border-l-2 border-primary/20">
              <div>
                <p className="font-medium">1. Search for your address</p>
                <p className="text-sm text-muted-foreground">Type your street address in the search field</p>
              </div>
              <div>
                <p className="font-medium">2. Verify on the map</p>
                <p className="text-sm text-muted-foreground">Check that the map marker is at the correct location</p>
              </div>
              <div>
                <p className="font-medium">3. Check coverage status</p>
                <p className="text-sm text-muted-foreground">
                  ✅ Green = We service your area<br />
                  ⚠️ Yellow = Close to service area<br />
                  ❌ Red = Not yet serviced (contact us!)
                </p>
              </div>
              <div>
                <p className="font-medium">4. Enter location details</p>
                <p className="text-sm text-muted-foreground">Give it a name (e.g., "Home", "Main Office") and confirm address</p>
              </div>
            </div>
          </div>

          <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-900/20">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-900 dark:text-amber-100">
              <strong>Out of Coverage?</strong> If your location isn't in our service area yet, you can still add it and join our waitlist. We'll notify you when we expand to your area!
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Step 3: Complete Legal Profile (Optional) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold">
              3
            </div>
            <CardTitle className="text-2xl flex items-center gap-2">
              <FileSignature className="h-6 w-6" />
              Complete Legal Profile
              <Badge variant="secondary">Optional</Badge>
            </CardTitle>
          </div>
          <CardDescription>Add your legal information for service contracts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Your legal profile helps us generate proper service contracts. You can skip this initially and complete it later before signing your first agreement.
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-3 border rounded-lg">
              <p className="font-medium text-sm mb-1">Personal Information</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Legal first name & surname</li>
                <li>• ID number</li>
                <li>• Phone number</li>
              </ul>
            </div>
            <div className="p-3 border rounded-lg">
              <p className="font-medium text-sm mb-1">Address Details</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Physical address</li>
                <li>• City & Province</li>
                <li>• Postal code</li>
              </ul>
            </div>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>Why we need this:</strong> This information appears on your rental agreement and ensures legal validity. All data is encrypted and POPIA-compliant.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Step 4: Add Service */}
      <Card className="border-2 border-primary/30">
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold">
              4
            </div>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Sprout className="h-6 w-6" />
              Add Your First Service
            </CardTitle>
          </div>
          <CardDescription>Configure your garden bot service</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-muted-foreground">
            The Service Wizard guides you through configuring your bot service. This is where you define what needs to be automated.
          </p>

          <div className="space-y-4">
            <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <PlayCircle className="h-5 w-5 text-primary" />
                Service Wizard Steps
              </h4>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">1</div>
                  <div>
                    <p className="font-medium text-sm">Choose Service Type & Location</p>
                    <p className="text-xs text-muted-foreground">Select "Garden Maintenance" and pick your location</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">2</div>
                  <div>
                    <p className="font-medium text-sm">Define Your Gardens</p>
                    <p className="text-xs text-muted-foreground">Add each garden/lawn area with name and size (m²)</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">3</div>
                  <div>
                    <p className="font-medium text-sm">Set Up Schedule</p>
                    <p className="text-xs text-muted-foreground">Choose weekly/monthly schedule and service frequency</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">4</div>
                  <div>
                    <p className="font-medium text-sm">Review & Pricing</p>
                    <p className="text-xs text-muted-foreground">See complete cost breakdown and invoice preview</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">5</div>
                  <div>
                    <p className="font-medium text-sm">Sign Agreement</p>
                    <p className="text-xs text-muted-foreground">Review contract terms and sign electronically</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">6</div>
                  <div>
                    <p className="font-medium text-sm">Add Payment Method</p>
                    <p className="text-xs text-muted-foreground">Securely link your card for monthly billing</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Garden Configuration Details */}
            <div>
              <h4 className="font-semibold mb-3">Defining Your Gardens:</h4>
              <div className="space-y-3 text-sm">
                <Alert>
                  <Bot className="h-4 w-4" />
                  <AlertDescription>
                    <strong>One bot per garden:</strong> Each garden requires one bot. If you have 3 gardens, you'll rent 3 bots.
                  </AlertDescription>
                </Alert>
                <p className="text-muted-foreground">For each garden, provide:</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground pl-4">
                  <li><strong>Name:</strong> e.g., "Front Lawn", "Back Garden", "Side Yard"</li>
                  <li><strong>Area (m²):</strong> Approximate size in square meters</li>
                </ul>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="text-xs text-muted-foreground">
                    <strong>Tip:</strong> You can add multiple gardens in one go using the "+ Add Another Garden" button. Each will be assigned its own bot.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step 5: Schedule Setup */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold">
              5
            </div>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Calendar className="h-6 w-6" />
              Set Up Your Schedule
            </CardTitle>
          </div>
          <CardDescription>Define when and how often bots should service your gardens</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Choose how often you want your gardens serviced. More frequent services keep your lawn looking pristine, while less frequent services are more economical.
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 border rounded-lg">
              <h5 className="font-semibold mb-2 text-sm">Weekly Schedule</h5>
              <p className="text-xs text-muted-foreground mb-2">Select specific days of the week</p>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>✓ Best for maintaining consistent lawn height</li>
                <li>✓ Recommended: 2-4x per week for premium results</li>
                <li>✓ Can choose multiple days</li>
              </ul>
            </div>
            <div className="p-4 border rounded-lg">
              <h5 className="font-semibold mb-2 text-sm">Monthly Schedule</h5>
              <p className="text-xs text-muted-foreground mb-2">Choose specific dates each month</p>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>✓ More flexible for varying needs</li>
                <li>✓ Good for less frequent maintenance</li>
                <li>✓ Pick any dates from 1-31</li>
              </ul>
            </div>
          </div>

          <div className="bg-muted/50 p-4 rounded-lg space-y-3">
            <h5 className="font-semibold text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Service Visit Details
            </h5>
            <p className="text-sm text-muted-foreground">
              Each service visit includes:
            </p>
            <ul className="text-sm space-y-1">
              <li className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span>Edge trimming along boundaries and obstacles</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span>Bot battery swap (fresh, fully charged battery)</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span>Quick bot inspection and cleaning</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span>Blade check and minor adjustments</span>
              </li>
            </ul>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>Flexible scheduling:</strong> You can adjust your schedule anytime through the portal. Need to pause for winter? Just click "Pause Service" - no penalties!
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Step 6: Review & Pricing */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold">
              6
            </div>
            <CardTitle className="text-2xl flex items-center gap-2">
              <DollarSign className="h-6 w-6" />
              Review Pricing & Costs
            </CardTitle>
          </div>
          <CardDescription>Understand exactly what you'll pay</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Before signing the contract, you'll see a complete breakdown of all costs. BotKorp uses transparent pricing with no hidden fees.
          </p>

          <div className="space-y-4">
            <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
              <h5 className="font-semibold mb-3">Pricing Components:</h5>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">Bot Rental</p>
                    <p className="text-xs text-muted-foreground">R150 per bot per month</p>
                  </div>
                  <Badge>Monthly</Badge>
                </div>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">Service Visits</p>
                    <p className="text-xs text-muted-foreground">R150 per visit (includes edge trimming + battery swap)</p>
                  </div>
                  <Badge>Per Visit</Badge>
                </div>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">Setup Fee</p>
                    <p className="text-xs text-muted-foreground">R450 first bot, R200 each additional bot</p>
                  </div>
                  <Badge variant="secondary">One-time</Badge>
                </div>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">Bot Deposit</p>
                    <p className="text-xs text-muted-foreground">R500 per bot (fully refundable when you return the bot)</p>
                  </div>
                  <Badge variant="outline">Refundable</Badge>
                </div>
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg border border-amber-200 dark:border-amber-800">
              <h5 className="font-semibold mb-2 text-sm">Example: 2 Gardens, 4 Services/Month</h5>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bot Rental (2 bots)</span>
                  <span>R300.00</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service Visits (4x × 2 bots)</span>
                  <span>R1,200.00</span>
                </div>
                <div className="flex justify-between font-bold pt-2 border-t">
                  <span>Monthly Total</span>
                  <span className="text-primary">R1,500.00</span>
                </div>
                <div className="flex justify-between text-xs text-amber-900 dark:text-amber-100 pt-2 border-t">
                  <span>First Month (includes setup)</span>
                  <span>R2,150.00</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step 7: Sign Agreement */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold">
              7
            </div>
            <CardTitle className="text-2xl flex items-center gap-2">
              <FileSignature className="h-6 w-6" />
              Sign the Rental Agreement
            </CardTitle>
          </div>
          <CardDescription>Review terms and sign electronically</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Our rental agreement is flexible and customer-friendly. No long-term commitments, pause or cancel anytime.
          </p>

          <div className="space-y-3">
            <Alert className="border-green-500 bg-green-50 dark:bg-green-900/20">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription>
                <p className="font-semibold text-green-900 dark:text-green-100 mb-2">Key Benefits:</p>
                <ul className="text-sm text-green-900 dark:text-green-100 space-y-1">
                  <li>✓ <strong>No Long-term Contract</strong> - Month-to-month agreement</li>
                  <li>✓ <strong>Cancel Anytime</strong> - Just 30 days notice required</li>
                  <li>✓ <strong>Pause for Winter</strong> - No charge while paused</li>
                  <li>✓ <strong>Flexible Changes</strong> - Adjust services as needed</li>
                  <li>✓ <strong>Refundable Deposit</strong> - Get your R500/bot back when returning</li>
                </ul>
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <h5 className="font-semibold text-sm">Signing Process:</h5>
              <div className="pl-4 border-l-2 border-primary/20 space-y-2 text-sm">
                <p>1. Review the agreement summary with all terms</p>
                <p>2. Sign using the digital signature pad</p>
                <p>3. PDF is automatically generated and emailed to you</p>
                <p>4. Agreement is stored securely in your portal</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step 8: Payment Method */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold">
              8
            </div>
            <CardTitle className="text-2xl flex items-center gap-2">
              <CreditCard className="h-6 w-6" />
              Add Payment Method
            </CardTitle>
          </div>
          <CardDescription>Secure card linking for automated billing</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Link your debit or credit card for automated monthly billing. We use Paystack for secure payment processing.
          </p>

          <div className="space-y-3">
            <Alert>
              <Shield className="h-4 w-4" />
              <AlertDescription>
                <strong>Secure & PCI-compliant:</strong> We never store your full card details. All payment information is encrypted and processed through Paystack's secure platform.
              </AlertDescription>
            </Alert>

            <div className="bg-muted/50 p-4 rounded-lg space-y-2 text-sm">
              <h5 className="font-semibold">How Monthly Billing Works:</h5>
              <ul className="space-y-1 text-muted-foreground">
                <li>• Invoice generated on your chosen billing date (1-28th of month)</li>
                <li>• Payment auto-collected from your linked card</li>
                <li>• Invoice emailed to you with full breakdown</li>
                <li>• View all invoices and payment history in your portal</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Troubleshooting */}
      <Card className="border-2 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-6 w-6 text-amber-600" />
            Common Issues & Solutions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div>
              <p className="font-semibold text-sm mb-1">❌ "Location outside coverage area"</p>
              <p className="text-sm text-muted-foreground">
                Solution: Contact us to request service in your area. We're expanding rapidly and prioritize high-demand areas.
              </p>
            </div>
            <div>
              <p className="font-semibold text-sm mb-1">❌ "Can't complete legal profile"</p>
              <p className="text-sm text-muted-foreground">
                Solution: Legal profile is optional initially. You can skip it and complete it later before signing your first agreement.
              </p>
            </div>
            <div>
              <p className="font-semibold text-sm mb-1">❌ "Payment method won't link"</p>
              <p className="text-sm text-muted-foreground">
                Solution: Ensure your card supports online payments and 3D Secure. Try a different card or contact support.
              </p>
            </div>
            <div>
              <p className="font-semibold text-sm mb-1">❓ "How do I change my schedule?"</p>
              <p className="text-sm text-muted-foreground">
                Solution: Go to Services → Your Service → Schedules. You can modify schedules anytime with no penalties.
              </p>
            </div>
          </div>

          <Button variant="outline" className="w-full" onClick={() => window.location.href = 'mailto:support@botkorp.co.za'}>
            Still Need Help? Contact Support
          </Button>
        </CardContent>
      </Card>

      {/* Next Steps */}
      <Card className="bg-gradient-to-br from-primary/5 to-secondary/5 border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-6 w-6 text-green-600" />
            You're All Set!
          </CardTitle>
          <CardDescription>
            What happens after you complete setup
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="space-y-2">
            <p className="font-semibold">Immediate next steps:</p>
            <ul className="space-y-1 text-muted-foreground pl-4">
              <li>✓ Bot installation scheduled within 3-5 business days</li>
              <li>✓ Technician contacts you to arrange convenient time</li>
              <li>✓ Setup includes boundary wire installation and bot configuration</li>
              <li>✓ Quick training session on using the portal</li>
              <li>✓ First service visit scheduled based on your chosen schedule</li>
            </ul>
          </div>
          <div className="pt-3 border-t">
            <p className="font-semibold mb-2">Ongoing:</p>
            <ul className="space-y-1 text-muted-foreground pl-4">
              <li>• Monitor bot activity in real-time through your portal</li>
              <li>• Receive notifications for completed services and alerts</li>
              <li>• Adjust schedules and settings as needed</li>
              <li>• Monthly invoicing on your chosen billing date</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

