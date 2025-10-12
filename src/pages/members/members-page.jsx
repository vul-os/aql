import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
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
  Trash2
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import { format } from 'date-fns';

export default function MembersPage() {
  const { selectedOrg } = useOutletContext();
  const { user } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  
  // Invite form state
  const [inviteForm, setInviteForm] = useState({
    email: '',
    role: 'member',
    can_manage_bots: false,
    can_manage_locations: false,
    can_view_billing: false,
    can_manage_billing: false,
    can_manage_members: false,
    can_view_analytics: true
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

      const { data, error } = await supabase
        .from('organization_members')
        .select(`
          *,
          user:profiles(
            id,
            email,
            full_name,
            avatar_url
          )
        `)
        .eq('organization_id', selectedOrg.organization_id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setMembers(data || []);
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

    try {
      // Create invitation using SQL function
      const { data: inviteData, error: inviteError } = await supabase.rpc('create_member_invitation', {
        p_organization_id: selectedOrg.organization_id,
        p_email: inviteForm.email,
        p_role: inviteForm.role,
        p_invited_by: user.id,
        p_can_manage_bots: inviteForm.can_manage_bots,
        p_can_manage_locations: inviteForm.can_manage_locations,
        p_can_view_billing: inviteForm.can_view_billing,
        p_can_manage_billing: inviteForm.can_manage_billing,
        p_can_manage_members: inviteForm.can_manage_members,
        p_can_view_analytics: inviteForm.can_view_analytics
      });

      if (inviteError) throw inviteError;

      // Send invitation email via Edge Function
      const { error: emailError } = await supabase.functions.invoke('send-invite-email', {
        body: inviteData
      });

      if (emailError) {
        console.error('Error sending email:', emailError);
        toast({
          title: "Invitation Created",
          description: "Invitation created but email failed to send. Please contact support.",
          variant: "default"
        });
      } else {
        toast({
          title: "Success",
          description: `Invitation sent to ${inviteForm.email}`,
        });
      }

      setDialogOpen(false);
      setInviteForm({
        email: '',
        role: 'member',
        can_manage_bots: false,
        can_manage_locations: false,
        can_view_billing: false,
        can_manage_billing: false,
        can_manage_members: false,
        can_view_analytics: true
      });
      loadMembers();

    } catch (error) {
      console.error('Error inviting member:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to invite member",
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
    if (!confirm('Are you sure you want to remove this member?')) return;

    try {
      const { error } = await supabase
        .from('organization_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Member removed from organization",
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Team Members</h1>
          <p className="text-muted-foreground">
            Manage team members and their permissions
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
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
                    <SelectItem value="admin">Admin - Full access</SelectItem>
                    <SelectItem value="manager">Manager - Manage operations</SelectItem>
                    <SelectItem value="operator">Operator - Control bots</SelectItem>
                    <SelectItem value="viewer">Viewer - View only</SelectItem>
                    <SelectItem value="member">Member - Basic access</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              <div className="space-y-4">
                <Label className="text-base">Permissions</Label>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-normal">Manage Bots</Label>
                    <p className="text-sm text-muted-foreground">
                      Control and configure bots
                    </p>
                  </div>
                  <Switch
                    checked={inviteForm.can_manage_bots}
                    onCheckedChange={(checked) =>
                      setInviteForm({ ...inviteForm, can_manage_bots: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-normal">Manage Locations</Label>
                    <p className="text-sm text-muted-foreground">
                      Add and edit locations
                    </p>
                  </div>
                  <Switch
                    checked={inviteForm.can_manage_locations}
                    onCheckedChange={(checked) =>
                      setInviteForm({ ...inviteForm, can_manage_locations: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-normal">View Billing</Label>
                    <p className="text-sm text-muted-foreground">
                      View invoices and payments
                    </p>
                  </div>
                  <Switch
                    checked={inviteForm.can_view_billing}
                    onCheckedChange={(checked) =>
                      setInviteForm({ ...inviteForm, can_view_billing: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-normal">Manage Members</Label>
                    <p className="text-sm text-muted-foreground">
                      Invite and remove members
                    </p>
                  </div>
                  <Switch
                    checked={inviteForm.can_manage_members}
                    onCheckedChange={(checked) =>
                      setInviteForm({ ...inviteForm, can_manage_members: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-normal">View Analytics</Label>
                    <p className="text-sm text-muted-foreground">
                      Access dashboard and reports
                    </p>
                  </div>
                  <Switch
                    checked={inviteForm.can_view_analytics}
                    onCheckedChange={(checked) =>
                      setInviteForm({ ...inviteForm, can_view_analytics: checked })
                    }
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  <Mail className="h-4 w-4 mr-2" />
                  Add Member
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Members List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Members ({members.length})
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
                        <Badge variant={getRoleBadgeVariant(member.role)} className="gap-1">
                          {getRoleIcon(member.role)}
                          <span className="capitalize">{member.role}</span>
                        </Badge>
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
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleUpdateMemberRole(member.id, 'admin')}
                              disabled={member.role === 'owner' || member.user_id === user?.id}
                            >
                              Make Admin
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleUpdateMemberRole(member.id, 'member')}
                              disabled={member.role === 'owner' || member.user_id === user?.id}
                            >
                              Make Member
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleRemoveMember(member.id)}
                              disabled={member.role === 'owner' || member.user_id === user?.id}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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

