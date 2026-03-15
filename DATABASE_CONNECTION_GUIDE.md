# Database Connection Guide

## Quick Check: View Schedules in Database

### Method 1: Using the Python Script (Recommended)

I've created a script to check your schedules. Run it from the backend directory:

```bash
cd backend
python check_schedules.py
```

This will show you:

- Total number of schedules
- Number of finalized schedules
- List of all schedules with details
- Organization IDs associated with schedules

### Method 2: Direct Database Connection (psql)

If you're using PostgreSQL, you can connect directly:

```bash
# Get your DATABASE_URL from backend/.env
# It should look like: postgresql://user:password@host:port/dbname

# Connect using psql
psql "your_database_url_here"

# Or if you have the connection details separately:
psql -h localhost -U your_username -d your_database_name
```

Once connected, run these queries:

```sql
-- Count all schedules
SELECT COUNT(*) FROM optimized_schedules;

-- Count finalized schedules
SELECT COUNT(*) FROM optimized_schedules WHERE finalized = true;

-- View all schedules with details
SELECT
    id,
    organization_id,
    finalized,
    created_at,
    result->>'start_date' as start_date,
    result->>'end_date' as end_date
FROM optimized_schedules
ORDER BY created_at DESC;

-- View schedules by organization
SELECT
    organization_id,
    COUNT(*) as schedule_count,
    COUNT(CASE WHEN finalized = true THEN 1 END) as finalized_count
FROM optimized_schedules
GROUP BY organization_id;
```

### Method 3: Using a Database GUI

Popular options:

- **pgAdmin** (PostgreSQL): https://www.pgadmin.org/
- **DBeaver** (Multi-database): https://dbeaver.io/
- **TablePlus**: https://tableplus.com/

Connection details are in your `backend/.env` file under `DATABASE_URL`.

## Troubleshooting Dashboard Not Showing Schedules

### 1. Check Backend is Running

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

### 2. Check Frontend is Running

```bash
cd frontend
npm run dev
```

### 3. Verify API Endpoints

Test the schedules API:

```bash
# Without auth (will show all schedules if no org filter)
curl http://localhost:8000/api/optimize/

# With auth headers (replace TOKEN with your actual Clerk token)
curl http://localhost:8000/api/optimize/ \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN"
```

### 4. Check Browser Console

Open your browser's Developer Tools (F12) and:

1. Go to the Network tab
2. Refresh the dashboard page
3. Look for the `/api/optimize/` request
4. Check if it returns data
5. Look for any errors in the Console tab

### 5. Verify Organization ID

Make sure schedules are associated with your organization:

```sql
-- Check what organization IDs exist in schedules
SELECT DISTINCT organization_id FROM optimized_schedules;

-- Check your current user's organization
-- (This requires checking Clerk dashboard or application logs)
```

## Common Issues

### Issue: Dashboard shows 0 schedules but database has schedules

**Possible causes:**

1. **Organization mismatch**: Schedules were created without organization_id or with different org ID
2. **Auth headers not sent**: Frontend not passing auth headers to API
3. **Wrong endpoint**: Using old API endpoint without org filtering

**Solutions:**

1. Check browser console for API response
2. Verify organization_id in schedules matches your current organization
3. Update existing schedules to have your organization_id:
   ```sql
   UPDATE optimized_schedules
   SET organization_id = 'your_org_id_here'
   WHERE organization_id IS NULL;
   ```

### Issue: Can't connect to database

**Check:**

1. DATABASE_URL in backend/.env is correct
2. Database server is running
3. Network/firewall allows connection
4. Credentials are correct

### Issue: "Column doesn't exist" errors

**Solution:** Run migrations:

```bash
cd backend
alembic upgrade head
```

## Admin Features

### Access Admin Schedule Management

As an admin, you can:

1. Navigate to `/admin/schedules` in your browser
2. Or click "Schedules" in the navigation (admins see admin view by default)

### Admin Schedule Page Features:

- ✅ View all schedules (drafts and finalized)
- ✅ See organization IDs and metadata
- ✅ Delete schedules
- ✅ View detailed statistics
- ✅ Create new schedules (button links to scheduler)

### Regular Users:

- Navigate to `/schedules`
- Only see finalized schedules
- Cannot delete or manage schedules

## Next Steps

1. Run `python check_schedules.py` to see what's in your database
2. Check browser console when visiting dashboard
3. Verify organization IDs match between user and schedules
4. Visit `/admin/schedules` as an admin to manage all schedules
