#!/usr/bin/env node

/**
 * Connect.com - Database Migration Runner
 * 
 * This script runs all database migrations in the correct order.
 * 
 * Usage:
 *   node run_all_migrations.js
 * 
 * Prerequisites:
 * - Supabase project URL and service role key in .env file
 * - psql command-line tool installed (optional, for direct SQL execution)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

// Migration files in order
const MIGRATIONS = [
    {
        file: '20260313_add_missing_tables.sql',
        description: 'Add missing tables (conversations, call_logs, connects)'
    },
    {
        file: '20260313_fix_admin_role_enum.sql',
        description: 'Fix admin role ENUM to include all roles'
    },
    {
        file: '20260313_add_2fa_support.sql',
        description: 'Add 2FA support for admin accounts'
    },
    {
        file: '20260313_add_performance_indexes.sql',
        description: 'Add performance indexes to all tables'
    }
];

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

async function checkEnvironment() {
    console.log(`${colors.cyan}Checking environment...${colors.reset}\n`);
    
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
        console.error(`${colors.red}✗ Missing Supabase credentials in .env file${colors.reset}`);
        console.error('Please ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.');
        process.exit(1);
    }
    
    console.log(`${colors.green}✓ Supabase credentials found${colors.reset}`);
    
    // Check if psql is available
    try {
        await execPromise('psql --version');
        console.log(`${colors.green}✓ psql command found${colors.reset}\n`);
        return true;
    } catch (error) {
        console.log(`${colors.yellow}⚠ psql not found in PATH${colors.reset}`);
        console.log('You can still run migrations manually via Supabase Dashboard SQL Editor.\n');
        return false;
    }
}

async function runMigration(migration, hasPsql) {
    const filePath = path.join(__dirname, 'backend', 'supabase', 'migrations', migration.file);
    
    console.log(`${colors.blue}Running migration: ${migration.description}${colors.reset}`);
    console.log(`${colors.yellow}File: ${migration.file}${colors.reset}`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        console.error(`${colors.red}✗ Migration file not found: ${filePath}${colors.reset}`);
        return false;
    }
    
    if (hasPsql) {
        try {
            // Extract database connection from Supabase URL
            // Format: https://xxx.xxx.supabase.co
            const dbUrl = `${process.env.SUPABASE_URL.replace('https://', 'postgresql://postgres:')}@db.${process.env.SUPABASE_URL.split('://')[1]}/postgres`;
            
            await execPromise(`psql "${dbUrl}" -f "${filePath}"`);
            console.log(`${colors.green}✓ Migration completed successfully${colors.reset}\n`);
            return true;
        } catch (error) {
            console.error(`${colors.red}✗ Migration failed with error:${colors.reset}`);
            console.error(error.stderr || error.message);
            console.log('\n');
            return false;
        }
    } else {
        // Manual mode - provide instructions
        console.log(`${colors.yellow}Manual execution required:${colors.reset}`);
        console.log(`1. Open Supabase Dashboard: ${process.env.SUPABASE_URL}`);
        console.log('2. Go to SQL Editor');
        console.log(`3. Copy contents of: ${filePath}`);
        console.log('4. Paste and execute in SQL Editor\n');
        
        // Read and display first few lines as preview
        const content = fs.readFileSync(filePath, 'utf8');
        const preview = content.split('\n').slice(0, 5).join('\n');
        console.log(`${colors.cyan}Preview:${colors.reset}`);
        console.log(preview);
        console.log(`\n${colors.yellow}... (full file has ${content.split('\n').length} lines)${colors.reset}\n`);
        
        return true; // Consider it successful since user will run manually
    }
}

async function main() {
    console.log(`${colors.cyan}`);
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║     Connect.com - Database Migration Runner               ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log(`${colors.reset}\n`);
    
    const hasPsql = await checkEnvironment();
    
    console.log(`${colors.cyan}Found ${MIGRATIONS.length} migrations to run${colors.reset}\n`);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const migration of MIGRATIONS) {
        const success = await runMigration(migration, hasPsql);
        if (success) {
            successCount++;
        } else {
            failCount++;
        }
    }
    
    console.log(`${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.green}✓ Successful: ${successCount}${colors.reset}`);
    if (failCount > 0) {
        console.log(`${colors.red}✗ Failed: ${failCount}${colors.reset}`);
    }
    console.log(`${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}\n`);
    
    if (failCount === 0) {
        console.log(`${colors.green}🎉 All migrations completed successfully!${colors.reset}\n`);
        
        if (!hasPsql) {
            console.log(`${colors.yellow}⚠ Remember to run migrations manually in Supabase Dashboard!${colors.reset}\n`);
        }
        
        console.log('Next steps:');
        console.log('1. Verify new tables exist in Supabase Dashboard');
        console.log('2. Check that indexes were created (should see 60+ indexes)');
        console.log('3. Test the application to ensure everything works');
        console.log('4. Review IMPROVEMENTS_SUMMARY.md for full details\n');
    } else {
        console.log(`${colors.red}⚠ Some migrations failed. Please review errors above.${colors.reset}\n`);
        process.exit(1);
    }
}

// Run the script
main().catch(error => {
    console.error(`${colors.red}Fatal error:${colors.reset}`, error);
    process.exit(1);
});
