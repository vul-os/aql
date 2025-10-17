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
  AlertCircle,
  Calendar,
  Info
} from 'lucide-react';
import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import { usePaymentAuthorizations, usePaystack } from '@/hooks/use-paystack';
import PriceCalculator from '@/components/services/price-calculator';
import LocationChecker from '@/components/services/location-checker';
import ScheduleSelector from '@/components/services/schedule-selector';
import LocationWizard from '@/components/services/location-wizard';
import SignaturePad from '@/components/services/signature-pad';

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
  const [showLocationWizard, setShowLocationWizard] = useState(false);

  // Get passed location from landing page
  const passedLocation = location.state?.location;

  // Now 6 steps (added signature step)
  const totalSteps = 6;
  const hasPaymentMethod = !authLoading && authorizations.length > 0;

  // Form state
  const [formData, setFormData] = useState(initialData?.formData || {
    locationId: '',
    serviceType: 'garden',
    gardens: [
      {
        name: 'Garden 1',
        area_sqm: ''
      }
    ],
    schedule: {
      scheduleType: 'weekly',
      weeklyDays: [],
      monthlyDays: [],
      preferredTime: '10:00',
      isValid: false
    },
    signature: null
  });

  const [calculatedPricing, setCalculatedPricing] = useState(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [agreementPdfUrl, setAgreementPdfUrl] = useState(null);

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
      
      // Auto-select first location if none is selected
      if (data && data.length > 0 && !formData.locationId) {
        setFormData(prev => ({ ...prev, locationId: data[0].id }));
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

  const handleNext = async () => {
    if (step === 1) {
      if (!formData.locationId) {
        toast({
          title: 'Location Required',
          description: 'Please select a location',
          variant: 'destructive'
        });
        return;
      }
    }

    if (step === 1 && !formData.serviceType) {
      toast({
        title: 'Service Type Required',
        description: 'Please select a service type',
        variant: 'destructive'
      });
      return;
    }

    if (step === 2) {
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

    if (step === 3) {
      // Validate schedule
      if (!formData.schedule || !formData.schedule.isValid) {
        toast({
          title: 'Schedule Required',
          description: 'Please set up a valid service schedule',
          variant: 'destructive'
        });
        return;
      }
    }

    // Step 5: Generate PDF and save signature after user signs
    if (step === 5 && formData.signature) {
      try {
        setGeneratingPdf(true);
        
        // Validate required data
        if (!user?.id) {
          throw new Error('User ID is required');
        }
        if (!selectedOrg?.organization_id) {
          throw new Error('Organization ID is required');
        }
        if (!formData.locationId) {
          throw new Error('Location ID is required');
        }

        // Edge Function will fetch user profile, location, and calculate pricing
        // We only send the essential service details
        const requestBody = {
          user_id: user.id,
          organization_id: selectedOrg.organization_id,
          location_id: formData.locationId,
          signature_base64: formData.signature,
          number_of_bots: formData.gardens.length,
          services_per_month: calculatedPricing?.services_per_month || 4,
        };
        
        console.log('Sending agreement data:', JSON.stringify(requestBody, null, 2));
        
        // Call Edge Function to generate PDF and save signature
        const response = await fetch(
          `${supabaseUrl}/functions/v1/generate-agreement-pdf`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify(requestBody)
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Edge Function error response:', errorText);
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch (e) {
            errorData = { error: errorText };
          }
          throw new Error(errorData.error || `Failed to generate agreement PDF (${response.status})`);
        }

        const data = await response.json();
        console.log('Edge Function response:', data);
        
        if (data.success) {
          // Store URLs in form data
          setFormData({
            ...formData,
            signatureUrl: data.signature_url,
            pdfUrl: data.pdf_url,
            signaturePath: data.signature_path,
            pdfPath: data.pdf_path
          });
          
          setAgreementPdfUrl(data.pdf_url);

          toast({
            title: 'Agreement Generated! ✓',
            description: 'Your signature and rental agreement have been saved securely.',
          });
        } else {
          throw new Error(data.error || 'Failed to generate PDF');
        }
        
      } catch (error) {
        console.error('Error generating agreement:', error);
        toast({
          title: 'Generation Failed',
          description: error.message || 'Failed to generate agreement. Please try again.',
          variant: 'destructive'
        });
        // Don't proceed if PDF generation failed
        setGeneratingPdf(false);
        return;
      } finally {
        setGeneratingPdf(false);
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
      const locationId = formData.locationId;

      // Check if service already exists at this location
      const { data: existingCheck, error: checkError } = await supabase
        .rpc('check_service_exists_at_location', {
          p_location_id: locationId,
          p_service_type: formData.serviceType
        });

      if (checkError) {
        console.error('Error checking existing service:', checkError);
        // Continue anyway if function doesn't exist yet
      } else if (existingCheck) {
        toast({
          title: 'Service Already Exists',
          description: `A ${formData.serviceType} service already exists at this location. You can only have one service of each type per location.`,
          variant: 'destructive',
          duration: 5000
        });
        setLoading(false);
        return;
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

        // Create schedules for each garden
        if (formData.schedule && formData.schedule.isValid && gardens) {
          const schedulesToInsert = gardens.map(garden => ({
            organization_id: selectedOrg.organization_id,
            location_id: locationId,
            garden_id: garden.id,
            schedule_type: formData.schedule.scheduleType,
            weekly_days: formData.schedule.weeklyDays || [],
            monthly_days: formData.schedule.monthlyDays || [],
            preferred_time: formData.schedule.preferredTime,
            max_services_per_month: calculatedPricing?.services_per_month || 4,
            created_by: user.id
          }));

          const { error: scheduleError } = await supabase
            .from('service_schedules')
            .insert(schedulesToInsert);

          if (scheduleError) {
            console.error('Error creating schedules:', scheduleError);
            // Don't throw, just log - service is created
          }
        }

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

  // If no locations exist, redirect to services page
  if (!loading && locations.length === 0) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
        <Card className="border-2 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-6">
            <div className="rounded-full bg-orange-100 dark:bg-orange-950 p-8">
              <MapPin className="h-16 w-16 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="space-y-3 max-w-xl">
              <h3 className="text-3xl font-bold">Location Required First</h3>
              <p className="text-muted-foreground text-lg">
                Before you can add services, you need to create a location for your property. 
              </p>
            </div>
            
            <Alert className="max-w-xl">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Go back to the Services page or Dashboard to create your first location.
              </AlertDescription>
            </Alert>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => navigate('/portal')}>
                Go to Dashboard
              </Button>
              <Button onClick={() => navigate('/portal/services')}>
                Go to Services
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add New Service</h1>
          <p className="text-muted-foreground">
            Step {step} of {totalSteps}: {
              step === 1 ? 'Select Location & Service Type' :
              step === 2 ? 'Service Details' :
              step === 3 ? 'Schedule Setup' :
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
              setFormData({
                locationId: locations[0]?.id || '',
                serviceType: 'garden',
                gardens: [{ name: 'Garden 1', area_sqm: '' }],
                schedule: {
                  scheduleType: 'weekly',
                  weeklyDays: [],
                  monthlyDays: [],
                  preferredTime: '10:00',
                  isValid: false
                }
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

      {/* Step 1: Location & Service Type */}
      {step === 1 && (
        <div className="space-y-6">
          {/* Location Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                Select Location
              </CardTitle>
              <CardDescription>
                Choose which property location this service will be for
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label>Location *</Label>
                <div className="flex gap-2">
                  <Select 
                    value={formData.locationId} 
                    onValueChange={(value) => setFormData({...formData, locationId: value})}
                  >
                    <SelectTrigger className="flex-1">
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
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowLocationWizard(true)}
                    title="Add new location"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {formData.locationId && (
                  <p className="text-xs text-muted-foreground">
                    ✓ Location selected: {locations.find(l => l.id === formData.locationId)?.name}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Service Type Selection */}
          <div>
            <h3 className="font-semibold text-lg mb-4">Choose Service Type</h3>
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
          </div>
        </div>
      )}

      {/* Step 2: Garden Details */}
      {step === 2 && formData.serviceType === 'garden' && (
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

          {/* Cost Preview */}
          {formData.gardens.filter(g => g.name && g.area_sqm).length > 0 && (
            <Alert className="bg-primary/5 border-primary">
              <CreditCard className="h-4 w-4 text-primary" />
              <AlertDescription>
                <p className="font-semibold text-primary mb-2">Pricing Preview</p>
                <div className="space-y-1 text-sm">
                  <p>• <strong>Bot Rental:</strong> R150/bot/month (1 bot per garden)</p>
                  <p>• <strong>Service Visits:</strong> Priced per visit based on schedule</p>
                  <p>• <strong>Setup Fee:</strong> R450 first bot, R200 each additional</p>
                </div>
                <div className="mt-3 p-2 bg-background rounded-md">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">
                      {formData.gardens.filter(g => g.name && g.area_sqm).length} Garden{formData.gardens.filter(g => g.name && g.area_sqm).length > 1 ? 's' : ''}
                    </span>
                    <span className="text-primary font-bold">
                      From R{150 * formData.gardens.filter(g => g.name && g.area_sqm).length}/month*
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    *Plus service visit fees. Full pricing shown in next steps.
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* Step 3: Schedule Setup */}
      {step === 3 && (
        <div className="max-w-3xl mx-auto">
          <ScheduleSelector
            schedule={formData.schedule}
            onChange={(scheduleData) => {
              setFormData({
                ...formData,
                schedule: scheduleData
              });
            }}
            maxServicesPerMonth={calculatedPricing?.services_per_month || 4}
            basePrice={calculatedPricing?.monthly_total || 0}
          />
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
                    {locations.find(l => l.id === formData.locationId)?.name}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {locations.find(l => l.id === formData.locationId)?.address}
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

            {/* Schedule Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Service Schedule
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Schedule Type</p>
                    <p className="font-medium capitalize">{formData.schedule?.scheduleType || 'Not set'}</p>
                  </div>
                  {formData.schedule?.weeklyDays?.length > 0 && (
                    <div>
                      <p className="text-sm text-muted-foreground">Weekly Days</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {formData.schedule.weeklyDays.map(day => {
                          const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day];
                          return <Badge key={day} variant="secondary">{dayName}</Badge>;
                        })}
                      </div>
                    </div>
                  )}
                  {formData.schedule?.monthlyDays?.length > 0 && (
                    <div>
                      <p className="text-sm text-muted-foreground">Monthly Days</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {formData.schedule.monthlyDays.map(day => (
                          <Badge key={day} variant="secondary">{day}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground">Preferred Time</p>
                    <p className="font-medium">{formData.schedule?.preferredTime || '10:00'}</p>
                  </div>
                  <div className="mt-3 p-2 bg-muted rounded-md">
                    <p className="text-sm">
                      <span className="font-medium">~{formData.schedule?.estimatedServices || 0}</span> services per month
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Invoice Preview */}
            {calculatedPricing && calculatedPricing.monthly_total > 0 && (
              <Card className="border-2 border-primary">
                <CardHeader className="bg-primary/5">
                  <CardTitle className="flex items-center gap-2 text-primary">
                    <CreditCard className="h-5 w-5" />
                    Invoice Preview
                  </CardTitle>
                  <CardDescription>What you'll be charged</CardDescription>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    {/* First Month */}
                    <div className="pb-4 border-b">
                      <p className="font-semibold text-sm mb-3">First Month Invoice</p>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span>Bot Rental ({calculatedPricing.number_of_bots} bot{calculatedPricing.number_of_bots > 1 ? 's' : ''})</span>
                          <span>R{calculatedPricing.bot_rental_total?.toFixed(2) || '0.00'}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Service Visits ({calculatedPricing.services_per_month}x)</span>
                          <span>R{calculatedPricing.service_total?.toFixed(2) || '0.00'}</span>
                        </div>
                        {calculatedPricing.setup_fee > 0 && (
                          <div className="flex items-center justify-between text-amber-600">
                            <span>Setup Fee (one-time)</span>
                            <span>R{calculatedPricing.setup_fee?.toFixed(2) || '0.00'}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between pt-2 border-t font-bold text-base">
                          <span>First Month Total</span>
                          <span className="text-primary">
                            R{((calculatedPricing.monthly_total || 0) + (calculatedPricing.setup_fee || 0)).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Recurring Monthly */}
                    <div>
                      <p className="font-semibold text-sm mb-3">Ongoing Monthly Invoice</p>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span>Bot Rental ({calculatedPricing.number_of_bots} bot{calculatedPricing.number_of_bots > 1 ? 's' : ''})</span>
                          <span>R{calculatedPricing.bot_rental_total?.toFixed(2) || '0.00'}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Service Visits ({calculatedPricing.services_per_month}x)</span>
                          <span>R{calculatedPricing.service_total?.toFixed(2) || '0.00'}</span>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t font-bold text-base">
                          <span>Monthly Total</span>
                          <span className="text-primary">R{calculatedPricing.monthly_total?.toFixed(2) || '0.00'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Billing Note */}
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        <p className="font-semibold mb-1">Billing Details:</p>
                        <p>• Invoiced monthly on your chosen billing date</p>
                        <p>• Payment auto-collected from your card</p>
                        <p>• Invoice sent to your email each month</p>
                        <p>• Cancel or pause anytime with no penalties</p>
                      </AlertDescription>
                    </Alert>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Price Calculator */}
          <PriceCalculator 
            serviceType={formData.serviceType}
            totalArea={formData.gardens.reduce((sum, g) => sum + (parseFloat(g.area_sqm) || 0), 0)}
            gardenCount={formData.gardens.filter(g => g.name && g.area_sqm).length}
            servicesPerMonth={formData.schedule?.estimatedServices || 1}
            onPriceChange={setCalculatedPricing}
          />
        </div>
      )}

      {/* Step 5: Contract & Signature */}
      {step === 5 && (
        <div className="max-w-3xl mx-auto space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                Bot Rental Agreement
              </CardTitle>
              <CardDescription>
                Review and sign your flexible rental agreement
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Agreement Summary */}
              <div className="bg-muted/50 p-4 rounded-lg space-y-3">
                <h3 className="font-semibold text-lg">Agreement Summary</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Agreement Type</p>
                    <p className="font-medium">Flexible Bot Rental</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Number of Bots</p>
                    <p className="font-medium">{calculatedPricing?.number_of_bots || 0} bot(s)</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Monthly Rental</p>
                    <p className="font-medium">R{calculatedPricing?.bot_rental_total?.toFixed(2) || '0.00'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Service Visits</p>
                    <p className="font-medium">{calculatedPricing?.services_per_month || 0}x/month</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Monthly Total</p>
                    <p className="font-bold text-lg text-primary">R{calculatedPricing?.monthly_total?.toFixed(2) || '0.00'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Contract Length</p>
                    <p className="font-medium text-green-600">Month-to-Month</p>
                  </div>
                </div>
              </div>

              {/* Key Terms */}
              <Alert>
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription>
                  <p className="font-semibold mb-2">Flexible Agreement Benefits:</p>
                  <ul className="space-y-1 text-sm">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-3 w-3 text-green-600" />
                      <span><strong>No Long-term Contract</strong> - Cancel anytime with 30 days notice</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-3 w-3 text-green-600" />
                      <span><strong>Pause Anytime</strong> - Pause service during winter months at no charge</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-3 w-3 text-green-600" />
                      <span><strong>Adjust Schedule</strong> - Change service frequency as your needs change</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-3 w-3 text-green-600" />
                      <span><strong>Bot Deposit</strong> - R500 refundable deposit per bot (refunded when you return the bot)</span>
                    </li>
                  </ul>
                </AlertDescription>
              </Alert>

              {/* Full Terms Link */}
              <div className="p-4 border rounded-lg">
                <p className="text-sm mb-2">
                  Please review the full terms and conditions before signing:
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open('/docs/terms-and-conditions', '_blank')}
                >
                  View Full Terms & Conditions
                </Button>
              </div>

              {/* Signature Pad */}
              <div>
                <SignaturePad
                  signature={formData.signature}
                  onSignatureComplete={(signatureData) => {
                    setFormData({ ...formData, signature: signatureData });
                  }}
                />
              </div>

              {/* PDF Generation Status */}
              {generatingPdf && (
                <Alert>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <AlertDescription>
                    Generating your rental agreement PDF...
                  </AlertDescription>
                </Alert>
              )}

              {agreementPdfUrl && (
                <Alert className="border-green-500 bg-green-50">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertDescription>
                    <div className="flex items-center justify-between">
                      <span className="text-green-800">Agreement PDF generated successfully!</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(agreementPdfUrl, '_blank')}
                      >
                        View PDF
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 6: Payment Method */}
      {step === 6 && (
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

                  {!hasPaymentMethod && (
                    <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-900/20">
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                      <AlertDescription className="text-amber-900 dark:text-amber-100">
                        <strong>Payment Method Required:</strong> You must add a payment method before completing setup. This ensures uninterrupted monthly billing for your bot service.
                      </AlertDescription>
                    </Alert>
                  )}
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

          {step < 6 ? (
            <Button onClick={handleNext} disabled={loading || (step === 5 && !formData.signature)}>
              {step === 5 && !formData.signature ? 'Sign Agreement First' : 'Next'}
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
                disabled={loading || !hasPaymentMethod}
                size="lg"
                className="flex-1"
              >
                {loading ? 'Creating...' : (hasPaymentMethod ? 'Complete Setup' : 'Add Payment Method to Continue')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Location Wizard Modal */}
      {showLocationWizard && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-background rounded-lg shadow-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <LocationWizard
              embedded={true}
              onComplete={(newLocation) => {
                // Reload locations and select the new one
                loadLocations().then(() => {
                  setFormData({...formData, locationId: newLocation.id});
                  setShowLocationWizard(false);
                  toast({
                    title: 'Location Added',
                    description: `${newLocation.name} has been added and selected`,
                  });
                });
              }}
              onCancel={() => setShowLocationWizard(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

