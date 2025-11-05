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

  // Stats calculations
  const totalPending = newServices.length + amendments.length + agreements.length;

  useEffect(() => {
    loadAgreements();
    loadAmendments();
    loadNewServices();
  }, []);

  const loadAgreements = async () => {
    try {
      setLoading(true);

      // Load ONLY draft rental agreements that need approval
      // Active agreements are already approved and don't need to be shown here
      const { data, error } = await supabase
        .from('rental_agreements')
        .select(`
          *,
          user:profiles(first_name, full_name, email),
          organization:organizations(name),
          location:locations(name, city, province, address)
        `)
        .eq('status', 'draft')
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
      draft: { 
        label: 'Pending', 
        color: 'bg-[#FF6B35]/10 text-[#FF6B35] border-[#FF6B35]/30 shadow-sm', 
        icon: Clock 
      },
      active: { 
        label: 'Active', 
        color: 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30 shadow-sm', 
        icon: CheckCircle2 
      },
      paused: { 
        label: 'Paused', 
        color: 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30 shadow-sm', 
        icon: AlertCircle 
      },
      cancelled: { 
        label: 'Cancelled', 
        color: 'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/30 shadow-sm', 
        icon: XCircle 
      },
    };
    
    const config = configs[status] || configs.draft;
    const Icon = config.icon;
    
    return (
      <Badge variant="outline" className={`gap-1 text-[9px] h-5 px-2 ${config.color}`}>
        <Icon className="h-2.5 w-2.5" />
        {config.label}
      </Badge>
    );
  };

  const AgreementDetailsDialog = ({ agreement }) => {
    if (!agreement) return null;

    return (
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-gradient-to-br from-background to-muted/20 border-0 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
          <DialogHeader className="space-y-2 pb-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                <FileCheck className="h-4 w-4 text-botkorp-orange" />
              </div>
              <span className="font-bold">
                Rental Agreement Details
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs ml-10 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-botkorp-orange/10 text-botkorp-orange font-mono font-semibold text-[10px] border-0">
                #{agreement.agreement_number}
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Status */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
              {getStatusBadge(agreement.status)}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>Created {format(new Date(agreement.created_at), 'MMM d, yyyy')}</span>
              </div>
            </div>

            {/* Customer Info */}
            <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              <CardHeader className="pb-3 pt-4">
                <CardTitle className="flex items-center gap-2.5 text-sm font-bold">
                  <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#4F5D75]/15 to-[#4F5D75]/5 flex items-center justify-center shadow-[0_2px_10px_rgba(79,93,117,0.1)]">
                    <User className="h-4 w-4 text-[#4F5D75]" />
                  </div>
                  <span>Customer Information</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 pt-4">
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
            <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              <CardHeader className="pb-3 pt-4">
                <CardTitle className="flex items-center gap-2.5 text-sm font-bold">
                  <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_2px_10px_rgb(255,107,53,0.1)]">
                    <MapPin className="h-4 w-4 text-botkorp-orange" />
                  </div>
                  <span>Service Location</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <p className="font-semibold text-[#121212]">{agreement.location?.name}</p>
                <p className="text-sm text-[#4F5D75] mt-1">
                  {agreement.location?.city}, {agreement.location?.province}
                </p>
              </CardContent>
            </Card>

            {/* Service Details */}
            <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              <CardHeader className="pb-3 pt-4">
                <CardTitle className="flex items-center gap-2.5 text-sm font-bold">
                  <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#4F5D75]/15 to-[#4F5D75]/5 flex items-center justify-center shadow-[0_2px_10px_rgba(79,93,117,0.1)]">
                    <Bot className="h-4 w-4 text-[#4F5D75]" />
                  </div>
                  <span>Service Details</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
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
            <Card className="border-0 bg-gradient-to-br from-green-500/5 to-background rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              <CardHeader className="pb-3 pt-4">
                <CardTitle className="flex items-center gap-2.5 text-sm font-bold">
                  <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-green-500/15 to-green-500/5 flex items-center justify-center shadow-[0_2px_10px_rgb(34,197,94,0.1)]">
                    <DollarSign className="h-4 w-4 text-green-600" />
                  </div>
                  <span>Pricing Breakdown</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                <div className="flex justify-between p-3 rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                  <span className="text-muted-foreground">Bot Rental</span>
                  <span className="font-semibold">R {parseFloat(agreement.bot_rental_total).toFixed(2)}</span>
                </div>
                <div className="flex justify-between p-3 rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                  <span className="text-muted-foreground">Service Fee</span>
                  <span className="font-semibold">R {parseFloat(agreement.service_total).toFixed(2)}</span>
                </div>
                <div className="flex justify-between p-4 rounded-xl bg-green-500/10 border-0">
                  <span className="font-bold text-green-600">Monthly Total</span>
                  <span className="font-bold text-xl text-green-600">R {parseFloat(agreement.monthly_total).toFixed(2)}</span>
                </div>
                <div className="flex justify-between p-4 rounded-xl bg-botkorp-orange/10 border-0">
                  <span className="font-bold text-botkorp-orange">Setup Fee (One-time)</span>
                  <span className="font-bold text-xl text-botkorp-orange">R {parseFloat(agreement.setup_fee).toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Documents */}
            {(agreement.agreement_pdf_url || agreement.signature_image_url) && (
              <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                <CardHeader className="pb-3 pt-4">
                  <CardTitle className="flex items-center gap-2.5 text-sm font-bold">
                    <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#4F5D75]/15 to-[#4F5D75]/5 flex items-center justify-center shadow-[0_2px_10px_rgba(79,93,117,0.1)]">
                      <FileText className="h-4 w-4 text-[#4F5D75]" />
                    </div>
                    <span>Documents</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-4">
                  {agreement.agreement_pdf_url && (
                    <Button
                      variant="outline"
                      className="w-full justify-start h-11 text-xs font-semibold rounded-xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300 active:scale-95"
                      onClick={() => window.open(agreement.agreement_pdf_url, '_blank')}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download Agreement PDF
                    </Button>
                  )}
                  {agreement.signature_image_url && (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">Customer Signature</p>
                      <div className="p-4 bg-background/60 backdrop-blur-sm rounded-xl shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                        <img 
                          src={agreement.signature_image_url} 
                          alt="Signature" 
                          className="max-w-xs mx-auto"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Calendar className="h-3 w-3" />
                        Signed on {format(new Date(agreement.signed_at), 'MMM d, yyyy HH:mm')}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <DialogFooter className="gap-2 pt-3">
            {agreement.status === 'draft' && (
              <>
                <Button
                  variant="outline"
                  onClick={() => handleReject(agreement.id, 'Rejected after review')}
                  disabled={actionLoading}
                  className="h-8 text-[10px] font-semibold bg-red-500/10 hover:bg-red-500/20 text-red-600 border-0 rounded-lg shadow-sm hover:shadow-md transition-all duration-300 active:scale-95 px-3"
                >
                  {actionLoading ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <XCircle className="h-3 w-3 mr-1" />
                  )}
                  Reject
                </Button>
                <Button
                  onClick={() => handleApprove(agreement.id)}
                  disabled={actionLoading}
                  className="h-8 text-[10px] font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] active:scale-95 transition-all duration-300 rounded-lg border-0 text-white px-3"
                >
                  {actionLoading ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                  )}
                  Approve & Activate
                </Button>
              </>
            )}
            {agreement.status !== 'draft' && (
              <Button 
                variant="outline" 
                onClick={() => setShowDetailsDialog(false)}
                className="h-8 text-[10px] font-semibold rounded-lg border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300 active:scale-95 px-3"
              >
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

      // Mark as installed (database trigger will send notifications automatically)
      const { error } = await supabase
        .from('services')
        .update({ 
          installation_completed_date: new Date().toISOString()
        })
        .eq('id', serviceId);

      if (error) throw error;

      toast({
        variant: 'success',
        title: 'Installation Completed ✓',
        description: 'Service marked as installed. Organization members will be notified automatically.',
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100/50 to-gray-100/40 p-3 md:p-4 space-y-3 md:space-y-4">
      {/* Enhanced Header with Stats */}
      <div className="space-y-3 animate-in fade-in slide-in-from-top-3 duration-500">
        <PageHeader
          title="Approvals Dashboard"
          subtitle="Review agreements, installations, and service modifications"
          icon={<FileCheck className="h-5 w-5" />}
        />
        
        {/* Stats Cards - Compact & Elegant */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-100">
          {/* Pending Installations Stat */}
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-2xl">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Pending Installations</p>
                  <p className="text-2xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{newServices.length}</p>
                  <p className="text-[10px] text-muted-foreground font-medium">Services awaiting setup</p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-botkorp-orange/20 to-botkorp-orange/10 dark:from-botkorp-orange/30 dark:to-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                  <Bot className="h-5 w-5 text-botkorp-orange transition-all duration-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pending Amendments Stat */}
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-2xl">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Service Amendments</p>
                  <p className="text-2xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{amendments.length}</p>
                  <p className="text-[10px] text-muted-foreground font-medium">Modification requests</p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#4F5D75]/20 to-[#4F5D75]/10 dark:from-[#4F5D75]/30 dark:to-[#4F5D75]/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                  <Settings className="h-5 w-5 text-[#4F5D75] dark:text-[#6B7A94] transition-all duration-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pending Agreements Stat */}
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-2xl">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Rental Agreements</p>
                  <p className="text-2xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{agreements.length}</p>
                  <p className="text-[10px] text-muted-foreground font-medium">Awaiting approval</p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-green-500/20 to-green-500/10 dark:from-green-500/30 dark:to-green-500/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                  <FileCheck className="h-5 w-5 text-green-600 dark:text-green-400 transition-all duration-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Pending Installations Section - Compact */}
      <Card className="animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200 border-0 bg-gradient-to-br from-background to-muted/20 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300">
        <CardHeader className="pb-2 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                <Bot className="h-4 w-4 text-botkorp-orange" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold">Pending Installations</CardTitle>
                <CardDescription className="text-[10px] font-medium">New services awaiting bot installation</CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="text-[9px] h-5 border-none bg-botkorp-orange/10 text-botkorp-orange font-semibold px-2.5 rounded-full">
              {newServices.length} Pending
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-2 pb-3">
          {loadingServices ? (
            <div className="py-12 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mb-3 animate-pulse shadow-[0_8px_30px_rgb(255,107,53,0.15)]">
                <Loader2 className="h-6 w-6 animate-spin text-botkorp-orange" />
              </div>
              <p className="text-xs text-muted-foreground font-medium">Loading installations...</p>
            </div>
          ) : newServices.length === 0 ? (
            <div className="py-12 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-green-500/15 to-green-500/5 mb-3 shadow-[0_8px_30px_rgb(34,197,94,0.15)]">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
              <p className="text-sm font-bold mb-1">All caught up!</p>
              <p className="text-xs text-muted-foreground">No pending installations at this time.</p>
            </div>
          ) : (
            <div className="rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/50 border-b border-border/50">
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Service</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Location</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Type</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Details</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Created</TableHead>
                    <TableHead className="text-right font-bold text-[10px] uppercase tracking-wider py-2">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {newServices.map((service, idx) => (
                    <TableRow 
                      key={service.id} 
                      className={`hover:bg-muted/30 transition-all duration-300 border-b border-border/30 ${
                        idx % 2 === 0 ? 'bg-background' : 'bg-muted/10'
                      }`}
                    >
                      <TableCell className="py-2">
                        <div className="space-y-0.5">
                          <p className="font-semibold text-xs text-[#121212]">{service.name}</p>
                          <p className="text-[10px] text-[#4F5D75] font-medium">{service.organization?.name}</p>
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="space-y-0.5">
                          <p className="font-medium text-xs text-[#121212]">{service.location?.name}</p>
                          <p className="text-[10px] text-[#4F5D75]">{service.location?.city || service.location?.address}</p>
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge variant="outline" className="capitalize text-[9px] bg-slate-50 text-[#4F5D75] border-[#D0D2D5] shadow-sm h-5 px-2">
                          {service.service_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-xs">
                            <div className="h-5 w-5 rounded-md bg-[#10B981]/10 flex items-center justify-center">
                              <Sprout className="h-3 w-3 text-[#10B981]" />
                            </div>
                            <span className="text-[#121212]">{service.garden_count} garden{service.garden_count !== 1 ? 's' : ''}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs">
                            <div className="h-5 w-5 rounded-md bg-[#FF6B35]/10 flex items-center justify-center">
                              <Bot className="h-3 w-3 text-[#FF6B35]" />
                            </div>
                            <span className="text-[#121212]">{service.garden_count} bot{service.garden_count !== 1 ? 's' : ''} to install</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs">
                            <div className="h-5 w-5 rounded-md bg-[#4F5D75]/10 flex items-center justify-center">
                              <FileText className="h-3 w-3 text-[#4F5D75]" />
                            </div>
                            <span className="text-[#121212]">{service.agreement_count} agreement{service.agreement_count !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-[#4F5D75] py-2">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-[#B0B3B8]" />
                          {format(new Date(service.created_at), 'MMM d, yyyy')}
                        </div>
                      </TableCell>
                      <TableCell className="text-right py-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedService(service);
                            setShowInstallDialog(true);
                          }}
                          className="h-7 text-[10px] font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] active:scale-95 transition-all duration-300 rounded-lg border-0 text-white px-2"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Mark Installed
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Amendment Requests Section - Compact */}
      <Card className="animate-in fade-in slide-in-from-bottom-3 duration-500 delay-300 border-0 bg-gradient-to-br from-background to-muted/20 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300">
        <CardHeader className="pb-2 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#4F5D75]/15 to-[#4F5D75]/5 flex items-center justify-center shadow-[0_4px_20px_rgba(79,93,117,0.15)]">
                <Settings className="h-4 w-4 text-[#4F5D75]" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold">Service Modification Requests</CardTitle>
                <CardDescription className="text-[10px] font-medium">Customer requests to change bot counts and service plans</CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="text-[9px] h-5 border-none bg-[#4F5D75]/10 text-[#4F5D75] font-semibold px-2.5 rounded-full">
              {amendments.length} pending
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-2 pb-3">
          {loadingAmendments ? (
            <div className="py-12 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#4F5D75]/15 to-[#4F5D75]/5 mb-3 animate-pulse shadow-[0_8px_30px_rgba(79,93,117,0.15)]">
                <Loader2 className="h-6 w-6 animate-spin text-[#4F5D75]" />
              </div>
              <p className="text-xs text-muted-foreground font-medium">Loading amendments...</p>
            </div>
          ) : amendments.length === 0 ? (
            <div className="py-12 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-green-500/15 to-green-500/5 mb-3 shadow-[0_8px_30px_rgb(34,197,94,0.15)]">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
              <p className="text-sm font-bold mb-1">All Caught Up!</p>
              <p className="text-xs text-muted-foreground">
                No pending amendment requests at this time.
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/50 border-b border-border/50">
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">ID</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Customer</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Type</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Change</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Impact</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Date</TableHead>
                    <TableHead className="text-right font-bold text-[10px] uppercase tracking-wider py-2">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {amendments.map((amendment, idx) => (
                    <TableRow 
                      key={amendment.id}
                      className={`hover:bg-muted/30 transition-all duration-300 border-b border-border/30 ${
                        idx % 2 === 0 ? 'bg-background' : 'bg-muted/10'
                      }`}
                    >
                      <TableCell className="font-mono text-[10px] py-2">
                        <div className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-[#4F5D75] border border-[#D0D2D5]">
                          {amendment.id.substring(0, 8)}
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="space-y-0.5">
                          <p className="font-semibold text-xs text-[#121212]">
                            {amendment.user?.full_name || amendment.user?.first_name}
                          </p>
                          <p className="text-[10px] text-[#4F5D75] font-medium">
                            {amendment.user?.email}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge 
                          variant="outline" 
                          className={`capitalize text-[9px] shadow-sm h-5 px-2 ${
                            amendment.amendment_type === 'add_gardens' 
                              ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30' 
                              : 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30'
                          }`}
                        >
                          {amendment.amendment_type === 'add_gardens' ? <TrendingUp className="h-2.5 w-2.5 mr-0.5" /> : <TrendingDown className="h-2.5 w-2.5 mr-0.5" />}
                          {amendment.amendment_type.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="space-y-0.5">
                          <p className="text-xs font-semibold text-[#121212]">
                            {amendment.current_garden_count} → {amendment.new_garden_count} gardens
                          </p>
                          <p className="text-[10px] text-[#4F5D75] font-medium">
                            {amendment.service?.name}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="space-y-0.5">
                          <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[10px] shadow-sm ${
                            amendment.new_garden_count > amendment.current_garden_count 
                              ? 'bg-[#10B981]/20 text-[#10B981] border border-[#10B981]/40' 
                              : 'bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/40'
                          }`}>
                            {amendment.new_garden_count > amendment.current_garden_count ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                            {amendment.new_garden_count > amendment.current_garden_count ? '+' : ''}{amendment.new_garden_count - amendment.current_garden_count} garden{Math.abs(amendment.new_garden_count - amendment.current_garden_count) !== 1 ? 's' : ''}
                          </div>
                          <p className="text-[10px] text-[#4F5D75]">
                            {amendment.current_garden_count} → {amendment.new_garden_count} bots
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-[#4F5D75] py-2">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-[#B0B3B8]" />
                          {format(new Date(amendment.created_at), 'MMM d, yyyy')}
                        </div>
                      </TableCell>
                      <TableCell className="text-right py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedAmendment(amendment);
                            setShowAmendmentDialog(true);
                          }}
                          className="h-7 text-[10px] font-semibold rounded-lg border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300 active:scale-95 px-2"
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          Review
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rental Agreements Section - Compact */}
      <Card className="animate-in fade-in slide-in-from-bottom-3 duration-500 delay-400 border-0 bg-gradient-to-br from-background to-muted/20 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300">
        <CardHeader className="pb-2 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-green-500/15 to-green-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(34,197,94,0.15)]">
                <FileCheck className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold">New Rental Agreements</CardTitle>
                <CardDescription className="text-[10px] font-medium">All rental agreements across all customers</CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="text-[9px] h-5 border-none bg-green-500/10 text-green-600 font-semibold px-2.5 rounded-full">
              {agreements.length} pending
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-2 pb-3">
          {loading ? (
            <div className="py-12 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-green-500/15 to-green-500/5 mb-3 animate-pulse shadow-[0_8px_30px_rgb(34,197,94,0.15)]">
                <Loader2 className="h-6 w-6 animate-spin text-green-600" />
              </div>
              <p className="text-xs text-muted-foreground font-medium">Loading agreements...</p>
            </div>
          ) : agreements.length === 0 ? (
            <div className="py-12 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-green-500/15 to-green-500/5 mb-3 shadow-[0_8px_30px_rgb(34,197,94,0.15)]">
                <FileCheck className="h-6 w-6 text-green-600" />
              </div>
              <p className="text-sm font-bold mb-1">No Agreements Found</p>
              <p className="text-xs text-muted-foreground">
                There are no rental agreements to review at this time.
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/50 border-b border-border/50">
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Agreement #</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Customer</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Organization</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Bot Type</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Monthly Total</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Status</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase tracking-wider py-2">Date</TableHead>
                    <TableHead className="text-right font-bold text-[10px] uppercase tracking-wider py-2">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agreements.map((agreement, idx) => (
                    <TableRow 
                      key={agreement.id}
                      className={`hover:bg-muted/30 transition-all duration-300 border-b border-border/30 ${
                        idx % 2 === 0 ? 'bg-background' : 'bg-muted/10'
                      }`}
                    >
                      <TableCell className="font-mono text-[10px] py-2">
                        <div className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#FF6B35]/10 text-[#FF6B35] border border-[#FF6B35]/30 font-semibold">
                          {agreement.agreement_number}
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="space-y-0.5">
                          <p className="font-semibold text-xs text-[#121212]">
                            {agreement.signer_first_name} {agreement.signer_surname}
                          </p>
                          <p className="text-[10px] text-[#4F5D75] font-medium">
                            {agreement.signer_email}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <span className="font-medium text-xs text-[#121212]">{agreement.organization?.name}</span>
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge variant="outline" className="capitalize text-[9px] bg-slate-50 text-[#4F5D75] border-[#D0D2D5] shadow-sm h-5 px-2">
                          <Bot className="h-2.5 w-2.5 mr-0.5" />
                          {agreement.bot_type.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#10B981]/20 border border-[#10B981]/40 shadow-sm">
                          <DollarSign className="h-3 w-3 text-[#10B981]" />
                          <span className="font-bold text-[10px] text-[#10B981]">R {parseFloat(agreement.monthly_total).toFixed(2)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2">{getStatusBadge(agreement.status)}</TableCell>
                      <TableCell className="text-xs text-[#4F5D75] py-2">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-[#B0B3B8]" />
                          {format(new Date(agreement.created_at), 'MMM d, yyyy')}
                        </div>
                      </TableCell>
                      <TableCell className="text-right py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedAgreement(agreement);
                            setShowDetailsDialog(true);
                          }}
                          className="h-7 text-[10px] font-semibold rounded-lg border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300 active:scale-95 px-2"
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedAgreement && (
        <AgreementDetailsDialog agreement={selectedAgreement} />
      )}

      {/* Amendment Review Dialog */}
      {selectedAmendment && (
        <Dialog open={showAmendmentDialog} onOpenChange={setShowAmendmentDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-background to-muted/20 border-0 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
            <DialogHeader className="space-y-2 pb-3">
              <DialogTitle className="flex items-center gap-2 text-base">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#4F5D75]/15 to-[#4F5D75]/5 flex items-center justify-center shadow-[0_4px_20px_rgba(79,93,117,0.15)]">
                  <Settings className="h-4 w-4 text-[#4F5D75]" />
                </div>
                <span className="font-bold">
                  Review Service Amendment
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs ml-10">
                <Badge className={`${selectedAmendment.amendment_type === 'add_gardens' 
                  ? 'bg-gradient-to-r from-[#10B981] to-[#10B981]/80 hover:from-[#10B981]/90 hover:to-[#10B981]' 
                  : 'bg-gradient-to-r from-[#F59E0B] to-[#F59E0B]/80 hover:from-[#F59E0B]/90 hover:to-[#F59E0B]'} shadow-md text-white border-0 text-[9px] h-5 px-2`}>
                  {selectedAmendment.amendment_type === 'add_gardens' ? <TrendingUp className="h-2.5 w-2.5 mr-1" /> : <TrendingDown className="h-2.5 w-2.5 mr-1" />}
                  {selectedAmendment.amendment_type === 'add_gardens' ? 'Add Gardens' : 'Remove Gardens'} Request
                </Badge>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              {/* Customer Info */}
              <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                <CardHeader className="pb-3 pt-4">
                  <CardTitle className="flex items-center gap-2.5 text-sm font-bold">
                    <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#4F5D75]/15 to-[#4F5D75]/5 flex items-center justify-center shadow-[0_2px_10px_rgba(79,93,117,0.1)]">
                      <User className="h-4 w-4 text-[#4F5D75]" />
                    </div>
                    <span>Customer Information</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm pt-4">
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
              <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                <CardHeader className="pb-3 pt-4">
                  <CardTitle className="flex items-center gap-2.5 text-sm font-bold">
                    <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_2px_10px_rgb(255,107,53,0.1)]">
                      <Settings className="h-4 w-4 text-botkorp-orange" />
                    </div>
                    <span>Requested Changes</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                      <p className="text-xs font-semibold text-muted-foreground mb-2">Current Gardens</p>
                      <p className="text-3xl font-bold">{selectedAmendment.current_garden_count}</p>
                      <p className="text-sm text-muted-foreground mt-2 flex items-center gap-1.5">
                        <Bot className="h-3.5 w-3.5" />
                        {selectedAmendment.current_garden_count} bot{selectedAmendment.current_garden_count !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className={`p-4 rounded-xl border-0 ${
                      selectedAmendment.amendment_type === 'add_gardens'
                        ? 'bg-green-500/10'
                        : 'bg-orange-500/10'
                    }`}>
                      <p className={`text-xs font-semibold mb-2 ${
                        selectedAmendment.amendment_type === 'add_gardens' ? 'text-green-600' : 'text-orange-600'
                      }`}>Requested Gardens</p>
                      <p className={`text-3xl font-bold ${
                        selectedAmendment.amendment_type === 'add_gardens' ? 'text-green-600' : 'text-orange-600'
                      }`}>{selectedAmendment.new_garden_count}</p>
                      <p className={`text-sm mt-2 flex items-center gap-1.5 ${
                        selectedAmendment.amendment_type === 'add_gardens' ? 'text-green-600' : 'text-orange-600'
                      }`}>
                        <Bot className="h-3.5 w-3.5" />
                        {selectedAmendment.new_garden_count} bot{selectedAmendment.new_garden_count !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>

                  <Alert className={`border-0 rounded-xl ${
                    selectedAmendment.amendment_type === 'add_gardens' 
                      ? 'bg-green-500/10' 
                      : 'bg-orange-500/10'
                  }`}>
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                      selectedAmendment.amendment_type === 'add_gardens'
                        ? 'bg-green-500/20'
                        : 'bg-orange-500/20'
                    }`}>
                      <Info className={`h-4 w-4 ${
                        selectedAmendment.amendment_type === 'add_gardens' ? 'text-green-600' : 'text-orange-600'
                      }`} />
                    </div>
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
                    <div className="space-y-3">
                      <p className="text-sm font-semibold">Customer Signature:</p>
                      <div className="p-4 bg-background/60 backdrop-blur-sm rounded-xl shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                        <img 
                          src={selectedAmendment.signature_url} 
                          alt="Customer Signature" 
                          className="max-h-24 mx-auto"
                        />
                      </div>
                      {selectedAmendment.signed_at && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Calendar className="h-3 w-3" />
                          Signed: {format(new Date(selectedAmendment.signed_at), 'MMM d, yyyy h:mm a')}
                        </p>
                      )}
                    </div>
                  )}

                  <Alert className="border-0 bg-[#4F5D75]/10 rounded-xl">
                    <div className="h-8 w-8 rounded-lg bg-[#4F5D75]/20 flex items-center justify-center">
                      <Calendar className="h-4 w-4 text-[#4F5D75]" />
                    </div>
                    <AlertDescription className="text-sm font-medium">
                      Requested: {format(new Date(selectedAmendment.created_at), 'MMMM d, yyyy h:mm a')}
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            </div>

            <DialogFooter className="gap-2 pt-3">
              <Button
                variant="outline"
                onClick={() => setShowAmendmentDialog(false)}
                disabled={actionLoading}
                className="h-8 text-[10px] font-semibold rounded-lg border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300 active:scale-95 px-3"
              >
                Close
              </Button>
              <Button
                variant="outline"
                onClick={() => handleRejectAmendment(selectedAmendment.id)}
                disabled={actionLoading}
                className="h-8 text-[10px] font-semibold bg-red-500/10 hover:bg-red-500/20 text-red-600 border-0 rounded-lg shadow-sm hover:shadow-md transition-all duration-300 active:scale-95 px-3"
              >
                {actionLoading ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <XCircle className="h-3 w-3 mr-1" />
                )}
                Reject
              </Button>
              <Button
                onClick={() => handleApproveAmendment(selectedAmendment.id)}
                disabled={actionLoading}
                className="h-8 text-[10px] font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] active:scale-95 transition-all duration-300 rounded-lg border-0 text-white px-3"
              >
                {actionLoading ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3 w-3 mr-1" />
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
          <DialogContent className="max-w-xl bg-gradient-to-br from-background to-muted/20 border-0 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
            <DialogHeader className="space-y-2 pb-3">
              <DialogTitle className="flex items-center gap-2 text-base">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                  <Bot className="h-4 w-4 text-botkorp-orange" />
                </div>
                <span className="font-bold">
                  Mark Service as Installed
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs ml-10 text-muted-foreground">
                Confirm that bots have been physically installed for this service
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              {/* Service Info */}
              <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                <CardHeader className="pb-3 pt-4">
                  <CardTitle className="flex items-center gap-2.5 text-sm font-bold">
                    <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#4F5D75]/15 to-[#4F5D75]/5 flex items-center justify-center shadow-[0_2px_10px_rgba(79,93,117,0.1)]">
                      <Settings className="h-4 w-4 text-[#4F5D75]" />
                    </div>
                    <span>Service Information</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm pt-4">
                  <div className="flex justify-between p-2.5 rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <span className="text-muted-foreground">Service Name:</span>
                    <span className="font-semibold">{selectedService.name}</span>
                  </div>
                  <div className="flex justify-between p-2.5 rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <span className="text-muted-foreground">Service Type:</span>
                    <Badge variant="outline" className="capitalize border-0 bg-[#4F5D75]/10 text-[#4F5D75]">
                      {selectedService.service_type}
                    </Badge>
                  </div>
                  <div className="flex justify-between p-2.5 rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <span className="text-muted-foreground">Location:</span>
                    <span className="font-medium">{selectedService.location?.name}, {selectedService.location?.city}</span>
                  </div>
                  <div className="flex justify-between p-2.5 rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <span className="text-muted-foreground">Gardens:</span>
                    <span className="font-medium text-green-600 flex items-center gap-1.5">
                      <Sprout className="h-3.5 w-3.5" />
                      {selectedService.garden_count} garden{selectedService.garden_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex justify-between p-2.5 rounded-lg bg-botkorp-orange/10 border-0">
                    <span className="font-semibold text-botkorp-orange">Bots to Deploy:</span>
                    <Badge className="bg-botkorp-orange hover:bg-botkorp-orange/90 text-white border-0">
                      <Bot className="h-3 w-3 mr-1" />
                      {selectedService.garden_count} bot{selectedService.garden_count !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                  <div className="flex justify-between p-2.5 rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <span className="text-muted-foreground">Created:</span>
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {format(new Date(selectedService.created_at), 'MMM d, yyyy h:mm a')}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Alert className="border-0 bg-botkorp-orange/10 rounded-xl">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                  <Info className="h-5 w-5 text-botkorp-orange" />
                </div>
                <AlertDescription className="text-sm">
                  <p className="font-bold mb-2 text-base">Before marking as installed:</p>
                  <ul className="space-y-2 mt-3">
                    <li className="flex items-center gap-2">
                      <div className="h-5 w-5 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 className="h-3 w-3 text-white" />
                      </div>
                      <span>All {selectedService.garden_count} bots physically deployed</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="h-5 w-5 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 className="h-3 w-3 text-white" />
                      </div>
                      <span>Bots tested and operational</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="h-5 w-5 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 className="h-3 w-3 text-white" />
                      </div>
                      <span>Customer informed of installation completion</span>
                    </li>
                  </ul>
                </AlertDescription>
              </Alert>
            </div>

            <DialogFooter className="gap-2 pt-3">
              <Button
                variant="outline"
                onClick={() => setShowInstallDialog(false)}
                disabled={actionLoading}
                className="h-8 text-[10px] font-semibold rounded-lg border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300 active:scale-95 px-3"
              >
                Cancel
              </Button>
              <Button
                onClick={() => handleMarkInstalled(selectedService.id)}
                disabled={actionLoading}
                className="h-8 text-[10px] font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] active:scale-95 transition-all duration-300 rounded-lg border-0 text-white px-3"
              >
                {actionLoading ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3 w-3 mr-1" />
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


