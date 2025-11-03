import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LoadingLottie from '@/components/ui/loading-lottie';
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
  X,
  Search,
  UserCheck,
  Building
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
  const [searchQuery, setSearchQuery] = useState('');
  
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

  const filteredMembers = members.filter(member =>
    member.user?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    member.user?.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    member.role?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen">
        <LoadingLottie
          src="https://lottie.host/51fee83a-3e79-41b0-8a20-77f890b9b6f1/iUangPxwIF.lottie"
          message="Loading team members..."
          size="md"
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Soft UI Background Card for Header */}
      <div className="bg-gradient-to-br from-background via-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <PageHeader
          title="Team Members"
          subtitle={`Manage your ${members.length} team member${members.length !== 1 ? 's' : ''} • Control roles and permissions`}
          icon={<Users />}
        />

        {/* Action Bar */}
        <div className="flex flex-col sm:flex-row gap-3 justify-between items-stretch sm:items-center mt-4">
          <div className="relative flex-1 max-w-md w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
            <Input
              placeholder="Search members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10 bg-background/60 backdrop-blur-sm border-none shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] focus:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06),0_0_0_3px_rgb(255,107,53,0.1)] transition-all rounded-xl"
            />
          </div>
          <Button 
            onClick={() => setDialogOpen(true)}
            className="h-10 px-5 font-medium bg-botkorp-orange hover:bg-botkorp-orange/90 text-white rounded-xl shadow-[0_8px_30px_rgb(255,107,53,0.25)] hover:shadow-[0_8px_30px_rgb(255,107,53,0.35)] hover:-translate-y-0.5 transition-all"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Invite Member
          </Button>
        </div>
      </div>

      {/* Stats Overview - Soft UI Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {/* Total Members Stat */}
        <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Members</span>
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
              <Users className="h-4 w-4 text-botkorp-orange" />
            </div>
          </div>
          <div className="text-3xl font-bold mb-1">{members.length}</div>
          <p className="text-xs text-muted-foreground/60">Active in team</p>
        </div>

        {/* Pending Invitations Stat */}
        <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Pending</span>
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
              <Clock className="h-4 w-4 text-botkorp-orange" />
            </div>
          </div>
          <div className="text-3xl font-bold mb-1">{invitations.length}</div>
          <p className="text-xs text-muted-foreground/60">Invites sent</p>
        </div>

        {/* Admins Count Stat */}
        <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Admins</span>
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
              <Shield className="h-4 w-4 text-botkorp-orange" />
            </div>
          </div>
          <div className="text-3xl font-bold mb-1">
            {members.filter(m => m.role === 'admin' || m.role === 'owner').length}
          </div>
          <p className="text-xs text-muted-foreground/60">& owners</p>
        </div>

        {/* Organization Stat */}
        <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Organization</span>
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
              <Building className="h-4 w-4 text-botkorp-orange" />
            </div>
          </div>
          <div className="text-lg font-bold mb-1 truncate">
            {selectedOrg?.organization_name || 'N/A'}
          </div>
          <p className="text-xs text-muted-foreground/60 capitalize">
            {selectedOrg?.member_role || 'Member'}
          </p>
        </div>
      </div>

      {/* Invite Member Dialog - Soft UI */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                <UserPlus className="h-5 w-5 text-botkorp-orange" />
              </div>
              Invite Team Member
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground/70">
              Send an email invitation to join your organization. They can accept within 7 days.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleInviteMember} className="space-y-5 mt-2">
            <div className="space-y-2.5">
              <Label htmlFor="email" className="text-sm font-medium">Email Address *</Label>
              <Input
                id="email"
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                placeholder="member@example.com"
                required
                className="h-11 bg-background/60 backdrop-blur-sm border-none shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] focus:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06),0_0_0_3px_rgb(255,107,53,0.1)] rounded-xl"
              />
            </div>

            <div className="space-y-2.5">
              <Label htmlFor="role" className="text-sm font-medium">Role *</Label>
              <Select
                value={inviteForm.role}
                onValueChange={(value) => setInviteForm({ ...inviteForm, role: value })}
              >
                <SelectTrigger className="h-11 bg-background/60 backdrop-blur-sm border-none shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-2xl">
                  <SelectItem value="admin" className="rounded-xl">
                    <div className="flex flex-col items-start py-1">
                      <span className="font-semibold">Admin</span>
                      <span className="text-xs text-muted-foreground/70">Full access to everything</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="manager" className="rounded-xl">
                    <div className="flex flex-col items-start py-1">
                      <span className="font-semibold">Manager</span>
                      <span className="text-xs text-muted-foreground/70">Manage bots, locations, view billing</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="operator" className="rounded-xl">
                    <div className="flex flex-col items-start py-1">
                      <span className="font-semibold">Operator</span>
                      <span className="text-xs text-muted-foreground/70">Control bots only</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="viewer" className="rounded-xl">
                    <div className="flex flex-col items-start py-1">
                      <span className="font-semibold">Viewer</span>
                      <span className="text-xs text-muted-foreground/70">View-only access</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="member" className="rounded-xl">
                    <div className="flex flex-col items-start py-1">
                      <span className="font-semibold">Member</span>
                      <span className="text-xs text-muted-foreground/70">Basic access</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground/60">
                Permissions are automatically assigned based on role
              </p>
            </div>

            <DialogFooter className="gap-2">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setDialogOpen(false)} 
                className="h-10 px-5 rounded-xl border-none bg-background/60 shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)]"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={inviting} 
                className="h-10 px-5 bg-botkorp-orange hover:bg-botkorp-orange/90 text-white rounded-xl shadow-[0_8px_30px_rgb(255,107,53,0.25)] hover:shadow-[0_8px_30px_rgb(255,107,53,0.35)]"
              >
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

      {/* Pending Invitations - Soft UI */}
      {invitations.length > 0 && (
        <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500/15 to-amber-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(245,158,11,0.15)]">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold flex items-center gap-2">
                Pending Invitations
                <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-amber-500/15 text-amber-600 text-[10px] font-bold">
                  {invitations.length}
                </span>
              </h3>
              <p className="text-xs text-muted-foreground/70">Waiting for acceptance</p>
            </div>
          </div>
          
          <div className="space-y-2.5">
            {invitations.map((invitation) => (
              <div 
                key={invitation.id} 
                className="flex items-center justify-between p-4 bg-background/60 backdrop-blur-sm rounded-2xl shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all group"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center flex-shrink-0 shadow-[0_4px_20px_rgb(255,107,53,0.1)]">
                    <Mail className="h-4 w-4 text-botkorp-orange" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{invitation.email}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-botkorp-orange/10 text-botkorp-orange text-[10px] font-medium capitalize">
                        {invitation.role}
                      </span>
                      {invitation.inviter && (
                        <>
                          <span className="text-[10px] text-muted-foreground/60">
                            by {invitation.inviter.full_name || invitation.inviter.first_name}
                          </span>
                          <span className="text-[10px] text-muted-foreground/40">•</span>
                        </>
                      )}
                      <span className="text-[10px] text-muted-foreground/60">
                        {format(new Date(invitation.created_at), 'MMM d, yyyy')}
                      </span>
                      <span className="text-[10px] text-muted-foreground/40">•</span>
                      <span className="text-[10px] text-amber-600 font-medium">
                        Expires {format(new Date(invitation.expires_at), 'MMM d')}
                      </span>
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCancelInvitation(invitation.id)}
                  className="h-9 w-9 p-0 rounded-xl hover:bg-destructive/10 hover:text-destructive transition-all flex-shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Members List - Soft UI */}
      <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
            <Users className="h-5 w-5 text-botkorp-orange" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold flex items-center gap-2">
              Active Members
              <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-botkorp-orange/15 text-botkorp-orange text-[10px] font-bold">
                {filteredMembers.length}
              </span>
            </h3>
            <p className="text-xs text-muted-foreground/70">
              {searchQuery 
                ? `${filteredMembers.length} of ${members.length} members match your search`
                : `Current members of ${selectedOrg?.organization_name}`
              }
            </p>
          </div>
        </div>
        
        <div>
          {filteredMembers.length > 0 ? (
            <div className="space-y-2.5">
              {filteredMembers.map((member) => (
                <div 
                  key={member.id} 
                  className="flex items-center justify-between p-4 bg-background/60 backdrop-blur-sm rounded-2xl shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all group"
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <Avatar className="h-11 w-11 shadow-[0_4px_20px_rgb(255,107,53,0.1)]">
                      <AvatarImage src={member.user?.avatar_url} />
                      <AvatarFallback className="bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 text-botkorp-orange font-bold text-sm">
                        {getUserInitials(member)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">
                        {member.user?.full_name || 'Unknown User'}
                      </p>
                      <p className="text-xs text-muted-foreground/60 truncate">
                        {member.user?.email}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <Select
                      value={member.role}
                      onValueChange={(newRole) => handleUpdateMemberRole(member.id, newRole)}
                      disabled={member.role === 'owner' || member.user_id === user?.id}
                    >
                      <SelectTrigger className="w-[130px] h-9 border-none bg-botkorp-orange/10 hover:bg-botkorp-orange/15 rounded-xl shadow-[0_2px_10px_rgb(255,107,53,0.08)]">
                        <div className="flex items-center gap-1.5">
                          {getRoleIcon(member.role)}
                          <span className="capitalize text-xs font-medium text-botkorp-orange">{member.role}</span>
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="operator">Operator</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                        <SelectItem value="member">Member</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-green-500/10 text-green-600 text-xs font-medium shadow-[0_2px_10px_rgb(34,197,94,0.08)]">
                      <UserCheck className="h-3.5 w-3.5" />
                      Active
                    </span>
                    
                    <div className="text-xs text-muted-foreground/60 w-24 text-right hidden md:block">
                      {member.joined_at
                        ? format(new Date(member.joined_at), 'MMM d, yyyy')
                        : 'N/A'}
                    </div>
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveMember(member.id)}
                      disabled={member.role === 'owner' || member.user_id === user?.id}
                      className="h-9 w-9 p-0 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-16 text-center">
              <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mb-5 shadow-[0_8px_30px_rgb(255,107,53,0.15)]">
                <Users className="h-10 w-10 text-botkorp-orange" />
              </div>
              <h3 className="text-xl font-bold mb-2">
                {searchQuery ? 'No members found' : 'No members yet'}
              </h3>
              <p className="text-muted-foreground/70 mb-8 max-w-sm mx-auto text-sm leading-relaxed">
                {searchQuery 
                  ? 'Try adjusting your search terms to find the member you\'re looking for'
                  : 'Invite team members to collaborate and manage your Bot Korp organization together'}
              </p>
              {!searchQuery && (
                <Button 
                  onClick={() => setDialogOpen(true)}
                  className="h-11 px-6 font-medium bg-botkorp-orange hover:bg-botkorp-orange/90 text-white rounded-xl shadow-[0_8px_30px_rgb(255,107,53,0.25)] hover:shadow-[0_8px_30px_rgb(255,107,53,0.35)] hover:-translate-y-0.5 transition-all"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Invite Member
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

