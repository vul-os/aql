import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Users,
  UserPlus,
  Mail,
  MoreVertical,
  Shield,
  Crown,
  UserCog,
  Eye,
  Trash2,
  Loader2,
  Clock,
  X
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import PageHeader from '@/components/ui/page-header';
import { format } from 'date-fns';

export default function MembersPage() {
  const { user, selectedOrg, selectedLocation } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  
  // Invite form state
  const [inviteForm, setInviteForm] = useState({
    email: '',
    role: 'member'
  });

  useEffect(() => {
    if (selectedOrg) {
      loadMembers();
    }
  }, [selectedOrg]);

  const loadMembers = async () => {
    if (!selectedOrg?.organization_id) return;

    try {
      setLoading(true);

      // Load active members (specify foreign key to avoid ambiguity)
      const { data: membersData, error: membersError } = await supabase
        .from('organization_members')
        .select(`
          *,
          user:profiles!organization_members_user_id_fkey(
            id,
            email,
            full_name,
            avatar_url
          )
        `)
        .eq('organization_id', selectedOrg.organization_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (membersError) throw membersError;
      setMembers(membersData || []);

      // Load pending invitations with inviter details
      const { data: invitationsData, error: invitationsError } = await supabase
        .from('organization_invitations')
        .select(`
          *,
          inviter:profiles!invited_by(first_name, email, full_name)
        `)
        .eq('organization_id', selectedOrg.organization_id)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (invitationsError) throw invitationsError;
      setInvitations(invitationsData || []);

    } catch (error) {
      console.error('Error loading members:', error);
      toast({
        title: "Error",
        description: "Failed to load team members",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInviteMember = async (e) => {
    e.preventDefault();

    if (!inviteForm.email) {
      toast({
        title: "Validation Error",
        description: "Please enter an email address",
        variant: "destructive"
      });
      return;
    }

    setInviting(true);
    try {
      // Create invitation using SQL function
      // Note: Permissions are determined by role, no need to pass them explicitly
      const { data: inviteData, error: inviteError } = await supabase.rpc('create_member_invitation', {
        p_organization_id: selectedOrg.organization_id,
        p_email: inviteForm.email,
        p_role: inviteForm.role,
        p_invited_by: user.id
      });

      if (inviteError) throw inviteError;

      console.log('✅ Invitation created:', inviteData);
      
      // Check if the RPC returned success
      if (!inviteData || !inviteData.success) {
        throw new Error(inviteData?.error || 'Failed to create invitation');
      }

      console.log('📧 Sending email for invitation:', inviteData.invitation_id);

      // Send invitation email via Edge Function (just pass invitation_id)
      const { data: emailResponse, error: emailError } = await supabase.functions.invoke('send-invite-email', {
        body: {
          invitation_id: inviteData.invitation_id
        }
      });
      
      console.log('📬 Email sent:', emailResponse);
      if (emailError) {
        console.error('⚠️ Email error:', emailError);
      }

      if (emailError) {
        console.error('Error sending email:', emailError);
        toast({
          title: "Invitation Created ✅",
          description: `Invitation created for ${inviteForm.email}. Email sending in progress...`,
        });
      } else {
        toast({
          variant: 'success',
          title: "Invitation Sent! 📧",
          description: `Email invitation sent to ${inviteForm.email}. They have 7 days to accept.`,
          duration: 5000,
        });
      }

      setDialogOpen(false);
      setInviteForm({
        email: '',
        role: 'member'
      });
      loadMembers();

    } catch (error) {
      console.error('Error inviting member:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to invite member",
        variant: "destructive"
      });
    } finally {
      setInviting(false);
    }
  };

  const handleCancelInvitation = async (invitationId) => {
    try {
      const { error } = await supabase.rpc('cancel_member_invitation', {
        p_invitation_id: invitationId,
        p_user_id: user.id
      });

      if (error) throw error;

      toast({
        title: "Invitation Cancelled",
        description: "The invitation has been cancelled",
      });

      loadMembers();
    } catch (error) {
      console.error('Error cancelling invitation:', error);
      toast({
        title: "Error",
        description: "Failed to cancel invitation",
        variant: "destructive"
      });
    }
  };

  const handleUpdateMemberRole = async (memberId, newRole) => {
    try {
      const { error } = await supabase
        .from('organization_members')
        .update({ role: newRole })
        .eq('id', memberId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Member role updated",
      });

      loadMembers();
    } catch (error) {
      console.error('Error updating member:', error);
      toast({
        title: "Error",
        description: "Failed to update member role",
        variant: "destructive"
      });
    }
  };

  const handleRemoveMember = async (memberId) => {
    const member = members.find(m => m.id === memberId);
    if (!confirm(`Are you sure you want to remove ${member?.user?.full_name || member?.user?.email} from the organization?`)) return;

    try {
      const { error } = await supabase
        .from('organization_members')
        .update({ status: 'removed' })
        .eq('id', memberId);

      if (error) throw error;

      toast({
        title: "Member Removed",
        description: "Member has been removed from organization",
      });

      loadMembers();
    } catch (error) {
      console.error('Error removing member:', error);
      toast({
        title: "Error",
        description: "Failed to remove member",
        variant: "destructive"
      });
    }
  };

  const getRoleBadgeVariant = (role) => {
    switch (role) {
      case 'owner':
        return 'default';
      case 'admin':
        return 'default';
      case 'manager':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'owner':
        return <Crown className="h-4 w-4" />;
      case 'admin':
        return <Shield className="h-4 w-4" />;
      case 'manager':
        return <UserCog className="h-4 w-4" />;
      default:
        return <Eye className="h-4 w-4" />;
    }
  };

  const getUserInitials = (member) => {
    if (member.user?.full_name) {
      return member.user.full_name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return member.user?.email?.[0]?.toUpperCase() || 'U';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <PageHeader
          title="Team Members"
          subtitle="Manage team members and their permissions"
          actions={
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="h-4 w-4 mr-2" />
                Invite Member
              </Button>
            </DialogTrigger>
          }
        />
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="h-4 w-4 mr-2" />
              Invite Member
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
              <DialogDescription>
                Send an email invitation to join your organization. They can accept within 7 days.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleInviteMember} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address *</Label>
                <Input
                  id="email"
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  placeholder="member@example.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">Role *</Label>
                <Select
                  value={inviteForm.role}
                  onValueChange={(value) => setInviteForm({ ...inviteForm, role: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">
                      <div className="flex flex-col items-start">
                        <span className="font-semibold">Admin</span>
                        <span className="text-xs text-muted-foreground">Full access to everything</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="manager">
                      <div className="flex flex-col items-start">
                        <span className="font-semibold">Manager</span>
                        <span className="text-xs text-muted-foreground">Manage bots, locations, view billing</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="operator">
                      <div className="flex flex-col items-start">
                        <span className="font-semibold">Operator</span>
                        <span className="text-xs text-muted-foreground">Control bots only</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="viewer">
                      <div className="flex flex-col items-start">
                        <span className="font-semibold">Viewer</span>
                        <span className="text-xs text-muted-foreground">View-only access</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="member">
                      <div className="flex flex-col items-start">
                        <span className="font-semibold">Member</span>
                        <span className="text-xs text-muted-foreground">Basic access</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Permissions are automatically assigned based on role
                </p>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={inviting}>
                  {inviting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Mail className="h-4 w-4 mr-2" />
                      Send Invitation
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Pending Invitations ({invitations.length})
            </CardTitle>
            <CardDescription>
              Invitations waiting to be accepted
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {invitations.map((invitation) => (
                <div key={invitation.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/5 transition-colors">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Mail className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{invitation.email}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="secondary" className="capitalize">
                          {invitation.role}
                        </Badge>
                        {invitation.inviter && (
                          <span className="text-xs text-muted-foreground">
                            Invited by {invitation.inviter.full_name || invitation.inviter.first_name}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">
                          Sent {format(new Date(invitation.created_at), 'MMM d, yyyy')}
                        </span>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-amber-600 font-medium">
                          Expires {format(new Date(invitation.expires_at), 'MMM d')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCancelInvitation(invitation.id)}
                    className="hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Members List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Active Members ({members.length})
          </CardTitle>
          <CardDescription>
            Current members of {selectedOrg?.organization_name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {members.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarImage src={member.user?.avatar_url} />
                            <AvatarFallback>{getUserInitials(member)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">
                              {member.user?.full_name || 'Unknown User'}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {member.user?.email}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={member.role}
                          onValueChange={(newRole) => handleUpdateMemberRole(member.id, newRole)}
                          disabled={member.role === 'owner' || member.user_id === user?.id}
                        >
                          <SelectTrigger className="w-[150px]">
                            <Badge variant={getRoleBadgeVariant(member.role)} className="gap-1">
                              {getRoleIcon(member.role)}
                              <span className="capitalize">{member.role}</span>
                            </Badge>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="operator">Operator</SelectItem>
                            <SelectItem value="viewer">Viewer</SelectItem>
                            <SelectItem value="member">Member</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={member.status === 'active' ? 'default' : 'secondary'}
                        >
                          {member.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {member.joined_at
                          ? format(new Date(member.joined_at), 'MMM d, yyyy')
                          : 'N/A'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveMember(member.id)}
                          disabled={member.role === 'owner' || member.user_id === user?.id}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No members yet</h3>
              <p className="text-muted-foreground mb-4">
                Invite team members to collaborate on Bot Korp
              </p>
              <Button onClick={() => setDialogOpen(true)}>
                <UserPlus className="h-4 w-4 mr-2" />
                Invite Member
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

