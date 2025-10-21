import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  CreditCard,
  AlertCircle,
  RotateCcw,
  Calendar,
  Clock,
  Info,
  Scissors
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { usePaymentAuthorizations, usePaystack } from '@/hooks/use-paystack';
import { useAuth } from '@/context/auth-context';
import PriceCalculator from './price-calculator';
import LocationChecker from './location-checker';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const STORAGE_KEY = 'serviceWizardData';

export default function ServiceWizard({ open, onOpenChange, organizationId, onComplete }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { authorizations, loading: authLoading } = usePaymentAuthorizations();
  const { addPaymentMethod, processing } = usePaystack();

  // Load from localStorage helper
  const loadSavedData = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        console.log('📦 Loaded from localStorage:', parsed);
        return parsed;
      }
    } catch (error) {
      console.error('Error loading saved wizard data:', error);
    }
    return null;
  };

  // Initialize state from localStorage
  const initialData = loadSavedData();
  
  console.log('🔄 Wizard initializing with data:', initialData);
  console.log('📌 Initial step:', initialData?.step || 1);
  
  const [step, setStep] = useState(initialData?.step || 1);
  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState([]);
  const [showNewLocation, setShowNewLocation] = useState(initialData?.showNewLocation || false);

  // Form state
  const [formData, setFormData] = useState(initialData?.formData || {
    // Step 1: Location
    locationId: '',
    selectedLocation: null, // From location checker
    newLocation: {
      name: 'Location 1',
      address: '',
      city: '',
      province: 'KwaZulu-Natal',
      postalCode: '',
      latitude: null,
      longitude: null
    },
    // Step 2: Service Type
    serviceType: 'garden',
    // Step 3: Service Details
    gardenDetails: {
      name: '',
      description: '',
      area_sqm: '',
      grass_type: '',
      terrain_type: 'flat',
      difficulty_level: 'easy',
      has_obstacles: false,
      obstacle_description: '',
      preferred_cut_height_mm: '40',
      preferred_pattern: 'random',
      service_frequency: 'bi-weekly'
    },
    // Step 3.5: Scheduling Preferences
    schedulingPreferences: {
      edge_trimming_per_month: 2, // Default to 2 for bi-weekly
      preferred_day_of_week: 1, // 0=Sunday, 6=Saturday
      preferred_time_window_start: '08:00',
      preferred_time_window_end: '12:00'
    }
  });

  const [calculatedPricing, setCalculatedPricing] = useState(null);
  
  // Always show 6 steps (including scheduling preferences and payment method)
  const totalSteps = 6;
  const hasPaymentMethod = !authLoading && authorizations.length > 0;
  
  console.log('📊 Current step:', step, '/ Total steps:', totalSteps, '| Has payment:', hasPaymentMethod, '| Auth count:', authorizations.length);

  // Save to localStorage on EVERY change
  useEffect(() => {
    const dataToSave = {
      step,
      formData,
      showNewLocation,
      timestamp: Date.now()
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
      console.log('💾 SAVED - Step:', step, 'Data:', {
        step,
        locationId: formData.locationId,
        serviceType: formData.serviceType,
        gardenName: formData.gardenDetails?.name
      });
    } catch (error) {
      console.error('❌ Error saving to localStorage:', error);
    }
  }, [step, formData, showNewLocation]);

  useEffect(() => {
    if (open && organizationId) {
      loadLocations();
      
      // Show toast if data was restored
      if (initialData && initialData.step > 1) {
        setTimeout(() => {
          toast({
            title: "📦 Progress Restored",
            description: `Continuing from Step ${initialData.step}`,
            duration: 3000,
          });
        }, 300);
      }
    }
  }, [open]);

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
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setLocations(data || []);
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
      if (!formData.gardenDetails.name || !formData.gardenDetails.area_sqm) {
        toast({
          title: 'Garden Details Required',
          description: 'Please fill in the garden name and area',
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

  const handleAddCard = async () => {
    if (!user?.email || !organizationId) {
      toast({
        title: "Error",
        description: "Missing user or organization information",
        variant: "destructive"
      });
      return;
    }

    try {
      await addPaymentMethod(user.email, organizationId);
      toast({
        title: "Redirecting to Paystack",
        description: "You'll be charged R1 to verify your card",
      });
    } catch (error) {
      console.error('Error adding card:', error);
      toast({
        title: "Failed to add card",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const handleSkipPayment = () => {
    // Skip payment step and go to submit
    handleSubmit();
  };

  const handleClearProgress = () => {
    localStorage.removeItem(STORAGE_KEY);
    setStep(1);
    setShowNewLocation(false);
    setFormData({
      locationId: '',
      selectedLocation: null,
      newLocation: {
        name: 'Location 1',
        address: '',
        city: '',
        province: 'KwaZulu-Natal',
        postalCode: '',
        latitude: null,
        longitude: null
      },
      serviceType: 'garden',
      gardenDetails: {
        name: '',
        description: '',
        area_sqm: '',
        grass_type: '',
        terrain_type: 'flat',
        difficulty_level: 'easy',
        has_obstacles: false,
        obstacle_description: '',
        preferred_cut_height_mm: '40',
        preferred_pattern: 'random',
        service_frequency: 'bi-weekly'
      },
      schedulingPreferences: {
        edge_trimming_per_month: 2,
        preferred_day_of_week: 1,
        preferred_time_window_start: '08:00',
        preferred_time_window_end: '12:00'
      }
    });
    toast({
      title: "Progress cleared",
      description: "Starting fresh from Step 1",
    });
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      let locationId = formData.locationId;

      // Create new location if needed
      if (showNewLocation) {
        const locationData = {
          organization_id: organizationId,
          ...formData.newLocation
        };

        // Add coordinates if available
        if (formData.selectedLocation) {
          locationData.latitude = formData.selectedLocation.latitude;
          locationData.longitude = formData.selectedLocation.longitude;
        }

        const { data: newLoc, error: locError } = await supabase
          .from('locations')
          .insert(locationData)
          .select()
          .single();

        if (locError) throw locError;
        locationId = newLoc.id;
        
        // Refresh locations list so new location appears
        await loadLocations();
      }

      // Create service first (parent record)
      if (formData.serviceType === 'garden') {
        const { data: service, error: serviceError } = await supabase
          .from('services')
          .insert({
            location_id: locationId,
            service_type: 'garden',
            services_per_month: formData.schedulingPreferences.edge_trimming_per_month,
            service_frequency: formData.gardenDetails.service_frequency
          })
          .select()
          .single();

        if (serviceError) throw serviceError;

        // Create garden details
        const { data: garden, error: gardenError } = await supabase
          .from('gardens')
          .insert({
            service_id: service.id,
            location_id: locationId,
            ...formData.gardenDetails,
            area_sqm: parseFloat(formData.gardenDetails.area_sqm),
            preferred_cut_height_mm: parseInt(formData.gardenDetails.preferred_cut_height_mm)
          })
          .select()
          .single();

        if (gardenError) throw gardenError;

        // Create scheduling preferences
        const { error: prefError } = await supabase
          .from('service_preferences')
          .insert({
            service_id: service.id,
            day_of_week: formData.schedulingPreferences.preferred_day_of_week,
            time_window_start: formData.schedulingPreferences.preferred_time_window_start,
            time_window_end: formData.schedulingPreferences.preferred_time_window_end,
            priority: 1,
            is_active: true
          });

        if (prefError) throw prefError;

        toast({
          title: 'Service Created Successfully! 🎉',
          description: 'You will receive communication regarding installation of your service within 24-48 hours. Our team will contact you to schedule the bot setup.',
          duration: 7000,
        });

        // Clear localStorage on successful completion
        localStorage.removeItem(STORAGE_KEY);
        
        if (onComplete) onComplete(garden);
        resetForm();
        onOpenChange(false);
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

  const resetForm = () => {
    // Clear localStorage on reset
    localStorage.removeItem(STORAGE_KEY);
    
    setStep(1);
    setShowNewLocation(false);
    setFormData({
      locationId: '',
      selectedLocation: null,
      newLocation: {
        name: '',
        address: '',
        city: '',
        province: 'KwaZulu-Natal',
        postalCode: '',
        latitude: null,
        longitude: null
      },
      serviceType: 'garden',
      gardenDetails: {
        name: '',
        description: '',
        area_sqm: '',
        grass_type: '',
        terrain_type: 'flat',
        difficulty_level: 'easy',
        has_obstacles: false,
        obstacle_description: '',
        preferred_cut_height_mm: '40',
        preferred_pattern: 'random',
        service_frequency: 'bi-weekly'
      },
      schedulingPreferences: {
        edge_trimming_per_month: 2,
        preferred_day_of_week: 1,
        preferred_time_window_start: '08:00',
        preferred_time_window_end: '12:00'
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-2xl">Add New Service</DialogTitle>
              <DialogDescription>
                Step {step} of {totalSteps}: {
                  step === 1 ? 'Choose Location' :
                  step === 2 ? 'Select Service Type' :
                  step === 3 ? 'Service Details' :
                  step === 4 ? 'Scheduling Preferences' :
                  step === 5 ? 'Review & Pricing' :
                  'Add Payment Method'
                }
              </DialogDescription>
            </div>
            {step > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearProgress}
                className="gap-1"
              >
                <RotateCcw className="h-3 w-3" />
                Start Over
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Progress Bar */}
        <div className="space-y-2 mb-6">
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
              Progress auto-saved • Refresh-safe 💾
            </p>
          )}
        </div>

        {/* Step 1: Location */}
        {step === 1 && (
          <div className="space-y-4">
            {/* Location Checker with Map */}
            <LocationChecker
              initialAddress={formData.newLocation.address}
              onLocationSelect={(location) => {
                setFormData({
                  ...formData,
                  selectedLocation: location,
                  newLocation: {
                    ...formData.newLocation,
                    address: location.address,
                    latitude: location.latitude,
                    longitude: location.longitude
                  }
                });
              }}
            />

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  {showNewLocation ? 'Location Details' : 'Select Existing Location'}
                </span>
              </div>
            </div>

            {!showNewLocation ? (
              <>
                <div className="space-y-2">
                  <Label>Select Location</Label>
                  <Select 
                    value={formData.locationId} 
                    onValueChange={(value) => setFormData({...formData, locationId: value})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a location" />
                    </SelectTrigger>
                    <SelectContent position="popper" sideOffset={5}>
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

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">Or</span>
                  </div>
                </div>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowNewLocation(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create New Location
                </Button>
              </>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">New Location Details</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowNewLocation(false)}
                  >
                    Cancel
                  </Button>
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
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="garden-name">Garden Name *</Label>
                <Input
                  id="garden-name"
                  placeholder="e.g., Front Garden, Back Lawn"
                  value={formData.gardenDetails.name}
                  onChange={(e) => setFormData({
                    ...formData,
                    gardenDetails: {...formData.gardenDetails, name: e.target.value}
                  })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="garden-area">Area (m²) *</Label>
                <Input
                  id="garden-area"
                  type="number"
                  placeholder="250"
                  value={formData.gardenDetails.area_sqm}
                  onChange={(e) => setFormData({
                    ...formData,
                    gardenDetails: {...formData.gardenDetails, area_sqm: e.target.value}
                  })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="garden-description">Description (Optional)</Label>
              <Textarea
                id="garden-description"
                placeholder="Describe your garden..."
                value={formData.gardenDetails.description}
                onChange={(e) => setFormData({
                  ...formData,
                  gardenDetails: {...formData.gardenDetails, description: e.target.value}
                })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="grass-type">Grass Type (Optional)</Label>
                <Input
                  id="grass-type"
                  placeholder="e.g., Kikuyu, LM"
                  value={formData.gardenDetails.grass_type}
                  onChange={(e) => setFormData({
                    ...formData,
                    gardenDetails: {...formData.gardenDetails, grass_type: e.target.value}
                  })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="terrain">Terrain Type</Label>
                <Select 
                  value={formData.gardenDetails.terrain_type}
                  onValueChange={(value) => setFormData({
                    ...formData,
                    gardenDetails: {...formData.gardenDetails, terrain_type: value}
                  })}
                >
                  <SelectTrigger id="terrain">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={5}>
                    <SelectItem value="flat">Flat</SelectItem>
                    <SelectItem value="sloped">Sloped</SelectItem>
                    <SelectItem value="mixed">Mixed</SelectItem>
                    <SelectItem value="hilly">Hilly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cut-height">Preferred Cut Height (mm)</Label>
                <Input
                  id="cut-height"
                  type="number"
                  value={formData.gardenDetails.preferred_cut_height_mm}
                  onChange={(e) => setFormData({
                    ...formData,
                    gardenDetails: {...formData.gardenDetails, preferred_cut_height_mm: e.target.value, service_frequency: 'monthly'}
                  })}
                />
              </div>

              <div className="p-3 bg-muted/50 rounded-lg border">
                <p className="text-sm font-medium">Bot Servicing Frequency</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Once per month (fixed) - Bots are automatically serviced monthly
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Scheduling Preferences */}
        {step === 4 && formData.serviceType === 'garden' && (
          <div className="space-y-6">
            {/* Important Information Alert */}
            <Alert className="border-primary/50 bg-primary/5">
              <Info className="h-4 w-4 text-primary" />
              <AlertTitle>Service Scheduling Information</AlertTitle>
              <AlertDescription className="space-y-2 text-sm">
                <p className="font-medium">Please note:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li><strong>Bot servicing:</strong> Bots are automatically serviced once a month (fixed)</li>
                  <li><strong>Edge trimming:</strong> Select 1-4 edge trimming visits per month based on your needs</li>
                  <li><strong>Flexible scheduling:</strong> Your preferred day and time are our priority, but may change due to weather, environmental conditions, or logistical factors</li>
                  <li><strong>Appointment allocation:</strong> One of your selected time windows will be chosen for each visit</li>
                </ul>
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-1 gap-6">
              {/* Edge Trimming Frequency */}
              <Card className="border-2">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Scissors className="h-5 w-5 text-primary" />
                    <h3 className="font-semibold text-lg">Edge Trimming Frequency</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Choose how many edge trimming visits you'd like per month (1-4 visits)
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <Label>Visits per Month</Label>
                    <div className="grid grid-cols-4 gap-3">
                      {[1, 2, 3, 4].map((visits) => (
                        <button
                          key={visits}
                          type="button"
                          onClick={() => setFormData({
                            ...formData,
                            gardenDetails: {...formData.gardenDetails, service_frequency: 'monthly'},
                            schedulingPreferences: {
                              ...formData.schedulingPreferences,
                              edge_trimming_per_month: visits
                            }
                          })}
                          className={`p-6 rounded-lg border-2 text-center transition-all ${
                            formData.schedulingPreferences.edge_trimming_per_month === visits
                              ? 'border-primary bg-primary/10 shadow-md'
                              : 'border-border hover:border-primary/50 hover:bg-muted'
                          }`}
                        >
                          <div className="text-3xl font-bold mb-2 text-primary">{visits}</div>
                          <div className="text-xs text-muted-foreground">
                            visit{visits > 1 ? 's' : ''}/month
                          </div>
                          <div className="text-sm font-semibold mt-2">
                            R{visits * 100}
                          </div>
                          {formData.schedulingPreferences.edge_trimming_per_month === visits && (
                            <CheckCircle className="h-5 w-5 text-primary mx-auto mt-2" />
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <p className="text-sm text-center">
                        <strong>R{(formData.schedulingPreferences.edge_trimming_per_month * 100).toFixed(2)}/month</strong> for edge trimming
                        <span className="text-muted-foreground ml-1">(R100 per visit)</span>
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Preferred Day of Week */}
              <Card className="border-2">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-primary" />
                    <h3 className="font-semibold text-lg">Preferred Day of Week</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Choose your preferred day for service visits
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <Label>Select Day</Label>
                    <div className="grid grid-cols-7 gap-2">
                      {[
                        { value: 0, label: 'Sun', full: 'Sunday' },
                        { value: 1, label: 'Mon', full: 'Monday' },
                        { value: 2, label: 'Tue', full: 'Tuesday' },
                        { value: 3, label: 'Wed', full: 'Wednesday' },
                        { value: 4, label: 'Thu', full: 'Thursday' },
                        { value: 5, label: 'Fri', full: 'Friday' },
                        { value: 6, label: 'Sat', full: 'Saturday' }
                      ].map((day) => (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => setFormData({
                            ...formData,
                            schedulingPreferences: {
                              ...formData.schedulingPreferences,
                              preferred_day_of_week: day.value
                            }
                          })}
                          className={`p-3 rounded-lg border-2 text-center transition-all ${
                            formData.schedulingPreferences.preferred_day_of_week === day.value
                              ? 'border-primary bg-primary text-primary-foreground shadow-md'
                              : 'border-border hover:border-primary/50 hover:bg-muted'
                          }`}
                          title={day.full}
                        >
                          <div className="text-xs font-semibold">{day.label}</div>
                        </button>
                      ))}
                    </div>
                    {formData.schedulingPreferences?.preferred_day_of_week !== undefined && (
                      <p className="text-sm text-muted-foreground">
                        ✓ Selected: {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][formData.schedulingPreferences.preferred_day_of_week]}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Preferred Time Window */}
              <Card className="border-2">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-primary" />
                    <h3 className="font-semibold text-lg">Preferred Time Window</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Select your preferred time range for service visits
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="time-start">Start Time</Label>
                      <Select 
                        value={formData.schedulingPreferences.preferred_time_window_start}
                        onValueChange={(value) => setFormData({
                          ...formData,
                          schedulingPreferences: {
                            ...formData.schedulingPreferences,
                            preferred_time_window_start: value
                          }
                        })}
                      >
                        <SelectTrigger id="time-start">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper" sideOffset={5}>
                          <SelectItem value="06:00">6:00 AM</SelectItem>
                          <SelectItem value="07:00">7:00 AM</SelectItem>
                          <SelectItem value="08:00">8:00 AM</SelectItem>
                          <SelectItem value="09:00">9:00 AM</SelectItem>
                          <SelectItem value="10:00">10:00 AM</SelectItem>
                          <SelectItem value="11:00">11:00 AM</SelectItem>
                          <SelectItem value="12:00">12:00 PM</SelectItem>
                          <SelectItem value="13:00">1:00 PM</SelectItem>
                          <SelectItem value="14:00">2:00 PM</SelectItem>
                          <SelectItem value="15:00">3:00 PM</SelectItem>
                          <SelectItem value="16:00">4:00 PM</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="time-end">End Time</Label>
                      <Select 
                        value={formData.schedulingPreferences.preferred_time_window_end}
                        onValueChange={(value) => setFormData({
                          ...formData,
                          schedulingPreferences: {
                            ...formData.schedulingPreferences,
                            preferred_time_window_end: value
                          }
                        })}
                      >
                        <SelectTrigger id="time-end">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper" sideOffset={5}>
                          <SelectItem value="08:00">8:00 AM</SelectItem>
                          <SelectItem value="09:00">9:00 AM</SelectItem>
                          <SelectItem value="10:00">10:00 AM</SelectItem>
                          <SelectItem value="11:00">11:00 AM</SelectItem>
                          <SelectItem value="12:00">12:00 PM</SelectItem>
                          <SelectItem value="13:00">1:00 PM</SelectItem>
                          <SelectItem value="14:00">2:00 PM</SelectItem>
                          <SelectItem value="15:00">3:00 PM</SelectItem>
                          <SelectItem value="16:00">4:00 PM</SelectItem>
                          <SelectItem value="17:00">5:00 PM</SelectItem>
                          <SelectItem value="18:00">6:00 PM</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    Services are typically scheduled within this time window
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Step 5: Review & Pricing */}
        {step === 5 && (
          <div className="space-y-6">
            {console.log('🎨 Rendering Step 4 - Review & Pricing')}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Summary */}
              <Card>
                <CardHeader>
                  <h3 className="font-semibold">Service Summary</h3>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Location</p>
                    <p className="font-medium">
                      {showNewLocation 
                        ? formData.newLocation.name 
                        : locations.find(l => l.id === formData.locationId)?.name}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Service Type</p>
                    <p className="font-medium capitalize">{formData.serviceType} Maintenance</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Garden Name</p>
                    <p className="font-medium">{formData.gardenDetails.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Area</p>
                    <p className="font-medium">{formData.gardenDetails.area_sqm} m²</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Frequency</p>
                    <p className="font-medium">{formData.gardenDetails.service_frequency === 'bi-weekly' ? 'Bi-Weekly (Every 2 Weeks)' : 'Monthly (Every 4 Weeks)'}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Price Calculator */}
              <div>
                <PriceCalculator 
                  serviceType={formData.serviceType}
                  onPriceChange={setCalculatedPricing}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 6: Payment Method */}
        {step === 6 && (
          <div className="space-y-6">
            {console.log('🎨 Rendering Step 5 - hasPaymentMethod:', hasPaymentMethod, 'authorizations:', authorizations.length)}
            {hasPaymentMethod ? (
              // User has payment method - show success message
              <div className="text-center">
                <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
                <h3 className="text-2xl font-bold mb-2">Payment Method Ready</h3>
                <p className="text-muted-foreground mb-6">
                  You have {authorizations.length} payment {authorizations.length === 1 ? 'method' : 'methods'} on file. 
                  You're all set for automatic billing!
                </p>
                
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-3">
                      {authorizations.slice(0, 1).map(auth => (
                        <div key={auth.id} className="flex items-center gap-3 p-4 bg-primary/10 rounded-lg">
                          <CreditCard className="h-8 w-8 text-primary" />
                          <div className="flex-1 text-left">
                            <p className="font-semibold">•••• •••• •••• {auth.last4}</p>
                            <p className="text-sm text-muted-foreground">
                              {auth.card_type} • Expires {auth.exp_month}/{auth.exp_year}
                            </p>
                          </div>
                          {auth.is_default && (
                            <Badge variant="default">Default</Badge>
                          )}
                        </div>
                      ))}
                      <p className="text-xs text-center text-muted-foreground mt-4">
                        Manage payment methods in Billing settings
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              // User needs to add payment method
              <div>
                <div className="text-center mb-6">
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <CreditCard className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-2xl font-bold mb-2">Add Payment Method</h3>
                  <p className="text-muted-foreground">
                    Add a card to enable automatic monthly billing
                  </p>
                </div>

                <Alert className="mb-6">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Card Verification</AlertTitle>
                  <AlertDescription>
                    We'll charge R1 to verify your card. This is a one-time verification charge 
                    to ensure your card is valid for future automatic payments.
                  </AlertDescription>
                </Alert>

                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
                        <Lock className="h-5 w-5 text-primary" />
                        <div className="flex-1">
                          <p className="font-semibold text-sm">Secure Payment</p>
                          <p className="text-xs text-muted-foreground">
                            Your card details are processed securely by Paystack
                          </p>
                        </div>
                      </div>

                      <p className="text-sm text-muted-foreground text-center">
                        💳 Monthly automatic billing for your subscription
                      </p>

                      <p className="text-xs text-center text-muted-foreground">
                        You can manage your payment methods anytime in Billing settings
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="flex items-center justify-between pt-6 border-t">
          {step > 1 ? (
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={loading}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          ) : <div />}

          {step < 6 ? (
            <Button onClick={handleNext} disabled={loading}>
              {console.log('🔘 Showing Next button for step:', step)}
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <div className="flex gap-2">
              {!hasPaymentMethod && (
                <Button 
                  size="lg"
                  onClick={handleAddCard}
                  disabled={processing}
                  className="flex-1"
                >
                  {processing ? (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2 animate-pulse" />
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
                variant={hasPaymentMethod ? "default" : "outline"}
                size="lg"
                className="flex-1"
              >
                {loading ? 'Creating...' : (hasPaymentMethod ? 'Complete Setup' : 'Skip & Complete')}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

