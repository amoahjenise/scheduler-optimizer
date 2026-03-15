"""
Backup database and delete master data (keeping system data like shift_codes, system_prompts)
"""
import datetime
from sqlalchemy import create_engine, text
from app.core.config import settings

def create_backup():
    """Create database backup"""
    timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_file = f'db_backup_{timestamp}.sql'
    
    print(f'Creating backup: {backup_file}')
    
    engine = create_engine(settings.DATABASE_URL)
    with open(backup_file, 'w') as f:
        with engine.connect() as conn:
            # Get all table names
            result = conn.execute(text("""
                SELECT tablename FROM pg_tables 
                WHERE schemaname = 'public' 
                ORDER BY tablename
            """))
            tables = [row[0] for row in result]
            
            f.write(f'-- Database backup created at {timestamp}\n\n')
            
            for table in tables:
                # Get data count
                count_result = conn.execute(text(f'SELECT COUNT(*) FROM {table}'))
                count = count_result.scalar()
                
                f.write(f'-- Table: {table} ({count} rows)\n')
                
                if count > 0:
                    # Get column names
                    col_result = conn.execute(text(f'SELECT * FROM {table} LIMIT 0'))
                    columns = list(col_result.keys())
                    
                    # Get all data
                    data = conn.execute(text(f'SELECT * FROM {table}'))
                    
                    for row in data:
                        values = []
                        for val in row:
                            if val is None:
                                values.append('NULL')
                            elif isinstance(val, str):
                                # Escape single quotes
                                escaped = val.replace("'", "''").replace('\\', '\\\\')
                                values.append(f"'{escaped}'")
                            elif isinstance(val, (int, float)):
                                values.append(str(val))
                            else:
                                values.append(f"'{str(val)}'")
                        
                        cols = ', '.join(columns)
                        vals = ', '.join(values)
                        f.write(f'INSERT INTO {table} ({cols}) VALUES ({vals});\n')
                
                f.write('\n')
    
    print(f'✅ Backup created: {backup_file}')
    return backup_file


def delete_master_data():
    """Delete master data tables (keep system tables like shift_codes, system_prompts)"""
    
    # Tables to DELETE (master/user data)
    master_tables = [
        'handovers',
        'optimized_schedules',
        'schedules',
        'patients',
        'nurses',
        'organization_members',
        'organizations',
        'users'
    ]
    
    # Tables to KEEP (system/configuration data)
    system_tables = [
        'shift_codes',
        'system_prompts',
        'alembic_version'
    ]
    
    print('\n🗑️  Deleting master data...')
    print(f'   Tables to delete: {", ".join(master_tables)}')
    print(f'   Tables to keep: {", ".join(system_tables)}')
    
    engine = create_engine(settings.DATABASE_URL)
    with engine.connect() as conn:
        # Start transaction
        trans = conn.begin()
        
        try:
            # Delete in reverse dependency order
            for table in master_tables:
                # Check if table exists
                result = conn.execute(text(f"""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = '{table}'
                    )
                """))
                
                if result.scalar():
                    # Get count before deletion
                    count_result = conn.execute(text(f'SELECT COUNT(*) FROM {table}'))
                    count = count_result.scalar()
                    
                    if count > 0:
                        # Delete all rows
                        conn.execute(text(f'DELETE FROM {table}'))
                        print(f'   ✅ Deleted {count} rows from {table}')
                    else:
                        print(f'   ⊘ {table} was already empty')
                else:
                    print(f'   ⚠️  {table} does not exist')
            
            # Commit transaction
            trans.commit()
            print('\n✅ Master data deleted successfully!')
            
        except Exception as e:
            trans.rollback()
            print(f'\n❌ Error: {e}')
            raise


if __name__ == '__main__':
    import sys
    
    print('=' * 60)
    print('DATABASE BACKUP AND CLEANUP')
    print('=' * 60)
    
    # Step 1: Create backup
    backup_file = create_backup()
    
    # Step 2: Confirm deletion
    print(f'\n⚠️  Backup saved to: {backup_file}')
    
    # Check if 'yes' provided as argument
    if len(sys.argv) > 1 and sys.argv[1].lower() == 'yes':
        response = 'yes'
        print('\nProceeding with deletion (auto-confirmed)...')
    else:
        response = input('\nProceed with deleting master data? (yes/no): ')
    
    if response.lower() == 'yes':
        delete_master_data()
        print('\n✅ Done!')
    else:
        print('\n❌ Cancelled')
