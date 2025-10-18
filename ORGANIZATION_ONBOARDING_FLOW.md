# Organization Onboarding Flow

## Overview
Users are NOT automatically assigned to an organization on signup. Instead, they must either:
1. Create a new organization, OR
2. Accept a pending invitation to join an existing organization

## Backend Changes Made

### Auth Trigger (`handle_new_user()`)
- ✅ **Only creates profile** - no automatic organization creation
- ✅ Sets user role to `'user'` (platform-level role)
- ✅ Does NOT create organization or organization_members entry

### Available SQL Functions

#### 1. Check User's Organizations
```sql
SELECT * FROM get_user_organizations(user_id);
```
**Returns:** List of organizations the user is a member of
- If empty: User needs to create org or accept invite
- If has results: User has organization(s)

#### 2. Get Pending Invitations
```sql
SELECT * FROM get_user_pending_invitations(user_id);
```
**Returns:** List of pending invitations for the user's email
- `invitation_id` - UUID of the invitation
- `organization_id` - UUID of the organization
- `organization_name` - Name of the organization
- `role` - Role they'll have (admin, manager, operator, viewer, member)
- `invited_by_name` - Full name of person who invited them
- `invited_at` - When invitation was created
- `expires_at` - When invitation expires (7 days default)

#### 3. Create Organization
```sql
SELECT * FROM create_organization(
  p_user_id := auth.uid(),
  p_organization_name := 'My Company',
  p_organization_type := 'residential' -- or 'commercial', 'industrial', 'agricultural'
);
```
**Returns:**
- `organization_id` - UUID of new organization
- `organization_name` - Name of organization
- `organization_slug` - URL-safe slug
- `subscription_tier` - 'free' (default)
- `member_role` - 'owner' (creator is owner)

**Side Effects:**
- Creates organization
- Adds creator to `organization_members` with role='owner'
- Updates user's profile with `organization_id`
- Logs activity

#### 4. Accept Invitation
```sql
SELECT accept_member_invitation(
  p_invitation_id := '<invitation-uuid>',
  p_user_id := auth.uid()
);
```
**Returns:** `{ success: true, member_id: "<uuid>" }` or `{ success: false, error: "message" }`

**Side Effects:**
- Adds user to `organization_members` with the invited role
- Updates user's profile with `organization_id`
- Marks invitation as 'accepted'

#### 5. Decline Invitation
```sql
SELECT decline_member_invitation(
  p_invitation_id := '<invitation-uuid>',
  p_user_id := auth.uid()
);
```
**Returns:** `{ success: true }` or `{ success: false, error: "message" }`

## Frontend Implementation

### On Login/Signup Flow

```javascript
// After user logs in
const userId = (await supabase.auth.getUser()).data.user.id;

// 1. Check if user has any organizations
const { data: orgs } = await supabase.rpc('get_user_organizations', { 
  user_uuid: userId 
});

if (!orgs || orgs.length === 0) {
  // User has no organization
  
  // 2. Check for pending invitations
  const { data: invites } = await supabase.rpc('get_user_pending_invitations', {
    p_user_id: userId
  });
  
  // 3. Show dialog with options
  showOnboardingDialog({
    hasPendingInvites: invites && invites.length > 0,
    invitations: invites || []
  });
} else {
  // User has organization(s), continue to app
  continueToApp();
}
```

### Onboarding Dialog Component

```jsx
<OnboardingDialog>
  {hasPendingInvites ? (
    <Tabs>
      <Tab label="Accept Invitation">
        {invitations.map(invite => (
          <InvitationCard
            organizationName={invite.organization_name}
            role={invite.role}
            invitedBy={invite.invited_by_name}
            expiresAt={invite.expires_at}
            onAccept={() => handleAcceptInvite(invite.invitation_id)}
            onDecline={() => handleDeclineInvite(invite.invitation_id)}
          />
        ))}
      </Tab>
      <Tab label="Create Organization">
        <CreateOrgForm onSubmit={handleCreateOrg} />
      </Tab>
    </Tabs>
  ) : (
    <CreateOrgForm onSubmit={handleCreateOrg} />
  )}
</OnboardingDialog>
```

### Create Organization Handler

```javascript
async function handleCreateOrg(formData) {
  const { data, error } = await supabase.rpc('create_organization', {
    p_user_id: userId,
    p_organization_name: formData.name,
    p_organization_type: formData.type || 'residential'
  });
  
  if (error) {
    showError(error.message);
    return;
  }
  
  // Success! User now has an organization
  navigateToDashboard();
}
```

### Accept Invitation Handler

```javascript
async function handleAcceptInvite(invitationId) {
  const { data, error } = await supabase.rpc('accept_member_invitation', {
    p_invitation_id: invitationId,
    p_user_id: userId
  });
  
  if (error || !data.success) {
    showError(data?.error || error.message);
    return;
  }
  
  // Success! User is now part of organization
  navigateToDashboard();
}
```

### Decline Invitation Handler

```javascript
async function handleDeclineInvite(invitationId) {
  const { data, error } = await supabase.rpc('decline_member_invitation', {
    p_invitation_id: invitationId,
    p_user_id: userId
  });
  
  if (error || !data.success) {
    showError(data?.error || error.message);
    return;
  }
  
  // Refresh invitations list
  refreshInvitations();
}
```

## Key Points

1. **Profile vs Organization Roles**
   - `profiles.role`: Platform-level role ('user', 'admin', 'staff', 'owner')
   - `organization_members.role`: Org-level role ('owner', 'admin', 'manager', 'operator', 'viewer', 'member')

2. **Organization Ownership**
   - Tracked in `organization_members` table with `role='owner'`
   - NOT in `organizations.owner_id` (removed - was redundant)

3. **Multiple Organizations**
   - Users can be members of multiple organizations
   - The `get_user_organizations()` function returns all of them
   - Frontend should handle organization switching if needed

4. **Invitation Expiry**
   - Invitations expire after 7 days by default
   - `get_user_pending_invitations()` only returns non-expired invitations

5. **Error Handling**
   - All invitation functions return JSON with `{ success: boolean, error?: string }`
   - Always check for errors and display them to users

## Testing Checklist

- [ ] New user signup creates profile only (no org)
- [ ] Login without org shows onboarding dialog
- [ ] Can create new organization from dialog
- [ ] After creating org, user is redirected to dashboard
- [ ] Can see pending invitations (if any)
- [ ] Can accept invitation and join organization
- [ ] Can decline invitation
- [ ] After accepting invite, user is redirected to dashboard
- [ ] Cannot access app features without being in an organization
- [ ] Multiple organization support (if needed)

