# Organization & Location Context Fix

## Problem

The active organization and active location were **NOT** stored in a global context. They were only managed as local state in `portal-layout.jsx` and passed to child components via `useOutletContext()`. This caused several issues:

1. **Limited Accessibility**: Only direct children of the `Outlet` could access `selectedOrg` and `selectedLocation`
2. **No Global State**: Components outside the portal layout couldn't access organization/location context
3. **Broken Dependencies**: Active location depends on active organization, but this relationship wasn't globally managed
4. **Data Isolation**: Hooks, utility functions, and nested components couldn't access the active organization/location

## Solution

### Extended `AuthContext` to Include Organization & Location Management

**File**: `src/context/auth-context.jsx`

#### New State Added:
```javascript
const [organizations, setOrganizations] = useState([])
const [selectedOrg, setSelectedOrg] = useState(null)
const [locations, setLocations] = useState([])
const [selectedLocation, setSelectedLocation] = useState(null)
const [orgLoading, setOrgLoading] = useState(false)
```

#### New Functions Added:

1. **`loadUserOrganizations()`**: 
   - Loads all organizations for the current user
   - Auto-selects from localStorage or first available organization
   - Called automatically when user changes

2. **`loadOrganizationLocations()`**: 
   - Loads all locations for the selected organization
   - Auto-selects from localStorage or first available location
   - Called automatically when organization changes

3. **`changeOrganization(org)`**: 
   - Updates the active organization
   - Saves to localStorage
   - Triggers location reload

4. **`changeLocation(loc)`**: 
   - Updates the active location
   - Saves to localStorage

#### Automatic Data Management:

```javascript
// Load organizations when user changes
useEffect(() => {
  loadUserOrganizations()
}, [loadUserOrganizations])

// Load locations when organization changes
useEffect(() => {
  loadOrganizationLocations()
}, [loadOrganizationLocations])

// Clear org/location data on sign out
useEffect(() => {
  if (!user) {
    setOrganizations([])
    setSelectedOrg(null)
    setLocations([])
    setSelectedLocation(null)
    localStorage.removeItem('selectedOrgId')
    localStorage.removeItem('selectedLocationId')
  }
}, [user])
```

### Updated `PortalLayout` to Use Context

**File**: `src/components/layout/portal-layout.jsx`

#### Removed:
- Local state for `organizations`, `selectedOrg`, `locations`, `selectedLocation`, `loading`
- `loadUserOrganizations()` function
- `loadOrganizationLocations()` function

#### Now Uses from Context:
```javascript
const { 
  user, 
  signOut, 
  organizations,           // ← from context
  selectedOrg,            // ← from context
  locations,              // ← from context
  selectedLocation,       // ← from context
  orgLoading,             // ← from context
  loadUserOrganizations,  // ← from context
  loadOrganizationLocations, // ← from context
  changeOrganization,     // ← from context
  changeLocation          // ← from context
} = useAuth();
```

## Benefits

### 1. **Global Accessibility**
```javascript
// Any component can now access active organization/location
import { useAuth } from '@/context/auth-context';

function MyComponent() {
  const { selectedOrg, selectedLocation } = useAuth();
  
  // Use them anywhere!
}
```

### 2. **Automatic Relationship Management**
- When organization changes → locations automatically reload
- When user signs out → organization and location state automatically cleared
- Data always stays in sync

### 3. **Consistent State**
- Single source of truth for organization/location
- No risk of state mismatch between components
- localStorage persistence handled centrally

### 4. **Simplified Component Logic**
- Components no longer need to manage organization/location state
- No need to pass props down multiple levels
- Cleaner, more maintainable code

## Usage Examples

### Basic Usage
```javascript
import { useAuth } from '@/context/auth-context';

function ServicePage() {
  const { selectedOrg, selectedLocation } = useAuth();
  
  return (
    <div>
      <h1>Services for {selectedOrg.organization_name}</h1>
      <p>Location: {selectedLocation?.name}</p>
    </div>
  );
}
```

### Changing Organization
```javascript
function OrgSwitcher() {
  const { organizations, selectedOrg, changeOrganization } = useAuth();
  
  return (
    <select 
      value={selectedOrg?.organization_id}
      onChange={(e) => {
        const org = organizations.find(o => o.organization_id === e.target.value);
        changeOrganization(org);
      }}
    >
      {organizations.map(org => (
        <option key={org.organization_id} value={org.organization_id}>
          {org.organization_name}
        </option>
      ))}
    </select>
  );
}
```

### Changing Location
```javascript
function LocationSwitcher() {
  const { locations, selectedLocation, changeLocation } = useAuth();
  
  return (
    <select 
      value={selectedLocation?.id}
      onChange={(e) => {
        const loc = locations.find(l => l.id === e.target.value);
        changeLocation(loc);
      }}
    >
      {locations.map(loc => (
        <option key={loc.id} value={loc.id}>
          {loc.name}
        </option>
      ))}
    </select>
  );
}
```

### Loading New Data After Changes
```javascript
function ManageOrganizations() {
  const { loadUserOrganizations } = useAuth();
  
  const createNewOrg = async (name) => {
    await supabase.rpc('create_organization', { p_organization_name: name });
    
    // Reload organizations to include the new one
    await loadUserOrganizations();
  };
  
  return <button onClick={() => createNewOrg('My New Org')}>Create</button>;
}
```

## Migration Notes

### For Existing Components

**Before:**
```javascript
function MyComponent() {
  const { selectedOrg } = useOutletContext();
  // ...
}
```

**After:**
```javascript
import { useAuth } from '@/context/auth-context';

function MyComponent() {
  const { selectedOrg, selectedLocation } = useAuth();
  // ...
}
```

### For Components Creating Organizations/Locations

Components that create new organizations or locations should call the reload functions:

```javascript
import { useAuth } from '@/context/auth-context';

function CreateLocation() {
  const { selectedOrg, loadOrganizationLocations } = useAuth();
  
  const createLocation = async (locationData) => {
    await supabase.from('locations').insert({
      ...locationData,
      organization_id: selectedOrg.organization_id
    });
    
    // Reload locations to include the new one
    await loadOrganizationLocations();
  };
}
```

## Technical Details

### State Management Flow

```
User Signs In
    ↓
loadUserOrganizations() is called
    ↓
Organizations loaded (ordered by created_at ASC - oldest first)
    ↓
First organization auto-selected (from localStorage or oldest created)
    ↓
selectedOrg change triggers loadOrganizationLocations()
    ↓
Locations loaded (ordered by created_at ASC - oldest first)
    ↓
First location auto-selected (from localStorage or oldest created)
    ↓
Components can now access selectedOrg & selectedLocation globally
```

### Default Selection Logic

Both organizations and locations default to the **first created** (oldest):

1. **Organizations**: 
   - Ordered by `created_at ASC` (oldest first)
   - Selects from localStorage if available, otherwise first in array (oldest)

2. **Locations**: 
   - Ordered by `created_at ASC` (oldest first)
   - Selects from localStorage if available, otherwise first in array (oldest)

This ensures consistent behavior where the user's original/primary organization and location are selected by default.

### Data Persistence

- **Organization**: Saved to `localStorage` key `selectedOrgId`
- **Location**: Saved to `localStorage` key `selectedLocationId`
- On app reload, the context automatically restores from localStorage
- On sign out, localStorage is cleared

### Error Handling

All loading functions include error handling:
- Errors are logged to console
- State is safely reset on error
- Loading flags are always cleared in `finally` blocks

## Files Modified

1. **`src/context/auth-context.jsx`**
   - Added organization and location state management
   - Added automatic data loading and cleanup
   - Exposed new functions in context value

2. **`src/components/layout/portal-layout.jsx`**
   - Removed duplicate state and functions
   - Now uses context for organization/location management
   - Simplified component logic

## Testing Checklist

- [x] Organization switching works and persists across page reloads
- [x] Location switching works and persists across page reloads
- [x] Locations reload when organization changes
- [x] State clears on sign out
- [x] New organizations can be created
- [x] New locations can be created
- [x] All existing components still work with context
- [x] No linter errors

## Future Improvements

1. **Optimistic Updates**: Update UI before API calls complete
2. **Error Boundaries**: Add error boundaries for organization/location loading
3. **Caching**: Cache organization/location data to reduce API calls
4. **Multi-Organization Support**: Allow selecting multiple organizations simultaneously
5. **Breadcrumbs**: Add organization > location breadcrumb navigation

