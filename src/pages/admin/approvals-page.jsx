import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  FileCheck, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  Clock,
  Eye,
  AlertCircle,
  User,
  MapPin,
  Calendar,
  DollarSign,
  Bot,
  FileText,
  Download,
  Settings,
  TrendingUp,
  TrendingDown,
  Info,
  Sprout
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import PageHeader from '@/components/ui/page-header';
import { format } from 'date-fns';
import { API } from '@/lib/config';

export default function ApprovalsPage() {
  const { user, selectedOrg, selectedLocation } = useAuth();
  const { toast } = useToast();
  const [agreements, setAgreements] = useState([]);
  const [amendments, setAmendments] = useState([]);
  const [newServices, setNewServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingAmendments, setLoadingAmendments] = useState(true);
  const [loadingServices, setLoadingServices] = useState(true);
  const [selectedAgreement, setSelectedAgreement] = useState(null);
  const [selectedAmendment, setSelectedAmendment] = useState(null);
  const [selectedService, setSelectedService] = useState(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [showAmendmentDialog, setShowAmendmentDialog] = useState(false);
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadAgreements();
    loadAmendments();
    loadNewServices();
  }, []);

  const loadAgreements = async () => {
    try {
      setLoading(true);

      // Load all rental agreements with user and organization details
      const { data, error } = await supabase
        .from('rental_agreements')
        .select(`
          *,
          user:profiles(first_name, full_name, email),
          organization:organizations(name),
          location:locations(name, city, province, address)
        `)
        .in('status', ['draft', 'active', 'paused'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAgreements(data || []);
    } catch (error) {
      console.error('Error loading agreements:', error);
      toast({
        title: 'Error',
        description: 'Failed to load rental agreements',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadAmendments = async () => {
    try {
      setLoadingAmendments(true);

      // Load pending service amendments (NEW TABLE)
      // Note: Use !user_id to specify which foreign key relationship to use
      const { data, error } = await supabase
        .from('service_amendments')
        .select(`
          *,
          service:services(
            id,
            name,
            service_type,
            location_id
          ),
          user:profiles!user_id(
            first_name,
            full_name,
            email
          )
        `)
        .eq('status', 'pending_approval')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAmendments(data || []);
    } catch (error) {
      console.error('Error loading amendments:', error);
      toast({
        title: 'Error',
        description: 'Failed to load amendment requests',
        variant: 'destructive'
      });
    } finally {
      setLoadingAmendments(false);
    }
  };

  const loadNewServices = async () => {
    try {
      setLoadingServices(true);

      // Load services that need installation
      // Include: pending_setup OR (active but not installed)
      const { data, error } = await supabase
        .from('services')
        .select(`
          *,
          location:locations(name, city, province, address),
          organization:organizations(name)
        `)
        .is('installation_completed_date', null)
        .eq('is_active', true)
        .in('status', ['active', 'pending_setup', 'pending_installation'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Get garden count and rental agreements for each service
      const servicesWithDetails = await Promise.all((data || []).map(async (service) => {
        const { data: gardens } = await supabase
          .from('gardens')
          .select('id, name, area_sqm')
          .eq('service_id', service.id)
          .eq('is_active', true);
        
        const { data: agreements } = await supabase
          .from('rental_agreements')
          .select('id, agreement_number, status')
          .eq('service_id', service.id);
        
        return {
          ...service,
          garden_count: (gardens || []).length,
          gardens: gardens || [],
          agreement_count: (agreements || []).length,
          agreements: agreements || []
        };
      }));

      setNewServices(servicesWithDetails);
    } catch (error) {
      console.error('Error loading new services:', error);
    } finally {
      setLoadingServices(false);
    }
  };

  const handleApprove = async (agreementId) => {
    try {
      setActionLoading(true);

      const { error } = await supabase
        .from('rental_agreements')
        .update({ 
          status: 'active',
          started_at: new Date().toISOString()
        })
        .eq('id', agreementId);

      if (error) throw error;

      toast({
        variant: 'success',
        title: 'Agreement Approved',
        description: 'Rental agreement has been activated successfully.',
      });

      setShowDetailsDialog(false);
      loadAgreements();
    } catch (error) {
      console.error('Error approving agreement:', error);
      toast({
        title: 'Approval Failed',
        description: error.message || 'Failed to approve agreement',
        variant: 'destructive'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (agreementId, reason) => {
    try {
      setActionLoading(true);

      const { error } = await supabase
        .from('rental_agreements')
        .update({ 
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: reason || 'Rejected by admin'
        })
        .eq('id', agreementId);

      if (error) throw error;

      toast({
        variant: 'success',
        title: 'Agreement Rejected',
        description: 'Rental agreement has been cancelled.',
      });

      setShowDetailsDialog(false);
      loadAgreements();
    } catch (error) {
      console.error('Error rejecting agreement:', error);
      toast({
        title: 'Rejection Failed',
        description: error.message || 'Failed to reject agreement',
        variant: 'destructive'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const configs = {
      draft: { label: 'Pending', color: 'bg-yellow-100 text-yellow-700 border-yellow-300', icon: Clock },
      active: { label: 'Active', color: 'bg-green-100 text-green-700 border-green-300', icon: CheckCircle2 },
      paused: { label: 'Paused', color: 'bg-amber-100 text-amber-700 border-amber-300', icon: AlertCircle },
      cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-700 border-red-300', icon: XCircle },
    };
    
    const config = configs[status] || configs.draft;
    const Icon = config.icon;
    
    return (
      <Badge variant="outline" className={`gap-1.5 ${config.color}`}>
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  const AgreementDetailsDialog = ({ agreement }) => {
    if (!agreement) return null;

    return (
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-2xl">
              <FileCheck className="h-6 w-6" />
              Rental Agreement Details
            </DialogTitle>
            <DialogDescription>
              Agreement #{agreement.agreement_number}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Status */}
            <div className="flex items-center justify-between">
              {getStatusBadge(agreement.status)}
              <span className="text-sm text-muted-foreground">
                Created {format(new Date(agreement.created_at), 'MMM d, yyyy')}
              </span>
            </div>

            {/* Customer Info */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Customer Information
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Name</p>
                  <p className="font-medium">{agreement.signer_first_name} {agreement.signer_surname}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">ID Number</p>
                  <p className="font-medium">{agreement.signer_id_number}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Phone</p>
                  <p className="font-medium">{agreement.signer_phone}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium">{agreement.signer_email}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-sm text-muted-foreground">Address</p>
                  <p className="font-medium">{agreement.signer_address}, {agreement.signer_city}</p>
                </div>
              </CardContent>
            </Card>

            {/* Location Info */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Service Location
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-medium">{agreement.location?.name}</p>
                <p className="text-sm text-muted-foreground">
                  {agreement.location?.city}, {agreement.location?.province}
                </p>
              </CardContent>
            </Card>

            {/* Service Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  Service Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Bot Type</p>
                    <p className="font-medium capitalize">{agreement.bot_type.replace('_', ' ')}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Number of Bots</p>
                    <p className="font-medium">{agreement.number_of_bots}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Services per Month</p>
                    <p className="font-medium">{agreement.services_per_month}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Billing Day</p>
                    <p className="font-medium">Day {agreement.billing_day} of month</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Pricing */}
            <Card className="border-2 border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Pricing Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span>Bot Rental</span>
                  <span className="font-medium">R {parseFloat(agreement.bot_rental_total).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Service Fee</span>
                  <span className="font-medium">R {parseFloat(agreement.service_total).toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t pt-3">
                  <span className="font-bold">Monthly Total</span>
                  <span className="font-bold text-lg">R {parseFloat(agreement.monthly_total).toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t pt-3">
                  <span className="font-bold">Setup Fee (One-time)</span>
                  <span className="font-bold text-lg">R {parseFloat(agreement.setup_fee).toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Documents */}
            {(agreement.agreement_pdf_url || agreement.signature_image_url) && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Documents
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {agreement.agreement_pdf_url && (
                    <Button
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => window.open(agreement.agreement_pdf_url, '_blank')}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download Agreement PDF
                    </Button>
                  )}
                  {agreement.signature_image_url && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Customer Signature</p>
                      <img 
                        src={agreement.signature_image_url} 
                        alt="Signature" 
                        className="border rounded-lg max-w-xs"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Signed on {format(new Date(agreement.signed_at), 'MMM d, yyyy HH:mm')}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <DialogFooter>
            {agreement.status === 'draft' && (
              <>
                <Button
                  variant="destructive"
                  onClick={() => handleReject(agreement.id, 'Rejected after review')}
                  disabled={actionLoading}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Reject
                </Button>
                <Button
                  onClick={() => handleApprove(agreement.id)}
                  disabled={actionLoading}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Approve & Activate
                </Button>
              </>
            )}
            {agreement.status !== 'draft' && (
              <Button variant="outline" onClick={() => setShowDetailsDialog(false)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  };

  const handleApproveAmendment = async (amendmentId) => {
    try {
      setActionLoading(true);

      const { error } = await supabase
        .from('service_amendments')
        .update({ 
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: user.id
        })
        .eq('id', amendmentId);

      if (error) throw error;

      toast({
        variant: 'success',
        title: 'Amendment Approved',
        description: 'The service modification has been approved.',
      });

      setShowAmendmentDialog(false);
      loadAmendments();
    } catch (error) {
      console.error('Error approving amendment:', error);
      toast({
        title: 'Approval Failed',
        description: error.message || 'Failed to approve amendment',
        variant: 'destructive'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectAmendment = async (amendmentId) => {
    try {
      setActionLoading(true);

      const { error } = await supabase
        .from('service_amendments')
        .update({ 
          status: 'rejected',
          approved_at: new Date().toISOString(),
          approved_by: user.id
        })
        .eq('id', amendmentId);

      if (error) throw error;

      toast({
        variant: 'success',
        title: 'Amendment Rejected',
        description: 'The service modification request has been rejected.',
      });

      setShowAmendmentDialog(false);
      loadAmendments();
    } catch (error) {
      console.error('Error rejecting amendment:', error);
      toast({
        title: 'Rejection Failed',
        description: error.message || 'Failed to reject amendment',
        variant: 'destructive'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkInstalled = async (serviceId) => {
    try {
      setActionLoading(true);

      // Mark as installed
      const { error } = await supabase
        .from('services')
        .update({ 
          installation_completed_date: new Date().toISOString()
        })
        .eq('id', serviceId);

      if (error) throw error;

      // Send email notification to all organization members via Supabase Edge Function
      try {
        const { data: notificationData, error: notificationError } = await supabase.functions.invoke('send-installation-notification', {
          body: {
            service_id: serviceId,
            organization_id: selectedService.organization_id
          }
        });

        if (!notificationError && notificationData?.success) {
          console.log(`📧 Sent installation notification to ${notificationData.emails_sent} members`);
        } else {
          console.warn('Failed to send installation notification:', notificationError);
        }
      } catch (emailError) {
        console.error('Email notification error:', emailError);
        // Don't fail the whole operation if email fails
      }

      toast({
        variant: 'success',
        title: 'Installation Completed ✓',
        description: 'Service marked as installed and notifications sent to organization members.',
        duration: 5000,
      });

      setShowInstallDialog(false);
      loadNewServices();
    } catch (error) {
      console.error('Error marking installed:', error);
      toast({
        title: 'Error',
        description: 'Failed to mark service as installed',
        variant: 'destructive'
      });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Approvals Dashboard"
        subtitle="Review agreements, installations, and service modifications"
        icon={<FileCheck className="h-6 w-6" />}
      />

      {/* Pending Installations Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-blue-600" />
                Pending Installations
              </CardTitle>
              <CardDescription>
                New services awaiting bot installation
              </CardDescription>
            </div>
            <Badge variant="secondary" className="h-7 px-3">
              {newServices.length} Pending
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loadingServices ? (
            <div className="py-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : newServices.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500" />
              <p className="font-medium">All caught up!</p>
              <p className="text-sm">No pending installations at this time.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {newServices.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell>
                      <div>
                        <p className="font-semibold">{service.name}</p>
                        <p className="text-xs text-muted-foreground">{service.organization?.name}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{service.location?.name}</p>
                        <p className="text-xs text-muted-foreground">{service.location?.city || service.location?.address}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{service.service_type}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <Sprout className="h-3.5 w-3.5 text-emerald-600" />
                          <span>{service.garden_count} garden{service.garden_count !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <Bot className="h-3.5 w-3.5 text-blue-600" />
                          <span>{service.garden_count} bot{service.garden_count !== 1 ? 's' : ''} to install</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <FileText className="h-3.5 w-3.5 text-purple-600" />
                          <span>{service.agreement_count} agreement{service.agreement_count !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(service.created_at), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => {
                          setSelectedService(service);
                          setShowInstallDialog(true);
                        }}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Mark Installed
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Amendment Requests Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Service Modification Requests
              </CardTitle>
              <CardDescription>
                Customer requests to change bot counts and service plans
              </CardDescription>
            </div>
            <Badge variant="secondary">{amendments.length} pending</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loadingAmendments ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : amendments.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">All Caught Up!</h3>
              <p className="text-muted-foreground">
                No pending amendment requests at this time.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Impact</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {amendments.map((amendment) => (
                  <TableRow key={amendment.id}>
                    <TableCell className="font-mono text-sm">
                      {amendment.id.substring(0, 8)}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">
                          {amendment.user?.full_name || amendment.user?.first_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {amendment.user?.email}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={amendment.amendment_type === 'add_gardens' ? 'default' : 'secondary'} className="capitalize">
                        {amendment.amendment_type.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">
                          {amendment.current_garden_count} → {amendment.new_garden_count} gardens
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {amendment.service?.name}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className={`text-sm font-bold ${amendment.new_garden_count > amendment.current_garden_count ? 'text-green-600' : 'text-orange-600'}`}>
                          {amendment.new_garden_count > amendment.current_garden_count ? '+' : ''}{amendment.new_garden_count - amendment.current_garden_count} garden{Math.abs(amendment.new_garden_count - amendment.current_garden_count) !== 1 ? 's' : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {amendment.current_garden_count} → {amendment.new_garden_count} bots
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(amendment.created_at), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedAmendment(amendment);
                          setShowAmendmentDialog(true);
                        }}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Rental Agreements Section */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>New Rental Agreements</CardTitle>
            <CardDescription>
              All rental agreements across all customers
            </CardDescription>
          </CardHeader>
          <CardContent>
            {agreements.length === 0 ? (
              <div className="text-center py-12">
                <FileCheck className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Agreements Found</h3>
                <p className="text-muted-foreground">
                  There are no rental agreements to review at this time.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agreement #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Bot Type</TableHead>
                    <TableHead>Monthly Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agreements.map((agreement) => (
                    <TableRow key={agreement.id}>
                      <TableCell className="font-mono text-sm">
                        {agreement.agreement_number}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {agreement.signer_first_name} {agreement.signer_surname}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {agreement.signer_email}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>{agreement.organization?.name}</TableCell>
                      <TableCell className="capitalize">
                        {agreement.bot_type.replace('_', ' ')}
                      </TableCell>
                      <TableCell className="font-bold">
                        R {parseFloat(agreement.monthly_total).toFixed(2)}
                      </TableCell>
                      <TableCell>{getStatusBadge(agreement.status)}</TableCell>
                      <TableCell>
                        {format(new Date(agreement.created_at), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedAgreement(agreement);
                            setShowDetailsDialog(true);
                          }}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {selectedAgreement && (
        <AgreementDetailsDialog agreement={selectedAgreement} />
      )}

      {/* Amendment Review Dialog */}
      {selectedAmendment && (
        <Dialog open={showAmendmentDialog} onOpenChange={setShowAmendmentDialog}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Review Service Amendment
              </DialogTitle>
              <DialogDescription>
                {selectedAmendment.amendment_type === 'add_gardens' ? 'Add Gardens' : 'Remove Gardens'} Request
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Customer Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Customer Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name:</span>
                    <span className="font-semibold">
                      {selectedAmendment.user?.full_name || selectedAmendment.user?.first_name}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Email:</span>
                    <span>{selectedAmendment.user?.email}</span>
                  </div>
                  {/* Phone number removed - now stored in organization_legal_profiles */}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Service:</span>
                    <span className="font-semibold">{selectedAmendment.service?.name}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Change Details */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Requested Changes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-2">Current Gardens</p>
                      <p className="text-2xl font-bold">{selectedAmendment.current_garden_count}</p>
                      <p className="text-sm text-muted-foreground mt-1">{selectedAmendment.current_garden_count} bot{selectedAmendment.current_garden_count !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="p-4 bg-primary/10 rounded-lg border-2 border-primary/30">
                      <p className="text-xs text-muted-foreground mb-2">Requested Gardens</p>
                      <p className="text-2xl font-bold text-primary">{selectedAmendment.new_garden_count}</p>
                      <p className="text-sm text-primary mt-1">{selectedAmendment.new_garden_count} bot{selectedAmendment.new_garden_count !== 1 ? 's' : ''}</p>
                    </div>
                  </div>

                  <Alert className={selectedAmendment.amendment_type === 'add_gardens' ? 'border-green-200 bg-green-50 dark:bg-green-900/20' : 'border-orange-200 bg-orange-50 dark:bg-orange-900/20'}>
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      <p className="font-semibold">
                        {selectedAmendment.amendment_type === 'add_gardens' ? 'Adding' : 'Removing'} {Math.abs(selectedAmendment.new_garden_count - selectedAmendment.current_garden_count)} Garden{Math.abs(selectedAmendment.new_garden_count - selectedAmendment.current_garden_count) !== 1 ? 's' : ''}
                      </p>
                      <p className="text-xs mt-1">
                        {selectedAmendment.amendment_type === 'add_gardens' 
                          ? 'New bots will be deployed and rental agreements created'
                          : 'Bots will be removed and rental agreements terminated'
                        }
                      </p>
                    </AlertDescription>
                  </Alert>

                  {/* Signature */}
                  {selectedAmendment.signature_url && (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">Customer Signature:</p>
                      <div className="border-2 rounded-lg p-4 bg-white">
                        <img 
                          src={selectedAmendment.signature_url} 
                          alt="Customer Signature" 
                          className="max-h-24 mx-auto"
                        />
                      </div>
                      {selectedAmendment.signed_at && (
                        <p className="text-xs text-muted-foreground">
                          Signed: {format(new Date(selectedAmendment.signed_at), 'MMM d, yyyy h:mm a')}
                        </p>
                      )}
                    </div>
                  )}

                  <Alert>
                    <Calendar className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Requested: {format(new Date(selectedAmendment.created_at), 'MMMM d, yyyy h:mm a')}
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setShowAmendmentDialog(false)}
                disabled={actionLoading}
              >
                Close
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleRejectAmendment(selectedAmendment.id)}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4 mr-2" />
                )}
                Reject
              </Button>
              <Button
                onClick={() => handleApproveAmendment(selectedAmendment.id)}
                disabled={actionLoading}
                className="bg-green-600 hover:bg-green-700"
              >
                {actionLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Approve
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Mark Installed Dialog */}
      {selectedService && (
        <Dialog open={showInstallDialog} onOpenChange={setShowInstallDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-blue-600" />
                Mark Service as Installed
              </DialogTitle>
              <DialogDescription>
                Confirm that bots have been physically installed for this service
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Service Info */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Service Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Service Name:</span>
                    <span className="font-semibold">{selectedService.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Service Type:</span>
                    <Badge variant="outline" className="capitalize">{selectedService.service_type}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Location:</span>
                    <span className="font-medium">{selectedService.location?.name}, {selectedService.location?.city}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Gardens:</span>
                    <span className="font-medium">{selectedService.garden_count} garden{selectedService.garden_count !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bots to Deploy:</span>
                    <Badge className="bg-blue-100 text-blue-800">{selectedService.garden_count} bot{selectedService.garden_count !== 1 ? 's' : ''}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Created:</span>
                    <span>{format(new Date(selectedService.created_at), 'MMM d, yyyy h:mm a')}</span>
                  </div>
                </CardContent>
              </Card>

              <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
                <Info className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-sm text-blue-900 dark:text-blue-200">
                  <p className="font-semibold mb-1">Before marking as installed:</p>
                  <ul className="text-xs space-y-1 mt-2">
                    <li>✓ All {selectedService.garden_count} bots physically deployed</li>
                    <li>✓ Bots tested and operational</li>
                    <li>✓ Customer informed of installation completion</li>
                  </ul>
                </AlertDescription>
              </Alert>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setShowInstallDialog(false)}
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button
                onClick={() => handleMarkInstalled(selectedService.id)}
                disabled={actionLoading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {actionLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Confirm Installation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}


