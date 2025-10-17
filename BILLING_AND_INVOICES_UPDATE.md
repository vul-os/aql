# Billing & Invoices System Update

## Overview
Complete invoicing system with monthly billing, invoice history, and enhanced billing page.

---

## Database: `invoices` Table ✅

### Fields:
- `invoice_number`: INV-YYYYMM-NNNN
- `period_start`, `period_end`: Billing period
- `bot_rental_total`: Total bot rental for period
- `service_visits_total`: Total service visits
- `subtotal`, `tax_amount`, `total_amount`
- `amount_paid`, `amount_due`
- `line_items`: JSON array of charges
- `status`: draft, sent, paid, overdue, cancelled, refunded
- `invoice_pdf_url`: CDN link to PDF
- Billing address snapshot

### Functions:
1. `create_monthly_invoice()` - Generate monthly invoice from rental agreement
2. `mark_invoice_paid()` - Record payment (supports partial payments)
3. `get_user_invoices()` - Retrieve invoice history with pagination

---

## Billing Page Updates

### Current State:
- Payment methods (credit cards)
- Active subscriptions

### Add New Sections:

#### 1. **Invoices Section** (Priority)
```jsx
<Card>
  <CardHeader>
    <CardTitle>Invoices</CardTitle>
    <CardDescription>View and download your billing history</CardDescription>
  </CardHeader>
  <CardContent>
    {invoices.map(invoice => (
      <InvoiceRow
        invoice={invoice}
        onDownload={() => downloadInvoice(invoice.id)}
        onPay={() => payInvoice(invoice.id)}
      />
    ))}
  </CardContent>
</Card>
```

**Invoice Row Display:**
```
┌────────────────────────────────────────────────────────────┐
│ INV-202510-0001          [Paid] or [Overdue] badge        │
│ October 1-31, 2025                                         │
│                                                            │
│ Bot Rental (2 bots):     R300                             │
│ Service Visits (1):      R200                             │
│ Subtotal:                R500                             │
│ VAT (15%):               R75                              │
│ Total:                   R575                             │
│                                                            │
│ [Download PDF]  [View Details]  [Pay Now] (if unpaid)    │
└────────────────────────────────────────────────────────────┘
```

#### 2. **Billing Summary** (New Top Section)
```jsx
<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
  <Card>
    <CardHeader>
      <CardTitle>Current Month</CardTitle>
    </CardHeader>
    <CardContent>
      <p className="text-3xl font-bold">R{currentMonthTotal}</p>
      <p className="text-sm text-muted-foreground">
        {botCount} bots + {serviceVisits} visits
      </p>
    </CardContent>
  </Card>
  
  <Card>
    <CardHeader>
      <CardTitle>Outstanding Balance</CardTitle>
    </CardHeader>
    <CardContent>
      <p className="text-3xl font-bold text-red-600">R{outstandingBalance}</p>
      <p className="text-sm text-muted-foreground">
        {unpaidInvoices} unpaid invoices
      </p>
    </CardContent>
  </Card>
  
  <Card>
    <CardHeader>
      <CardTitle>Next Billing Date</CardTitle>
    </CardHeader>
    <CardContent>
      <p className="text-xl font-bold">{nextBillingDate}</p>
      <p className="text-sm text-muted-foreground">
        Estimated: R{estimatedNextBill}
      </p>
    </CardContent>
  </Card>
</div>
```

#### 3. **Rental Agreements Section**
```jsx
<Card>
  <CardHeader>
    <CardTitle>Active Rental Agreements</CardTitle>
    <CardDescription>Your current bot rental agreements</CardDescription>
  </CardHeader>
  <CardContent>
    {agreements.map(agreement => (
      <div className="p-4 border rounded-lg">
        <div className="flex justify-between">
          <div>
            <p className="font-semibold">{agreement.agreement_number}</p>
            <p className="text-sm text-muted-foreground">
              {agreement.number_of_bots} bots, {agreement.services_per_month} services/month
            </p>
          </div>
          <div className="text-right">
            <p className="font-bold">R{agreement.monthly_total}/month</p>
            <Badge>{agreement.status}</Badge>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => pauseAgreement(agreement.id)}>
            Pause Service
          </Button>
          <Button size="sm" variant="outline" onClick={() => viewAgreement(agreement.id)}>
            View Agreement
          </Button>
          <Button size="sm" variant="destructive" onClick={() => cancelAgreement(agreement.id)}>
            Cancel
          </Button>
        </div>
      </div>
    ))}
  </CardContent>
</Card>
```

#### 4. **Billing Information Section**
```jsx
<Card>
  <CardHeader>
    <CardTitle>Billing Information</CardTitle>
    <CardDescription>How billing works</CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    <Alert>
      <Info className="h-4 w-4" />
      <AlertDescription>
        <strong>Monthly Billing Cycle:</strong> You're billed on the 1st of each month for the previous month's usage.
      </AlertDescription>
    </Alert>
    
    <div className="space-y-2">
      <h4 className="font-semibold">What You're Charged For:</h4>
      <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
        <li><strong>Bot Rental:</strong> R150 per bot per month (prorated for partial months)</li>
        <li><strong>Service Visits:</strong> Charged per visit for edge trimming + bot swap</li>
        <li><strong>VAT:</strong> 15% added to all charges (as required by South African law)</li>
      </ul>
    </div>
    
    <div className="space-y-2">
      <h4 className="font-semibold">Payment Terms:</h4>
      <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
        <li>Invoices due within 14 days of issue</li>
        <li>Automatic payment from your default card</li>
        <li>Late payment may result in service suspension</li>
      </ul>
    </div>
    
    <div className="space-y-2">
      <h4 className="font-semibold">Flexibility:</h4>
      <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
        <li><strong>No Contracts:</strong> Month-to-month service only</li>
        <li><strong>Pause Anytime:</strong> No fees during winter break</li>
        <li><strong>Cancel Anytime:</strong> No cancellation penalties</li>
      </ul>
    </div>
  </CardContent>
</Card>
```

---

## Landing Page: Pricing Calculator

### New Interactive Calculator Section

```jsx
<section className="py-20 bg-gradient-to-b from-background to-muted">
  <div className="container mx-auto px-4">
    <div className="text-center mb-12">
      <h2 className="text-4xl font-bold mb-4">Simple, Transparent Pricing</h2>
      <p className="text-xl text-muted-foreground">
        No contracts. Pause or cancel anytime. Pay only for what you use.
      </p>
    </div>
    
    <Card className="max-w-4xl mx-auto">
      <CardContent className="p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Calculator Controls */}
          <div className="space-y-6">
            <div>
              <Label>Number of Gardens/Areas</Label>
              <Slider
                value={[gardens]}
                onValueChange={([value]) => setGardens(value)}
                min={1}
                max={8}
                step={1}
              />
              <p className="text-sm text-muted-foreground mt-1">
                {gardens} garden{gardens > 1 ? 's' : ''} = {gardens} bot{gardens > 1 ? 's' : ''}
              </p>
            </div>
            
            <div>
              <Label>Service Visits Per Month</Label>
              <Slider
                value={[services]}
                onValueChange={([value]) => setServices(value)}
                min={1}
                max={8}
                step={1}
              />
              <p className="text-sm text-muted-foreground mt-1">
                {services} visit{services > 1 ? 's' : ''} (edge trimming + bot swap)
              </p>
            </div>
            
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Tip:</strong> Most customers choose 2-4 bots with 4 service visits per month
              </AlertDescription>
            </Alert>
          </div>
          
          {/* Price Display */}
          <div className="space-y-4">
            <div className="p-6 bg-blue-50 dark:bg-blue-950 rounded-lg">
              <div className="flex justify-between mb-2">
                <span className="text-sm">Bot Rental ({gardens} bots)</span>
                <span className="font-semibold">R{botRental}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {gardens} × R150/month
              </p>
            </div>
            
            <div className="p-6 bg-green-50 dark:bg-green-950 rounded-lg">
              <div className="flex justify-between mb-2">
                <span className="text-sm">Service Visits ({services})</span>
                <span className="font-semibold">R{serviceTotal}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {services} × R{pricePerService}/visit
              </p>
            </div>
            
            <Separator />
            
            <div className="p-6 bg-primary text-primary-foreground rounded-lg">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm opacity-90">Your Monthly Total</p>
                  <p className="text-xs opacity-70">+ VAT (15%)</p>
                </div>
                <p className="text-4xl font-bold">R{monthlyTotal}</p>
              </div>
            </div>
            
            <div className="text-center space-y-2">
              <Button size="lg" className="w-full">
                Get Started Now
              </Button>
              <p className="text-xs text-muted-foreground">
                ✓ No contracts • ✓ Cancel anytime • ✓ 14-day money-back guarantee
              </p>
            </div>
          </div>
        </div>
        
        {/* Example Scenarios */}
        <div className="mt-8 pt-8 border-t">
          <h4 className="font-semibold mb-4">Popular Configurations:</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 border rounded-lg hover:border-primary cursor-pointer"
                 onClick={() => { setGardens(1); setServices(2); }}>
              <p className="font-semibold">Small Property</p>
              <p className="text-sm text-muted-foreground">1 bot, 2 visits/month</p>
              <p className="text-2xl font-bold text-primary mt-2">R400/mo</p>
            </div>
            
            <div className="p-4 border-2 border-primary rounded-lg cursor-pointer"
                 onClick={() => { setGardens(2); setServices(4); }}>
              <Badge className="mb-2">Most Popular</Badge>
              <p className="font-semibold">Medium Property</p>
              <p className="text-sm text-muted-foreground">2 bots, 4 visits/month</p>
              <p className="text-2xl font-bold text-primary mt-2">R900/mo</p>
            </div>
            
            <div className="p-4 border rounded-lg hover:border-primary cursor-pointer"
                 onClick={() => { setGardens(4); setServices(8); }}>
              <p className="font-semibold">Large Property</p>
              <p className="text-sm text-muted-foreground">4 bots, 8 visits/month</p>
              <p className="text-2xl font-bold text-primary mt-2">R1,750/mo</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</section>
```

---

## Landing Page: Pricing Information Section

### Update Existing Pricing Section

```jsx
<section className="py-20">
  <div className="container mx-auto px-4">
    <div className="text-center mb-12">
      <Badge className="mb-4">Pricing</Badge>
      <h2 className="text-4xl font-bold mb-4">How Our Pricing Works</h2>
      <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
        Simple, transparent pricing with no hidden fees. Pay only for what you use.
      </p>
    </div>
    
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto mb-12">
      {/* Bot Rental */}
      <Card>
        <CardHeader>
          <Bot className="h-12 w-12 text-primary mb-4" />
          <CardTitle>Bot Rental</CardTitle>
          <CardDescription>Hardware and infrastructure</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-bold mb-4">R150<span className="text-xl text-muted-foreground">/bot/month</span></div>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start">
              <Check className="h-4 w-4 text-green-600 mr-2 mt-0.5" />
              <span>1 bot per garden/area</span>
            </li>
            <li className="flex items-start">
              <Check className="h-4 w-4 text-green-600 mr-2 mt-0.5" />
              <span>Includes charging station</span>
            </li>
            <li className="flex items-start">
              <Check className="h-4 w-4 text-green-600 mr-2 mt-0.5" />
              <span>Boundary wire & infrastructure</span>
            </li>
            <li className="flex items-start">
              <Check className="h-4 w-4 text-green-600 mr-2 mt-0.5" />
              <span>24/7 monitoring & support</span>
            </li>
          </ul>
        </CardContent>
      </Card>
      
      {/* Service Visits */}
      <Card>
        <CardHeader>
          <Wrench className="h-12 w-12 text-primary mb-4" />
          <CardTitle>Service Visits</CardTitle>
          <CardDescription>Professional maintenance</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-bold mb-4">From R50<span className="text-xl text-muted-foreground">/visit</span></div>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start">
              <Check className="h-4 w-4 text-green-600 mr-2 mt-0.5" />
              <span>Edge trimming & cleanup</span>
            </li>
            <li className="flex items-start">
              <Check className="h-4 w-4 text-green-600 mr-2 mt-0.5" />
              <span>Bot swap & maintenance</span>
            </li>
            <li className="flex items-start">
              <Check className="h-4 w-4 text-green-600 mr-2 mt-0.5" />
              <span>Blade sharpening</span>
            </li>
            <li className="flex items-start">
              <Check className="h-4 w-4 text-green-600 mr-2 mt-0.5" />
              <span>Trained professionals</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
    
    {/* Flexibility Features */}
    <div className="max-w-5xl mx-auto">
      <Card className="border-2 border-primary">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Full Flexibility - No Contracts!</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <Snowflake className="h-12 w-12 text-primary mx-auto mb-4" />
              <h4 className="font-semibold mb-2">Winter Pause</h4>
              <p className="text-sm text-muted-foreground">
                Going away? We'll collect the bots and store them safely. No fees during pause.
              </p>
            </div>
            <div className="text-center">
              <X className="h-12 w-12 text-primary mx-auto mb-4" />
              <h4 className="font-semibold mb-2">Cancel Anytime</h4>
              <p className="text-sm text-muted-foreground">
                No contracts, no penalties. Cancel anytime with 30 days notice.
              </p>
            </div>
            <div className="text-center">
              <Zap className="h-12 w-12 text-primary mx-auto mb-4" />
              <h4 className="font-semibold mb-2">Month-to-Month</h4>
              <p className="text-sm text-muted-foreground">
                Pay only for what you use. Adjust service frequency anytime.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</section>
```

---

## Implementation Checklist

### Database ✅
- [x] Create `invoices` table
- [x] Create invoice generation functions
- [x] Create payment recording functions

### Billing Page
- [ ] Add invoices list section
- [ ] Add billing summary cards
- [ ] Add rental agreements section
- [ ] Add billing information/FAQ
- [ ] Implement invoice download
- [ ] Implement pay invoice button

### Landing Page
- [ ] Add interactive pricing calculator
- [ ] Update pricing information section
- [ ] Add flexibility features showcase
- [ ] Add popular configuration examples

### Documentation
- [ ] Update pricing docs
- [ ] Add billing cycle explanation
- [ ] Add pause/cancel instructions

---

## Status
- ✅ Database complete
- 🔄 Frontend in progress
- ⏳ Documentation pending

**Next:** Implement billing page updates, then landing page calculator.

