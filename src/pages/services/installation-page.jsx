import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Calendar, 
  CheckCircle, 
  Clock, 
  Wrench, 
  AlertCircle,
  MapPin,
  Bot,
  Phone,
  Mail,
  ArrowRight,
  Home
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import PageHeader from '@/components/ui/page-header';

export default function InstallationPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { selectedOrg, selectedLocation } = useAuth();
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState([]);

  useEffect(() => {
    if (selectedOrg?.organization_id) {
      loadPendingInstallations();
    }
  }, [selectedOrg]);

  const loadPendingInstallations = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .rpc('get_pending_installations', {
          p_organization_id: selectedOrg.organization_id
        });

      if (error) throw error;

      setServices(data || []);
    } catch (error) {
      console.error('Error loading installations:', error);
      toast({
        title: 'Error',
        description: 'Failed to load installation status',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const getStageInfo = (stage) => {
    switch (stage) {
      case 'pending_installation':
        return {
          label: 'Pending Installation',
          icon: Clock,
          color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
          description: 'Waiting to be scheduled'
        };
      case 'installation_scheduled':
        return {
          label: 'Scheduled',
          icon: Calendar,
          color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
          description: 'Installation date confirmed'
        };
      case 'installing':
        return {
          label: 'In Progress',
          icon: Wrench,
          color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200',
          description: 'Technician is installing'
        };
      case 'installed':
        return {
          label: 'Installed',
          icon: CheckCircle,
          color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
          description: 'Ready for activation'
        };
      default:
        return {
          label: stage,
          icon: AlertCircle,
          color: 'bg-gray-100 text-gray-800',
          description: ''
        };
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return null;
    return new Date(dateString).toLocaleDateString('en-ZA', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading installation status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Installation Status"
        description="Track the installation progress of your bot services"
      />

      {services.length === 0 ? (
        <Card>
          <CardContent className="pt-12 pb-12 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">All Services Active</h3>
                <p className="text-muted-foreground mb-6 max-w-md">
                  You don't have any services pending installation. All your services are installed and active!
                </p>
                <div className="flex gap-3 justify-center">
                  <Button onClick={() => navigate('/portal/services')}>
                    <Home className="h-4 w-4 mr-2" />
                    View Services
                  </Button>
                  <Button variant="outline" onClick={() => navigate('/portal/services/add')}>
                    Add New Service
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Installation Process Overview */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <p className="font-semibold mb-2">Installation Process:</p>
              <div className="text-sm space-y-1">
                <p>1. <strong>Pending:</strong> We'll contact you within 24 hours to schedule installation</p>
                <p>2. <strong>Scheduled:</strong> Installation date confirmed with technician assigned</p>
                <p>3. <strong>Installing:</strong> Our technician is setting up your bot system</p>
                <p>4. <strong>Installed:</strong> System ready - we'll activate and start first service visit</p>
              </div>
            </AlertDescription>
          </Alert>

          {/* Contact Card */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Phone className="h-5 w-5" />
                Need to Reschedule?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>Call us: <strong>+27 31 123 4567</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>Email: <strong>installations@botkorp.co.za</strong></span>
              </div>
              <p className="text-muted-foreground mt-2">
                Our team is available Mon-Fri 8:00-17:00 to assist with scheduling.
              </p>
            </CardContent>
          </Card>

          {/* Services List */}
          <div className="grid gap-4">
            {services.map((service) => {
              const stageInfo = getStageInfo(service.stage);
              const StageIcon = stageInfo.icon;

              return (
                <Card key={`${service.service_type}-${service.service_id}`} className="border-2">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <Bot className="h-5 w-5 text-primary" />
                          <CardTitle className="text-xl">{service.service_name}</CardTitle>
                          <Badge variant="outline" className={stageInfo.color}>
                            <StageIcon className="h-3 w-3 mr-1" />
                            {stageInfo.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <MapPin className="h-4 w-4" />
                          <span>{service.location_name}</span>
                          <span>•</span>
                          <span className="capitalize">{service.service_type} Service</span>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Timeline */}
                    <div className="space-y-3">
                      {/* Service Created */}
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                          <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                        </div>
                        <div className="flex-1 pt-1">
                          <p className="font-medium text-sm">Service Created</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(service.created_at)}
                          </p>
                        </div>
                      </div>

                      {/* Installation Scheduled */}
                      {service.installation_scheduled_date && (
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                            <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                          </div>
                          <div className="flex-1 pt-1">
                            <p className="font-medium text-sm">Installation Scheduled</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(service.installation_scheduled_date)}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Current Stage Info */}
                      <div className="flex items-start gap-3">
                        <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${stageInfo.color}`}>
                          <StageIcon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 pt-1">
                          <p className="font-medium text-sm">{stageInfo.description}</p>
                          {service.stage === 'pending_installation' && (
                            <p className="text-xs text-muted-foreground mt-1">
                              We'll contact you within 24 hours to schedule your installation.
                            </p>
                          )}
                          {service.stage === 'installation_scheduled' && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Please ensure access to the property on the scheduled date.
                            </p>
                          )}
                          {service.stage === 'installing' && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Installation typically takes 2-4 hours. You'll receive a notification when complete.
                            </p>
                          )}
                          {service.stage === 'installed' && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Installation complete! We'll activate your service and perform the first visit.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* What's Included */}
                    <div className="bg-muted/50 p-4 rounded-lg">
                      <p className="font-semibold text-sm mb-2">Installation Includes:</p>
                      <ul className="text-xs space-y-1 text-muted-foreground">
                        <li className="flex items-center gap-2">
                          <CheckCircle className="h-3 w-3 text-green-600" />
                          Boundary wire installation and configuration
                        </li>
                        <li className="flex items-center gap-2">
                          <CheckCircle className="h-3 w-3 text-green-600" />
                          Bot setup and calibration for your garden
                        </li>
                        <li className="flex items-center gap-2">
                          <CheckCircle className="h-3 w-3 text-green-600" />
                          Safety checks and obstacle detection testing
                        </li>
                        <li className="flex items-center gap-2">
                          <CheckCircle className="h-3 w-3 text-green-600" />
                          Training session on portal usage and bot operation
                        </li>
                        <li className="flex items-center gap-2">
                          <CheckCircle className="h-3 w-3 text-green-600" />
                          First service visit included (edge trimming + battery swap)
                        </li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Help Section */}
          <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-amber-600" />
                Installation FAQ
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-semibold">How long does installation take?</p>
                <p className="text-muted-foreground">
                  Typically 2-4 hours depending on garden size and complexity. Our technician will confirm the timeline when scheduling.
                </p>
              </div>
              <div>
                <p className="font-semibold">Do I need to be present?</p>
                <p className="text-muted-foreground">
                  Yes, we require someone 18+ to be present for the installation and training session. They don't need to be involved in the physical work.
                </p>
              </div>
              <div>
                <p className="font-semibold">What if it rains on installation day?</p>
                <p className="text-muted-foreground">
                  We'll reschedule for the next available dry day at no additional cost. Our team will contact you to arrange a new date.
                </p>
              </div>
              <div>
                <p className="font-semibold">When will I get my first invoice?</p>
                <p className="text-muted-foreground">
                  Your first invoice (including setup fee and prorated monthly charges) will be generated after installation is complete and your service is activated.
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

