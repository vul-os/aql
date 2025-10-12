import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, useOutletContext } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  MapPin, 
  Sprout, 
  Droplets, 
  Shield, 
  ChevronRight, 
  ChevronLeft,
  Plus,
  CheckCircle,
  Lock,
  Home,
  Trash2,
  CreditCard,
  RotateCcw,
  Play,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import { usePaymentAuthorizations, usePaystack } from '@/hooks/use-paystack';
import PriceCalculator from '@/components/services/price-calculator';
import LocationChecker from '@/components/services/location-checker';

const STORAGE_KEY = 'addServiceWizardData';

export default function AddServicePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedOrg } = useOutletContext();
  const { toast } = useToast();
  const { user } = useAuth();
  const { authorizations, loading: authLoading } = usePaymentAuthorizations();
  const { addPaymentMethod, processing } = usePaystack();

  // Load from localStorage
  const loadSavedData = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        console.log('📦 Loaded from localStorage:', parsed);
        return parsed;
      }
    } catch (error) {
      console.error('Error loading saved data:', error);
    }
    return null;
  };

  const initialData = loadSavedData();
  
  const [step, setStep] = useState(initialData?.step || 1);
  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState([]);
  const [showNewLocation, setShowNewLocation] = useState(initialData?.showNewLocation !== undefined ? initialData.showNewLocation : true);

  // Get passed location from landing page
  const passedLocation = location.state?.location;

  // Always 5 steps
  const totalSteps = 5;
  const hasPaymentMethod = !authLoading && authorizations.length > 0;

  // Form state
  const [formData, setFormData] = useState(initialData?.formData || {
    locationId: '',
    selectedLocation: passedLocation || null,
    newLocation: {
      name: 'Location 1',
      address: passedLocation?.address || '',
      city: '',
      province: 'KwaZulu-Natal',
      postalCode: '',
      latitude: passedLocation?.latitude || null,
      longitude: passedLocation?.longitude || null
    },
    serviceType: 'garden',
    gardens: [
      {
        name: 'Garden 1',
        area_sqm: ''
      }
    ]
  });

  const [calculatedPricing, setCalculatedPricing] = useState(null);

  // Save to localStorage on every change
  useEffect(() => {
    const dataToSave = {
      step,
      formData,
      showNewLocation,
      timestamp: Date.now()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    console.log('💾 Saved - Step:', step);
  }, [step, formData, showNewLocation]);

  useEffect(() => {
    if (selectedOrg?.organization_id) {
      loadLocations();
      
      // Show restore toast
      if (initialData && initialData.step > 1) {
        toast({
          title: "Progress Restored",
          description: `Continuing from Step ${initialData.step}`,
        });
      }
    }
  }, [selectedOrg]);

  // Update default location name based on existing locations count
  useEffect(() => {
    if (locations.length > 0 && formData.newLocation.name === 'Location 1') {
      setFormData({
        ...formData,
        newLocation: {
          ...formData.newLocation,
          name: `Location ${locations.length + 1}`
        }
      });
    }
  }, [locations]);

  const loadLocations = async () => {
    try {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', selectedOrg.organization_id)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setLocations(data || []);
      
      // If we have locations and no passed location, default to showing location selector
      if (data && data.length > 0 && !passedLocation) {
        setShowNewLocation(false);
      }
    } catch (error) {
      console.error('Error loading locations:', error);
    }
  };

  const serviceTypes = [
    {
      id: 'garden',
      name: 'Garden Maintenance',
      icon: <Sprout className="h-8 w-8" />,
      description: 'Autonomous lawn mowing and garden care',
      available: true
    },
    {
      id: 'pool',
      name: 'Pool Cleaning',
      icon: <Droplets className="h-8 w-8" />,
      description: 'Automated pool cleaning and maintenance',
      available: false,
      comingSoon: true
    },
    {
      id: 'security',
      name: 'Security Monitoring',
      icon: <Shield className="h-8 w-8" />,
      description: 'Smart security monitoring and alerts',
      available: false,
      comingSoon: true
    }
  ];

  const handleNext = () => {
    if (step === 1) {
      if (!formData.locationId && !showNewLocation) {
        toast({
          title: 'Location Required',
          description: 'Please select or create a location',
          variant: 'destructive'
        });
        return;
      }
      if (showNewLocation && (!formData.newLocation.name || !formData.newLocation.address)) {
        toast({
          title: 'Location Details Required',
          description: 'Please fill in the location name and address',
          variant: 'destructive'
        });
        return;
      }
    }

    if (step === 2 && !formData.serviceType) {
      toast({
        title: 'Service Type Required',
        description: 'Please select a service type',
        variant: 'destructive'
      });
      return;
    }

    if (step === 3) {
      // Check if at least one garden has name and area
      const hasValidGarden = formData.gardens.some(g => g.name && g.area_sqm);
      if (!hasValidGarden) {
        toast({
          title: 'Garden Details Required',
          description: 'Please fill in at least one garden with name and area',
          variant: 'destructive'
        });
        return;
      }
    }

    setStep(step + 1);
  };

  const handleBack = () => {
    setStep(step - 1);
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      let locationId = formData.locationId;

      // Create new location if needed
      if (showNewLocation) {
        const locationData = {
          organization_id: selectedOrg.organization_id,
          name: formData.newLocation.name,
          address: formData.newLocation.address,
          city: formData.newLocation.city,
          province: formData.newLocation.province,
          postal_code: formData.newLocation.postalCode, // Database uses postal_code (snake_case)
          latitude: formData.selectedLocation?.latitude || formData.newLocation.latitude,
          longitude: formData.selectedLocation?.longitude || formData.newLocation.longitude
        };

        const { data: newLoc, error: locError } = await supabase
          .from('locations')
          .insert(locationData)
          .select()
          .single();

        if (locError) throw locError;
        locationId = newLoc.id;
      }

      // Create gardens
      if (formData.serviceType === 'garden') {
        // Filter out empty gardens
        const validGardens = formData.gardens.filter(g => g.name && g.area_sqm);
        
        const gardensToInsert = validGardens.map(garden => ({
          location_id: locationId,
          name: garden.name,
          area_sqm: parseFloat(garden.area_sqm)
        }));

        const { data: gardens, error: gardenError } = await supabase
          .from('gardens')
          .insert(gardensToInsert)
          .select();

        if (gardenError) throw gardenError;

        toast({
          title: 'Service Created Successfully! 🎉',
          description: 'You will receive communication regarding installation of your service within 24-48 hours. Our team will contact you to schedule the bot setup.',
          duration: 7000,
        });

        // Clear localStorage
        localStorage.removeItem(STORAGE_KEY);
        
        navigate('/portal/services');
      }
    } catch (error) {
      console.error('Error creating service:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create service',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add New Service</h1>
          <p className="text-muted-foreground">
            Step {step} of {totalSteps}: {
              step === 1 ? 'Choose Location' :
              step === 2 ? 'Select Service Type' :
              step === 3 ? 'Service Details' :
              step === 4 ? 'Review & Pricing' :
              'Payment Method'
            }
          </p>
        </div>
        {step > 1 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              localStorage.removeItem(STORAGE_KEY);
              setStep(1);
              setShowNewLocation(true);
              setFormData({
                locationId: '',
                selectedLocation: null,
                newLocation: { name: 'Location 1', address: '', city: '', province: 'KwaZulu-Natal', postalCode: '', latitude: null, longitude: null },
                serviceType: 'garden',
                gardens: [{ name: 'Garden 1', area_sqm: '' }]
              });
              toast({ title: "Progress cleared", description: "Starting fresh" });
            }}
            className="gap-1"
          >
            <RotateCcw className="h-3 w-3" />
            Start Over
          </Button>
        )}
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex gap-2">
          {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
            <div
              key={s}
              className={`h-2 flex-1 rounded-full transition-all ${
                s <= step ? 'bg-primary' : 'bg-muted'
              }`}
            />
          ))}
        </div>
        {step > 1 && (
          <p className="text-xs text-center text-muted-foreground">
            Progress auto-saved 💾
          </p>
        )}
      </div>

      {/* Step 1: Location */}
      {step === 1 && (
        <div className="space-y-6">
          {/* Location Checker with Map - Always show */}
          <LocationChecker
            initialAddress={formData.newLocation.address}
            onLocationSelect={(loc) => {
              setFormData({
                ...formData,
                selectedLocation: loc,
                newLocation: {
                  ...formData.newLocation,
                  address: loc.address,
                  latitude: loc.latitude,
                  longitude: loc.longitude
                }
              });
              // Auto-enable new location creation if location selected
              if (!formData.locationId) {
                setShowNewLocation(true);
              }
            }}
            embedded={true}
          />

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                {showNewLocation ? 'New Location Details' : 'Or Select Existing'}
              </span>
            </div>
          </div>

          {!showNewLocation && locations.length > 0 ? (
            <>
              <div className="space-y-2">
                <Label>Select Existing Location</Label>
                <Select 
                  value={formData.locationId} 
                  onValueChange={(value) => setFormData({...formData, locationId: value})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4" />
                          {loc.name} - {loc.city || loc.address}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowNewLocation(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create New Location Instead
              </Button>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Location Details</h3>
                {locations.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowNewLocation(false)}
                  >
                    Use Existing Location
                  </Button>
                )}
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="loc-name">Location Name *</Label>
                  <Input
                    id="loc-name"
                    placeholder={`Location ${locations.length + 1}`}
                    value={formData.newLocation.name}
                    onChange={(e) => setFormData({
                      ...formData,
                      newLocation: {...formData.newLocation, name: e.target.value}
                    })}
                  />
                  <p className="text-xs text-muted-foreground">
                    e.g., Home, Office, Main Property
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="loc-address">Address *</Label>
                  <Input
                    id="loc-address"
                    placeholder="123 Main Street"
                    value={formData.newLocation.address}
                    onChange={(e) => setFormData({
                      ...formData,
                      newLocation: {...formData.newLocation, address: e.target.value}
                    })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="loc-city">City</Label>
                    <Input
                      id="loc-city"
                      placeholder="Durban"
                      value={formData.newLocation.city}
                      onChange={(e) => setFormData({
                        ...formData,
                        newLocation: {...formData.newLocation, city: e.target.value}
                      })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="loc-postal">Postal Code</Label>
                    <Input
                      id="loc-postal"
                      placeholder="4001"
                      value={formData.newLocation.postalCode}
                      onChange={(e) => setFormData({
                        ...formData,
                        newLocation: {...formData.newLocation, postalCode: e.target.value}
                      })}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Service Type */}
      {step === 2 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {serviceTypes.map((service) => (
            <Card
              key={service.id}
              className={`cursor-pointer transition-all ${
                !service.available
                  ? 'opacity-50 cursor-not-allowed'
                  : formData.serviceType === service.id
                  ? 'border-primary border-2 bg-primary/5'
                  : 'hover:border-primary/50'
              }`}
              onClick={() => service.available && setFormData({...formData, serviceType: service.id})}
            >
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className={service.available ? 'text-primary' : 'text-muted-foreground'}>
                    {service.icon}
                  </div>
                  {service.comingSoon && (
                    <Badge variant="secondary">
                      <Lock className="h-3 w-3 mr-1" />
                      Soon
                    </Badge>
                  )}
                  {formData.serviceType === service.id && (
                    <CheckCircle className="h-5 w-5 text-primary" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-lg">{service.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {service.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Step 3: Garden Details */}
      {step === 3 && formData.serviceType === 'garden' && (
        <div className="space-y-6">
          {formData.gardens.map((garden, index) => (
            <Card key={index}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Garden {index + 1}</CardTitle>
                    <CardDescription>
                      {index === 0 ? 'Tell us about your garden' : 'Add another garden at this location'}
                    </CardDescription>
                  </div>
                  {formData.gardens.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const newGardens = formData.gardens.filter((_, i) => i !== index);
                        setFormData({ ...formData, gardens: newGardens });
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor={`garden-name-${index}`}>Garden Name *</Label>
                    <Input
                      id={`garden-name-${index}`}
                      placeholder={`Garden ${index + 1}`}
                      value={garden.name}
                      onChange={(e) => {
                        const newGardens = [...formData.gardens];
                        newGardens[index].name = e.target.value;
                        setFormData({ ...formData, gardens: newGardens });
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`garden-area-${index}`}>Area (m²) *</Label>
                    <Input
                      id={`garden-area-${index}`}
                      type="number"
                      placeholder="250"
                      value={garden.area_sqm}
                      onChange={(e) => {
                        const newGardens = [...formData.gardens];
                        newGardens[index].area_sqm = e.target.value;
                        setFormData({ ...formData, gardens: newGardens });
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Add Another Garden Button */}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              const nextIndex = formData.gardens.length + 1;
              setFormData({
                ...formData,
                gardens: [
                  ...formData.gardens,
                  {
                    name: `Garden ${nextIndex}`,
                    area_sqm: ''
                  }
                ]
              });
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Another Garden
          </Button>
        </div>
      )}

      {/* Step 4: Review & Pricing */}
      {step === 4 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Summary */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Service Summary</CardTitle>
                <CardDescription>Review your selections</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Location</p>
                  <p className="font-medium">
                    {showNewLocation 
                      ? formData.newLocation.name || 'New Location'
                      : locations.find(l => l.id === formData.locationId)?.name}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {formData.newLocation.address}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Service Type</p>
                  <p className="font-medium capitalize">{formData.serviceType} Maintenance</p>
                </div>
              </CardContent>
            </Card>

            {/* Gardens Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Gardens ({formData.gardens.filter(g => g.name && g.area_sqm).length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {formData.gardens
                  .filter(g => g.name && g.area_sqm)
                  .map((garden, index) => (
                    <div key={index} className="p-3 bg-muted rounded-lg">
                      <div className="font-medium">{garden.name}</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {garden.area_sqm} m²
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </div>

          {/* Price Calculator */}
          <PriceCalculator 
            serviceType={formData.serviceType}
            totalArea={formData.gardens.reduce((sum, g) => sum + (parseFloat(g.area_sqm) || 0), 0)}
            gardenCount={formData.gardens.filter(g => g.name && g.area_sqm).length}
            onPriceChange={setCalculatedPricing}
          />
        </div>
      )}

      {/* Step 5: Payment Method */}
      {step === 5 && (
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <div className="text-center">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <CreditCard className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="text-2xl">Payment Method</CardTitle>
                <CardDescription>
                  {hasPaymentMethod 
                    ? "You're all set for automatic billing" 
                    : "Add a card to enable automatic monthly billing"}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {hasPaymentMethod ? (
                <div className="space-y-4">
                  <div className="p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="h-6 w-6 text-green-600" />
                      <div>
                        <p className="font-semibold">Payment Method Ready</p>
                        <p className="text-sm text-muted-foreground">
                          You have {authorizations.length} card{authorizations.length !== 1 ? 's' : ''} on file
                        </p>
                      </div>
                    </div>
                  </div>
                  {authorizations.slice(0, 1).map(auth => (
                    <div key={auth.id} className="flex items-center gap-3 p-4 bg-muted rounded-lg">
                      <CreditCard className="h-8 w-8 text-primary" />
                      <div className="flex-1">
                        <p className="font-semibold">•••• •••• •••• {auth.last4}</p>
                        <p className="text-sm text-muted-foreground">
                          {auth.card_type} • Expires {auth.exp_month}/{auth.exp_year}
                        </p>
                      </div>
                      {auth.is_default && <Badge>Default</Badge>}
                    </div>
                  ))}
                  <p className="text-xs text-center text-muted-foreground">
                    Manage cards in Billing settings
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Card Verification:</strong> We'll charge R1 to verify your card.
                    </AlertDescription>
                  </Alert>

                  <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
                    <Lock className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-semibold text-sm">Secure Payment</p>
                      <p className="text-xs text-muted-foreground">
                        Your card details are processed securely by Paystack
                      </p>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground text-center">
                    💳 Monthly automatic billing • Cancel anytime
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Navigation Buttons */}
      <Card>
        <CardContent className="flex items-center justify-between pt-6">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => navigate(-1)}
              disabled={loading}
            >
              <Home className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            {step > 1 && (
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={loading}
              >
                <ChevronLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            )}
          </div>

          {step < 5 ? (
            <Button onClick={handleNext} disabled={loading}>
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <div className="flex gap-2">
              {!hasPaymentMethod && (
                <Button 
                  size="lg"
                  onClick={async () => {
                    if (user?.email && selectedOrg?.organization_id) {
                      await addPaymentMethod(user.email, selectedOrg.organization_id);
                    }
                  }}
                  disabled={processing}
                  className="flex-1"
                >
                  {processing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Redirecting...
                    </>
                  ) : (
                    <>
                      <CreditCard className="h-4 w-4 mr-2" />
                      Add Card & Complete
                    </>
                  )}
                </Button>
              )}
              <Button 
                onClick={handleSubmit} 
                disabled={loading}
                size="lg"
                className="flex-1"
                variant={hasPaymentMethod ? "default" : "outline"}
              >
                {loading ? 'Creating...' : (hasPaymentMethod ? 'Complete Setup' : 'Skip & Complete')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

