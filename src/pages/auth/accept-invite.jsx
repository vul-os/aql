import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Bot,
  Building2,
  Calendar,
  CheckCircle2,
  XCircle,
  Loader2,
  Crown,
  Shield,
  UserCog,
  Eye,
  Mail
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

export default function AcceptInvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [invitation, setInvitation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (token) {
      loadInvitation();
    }
  }, [token]);

  const loadInvitation = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: inviteError } = await supabase.rpc('get_invitation_by_token', {
        p_invite_token: token
      });

      if (inviteError) throw inviteError;

      if (!data) {
        setError('Invitation not found');
        return;
      }

      setInvitation(data);

      // Check if invitation is valid
      if (!data.is_valid) {
        if (data.status === 'expired') {
          setError('This invitation has expired');
        } else if (data.status === 'accepted') {
          setError('This invitation has already been accepted');
        } else if (data.status === 'cancelled') {
          setError('This invitation has been cancelled');
        } else {
          setError('This invitation is no longer valid');
        }
      }

    } catch (error) {
      console.error('Error loading invitation:', error);
      setError('Failed to load invitation');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptInvitation = async () => {
    if (!user) {
      // Redirect to login with return URL
      navigate(`/auth/login?redirect=/accept-invite/${token}`);
      return;
    }

    try {
      setAccepting(true);

      const { data, error: acceptError } = await supabase.rpc('accept_member_invitation', {
        p_invite_token: token,
        p_user_id: user.id
      });

      if (acceptError) throw acceptError;

      toast({
        title: "Success!",
        description: `You've joined ${invitation.organization_name}`,
      });

      // Redirect to portal
      navigate('/portal');

    } catch (error) {
      console.error('Error accepting invitation:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to accept invitation",
        variant: "destructive"
      });
    } finally {
      setAccepting(false);
    }
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'owner':
        return <Crown className="h-5 w-5" />;
      case 'admin':
        return <Shield className="h-5 w-5" />;
      case 'manager':
        return <UserCog className="h-5 w-5" />;
      default:
        return <Eye className="h-5 w-5" />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Loading invitation...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !invitation) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>Invalid Invitation</CardTitle>
            <CardDescription>{error || 'This invitation is not valid'}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => navigate('/')}
            >
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        {/* Header */}
        <CardHeader className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Bot className="h-8 w-8 text-primary" />
            <h1 className="text-2xl font-bold">Bot Korp</h1>
          </div>
          <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Mail className="h-8 w-8 text-primary" />
          </div>
          <div>
            <CardTitle className="text-2xl mb-2">You're Invited!</CardTitle>
            <CardDescription>
              {invitation.inviter_name} has invited you to join their organization
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Organization Card */}
          <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-6">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold mb-1">{invitation.organization_name}</h3>
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge variant="secondary" className="gap-1">
                    {getRoleIcon(invitation.role)}
                    <span className="capitalize">{invitation.role}</span>
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    Invited by {invitation.inviter_name}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <span className="text-muted-foreground">Invited on: </span>
                <span className="font-medium">
                  {format(new Date(invitation.invited_at), 'MMMM d, yyyy')}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <span className="text-muted-foreground">Expires on: </span>
                <span className="font-medium">
                  {format(new Date(invitation.expires_at), 'MMMM d, yyyy')}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <div>
                <span className="text-muted-foreground">Email: </span>
                <span className="font-medium">{invitation.email}</span>
              </div>
            </div>
          </div>

          {/* What you'll get */}
          <div className="rounded-lg bg-muted/50 p-4">
            <h4 className="font-semibold mb-3">What you'll get access to:</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>Real-time dashboard and analytics</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>Control and monitor autonomous bots</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>Collaborate with team members</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>Receive alerts and notifications</span>
              </li>
            </ul>
          </div>

          {/* Warning if not logged in */}
          {!user && (
            <Alert>
              <AlertDescription>
                You need to sign in or create an account to accept this invitation.
              </AlertDescription>
            </Alert>
          )}

          {/* Warning if email mismatch */}
          {user && user.email !== invitation.email && (
            <Alert variant="destructive">
              <AlertDescription>
                This invitation was sent to <strong>{invitation.email}</strong>, but you're logged in as <strong>{user.email}</strong>. 
                Please sign in with the correct account.
              </AlertDescription>
            </Alert>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            {user ? (
              <>
                <Button
                  className="flex-1"
                  onClick={handleAcceptInvitation}
                  disabled={accepting || user.email !== invitation.email}
                >
                  {accepting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Accepting...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Accept Invitation
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate('/')}
                  disabled={accepting}
                >
                  Decline
                </Button>
              </>
            ) : (
              <>
                <Button
                  className="flex-1"
                  onClick={() => navigate(`/auth/login?redirect=/accept-invite/${token}`)}
                >
                  Sign In to Accept
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate(`/auth/register?redirect=/accept-invite/${token}`)}
                >
                  Create Account
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

