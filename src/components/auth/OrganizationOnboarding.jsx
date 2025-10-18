import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Building2, 
  Users, 
  Clock, 
  LogOut, 
  Loader2, 
  Home, 
  Factory, 
  ShoppingBag, 
  Tractor,
  Sparkles,
  Check
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import { cn } from '@/lib/utils';

const ORG_TYPES = [
  { 
    value: 'residential', 
    label: 'Residential', 
    icon: Home,
    description: 'Home & residential properties'
  },
  { 
    value: 'commercial', 
    label: 'Commercial', 
    icon: ShoppingBag,
    description: 'Offices, retail & businesses'
  },
  { 
    value: 'industrial', 
    label: 'Industrial', 
    icon: Factory,
    description: 'Factories & warehouses'
  },
  { 
    value: 'agricultural', 
    label: 'Agricultural', 
    icon: Tractor,
    description: 'Farms & agricultural land'
  }
];

export function OrganizationOnboarding({ onComplete }) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [invitations, setInvitations] = useState([]);
  const { user, signOut } = useAuth();
  const { toast } = useToast();

  // Form state for creating organization
  const [orgName, setOrgName] = useState('');
  const [orgType, setOrgType] = useState('residential');

  useEffect(() => {
    if (user?.id) {
      loadPendingInvitations();
    }
  }, [user?.id]);

  const loadPendingInvitations = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_user_pending_invitations', {
        p_user_id: user.id
      });

      if (error) throw error;

      setInvitations(data || []);
    } catch (error) {
      console.error('Error loading invitations:', error);
      toast({
        title: "Error",
        description: "Failed to load invitations",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateOrganization = async (e) => {
    e.preventDefault();
    
    if (!orgName.trim()) {
      toast({
        title: "Error",
        description: "Organization name is required",
        variant: "destructive"
      });
      return;
    }

    try {
      setSubmitting(true);
      
      const { data, error } = await supabase.rpc('create_organization', {
        p_user_id: user.id,
        p_organization_name: orgName.trim(),
        p_organization_type: orgType
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Organization "${data[0].organization_name}" created successfully!`
      });

      // Trigger refresh in parent
      if (onComplete) {
        onComplete();
      }
    } catch (error) {
      console.error('Error creating organization:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to create organization",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcceptInvitation = async (invitationId) => {
    try {
      setSubmitting(true);
      
      const { data, error } = await supabase.rpc('accept_member_invitation', {
        p_invitation_id: invitationId,
        p_user_id: user.id
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Failed to accept invitation');
      }

      toast({
        title: "Success",
        description: "You've joined the organization!"
      });

      // Trigger refresh in parent
      if (onComplete) {
        onComplete();
      }
    } catch (error) {
      console.error('Error accepting invitation:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to accept invitation",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeclineInvitation = async (invitationId) => {
    try {
      const { data, error } = await supabase.rpc('decline_member_invitation', {
        p_invitation_id: invitationId,
        p_user_id: user.id
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Failed to decline invitation');
      }

      toast({
        title: "Invitation declined",
        description: "The invitation has been declined"
      });

      // Refresh invitations list
      loadPendingInvitations();
    } catch (error) {
      console.error('Error declining invitation:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to decline invitation",
        variant: "destructive"
      });
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-muted/20 p-4">
      <div className="w-full max-w-3xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 rounded-full blur-2xl"></div>
              <div className="relative rounded-full bg-gradient-to-br from-primary to-primary/80 p-4 shadow-lg">
                <Building2 className="h-12 w-12 text-primary-foreground" />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              Welcome to BotKorp!
            </h1>
            <p className="text-lg text-muted-foreground max-w-md mx-auto">
              {invitations.length > 0 
                ? `You have ${invitations.length} pending ${invitations.length === 1 ? 'invitation' : 'invitations'}! Accept to join or create your own organization.`
                : 'Create your organization to get started with automated bot services'
              }
            </p>
          </div>
        </div>

        {/* Pending Invitations Alert */}
        {invitations.length > 0 && (
          <Card className="border-2 border-primary/50 bg-primary/5 shadow-lg">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">You're Invited!</CardTitle>
              </div>
              <CardDescription>
                {invitations.length} organization{invitations.length > 1 ? 's' : ''} want you to join their team
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {invitations.map((invitation) => (
                <Card key={invitation.invitation_id} className="border-2 hover:border-primary/50 transition-colors">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-1">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Building2 className="h-5 w-5 text-primary" />
                          {invitation.organization_name}
                        </CardTitle>
                        <CardDescription className="space-y-1">
                          <div className="flex items-center gap-2 text-sm">
                            <Users className="h-3.5 w-3.5" />
                            <span>Invited by {invitation.invited_by_name || 'Organization Admin'}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <Clock className="h-3.5 w-3.5" />
                            <span>Expires {formatDate(invitation.expires_at)}</span>
                          </div>
                        </CardDescription>
                      </div>
                      <Badge variant="secondary" className="capitalize shrink-0">
                        {invitation.role}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardFooter className="gap-2 pt-0">
                    <Button
                      onClick={() => handleAcceptInvitation(invitation.invitation_id)}
                      disabled={submitting}
                      className="flex-1"
                    >
                      {submitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="h-4 w-4 mr-2" />
                          Accept
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleDeclineInvitation(invitation.invitation_id)}
                      disabled={submitting}
                      className="flex-1"
                    >
                      Decline
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Create Organization Card */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Create Your Organization
            </CardTitle>
            <CardDescription>
              Set up your own organization to manage bots and services
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleCreateOrganization}>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="orgName" className="text-base">Organization Name</Label>
                <Input
                  id="orgName"
                  placeholder="Enter your organization name"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  disabled={submitting}
                  required
                  className="h-11"
                />
                <p className="text-sm text-muted-foreground">
                  This will be visible to your team members
                </p>
              </div>

              <div className="space-y-3">
                <Label className="text-base">Organization Type</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ORG_TYPES.map((type) => {
                    const Icon = type.icon;
                    return (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => setOrgType(type.value)}
                        disabled={submitting}
                        className={cn(
                          "relative flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left transition-all hover:border-primary/50",
                          orgType === type.value
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border bg-card hover:bg-accent/50"
                        )}
                      >
                        <div className="flex items-center gap-3 w-full">
                          <div className={cn(
                            "rounded-lg p-2",
                            orgType === type.value
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          )}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold">{type.label}</p>
                            <p className="text-xs text-muted-foreground">{type.description}</p>
                          </div>
                          {orgType === type.value && (
                            <Check className="h-5 w-5 text-primary shrink-0" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>

            <CardFooter>
              <Button
                type="submit"
                className="w-full h-11 text-base"
                disabled={submitting || !orgName.trim()}
                size="lg"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Creating Organization...
                  </>
                ) : (
                  <>
                    <Building2 className="mr-2 h-5 w-5" />
                    Create Organization
                  </>
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* Sign Out Button */}
        <div className="text-center">
          <Button
            variant="ghost"
            onClick={handleSignOut}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>

        {/* Footer */}
        <div className="text-center text-sm text-muted-foreground">
          <p>Need help? Contact support@botkorp.com</p>
        </div>
      </div>
    </div>
  );
}

