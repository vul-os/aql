import React, { useState, useEffect, useMemo } from 'react';
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
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
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
  Download,
  Filter,
  SortAsc,
  SortDesc,
  ChevronLeft,
  ChevronRight,
  UserX,
  TrendingUp,
  Activity,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  FileDown
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import PageHeader from '@/components/ui/page-header';
import { format, subDays, startOfDay, endOfDay, isAfter, isBefore } from 'date-fns';

export default function MembersPage() {
  const { user, selectedOrg, selectedLocation } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState([]);
  const [removedMembers, setRemovedMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [memberActivity, setMemberActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [memberDetailOpen, setMemberDetailOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [editingMember, setEditingMember] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('active');
  const [selectedMembers, setSelectedMembers] = useState([]);
  
  // Filtering & Sorting
  const [roleFilter, setRoleFilter] = useState('all');
  const [sortBy, setSortBy] = useState('joined_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [dateFilter, setDateFilter] = useState('all'); // all, today, week, month
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  
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

      // Load removed members
      const { data: removedData, error: removedError } = await supabase
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
        .eq('status', 'removed')
        .order('updated_at', { ascending: false });

      if (removedError) throw removedError;
      setRemovedMembers(removedData || []);

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

      // Compile recent activity from members and invitations
      const recentActivity = [
        ...membersData.slice(0, 5).map(m => ({
          type: 'joined',
          member: m,
          timestamp: m.joined_at || m.created_at
        })),
        ...invitationsData.slice(0, 3).map(i => ({
          type: 'invited',
          email: i.email,
          role: i.role,
          inviter: i.inviter,
          timestamp: i.created_at
        }))
      ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 8);
      
      setMemberActivity(recentActivity);

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

  // Export members to CSV
  const handleExportMembers = () => {
    const dataToExport = activeTab === 'active' ? filteredAndSortedMembers : 
                         activeTab === 'removed' ? removedMembers : invitations;
    
    if (dataToExport.length === 0) {
      toast({
        title: "No data to export",
        description: "There are no members to export",
        variant: "destructive"
      });
      return;
    }

    const csvContent = activeTab === 'pending' 
      ? [
          ['Email', 'Role', 'Invited At', 'Expires At'],
          ...dataToExport.map(inv => [
            inv.email,
            inv.role,
            format(new Date(inv.created_at), 'yyyy-MM-dd HH:mm'),
            format(new Date(inv.expires_at), 'yyyy-MM-dd HH:mm')
          ])
        ]
      : [
          ['Name', 'Email', 'Role', 'Joined At', 'Status'],
          ...dataToExport.map(member => [
            member.user?.full_name || 'N/A',
            member.user?.email || 'N/A',
            member.role,
            member.joined_at ? format(new Date(member.joined_at), 'yyyy-MM-dd HH:mm') : 'N/A',
            member.status
          ])
        ];

    const csv = csvContent.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `members-${activeTab}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    toast({
      title: "Export successful",
      description: `Exported ${dataToExport.length} members to CSV`,
    });
  };

  // Bulk actions
  const handleBulkRemove = async () => {
    if (selectedMembers.length === 0) return;
    
    if (!confirm(`Are you sure you want to remove ${selectedMembers.length} member(s)?`)) return;

    try {
      const { error } = await supabase
        .from('organization_members')
        .update({ status: 'removed' })
        .in('id', selectedMembers);

      if (error) throw error;

      toast({
        title: "Members removed",
        description: `${selectedMembers.length} member(s) removed successfully`,
      });

      setSelectedMembers([]);
      loadMembers();
    } catch (error) {
      console.error('Error removing members:', error);
      toast({
        title: "Error",
        description: "Failed to remove members",
        variant: "destructive"
      });
    }
  };

  const handleBulkChangeRole = async (newRole) => {
    if (selectedMembers.length === 0) return;

    try {
      const { error } = await supabase
        .from('organization_members')
        .update({ role: newRole })
        .in('id', selectedMembers);

      if (error) throw error;

      toast({
        title: "Roles updated",
        description: `${selectedMembers.length} member(s) updated to ${newRole}`,
      });

      setSelectedMembers([]);
      loadMembers();
    } catch (error) {
      console.error('Error updating roles:', error);
      toast({
        title: "Error",
        description: "Failed to update roles",
        variant: "destructive"
      });
    }
  };

  // Filtering and sorting logic
  const filteredAndSortedMembers = useMemo(() => {
    let filtered = members.filter(member => {
      // Search filter
      const matchesSearch = 
        member.user?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        member.user?.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        member.role?.toLowerCase().includes(searchQuery.toLowerCase());
      
      if (!matchesSearch) return false;

      // Role filter
      if (roleFilter !== 'all' && member.role !== roleFilter) return false;

      // Date filter
      if (dateFilter !== 'all' && member.joined_at) {
        const joinedDate = new Date(member.joined_at);
        const now = new Date();
        
        switch (dateFilter) {
          case 'today':
            if (!isAfter(joinedDate, startOfDay(now))) return false;
            break;
          case 'week':
            if (!isAfter(joinedDate, subDays(now, 7))) return false;
            break;
          case 'month':
            if (!isAfter(joinedDate, subDays(now, 30))) return false;
            break;
        }
      }

      return true;
    });

    // Sorting
    filtered.sort((a, b) => {
      let aVal, bVal;

      switch (sortBy) {
        case 'name':
          aVal = a.user?.full_name?.toLowerCase() || a.user?.email?.toLowerCase() || '';
          bVal = b.user?.full_name?.toLowerCase() || b.user?.email?.toLowerCase() || '';
          break;
        case 'email':
          aVal = a.user?.email?.toLowerCase() || '';
          bVal = b.user?.email?.toLowerCase() || '';
          break;
        case 'role':
          aVal = a.role || '';
          bVal = b.role || '';
          break;
        case 'joined_at':
        default:
          aVal = new Date(a.joined_at || a.created_at);
          bVal = new Date(b.joined_at || b.created_at);
          break;
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [members, searchQuery, roleFilter, dateFilter, sortBy, sortOrder]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedMembers.length / itemsPerPage);
  const paginatedMembers = filteredAndSortedMembers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Stats calculations
  const stats = useMemo(() => {
    const total = members.length;
    const admins = members.filter(m => m.role === 'admin' || m.role === 'owner').length;
    const managers = members.filter(m => m.role === 'manager').length;
    const recentJoins = members.filter(m => {
      if (!m.joined_at) return false;
      return isAfter(new Date(m.joined_at), subDays(new Date(), 7));
    }).length;

    return { total, admins, managers, recentJoins, pending: invitations.length };
  }, [members, invitations]);

  const filteredMembers = filteredAndSortedMembers;

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
    <div className="p-3 md:p-5 space-y-5 max-w-7xl mx-auto">
      {/* Header with Soft UI */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 animate-in fade-in slide-in-from-top-3 duration-500">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">Team Members</h1>
          <p className="text-sm text-muted-foreground/70 mt-1 font-medium">
            Manage team members, roles, and permissions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline"
            onClick={handleExportMembers}
            className="h-10 px-4 text-xs font-semibold rounded-2xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] active:scale-95 transition-all duration-300"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button 
            onClick={() => setDialogOpen(true)}
            className="h-10 px-4 text-xs font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] active:scale-95 transition-all duration-300 rounded-2xl border-0 text-white"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Invite member
          </Button>
        </div>
      </div>

      {/* Enhanced Stats - Soft UI */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-100">
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Members</p>
                <p className="text-2xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{stats.total}</p>
                <div className="flex items-center gap-1 text-xs">
                  <TrendingUp className="h-3 w-3 text-green-600" />
                  <span className="text-green-600 font-medium">{stats.recentJoins}</span>
                  <span className="text-muted-foreground">this week</span>
                </div>
              </div>
              <img src="/images/members-icon.png" alt="Members" className="h-12 w-12 object-contain group-hover:scale-110 transition-all duration-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Pending Invites</p>
                <p className="text-2xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{stats.pending}</p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>Awaiting acceptance</span>
                </div>
              </div>
              <img src="/images/invite.png" alt="Invite" className="h-12 w-12 object-contain group-hover:scale-110 transition-all duration-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Admins</p>
                <p className="text-2xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{stats.admins}</p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Shield className="h-3 w-3" />
                  <span>{stats.managers} managers</span>
                </div>
              </div>
              <img src="/images/admin.png" alt="Admin" className="h-12 w-12 object-contain group-hover:scale-110 transition-all duration-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Removed</p>
                <p className="text-2xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{removedMembers.length}</p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <UserX className="h-3 w-3" />
                  <span>Inactive accounts</span>
                </div>
              </div>
              <img src="/images/delete..png" alt="Delete" className="h-12 w-12 object-contain group-hover:scale-110 transition-all duration-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invite Dialog - Soft UI */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl border-0 shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                <UserPlus className="h-5 w-5 text-botkorp-orange" />
              </div>
              Invite team member
            </DialogTitle>
            <DialogDescription className="text-sm font-medium">
              Send an invitation to join your organization
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleInviteMember} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-semibold">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                placeholder="member@example.com"
                required
                className="h-10 text-sm rounded-xl focus:border-botkorp-orange focus:ring-2 focus:ring-botkorp-orange/20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role" className="text-xs font-semibold">Role</Label>
              <Select
                value={inviteForm.role}
                onValueChange={(value) => setInviteForm({ ...inviteForm, role: value })}
              >
                <SelectTrigger className="h-10 text-sm rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="operator">Operator</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setDialogOpen(false)} 
                className="h-10 text-xs font-semibold rounded-2xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] active:scale-95 transition-all duration-300"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={inviting} 
                className="h-10 text-xs font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] active:scale-95 transition-all duration-300 rounded-2xl border-0 text-white"
              >
                {inviting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4 mr-2" />
                    Send invite
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Main Content Area with Tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200">
        {/* Left: Members List (2/3 width) */}
        <div className="lg:col-span-2 space-y-5">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
              <TabsList className="grid w-full sm:w-auto grid-cols-3 h-12 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 p-2 rounded-3xl shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] border-0">
                <TabsTrigger 
                  value="active" 
                  className="text-xs font-bold rounded-2xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/90 data-[state=active]:text-white data-[state=active]:shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] transition-all duration-300 hover:bg-botkorp-orange/5"
                >
                  Active ({members.length})
                </TabsTrigger>
                <TabsTrigger 
                  value="pending" 
                  className="text-xs font-bold rounded-2xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/90 data-[state=active]:text-white data-[state=active]:shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] transition-all duration-300 hover:bg-botkorp-orange/5"
                >
                  Pending ({invitations.length})
                </TabsTrigger>
                <TabsTrigger 
                  value="removed" 
                  className="text-xs font-bold rounded-2xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/90 data-[state=active]:text-white data-[state=active]:shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] transition-all duration-300 hover:bg-botkorp-orange/5"
                >
                  Removed ({removedMembers.length})
                </TabsTrigger>
              </TabsList>

              {activeTab === 'active' && (
                <div className="flex flex-wrap items-center gap-2">
                  {/* Search */}
                  <div className="relative flex-1 sm:flex-initial sm:w-48">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search members..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 h-10 text-sm rounded-xl focus:border-botkorp-orange focus:ring-2 focus:ring-botkorp-orange/20"
                    />
                  </div>

                  {/* Role Filter */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-10 text-xs font-semibold rounded-2xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] active:scale-95 transition-all duration-300"
                      >
                        <Filter className="h-4 w-4 mr-2" />
                        Role
                        {roleFilter !== 'all' && (
                          <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-xs bg-botkorp-orange/10 text-botkorp-orange border-0 rounded-full">1</Badge>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuCheckboxItem
                        checked={roleFilter === 'all'}
                        onCheckedChange={() => setRoleFilter('all')}
                      >
                        All Roles
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuCheckboxItem
                        checked={roleFilter === 'owner'}
                        onCheckedChange={() => setRoleFilter(roleFilter === 'owner' ? 'all' : 'owner')}
                      >
                        Owner
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={roleFilter === 'admin'}
                        onCheckedChange={() => setRoleFilter(roleFilter === 'admin' ? 'all' : 'admin')}
                      >
                        Admin
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={roleFilter === 'manager'}
                        onCheckedChange={() => setRoleFilter(roleFilter === 'manager' ? 'all' : 'manager')}
                      >
                        Manager
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={roleFilter === 'member'}
                        onCheckedChange={() => setRoleFilter(roleFilter === 'member' ? 'all' : 'member')}
                      >
                        Member
                      </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Date Filter */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-10 text-xs font-semibold rounded-2xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] active:scale-95 transition-all duration-300"
                      >
                        <Calendar className="h-4 w-4 mr-2" />
                        Date
                        {dateFilter !== 'all' && (
                          <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-xs bg-botkorp-orange/10 text-botkorp-orange border-0 rounded-full">1</Badge>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuCheckboxItem
                        checked={dateFilter === 'all'}
                        onCheckedChange={() => setDateFilter('all')}
                      >
                        All Time
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={dateFilter === 'today'}
                        onCheckedChange={() => setDateFilter(dateFilter === 'today' ? 'all' : 'today')}
                      >
                        Today
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={dateFilter === 'week'}
                        onCheckedChange={() => setDateFilter(dateFilter === 'week' ? 'all' : 'week')}
                      >
                        This Week
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={dateFilter === 'month'}
                        onCheckedChange={() => setDateFilter(dateFilter === 'month' ? 'all' : 'month')}
                      >
                        This Month
                      </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Sort */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-10 text-xs font-semibold rounded-2xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] active:scale-95 transition-all duration-300"
                      >
                        {sortOrder === 'asc' ? <SortAsc className="h-4 w-4 mr-2" /> : <SortDesc className="h-4 w-4 mr-2" />}
                        Sort
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem onClick={() => { setSortBy('name'); setSortOrder('asc'); }}>
                        Name A-Z
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setSortBy('name'); setSortOrder('desc'); }}>
                        Name Z-A
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => { setSortBy('joined_at'); setSortOrder('desc'); }}>
                        Newest First
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setSortBy('joined_at'); setSortOrder('asc'); }}>
                        Oldest First
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => { setSortBy('role'); setSortOrder('asc'); }}>
                        Role A-Z
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>

            {/* Active Members Tab */}
            <TabsContent value="active" className="mt-0">
              <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 border-0">
                <CardContent className="p-0">
                  {/* Bulk Actions Bar */}
                  {selectedMembers.length > 0 && (
                    <div className="px-5 py-4 bg-gradient-to-br from-botkorp-orange/10 to-botkorp-orange/5 dark:from-botkorp-orange/20 dark:to-botkorp-orange/10 rounded-t-2xl flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={selectedMembers.length === paginatedMembers.length}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedMembers(paginatedMembers.map(m => m.id));
                            } else {
                              setSelectedMembers([]);
                            }
                          }}
                        />
                        <span className="font-bold text-botkorp-orange">
                          {selectedMembers.length} selected
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-9 text-xs font-semibold rounded-xl border-0 bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] hover:bg-botkorp-orange hover:text-white transition-all duration-300 active:scale-95"
                            >
                              Change Role
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => handleBulkChangeRole('admin')}>
                              Admin
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleBulkChangeRole('manager')}>
                              Manager
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleBulkChangeRole('member')}>
                              Member
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleBulkRemove}
                          className="h-9 text-xs font-semibold rounded-xl border-0 bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] hover:bg-red-600 hover:text-white transition-all duration-300 active:scale-95 text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Members List */}
                  {paginatedMembers.length > 0 ? (
                    <div>
                      <div className="divide-y divide-border/50">
                        {paginatedMembers.map((member) => (
                          <div 
                            key={member.id} 
                            className="flex items-center gap-4 px-5 py-4 hover:bg-botkorp-orange/5 transition-all duration-300"
                          >
                            <Checkbox
                              checked={selectedMembers.includes(member.id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedMembers([...selectedMembers, member.id]);
                                } else {
                                  setSelectedMembers(selectedMembers.filter(id => id !== member.id));
                                }
                              }}
                              disabled={member.role === 'owner' || member.user_id === user?.id}
                            />
                            
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <Avatar className="h-10 w-10 border-2 border-gray-100 dark:border-gray-800">
                                <AvatarImage src={member.user?.avatar_url} />
                                <AvatarFallback className="bg-gradient-to-br from-orange-100 to-orange-200 dark:from-orange-900 dark:to-orange-800 text-orange-700 dark:text-orange-200 text-xs font-semibold">
                                  {getUserInitials(member)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                                    {member.user?.full_name || 'Unknown User'}
                                  </p>
                                  {member.user_id === user?.id && (
                                    <Badge variant="secondary" className="text-xs px-1.5 py-0">You</Badge>
                                  )}
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
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
                                <SelectTrigger className="w-[120px] h-8 text-xs">
                                  <div className="flex items-center gap-1.5">
                                    {getRoleIcon(member.role)}
                                    <span className="capitalize">{member.role}</span>
                                  </div>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="admin" className="text-xs">
                                    <div className="flex items-center gap-2">
                                      <Shield className="h-3.5 w-3.5" />
                                      Admin
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="manager" className="text-xs">
                                    <div className="flex items-center gap-2">
                                      <UserCog className="h-3.5 w-3.5" />
                                      Manager
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="operator" className="text-xs">
                                    <div className="flex items-center gap-2">
                                      <UserCog className="h-3.5 w-3.5" />
                                      Operator
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="viewer" className="text-xs">
                                    <div className="flex items-center gap-2">
                                      <Eye className="h-3.5 w-3.5" />
                                      Viewer
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="member" className="text-xs">
                                    <div className="flex items-center gap-2">
                                      <UserCheck className="h-3.5 w-3.5" />
                                      Member
                                    </div>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              
                              <div className="text-xs text-gray-500 dark:text-gray-400 w-24 text-right hidden lg:block">
                                {member.joined_at
                                  ? format(new Date(member.joined_at), 'MMM d, yyyy')
                                  : 'N/A'}
                              </div>
                              
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                  >
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem 
                                    onClick={() => {
                                      setSelectedMember(member);
                                      setMemberDetailOpen(true);
                                    }}
                                  >
                                    <Eye className="h-4 w-4 mr-2" />
                                    View Details
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => handleRemoveMember(member.id)}
                                    disabled={member.role === 'owner' || member.user_id === user?.id}
                                    className="text-red-600"
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Remove Member
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Pagination */}
                      {totalPages > 1 && (
                        <div className="px-5 py-4 rounded-b-2xl bg-gradient-to-br from-background/60 to-muted/20 flex items-center justify-between">
                          <div className="text-xs text-muted-foreground font-medium">
                            Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filteredAndSortedMembers.length)} of {filteredAndSortedMembers.length} members
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                              disabled={currentPage === 1}
                              className="h-9 w-9 p-0 rounded-xl border-0 bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] hover:bg-botkorp-orange hover:text-white disabled:opacity-30 transition-all duration-300 active:scale-95"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <div className="flex items-center gap-1">
                              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                const pageNum = i + 1;
                                return (
                                  <Button
                                    key={pageNum}
                                    variant={currentPage === pageNum ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setCurrentPage(pageNum)}
                                    className={`h-9 w-9 p-0 text-xs font-semibold rounded-xl border-0 transition-all duration-300 active:scale-95 ${
                                      currentPage === pageNum 
                                        ? 'bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 text-white shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)]' 
                                        : 'bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] hover:bg-botkorp-orange/10'
                                    }`}
                                  >
                                    {pageNum}
                                  </Button>
                                );
                              })}
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                              disabled={currentPage === totalPages}
                              className="h-9 w-9 p-0 rounded-xl border-0 bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] hover:bg-botkorp-orange hover:text-white disabled:opacity-30 transition-all duration-300 active:scale-95"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-16 text-center px-4">
                      <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mb-5 animate-in zoom-in-50 duration-500 delay-100 shadow-[0_8px_30px_rgb(255,107,53,0.15)]">
                        <Users className="h-10 w-10 text-botkorp-orange animate-pulse" />
                      </div>
                      <h3 className="text-lg font-bold mb-2">
                        {searchQuery || roleFilter !== 'all' || dateFilter !== 'all' ? 'No members found' : 'No members yet'}
                      </h3>
                      <p className="text-sm text-muted-foreground/70 mb-5 max-w-md mx-auto leading-relaxed">
                        {searchQuery || roleFilter !== 'all' || dateFilter !== 'all'
                          ? 'Try adjusting your filters or search criteria'
                          : 'Get started by inviting your first team member'}
                      </p>
                      {!searchQuery && roleFilter === 'all' && dateFilter === 'all' && (
                        <Button 
                          onClick={() => setDialogOpen(true)}
                          className="h-10 px-4 text-xs font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] active:scale-95 transition-all duration-300 rounded-2xl border-0 text-white"
                        >
                          <UserPlus className="h-4 w-4 mr-2" />
                          Invite member
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Pending Invitations Tab */}
            <TabsContent value="pending" className="mt-0">
              <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 border-0">
                <CardContent className="p-0">
                  {invitations.length > 0 ? (
                    <div className="divide-y divide-border/50">
                      {invitations.map((invitation) => (
                        <div 
                          key={invitation.id} 
                          className="flex items-center justify-between px-5 py-4 hover:bg-botkorp-orange/5 transition-all duration-300"
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-900 dark:to-amber-800 flex items-center justify-center flex-shrink-0">
                              <Mail className="h-5 w-5 text-amber-700 dark:text-amber-200" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                                {invitation.email}
                              </p>
                              <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 dark:text-gray-400">
                                <Badge variant="outline" className="capitalize text-xs">
                                  {invitation.role}
                                </Badge>
                                <span>•</span>
                                <span>Invited {format(new Date(invitation.created_at), 'MMM d, yyyy')}</span>
                                <span>•</span>
                                <span>Expires {format(new Date(invitation.expires_at), 'MMM d')}</span>
                              </div>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCancelInvitation(invitation.id)}
                            className="h-9 px-3 text-xs font-semibold rounded-xl hover:bg-red-500/10 hover:text-red-600 active:scale-95 transition-all duration-300"
                          >
                            <X className="h-4 w-4 mr-1" />
                            Cancel
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-16 text-center px-4">
                      <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/15 to-amber-500/5 mb-5 animate-in zoom-in-50 duration-500 delay-100 shadow-[0_8px_30px_rgb(245,158,11,0.15)]">
                        <Clock className="h-10 w-10 text-amber-600 animate-pulse" />
                      </div>
                      <h3 className="text-lg font-bold mb-2">
                        No pending invitations
                      </h3>
                      <p className="text-sm text-muted-foreground/70 mb-5 max-w-md mx-auto leading-relaxed">
                        All invitations have been accepted or expired
                      </p>
                      <Button 
                        onClick={() => setDialogOpen(true)}
                        className="h-10 px-4 text-xs font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] active:scale-95 transition-all duration-300 rounded-2xl border-0 text-white"
                      >
                        <UserPlus className="h-4 w-4 mr-2" />
                        Send invitation
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Removed Members Tab */}
            <TabsContent value="removed" className="mt-0">
              <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 border-0">
                <CardContent className="p-0">
                  {removedMembers.length > 0 ? (
                    <div className="divide-y divide-border/50">
                      {removedMembers.map((member) => (
                        <div 
                          key={member.id} 
                          className="flex items-center gap-4 px-5 py-4 hover:bg-red-500/5 transition-all duration-300 opacity-60"
                        >
                          <Avatar className="h-10 w-10 border-2 border-gray-200 dark:border-gray-700">
                            <AvatarImage src={member.user?.avatar_url} />
                            <AvatarFallback className="bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-medium">
                              {getUserInitials(member)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {member.user?.full_name || 'Unknown User'}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {member.user?.email}
                            </p>
                          </div>
                          <Badge variant="secondary" className="flex-shrink-0">
                            <UserX className="h-3 w-3 mr-1" />
                            Removed
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-16 text-center px-4">
                      <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500/15 to-red-500/5 mb-5 animate-in zoom-in-50 duration-500 delay-100 shadow-[0_8px_30px_rgb(239,68,68,0.15)]">
                        <UserX className="h-10 w-10 text-red-600 animate-pulse" />
                      </div>
                      <h3 className="text-lg font-bold mb-2">
                        No removed members
                      </h3>
                      <p className="text-sm text-muted-foreground/70 max-w-md mx-auto leading-relaxed">
                        Members who are removed will appear here
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: Activity Timeline (1/3 width) */}
        <div className="lg:col-span-1">
          <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 border-0 sticky top-6">
            <CardHeader className="pb-3 pt-5">
              <div className="flex items-center gap-3">
                <img 
                  src="/images/recent-activity.png" 
                  alt="Recent Activity" 
                  className="h-11 w-11 object-contain"
                />
                <div>
                  <CardTitle className="text-base font-bold">Recent Activity</CardTitle>
                  <CardDescription className="text-[11px] font-medium">Latest team updates</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {memberActivity.length > 0 ? (
                <div className="divide-y divide-border/50">
                  {memberActivity.map((activity, index) => (
                    <div key={index} className="px-5 py-3 hover:bg-botkorp-orange/5 transition-all duration-300">
                      <p className="text-xs font-medium text-gray-900 dark:text-gray-100">
                        {activity.type === 'joined' ? (
                          <>
                            <span className="font-semibold">{activity.member?.user?.full_name || activity.member?.user?.email}</span>
                            {' '}joined as <span className="capitalize">{activity.member?.role}</span>
                          </>
                        ) : (
                          <>
                            {activity.inviter?.full_name || 'Someone'} invited{' '}
                            <span className="font-semibold">{activity.email}</span> as <span className="capitalize">{activity.role}</span>
                          </>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {format(new Date(activity.timestamp), 'MMM d, h:mm a')}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-5 py-12 text-center">
                  <img 
                    src="/images/recent-activity.png" 
                    alt="No Activity" 
                    className="h-16 w-16 object-contain mx-auto mb-3"
                  />
                  <p className="text-xs text-muted-foreground font-medium">
                    No recent activity
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Member Detail Dialog - Soft UI */}
      <Dialog open={memberDetailOpen} onOpenChange={setMemberDetailOpen}>
        <DialogContent className="sm:max-w-lg rounded-3xl border-0 shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                <Eye className="h-5 w-5 text-botkorp-orange" />
              </div>
              Member Details
            </DialogTitle>
          </DialogHeader>
          {selectedMember && (
            <div className="space-y-5">
              <div className="flex items-center gap-4 p-5 rounded-xl bg-gradient-to-br from-background/60 to-muted/20 shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                <Avatar className="h-16 w-16 border-2 border-botkorp-orange/20 shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                  <AvatarImage src={selectedMember.user?.avatar_url} />
                  <AvatarFallback className="bg-gradient-to-br from-orange-100 to-orange-200 dark:from-orange-900 dark:to-orange-800 text-orange-700 dark:text-orange-200 text-lg font-bold">
                    {getUserInitials(selectedMember)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="text-lg font-bold bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">
                    {selectedMember.user?.full_name || 'Unknown User'}
                  </h3>
                  <p className="text-sm text-muted-foreground font-medium">
                    {selectedMember.user?.email}
                  </p>
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="p-4 rounded-xl bg-gradient-to-br from-background/60 to-muted/20 shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                  <p className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wider">Role</p>
                  <Badge variant="secondary" className="capitalize bg-botkorp-orange/10 text-botkorp-orange border-0 font-semibold rounded-full">
                    {getRoleIcon(selectedMember.role)}
                    <span className="ml-1">{selectedMember.role}</span>
                  </Badge>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-background/60 to-muted/20 shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                  <p className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wider">Status</p>
                  <Badge variant="outline" className="bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-300 border-0 font-semibold rounded-full">
                    Active
                  </Badge>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-background/60 to-muted/20 shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                  <p className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wider">Joined</p>
                  <p className="font-bold text-foreground">
                    {selectedMember.joined_at
                      ? format(new Date(selectedMember.joined_at), 'MMM d, yyyy')
                      : 'N/A'}
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-background/60 to-muted/20 shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                  <p className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wider">Member ID</p>
                  <p className="font-mono text-xs font-bold text-foreground truncate">
                    {selectedMember.id.slice(0, 8)}...
                  </p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

