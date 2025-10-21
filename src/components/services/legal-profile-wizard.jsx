import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { 
  FileText, 
  User, 
  Phone, 
  MapPin, 
  AlertCircle, 
  CheckCircle,
  Shield,
  Info
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';

/**
 * LegalProfileWizard Component
 * 
 * Collects legal information required for service contracts:
 * - First name & surname
 * - South African ID number
 * - Physical address
 * - Cell phone number
 * 
 * Can be pre-filled from location address data
 */
export default function LegalProfileWizard({ 
  embedded = false,
  locationAddress = null,
  organizationId,
  onComplete,
  onSkip 
}) {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    first_name: '',
    surname: '',
    id_number: '',
    physical_address: '',
    physical_city: '',
    physical_province: 'KwaZulu-Natal',
    physical_postal_code: '',
    cell_phone: ''
  });

  const [errors, setErrors] = useState({});
  const [orgLegalProfile, setOrgLegalProfile] = useState(null);

  // Load existing organization legal profile OR pre-fill from location
  useEffect(() => {
    const loadOrgLegalProfile = async () => {
      if (!organizationId) return;

      try {
        const { data, error } = await supabase
          .from('organization_legal_profiles')
          .select('*')
          .eq('organization_id', organizationId)
          .single();

        if (error && error.code !== 'PGRST116') throw error;

        if (data) {
          setOrgLegalProfile(data);
          setFormData({
            first_name: data.first_name || '',
            surname: data.surname || '',
            id_number: data.id_number || '',
            // Always prefer location data for address fields if available
            physical_address: locationAddress?.address || data.physical_address || '',
            physical_city: locationAddress?.city || data.physical_city || '',
            physical_province: locationAddress?.province || data.physical_province || 'KwaZulu-Natal',
            physical_postal_code: locationAddress?.postal_code || data.physical_postal_code || '',
            cell_phone: data.cell_phone || ''
          });
        } else if (locationAddress) {
          // Pre-fill from location if no legal profile data
          console.log('[LegalProfileWizard] Pre-filling from location:', {
            address: locationAddress.address,
            city: locationAddress.city,
            province: locationAddress.province,
            postal_code: locationAddress.postal_code
          });
          
          setFormData(prev => ({
            ...prev,
            physical_address: locationAddress.address || '',
            physical_city: locationAddress.city || '',
            physical_province: locationAddress.province || 'KwaZulu-Natal',
            physical_postal_code: locationAddress.postal_code || ''
          }));
        }
      } catch (error) {
        console.error('[LegalProfileWizard] Error loading legal profile:', error);
      }
    };

    loadOrgLegalProfile();
  }, [organizationId, locationAddress]);

  // Validate South African ID number
  const validateIdNumber = (idNumber) => {
    if (!idNumber) return 'ID number is required';
    if (!/^\d{13}$/.test(idNumber)) return 'ID number must be exactly 13 digits';
    return null;
  };

  // Validate phone number
  const validatePhone = (phone) => {
    if (!phone) return 'Cell phone number is required';
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) return 'Phone number must be at least 10 digits';
    return null;
  };

  // Validate form
  const validateForm = () => {
    const newErrors = {};

    if (!formData.first_name?.trim()) newErrors.first_name = 'First name is required';
    if (!formData.surname?.trim()) newErrors.surname = 'Surname is required';
    
    const idError = validateIdNumber(formData.id_number);
    if (idError) newErrors.id_number = idError;
    
    if (!formData.physical_address?.trim()) newErrors.physical_address = 'Physical address is required';
    if (!formData.physical_city?.trim()) newErrors.physical_city = 'City is required';
    
    const phoneError = validatePhone(formData.cell_phone);
    if (phoneError) newErrors.cell_phone = phoneError;

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      toast({
        title: 'Validation Error',
        description: 'Please correct the errors in the form',
        variant: 'destructive'
      });
      return;
    }

    if (!organizationId) {
      toast({
        title: 'Error',
        description: 'Organization ID is required',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('update_org_legal_profile', {
        p_organization_id: organizationId,
        p_user_id: user.id,
        p_first_name: formData.first_name.trim(),
        p_surname: formData.surname.trim(),
        p_id_number: formData.id_number.replace(/\D/g, ''),
        p_physical_address: formData.physical_address.trim(),
        p_physical_city: formData.physical_city.trim(),
        p_physical_province: formData.physical_province,
        p_physical_postal_code: formData.physical_postal_code.trim(),
        p_cell_phone: formData.cell_phone.replace(/\D/g, '')
      });

      if (error) throw error;

      if (!data?.success) {
        throw new Error(data?.error || 'Failed to update legal profile');
      }

      toast({
        title: 'Legal Profile Complete ✓',
        description: 'Organization legal information has been saved securely. You can now proceed with service contracts.',
        duration: 5000
      });

      // Refresh profile in context
      await refreshProfile?.();

      // Call onComplete callback
      if (onComplete) {
        onComplete(data.profile);
      }
    } catch (error) {
      console.error('Error updating legal profile:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save legal profile',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    if (onSkip) {
      onSkip();
    }
  };

  return (
    <div className={embedded ? '' : 'p-4 md:p-6 max-w-3xl mx-auto'}>
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-3">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-2xl">Legal Profile Information</CardTitle>
              <CardDescription>
                Required for service contracts and legal documentation
              </CardDescription>
            </div>
          </div>

          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription>
              <strong>Why we need this:</strong> Your legal information is required for service agreements, 
              invoicing, and compliance. This information is encrypted and securely stored.
            </AlertDescription>
          </Alert>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Personal Information */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              <h3 className="font-semibold text-lg">Personal Information</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="first_name">
                  First Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="first_name"
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                  placeholder="John"
                  className={errors.first_name ? 'border-destructive' : ''}
                />
                {errors.first_name && (
                  <p className="text-xs text-destructive">{errors.first_name}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="surname">
                  Surname <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="surname"
                  value={formData.surname}
                  onChange={(e) => setFormData({ ...formData, surname: e.target.value })}
                  placeholder="Doe"
                  className={errors.surname ? 'border-destructive' : ''}
                />
                {errors.surname && (
                  <p className="text-xs text-destructive">{errors.surname}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="id_number">
                South African ID Number <span className="text-destructive">*</span>
              </Label>
              <Input
                id="id_number"
                value={formData.id_number}
                onChange={(e) => setFormData({ ...formData, id_number: e.target.value })}
                placeholder="8001015009087"
                maxLength={13}
                className={errors.id_number ? 'border-destructive' : ''}
              />
              {errors.id_number && (
                <p className="text-xs text-destructive">{errors.id_number}</p>
              )}
              <p className="text-xs text-muted-foreground">
                13-digit South African ID number
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cell_phone">
                Cell Phone Number <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cell_phone"
                type="tel"
                value={formData.cell_phone}
                onChange={(e) => setFormData({ ...formData, cell_phone: e.target.value })}
                placeholder="0821234567 or +27821234567"
                className={errors.cell_phone ? 'border-destructive' : ''}
              />
              {errors.cell_phone && (
                <p className="text-xs text-destructive">{errors.cell_phone}</p>
              )}
            </div>
          </div>

          {/* Physical Address */}
          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <h3 className="font-semibold text-lg">Physical Address</h3>
              {locationAddress && (
                <Badge variant="outline" className="ml-auto">Pre-filled from location</Badge>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="physical_address">
                Street Address <span className="text-destructive">*</span>
              </Label>
              <Input
                id="physical_address"
                value={formData.physical_address}
                onChange={(e) => setFormData({ ...formData, physical_address: e.target.value })}
                placeholder="123 Main Street, Suburb"
                className={errors.physical_address ? 'border-destructive' : ''}
              />
              {errors.physical_address && (
                <p className="text-xs text-destructive">{errors.physical_address}</p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="physical_city">
                  City <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="physical_city"
                  value={formData.physical_city}
                  onChange={(e) => setFormData({ ...formData, physical_city: e.target.value })}
                  placeholder="Durban"
                  className={errors.physical_city ? 'border-destructive' : ''}
                />
                {errors.physical_city && (
                  <p className="text-xs text-destructive">{errors.physical_city}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="physical_province">Province</Label>
                <select
                  id="physical_province"
                  value={formData.physical_province}
                  onChange={(e) => setFormData({ ...formData, physical_province: e.target.value })}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="Eastern Cape">Eastern Cape</option>
                  <option value="Free State">Free State</option>
                  <option value="Gauteng">Gauteng</option>
                  <option value="KwaZulu-Natal">KwaZulu-Natal</option>
                  <option value="Limpopo">Limpopo</option>
                  <option value="Mpumalanga">Mpumalanga</option>
                  <option value="Northern Cape">Northern Cape</option>
                  <option value="North West">North West</option>
                  <option value="Western Cape">Western Cape</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="physical_postal_code">Postal Code</Label>
              <Input
                id="physical_postal_code"
                value={formData.physical_postal_code}
                onChange={(e) => setFormData({ ...formData, physical_postal_code: e.target.value })}
                placeholder="4001"
                maxLength={4}
              />
            </div>
          </div>

          {/* Privacy Notice */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <strong>Privacy:</strong> Your information is stored securely and will only be used for 
              service contracts, invoicing, and legal compliance. We never share your personal 
              information with third parties without your consent.
            </AlertDescription>
          </Alert>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            {onSkip && (
              <Button
                type="button"
                variant="outline"
                onClick={handleSkip}
                disabled={loading}
                className="flex-1"
              >
                Skip for Now
              </Button>
            )}
            <Button
              onClick={handleSubmit}
              disabled={loading}
              className="flex-1"
            >
              {loading ? (
                <>
                  <CheckCircle className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Complete Legal Profile
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

