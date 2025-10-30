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
    <div className="p-3 md:p-5 space-y-5">
      {/* Header Section */}
      <div className="space-y-3 animate-in fade-in slide-in-from-top-3 duration-500">
        <PageHeader
          title="Team Members"
          subtitle={`Manage your ${members.length} team member${members.length !== 1 ? 's' : ''} and their permissions`}
          icon={<Users className="h-5 w-5 text-botkorp-orange" />}
        />

        {/* Action Bar */}
        <div className="flex flex-col sm:flex-row gap-2.5 justify-between items-start sm:items-center">
          <div className="relative flex-1 max-w-md w-full group">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground group-focus-within:text-botkorp-orange transition-colors duration-300" />
            <Input
              placeholder="Search members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-sm focus:border-botkorp-orange focus:ring-2 focus:ring-botkorp-orange/20 transition-all duration-300"
            />
          </div>
          <Button 
            onClick={() => setDialogOpen(true)}
            className="w-full sm:w-auto h-8 text-sm bg-botkorp-orange hover:bg-botkorp-orange/90 text-white hover:shadow-lg transition-all duration-300 active:scale-95 group"
          >
            <UserPlus className="h-3.5 w-3.5 mr-1.5 group-hover:rotate-12 transition-transform duration-300" />
            Invite Member
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {/* Total Members Stat */}
        <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 shadow-sm">
          <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total Members</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-botkorp-orange transition-all duration-300">
              <Users className="h-3.5 w-3.5 text-botkorp-orange group-hover:text-white transition-colors duration-300" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-bold tabular-nums">{members.length}</div>
            <p className="text-[10px] text-muted-foreground font-medium mt-0.5">Active</p>
          </CardContent>
        </Card>

        {/* Pending Invitations Stat */}
        <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-75 shadow-sm">
          <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pending</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-botkorp-orange transition-all duration-300">
              <Clock className="h-3.5 w-3.5 text-botkorp-orange group-hover:text-white transition-colors duration-300" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-bold tabular-nums">{invitations.length}</div>
            <p className="text-[10px] text-muted-foreground font-medium mt-0.5">Invitations</p>
          </CardContent>
        </Card>

        {/* Admins Count Stat */}
        <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-150 shadow-sm">
          <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Admins</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-botkorp-orange transition-all duration-300">
              <Shield className="h-3.5 w-3.5 text-botkorp-orange group-hover:text-white transition-colors duration-300" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-bold tabular-nums">
              {members.filter(m => m.role === 'admin' || m.role === 'owner').length}
            </div>
            <p className="text-[10px] text-muted-foreground font-medium mt-0.5">& Owners</p>
          </CardContent>
        </Card>

        {/* Organization Stat */}
        <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200 shadow-sm">
          <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Organization</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-botkorp-orange transition-all duration-300">
              <Building className="h-3.5 w-3.5 text-botkorp-orange group-hover:text-white transition-colors duration-300" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-sm font-bold truncate">
              {selectedOrg?.organization_name || 'N/A'}
            </div>
            <p className="text-[10px] text-muted-foreground font-medium mt-0.5 capitalize">
              {selectedOrg?.member_role || 'Member'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Invite Member Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg animate-in fade-in zoom-in-95 duration-300">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center">
                <UserPlus className="h-4 w-4 text-botkorp-orange" />
              </div>
              Invite Team Member
            </DialogTitle>
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
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className="h-8">
                Cancel
              </Button>
              <Button type="submit" disabled={inviting} className="h-8 bg-botkorp-orange hover:bg-botkorp-orange/90 text-white">
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
        <Card className="border-t-4 border-t-botkorp-orange shadow-md animate-in fade-in slide-in-from-bottom-3 duration-500">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-0.5 w-8 bg-botkorp-orange rounded-full" />
                <CardTitle className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
                  <Clock className="h-4 w-4 text-botkorp-orange" />
                  Pending Invitations
                  <Badge variant="secondary" className="h-5 px-2 text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20 font-semibold">
                    {invitations.length}
                  </Badge>
                </CardTitle>
              </div>
            </div>
            <CardDescription className="text-xs mt-1">
              Invitations waiting to be accepted
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {invitations.map((invitation, index) => (
                <div 
                  key={invitation.id} 
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-botkorp-orange/5 hover:border-botkorp-orange/30 transition-all duration-300 group animate-in fade-in slide-in-from-left-3"
                  style={{ animationDelay: `${index * 50}ms`, animationDuration: '300ms' }}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="h-9 w-9 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center flex-shrink-0 group-hover:bg-botkorp-orange transition-all duration-300">
                      <Mail className="h-4 w-4 text-botkorp-orange group-hover:text-white transition-colors duration-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{invitation.email}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="secondary" className="capitalize h-5 px-2 text-[10px] bg-botkorp-orange/10 text-botkorp-orange border-botkorp-orange/20">
                          {invitation.role}
                        </Badge>
                        {invitation.inviter && (
                          <>
                            <span className="text-[10px] text-muted-foreground">
                              by {invitation.inviter.full_name || invitation.inviter.first_name}
                            </span>
                            <span className="text-[10px] text-muted-foreground">•</span>
                          </>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {format(new Date(invitation.created_at), 'MMM d, yyyy')}
                        </span>
                        <span className="text-[10px] text-muted-foreground">•</span>
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
                    className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive transition-all duration-300 flex-shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Members List */}
      <Card className="border-t-4 border-t-botkorp-orange shadow-md animate-in fade-in slide-in-from-bottom-3 duration-500 delay-100">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-0.5 w-8 bg-botkorp-orange rounded-full" />
              <CardTitle className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
                <Users className="h-4 w-4 text-botkorp-orange" />
                Active Members
                <Badge variant="secondary" className="h-5 px-2 text-[10px] bg-botkorp-orange/10 text-botkorp-orange border-botkorp-orange/20 font-semibold">
                  {filteredMembers.length}
                </Badge>
              </CardTitle>
            </div>
          </div>
          <CardDescription className="text-xs mt-1">
            {searchQuery 
              ? `${filteredMembers.length} of ${members.length} members match your search`
              : `Current members of ${selectedOrg?.organization_name}`
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredMembers.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs font-bold">Member</TableHead>
                    <TableHead className="text-xs font-bold">Role</TableHead>
                    <TableHead className="text-xs font-bold">Status</TableHead>
                    <TableHead className="text-xs font-bold">Joined</TableHead>
                    <TableHead className="text-right text-xs font-bold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.map((member, index) => (
                    <TableRow 
                      key={member.id} 
                      className="group hover:bg-botkorp-orange/5 transition-all duration-300 animate-in fade-in slide-in-from-left-3"
                      style={{ animationDelay: `${index * 30}ms`, animationDuration: '300ms' }}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9 border-2 border-botkorp-orange/20 group-hover:border-botkorp-orange transition-all duration-300">
                            <AvatarImage src={member.user?.avatar_url} />
                            <AvatarFallback className="bg-botkorp-orange/10 text-botkorp-orange font-semibold text-xs">
                              {getUserInitials(member)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-semibold text-sm">
                              {member.user?.full_name || 'Unknown User'}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
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
                          <SelectTrigger className="w-[140px] h-8 border-botkorp-orange/20">
                            <Badge variant={getRoleBadgeVariant(member.role)} className="gap-1 bg-botkorp-orange/10 text-botkorp-orange border-botkorp-orange/20 hover:bg-botkorp-orange hover:text-white transition-colors duration-300">
                              {getRoleIcon(member.role)}
                              <span className="capitalize text-[11px]">{member.role}</span>
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
                          className="bg-green-500/10 text-green-600 border-green-500/20 text-[10px] h-5 px-2"
                        >
                          <UserCheck className="h-3 w-3 mr-1" />
                          {member.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {member.joined_at
                            ? format(new Date(member.joined_at), 'MMM d, yyyy')
                            : 'N/A'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveMember(member.id)}
                          disabled={member.role === 'owner' || member.user_id === user?.id}
                          className="h-8 w-8 p-0 text-destructive hover:text-white hover:bg-destructive transition-all duration-300 active:scale-95"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Card className="border-2 border-dashed bg-muted/20 shadow-sm">
              <CardContent className="pt-12 pb-12 text-center">
                <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-botkorp-orange/10 dark:bg-botkorp-orange/20 mb-5 animate-in zoom-in-50 duration-500 delay-100 shadow-sm">
                  <Users className="h-10 w-10 text-botkorp-orange animate-pulse" />
                </div>
                <h3 className="text-lg font-bold mb-2">
                  {searchQuery ? 'No members found' : 'No members yet'}
                </h3>
                <p className="text-muted-foreground mb-8 max-w-sm mx-auto text-sm leading-relaxed">
                  {searchQuery 
                    ? 'Try adjusting your search terms to find the member you\'re looking for'
                    : 'Invite team members to collaborate and manage your Bot Korp organization together'}
                </p>
                {!searchQuery && (
                  <Button 
                    onClick={() => setDialogOpen(true)}
                    className="bg-botkorp-orange hover:bg-botkorp-orange/90 text-white hover:shadow-lg shadow-md transition-all duration-300 active:scale-95 h-10 px-6 font-medium"
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Invite Member
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

