# Role-Based Permissions System

## 🎯 Overview

The system uses **role-based permissions** instead of individual permission flags. This is simpler and easier to maintain.

---

## 👥 Roles & Permissions

### **📊 Permission Matrix:**

| Permission | Owner | Admin | Manager | Operator | Viewer | Member |
|------------|-------|-------|---------|----------|--------|--------|
| Manage Bots | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage Services | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage Locations | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| View Billing | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage Billing | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage Members | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View Analytics | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Manage Settings | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Delete Organization | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 🎭 Role Descriptions

### **👑 Owner**
- **Full control** over organization
- Can delete organization
- Can transfer ownership
- **Use case:** Business owner

### **⚙️ Admin**
- Almost full access (cannot delete org)
- Manage all resources
- Manage billing and members
- **Use case:** General manager, co-owner

### **📋 Manager**
- Manage day-to-day operations
- Handle services, bots, locations
- View billing (cannot modify)
- **Use case:** Operations manager, supervisor

### **👨‍💼 Operator**
- View bots and services
- View analytics
- Cannot make changes
- **Use case:** Field technician, support staff

### **👀 Viewer**
- Read-only access
- View analytics
- **Use case:** Stakeholder, accountant

### **👤 Member**
- Basic view access
- View analytics only
- **Use case:** Basic team member

---

## 🗄️ Database Structure

### **organization_members Table:**

```sql
CREATE TABLE organization_members (
    id UUID PRIMARY KEY,
    organization_id UUID REFERENCES organizations(id),
    user_id UUID REFERENCES profiles(id),
    
    -- Role determines ALL permissions
    role TEXT CHECK (role IN (
        'owner', 'admin', 'manager', 'operator', 'viewer', 'member'
    )),
    
    status TEXT DEFAULT 'active',
    metadata JSONB DEFAULT '{}',  -- Store custom metadata if needed
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(organization_id, user_id)
);
```

**No individual permission columns!** Role determines everything.

---

## 🔧 Database Functions

### **1. `has_permission(user_id, org_id, permission)`**

Check if user has specific permission:

```sql
-- Check if user can manage bots
SELECT has_permission(
    'user-uuid',
    'org-uuid',
    'manage_bots'
);
-- Returns: true or false
```

### **2. `get_user_role(user_id, org_id)`**

Get user's role in organization:

```sql
SELECT get_user_role('user-uuid', 'org-uuid');
-- Returns: 'owner', 'admin', 'manager', etc.
```

### **3. `get_role_permissions(role)`**

Get all permissions for a role:

```sql
SELECT get_role_permissions('manager');
-- Returns: {"manage_bots": true, "manage_services": true, ...}
```

---

## ⚛️ Frontend Usage

### **React Hook: `usePermissions`**

```jsx
import { usePermissions } from '@/hooks/use-permissions';

export default function MyComponent({ organizationId }) {
  const {
    role,
    permissions,
    hasPermission,
    isOwner,
    isAdmin,
    isManager,
    canManageBots,
    canViewBilling,
    loading
  } = usePermissions(organizationId);

  if (loading) return <Loader />;

  return (
    <div>
      <p>Your role: {role}</p>
      
      {canManageBots && (
        <Button>Manage Bots</Button>
      )}
      
      {isAdmin && (
        <AdminPanel />
      )}
      
      {hasPermission('manage_billing') && (
        <BillingSettings />
      )}
    </div>
  );
}
```

### **Available Properties:**

```javascript
const {
  // Core
  role,              // 'owner', 'admin', 'manager', etc.
  permissions,       // Full permissions object
  hasPermission,     // Function: hasPermission('manage_bots')
  loading,           // Boolean: loading state
  
  // Role checks
  isOwner,           // role === 'owner'
  isAdmin,           // role === 'admin' || 'owner'
  isManager,         // role === 'manager' || 'admin' || 'owner'
  
  // Specific permissions
  canManageBots,
  canManageServices,
  canManageLocations,
  canViewBilling,
  canManageBilling,
  canManageMembers,
  canViewAnalytics,
  canManageSettings,
  canDeleteOrganization,
} = usePermissions(organizationId);
```

---

## 📝 Inviting Members

### **Database Function:**

```sql
-- Simplified: just pass role, no individual permissions
SELECT create_member_invitation(
    'org-uuid',        -- organization_id
    'user@email.com',  -- email
    'manager',         -- role (determines permissions)
    'inviter-uuid',    -- invited_by
    '{}'::JSONB        -- optional metadata
);
```

### **Frontend:**

```jsx
import { supabase } from '@/lib/supabase';

const inviteMember = async (email, role) => {
  const { data, error } = await supabase.rpc('create_member_invitation', {
    p_organization_id: organizationId,
    p_email: email,
    p_role: role,  // Just pass role!
    p_invited_by: user.id,
    p_metadata: {}
  });
  
  if (error) throw error;
  return data;
};

// Usage
<Select value={role} onValueChange={setRole}>
  <SelectItem value="admin">Admin</SelectItem>
  <SelectItem value="manager">Manager</SelectItem>
  <SelectItem value="operator">Operator</SelectItem>
  <SelectItem value="viewer">Viewer</SelectItem>
  <SelectItem value="member">Member</SelectItem>
</Select>
```

---

## 🔒 Security

### **Database-Level:**

```sql
-- Check permission in RLS policy
CREATE POLICY "Users can view bots if they have permission"
ON bots FOR SELECT
USING (
    has_permission(auth.uid(), organization_id, 'view_bots')
    OR has_permission(auth.uid(), organization_id, 'manage_bots')
);
```

### **Frontend-Level:**

```jsx
// Hide UI elements based on permissions
{canManageBots && (
  <Button onClick={deletBot}>Delete Bot</Button>
)}

// Redirect if no permission
useEffect(() => {
  if (!loading && !canViewBilling) {
    navigate('/portal/dashboard');
  }
}, [loading, canViewBilling]);
```

---

## 🧪 Testing

### **Test Permission Checks:**

```sql
-- Test has_permission function
SELECT has_permission(
    '11111111-1111-1111-1111-111111111111'::UUID,
    '22222222-2222-2222-2222-222222222222'::UUID,
    'manage_bots'
);

-- Test get_user_role
SELECT get_user_role(
    '11111111-1111-1111-1111-111111111111'::UUID,
    '22222222-2222-2222-2222-222222222222'::UUID
);

-- Test get_role_permissions
SELECT get_role_permissions('manager');
```

### **Test Frontend Hook:**

```jsx
// In a component
const { role, canManageBots } = usePermissions(orgId);
console.log('Role:', role);
console.log('Can manage bots:', canManageBots);
```

---

## 📋 Migration from Old System

If you had individual permission columns before:

```sql
-- Old system (complex)
ALTER TABLE organization_members
  ADD COLUMN can_manage_bots BOOLEAN,
  ADD COLUMN can_manage_locations BOOLEAN,
  -- etc...

-- New system (simple)
-- Just use the 'role' column!
-- Permissions determined by role
```

---

## ✅ Benefits

### **Simpler:**
- ❌ No individual permission columns
- ✅ Just one `role` TEXT column
- ✅ Permissions defined in code, not database

### **Easier to Maintain:**
- Change permission logic without ALTER TABLE
- Add new permissions without database migration
- Clear role hierarchy

### **Flexible:**
- Can still store custom metadata in JSONB
- Can override specific permissions if needed (via metadata)
- Easy to add new roles

### **Consistent:**
- Same permission logic in database and frontend
- Single source of truth (ROLE_PERMISSIONS)
- Easy to test and reason about

---

## 🎨 UI Components

### **Role Badge:**

```jsx
const RoleBadge = ({ role }) => {
  const variants = {
    owner: 'default',
    admin: 'destructive',
    manager: 'secondary',
    operator: 'outline',
    viewer: 'outline',
    member: 'outline',
  };

  const icons = {
    owner: '👑',
    admin: '⚙️',
    manager: '📋',
    operator: '👨‍💼',
    viewer: '👀',
    member: '👤',
  };

  return (
    <Badge variant={variants[role]}>
      {icons[role]} {role}
    </Badge>
  );
};
```

### **Permission Gate:**

```jsx
const PermissionGate = ({ permission, children, fallback = null }) => {
  const { hasPermission, loading } = usePermissions(organizationId);

  if (loading) return null;
  if (!hasPermission(permission)) return fallback;
  
  return children;
};

// Usage
<PermissionGate permission="manage_bots">
  <Button>Delete Bot</Button>
</PermissionGate>
```

---

## 📚 Complete Example

```jsx
import { usePermissions } from '@/hooks/use-permissions';

export default function SettingsPage({ organizationId }) {
  const {
    role,
    isOwner,
    isAdmin,
    canManageBots,
    canManageBilling,
    canManageMembers,
    loading
  } = usePermissions(organizationId);

  if (loading) return <Loader />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Settings</h1>
        <Badge variant="secondary">{role}</Badge>
      </div>

      {/* General Settings - Everyone */}
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent>
          <p>View-only settings</p>
        </CardContent>
      </Card>

      {/* Bot Management - Manager+ */}
      {canManageBots && (
        <Card>
          <CardHeader>
            <CardTitle>Bot Management</CardTitle>
          </CardHeader>
          <CardContent>
            <Button>Add Bot</Button>
            <Button>Configure Bots</Button>
          </CardContent>
        </Card>
      )}

      {/* Billing - Admin+ */}
      {canManageBilling && (
        <Card>
          <CardHeader>
            <CardTitle>Billing Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <Button>Update Payment Method</Button>
          </CardContent>
        </Card>
      )}

      {/* Members - Admin+ */}
      {canManageMembers && (
        <Card>
          <CardHeader>
            <CardTitle>Team Members</CardTitle>
          </CardHeader>
          <CardContent>
            <Button>Invite Member</Button>
          </CardContent>
        </Card>
      )}

      {/* Danger Zone - Owner Only */}
      {isOwner && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle>Danger Zone</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="destructive">Delete Organization</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

---

## ✅ Summary

✅ **Simple** - Just one `role` column  
✅ **Clear** - Role hierarchy is obvious  
✅ **Maintainable** - Change permissions in code, not database  
✅ **Flexible** - Can override via metadata if needed  
✅ **Type-safe** - Frontend hook provides all checks  
✅ **Secure** - Database functions enforce permissions  

**No more boolean columns for permissions!** 🎉

