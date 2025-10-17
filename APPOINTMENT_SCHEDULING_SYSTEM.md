# 📅 Service Appointment Scheduling & Reminders

## Complete Implementation

### ✅ What's Been Added:

#### 1. **Next Service Appointment Field**
- Added `next_service_date` column to services table
- Stores date of next scheduled service
- Indexed for performance

#### 2. **Beautiful Schedule Editor in Settings Tab**
- Purple theme (calendar icon)
- Calendar-style date display
- Edit mode with date picker
- Reminder notification info
- Professional UI

#### 3. **Automated Daily Reminders**
- Cron job runs daily at 9 AM
- Sends notifications day before service
- Notifies ALL organization members
- Database function for reliability

---

## 🎨 UI Design - Settings Tab

### Card Order:
1. **Service Name** (slate theme)
2. **Next Service Appointment** (purple theme) ← NEW!
3. **Number of Gardens** (blue theme)
4. **Service Controls** (pause/cancel)

### Schedule Card Features:

#### View Mode (Default):
```
┌─ 📅 Next Service Appointment ─────┐
│                                   │
│  ┌─────────────────────────┐     │
│  │   Next Appointment      │     │
│  │                         │     │
│  │        15               │     │
│  │    October 2025         │     │
│  │      Tuesday            │     │
│  └─────────────────────────┘     │
│                                   │
│  [Change Date]                    │
│                                   │
│  ℹ Reminder: Oct 14, 2025        │
└───────────────────────────────────┘
```

**Features:**
- Large number (text-4xl) - Day of month
- Month & year below (text-lg)
- Day of week (text-xs)
- Purple gradient background
- Bordered box
- Info alert: when reminder sent
- Edit button below

**If Not Scheduled:**
```
┌─────────────┐
│ Not scheduled │
│ Click edit to │
│  set a date  │
└─────────────┘
```

#### Edit Mode:
```
┌─ 📅 Next Service Appointment ─────┐
│                                   │
│  ℹ You'll receive a reminder      │
│    notification day before        │
│                                   │
│  Appointment Date                 │
│  [Date Picker: Oct 15, 2025]     │
│  Select date for next visit       │
│                                   │
│  [Save Date] [Cancel]             │
└───────────────────────────────────┘
```

**Features:**
- Info alert at top
- Date input (min = today)
- Helpful description
- Save/Cancel buttons (50/50 split)
- Loading state
- Validation

---

## 🤖 Automated Reminder System

### Database Function: `send_service_reminders()`

**What it does:**
1. Runs daily at 9 AM (cron job)
2. Finds services with `next_service_date = tomorrow`
3. Gets all active organization members
4. Creates notification for each member
5. Logs to console

**Notification includes:**
- Service type
- Location name
- Appointment date
- Service details (in data JSONB)

### Cron Schedule:
```sql
'0 9 * * *'  -- Every day at 9 AM
```

**Reliable:**
- Runs automatically
- No manual intervention
- PostgreSQL cron extension
- Built into database

---

## 🔔 Notification Flow

### Day Before Appointment:
```
9:00 AM - Cron job runs
  ↓
Find services scheduled for tomorrow
  ↓
For each service:
  - Get organization members
  - Create notification per member
  ↓
Members see in notifications:
  "🔔 Service Reminder
   Your lawn service at Home 
   is scheduled for tomorrow"
  ↓
Click notification → Go to service
```

---

## 📋 User Workflow

### Set Appointment:
```
Service Detail → Settings Tab
  ↓
Scroll to "Next Service Appointment"
  ↓
Click "Schedule Appointment" or "Change Date"
  ↓
Select date from calendar picker
  ↓
Click "Save Date"
  ↓
Appointment saved
  ↓
See calendar display with date
  ↓
See info: "Reminder on Oct 14"
```

### Update Appointment:
```
Settings Tab → Next Service Appointment
  ↓
Click "Change Date"
  ↓
Pick new date
  ↓
Save
  ↓
Calendar updates
  ↓
New reminder date shown
```

### Clear Appointment:
```
Edit mode
  ↓
Clear date field (leave empty)
  ↓
Save
  ↓
Shows "Not scheduled"
```

---

## 🎨 Design Details

### Purple Theme:
- Icon box: `bg-purple-100`
- Icon: `text-purple-600`
- Card background: `from-purple-50 to-purple-100/50`
- Border: `border-purple-200`
- Numbers: `text-purple-900`
- Alert: Purple themed

### Calendar Display:
- **Day:** Huge (text-4xl, bold)
- **Month/Year:** Large (text-lg, semibold)
- **Day of Week:** Small (text-xs)
- Centered, clear hierarchy
- Purple gradient background
- Professional, easy to read

### Date Picker:
- Standard HTML5 date input
- Min date = today (can't schedule in past)
- Height: h-11 (comfortable)
- Mobile-friendly
- Browser native UI

---

## 🗄️ Database Schema

### services table:
```sql
next_service_date DATE  -- New column
```

### notifications table:
Used by cron to create reminders

**Notification structure:**
```json
{
  "title": "Service Reminder",
  "message": "Your lawn service at Home is scheduled for tomorrow",
  "type": "reminder",
  "related_type": "service",
  "related_id": "service-uuid",
  "data": {
    "service_id": "uuid",
    "service_name": "Home - Lawn Care",
    "service_date": "2025-10-15",
    "location_name": "Home"
  }
}
```

---

## 📧 Future Enhancement: Email Reminders

**Could add:**
- Send email in addition to notification
- Use Resend API (already configured)
- Same beautiful template style
- "Service Tomorrow" subject
- Calendar link attachment

**Implementation:**
```python
# In send_service_reminders() function
# After creating notification, also send email
```

---

## 📱 Mobile Responsive

**Calendar Display:**
- Scales properly
- Touch-friendly
- Easy to read
- Date picker native UI

**Edit Mode:**
- Full-width inputs
- Proper button sizes
- Touch targets 44px+
- No overflow

---

## ✅ Benefits

### For Customers:
✅ Know when service is coming  
✅ Plan accordingly  
✅ Get reminded automatically  
✅ Easy to reschedule  

### For Operations:
✅ Track scheduled services  
✅ Plan technician routes  
✅ Automated reminders  
✅ Reduce no-shows  

### For System:
✅ Automated notifications  
✅ Database-driven  
✅ Reliable cron  
✅ Scalable  

---

## 🚀 Apply Migration

```bash
supabase db push
```

This applies:
- Adds `next_service_date` column
- Creates `send_service_reminders()` function
- Schedules daily cron job at 9 AM

---

## 🧪 Testing

### Manual Test:
1. Go to service detail page
2. Click Settings tab
3. Find "Next Service Appointment"
4. Click "Schedule Appointment"
5. Pick tomorrow's date
6. Save
7. See calendar display
8. Check reminder date in alert

### Cron Test:
```sql
-- Manually trigger the function
SELECT send_service_reminders();

-- Check notifications created
SELECT * FROM notifications 
WHERE type = 'reminder' 
ORDER BY created_at DESC 
LIMIT 10;
```

---

## 📍 Settings Tab Order (Final):

1. **Service Name** (edit inline)
2. **Next Service Appointment** (NEW - purple calendar)
3. **Number of Gardens** (+/- counter)
4. **Service Controls** (pause/cancel at bottom)

**Logical flow:**  
Identity → Schedule → Coverage → Actions

---

**Perfect scheduling system with automated reminders!** 📅✨

Navigate to a service and check the Settings tab to see the beautiful new appointment scheduler!

