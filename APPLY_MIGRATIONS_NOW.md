# ⚠️ APPLY MIGRATIONS NOW

## 🚨 Current Issues

### 1. RLS Error (403 Forbidden)
```
new row violates row-level security policy for table "rental_agreement_amendments"
```

**Cause:** The migrations haven't been applied to your database yet!

### 2. Missing Imports Errors
These are browser cache issues - files are updated but browser has old code.

## ✅ Fix Everything in 2 Steps

### Step 1: Apply Database Migrations

**Run this command:**
```bash
cd /home/imran/Documents/botkorp-mono
supabase db push
```

This will apply:
- ✅ `20251017210000_add_cancellation_columns.sql`
- ✅ `20251017230000_fix_invitations_foreign_keys.sql`
- ✅ `20251017235000_disable_rls_amendments.sql`

**What it fixes:**
- ✅ Disables RLS on amendment tables (fixes 403 error)
- ✅ Adds cancellation columns to gardens/pools
- ✅ Fixes foreign key relationships for invitations
- ✅ Enables amendment submissions
- ✅ Enables admin approvals

### Step 2: Hard Refresh Browser

**After migrations complete:**
1. **Hard refresh:** `Ctrl + Shift + R` (or `Cmd + Shift + R` on Mac)
2. **Or:** Clear browser cache completely
3. **Test features**

## 📝 What Will Work After

✅ Submit amendment requests (change bot count + sign)
✅ Admin can view and approve amendments
✅ No more 403 errors
✅ No more "Settings is not defined" errors
✅ Coverage areas display
✅ All imports resolved

## 🎯 Quick Test After Fix

1. Go to a garden detail page
2. Click "Settings" tab
3. Click "Change Number of Bots"
4. Adjust count → Review → Sign → Submit
5. Should succeed with green toast! ✓

Then as admin:
1. Go to Admin → Approvals
2. See "Service Modification Requests" section
3. Click "Review" on an amendment
4. Approve or Reject

---

**The migrations are ready - just run `supabase db push`!** 🚀

