import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MapPin, Loader2, CheckCircle, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import LocationChecker from './location-checker';

export default function LocationWizard({ 
  organizationId, 
  onComplete, 
  onCancel,
  embedded = false,
  title = "Create Your First Location",
  description = "Let's start by adding a location for your property. This is where your bot services will be deployed.",
  showCancel = true
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [coverageChecked, setCoverageChecked] = useState(false);
  const [formData, setFormData] = useState({
    name: 'Home',
    address: '',
    city: '',
    province: 'KwaZulu-Natal',
    postalCode: '',
    latitude: null,
    longitude: null
  });

  const handleLocationSelect = (location, coverageData, checked) => {
    setSelectedLocation(location);
    setCoverage(coverageData);
    setCoverageChecked(checked);
    setFormData({
      ...formData,
      address: location.address,
      city: location.city || formData.city,
      province: location.province || formData.province,
      postalCode: location.postalCode || formData.postalCode,
      latitude: location.latitude,
      longitude: location.longitude
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.name || !formData.address) {
      toast({
        title: 'Missing Information',
        description: 'Please provide a location name and address',
        variant: 'destructive'
      });
      return;
    }

    // Check if location is in coverage area
    if (coverageChecked && !coverage?.is_inside) {
      toast({
        title: 'Location Not in Service Area',
        description: 'This location is outside our current service area. Please contact us to request coverage.',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      const locationData = {
        organization_id: organizationId,
        name: formData.name,
        address: formData.address,
        city: formData.city,
        province: formData.province,
        postal_code: formData.postalCode,
        latitude: selectedLocation?.latitude || formData.latitude,
        longitude: selectedLocation?.longitude || formData.longitude
      };

      const { data: newLocation, error } = await supabase
        .from('locations')
        .insert(locationData)
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Location Created! 🎉',
        description: `${formData.name} has been added successfully.`,
      });

      // Call onComplete callback if provided
      if (onComplete) {
        onComplete(newLocation);
      }
    } catch (error) {
      console.error('Error creating location:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create location',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Location Checker with Map */}
      <LocationChecker
        initialAddress={formData.address}
        onLocationSelect={handleLocationSelect}
        embedded={true}
      />

      {/* Location Details Form */}
      <div className="space-y-4 pt-4 border-t">
        <h3 className="font-semibold text-lg">Location Details</h3>
        
        <div className="space-y-2">
          <Label htmlFor="loc-name">Location Name *</Label>
          <Input
            id="loc-name"
            placeholder="e.g., Home, Office, Main Property"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
          <p className="text-xs text-muted-foreground">
            Give this location a friendly name for easy identification
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="loc-address">Street Address *</Label>
          <Input
            id="loc-address"
            placeholder="123 Main Street"
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="loc-city">City</Label>
            <Input
              id="loc-city"
              placeholder="Durban"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="loc-postal">Postal Code</Label>
            <Input
              id="loc-postal"
              placeholder="4001"
              value={formData.postalCode}
              onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Coverage Status */}
      {selectedLocation && coverageChecked && (
        coverage?.is_inside ? (
          <Alert className="border-green-500 bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              <strong>Location verified!</strong> You can now proceed to create this location.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="border-red-500 bg-red-50">
            <AlertDescription className="text-red-800">
              <strong>Location Not in Service Area</strong>
              <p className="mt-1">This location is outside our current coverage area. Please contact us to request service at this location.</p>
            </AlertDescription>
          </Alert>
        )
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-4 border-t">
        {showCancel && onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={loading || !formData.name || !formData.address || (coverageChecked && !coverage?.is_inside)}
          className="ml-auto"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              Create Location
              <ArrowRight className="h-4 w-4 ml-2" />
            </>
          )}
        </Button>
      </div>
    </form>
  );

  if (embedded) {
    return content;
  }

  return (
    <Card className="max-w-4xl mx-auto">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
            <MapPin className="h-6 w-6 text-primary" />
          </div>
          <div>
            <CardTitle className="text-2xl">{title}</CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {content}
      </CardContent>
    </Card>
  );
}

