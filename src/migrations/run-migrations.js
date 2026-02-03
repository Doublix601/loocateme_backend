#!/usr/bin/env node
/**
 * Migration Runner
 * 
 * Scans the migrations folder for numbered migration files (e.g., 001_name.js, 002_name.js)
 * and executes any that haven't been run yet, in order.
 * 
 * Migration files must:
 * - Start with a 3-digit number followed by underscore (e.g., 001_)
 * - Export a default async function `migrate()` or named export `migrate`
 * - NOT be this file (run-migrations.js)
 * 
 * Usage:
 *   node src/migrations/run-migrations.js
 * 
 * Environment:
 *   MONGO_URI - MongoDB connection string (defaults to mongodb://localhost:27017/loocateme)
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MigrationState } from '../models/MigrationState.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pattern for migration files: 3 digits + underscore + name + .js
const MIGRATION_PATTERN = /^(\d{3})_.+\.js$/;

async function runMigrations() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/loocateme';
  
  console.log('[migrations] Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('[migrations] Connected.');

  try {
    // Get list of all migration files
    const files = fs.readdirSync(__dirname)
      .filter(f => MIGRATION_PATTERN.test(f) && f !== 'run-migrations.js')
      .sort(); // Sort alphabetically (which sorts by number prefix)

    if (files.length === 0) {
      console.log('[migrations] No migration files found.');
      return;
    }

    console.log(`[migrations] Found ${files.length} migration file(s): ${files.join(', ')}`);

    // Get already executed migrations
    const executed = await MigrationState.find({}).lean();
    const executedNames = new Set(executed.map(m => m.name));

    // Filter to only pending migrations
    const pending = files.filter(f => !executedNames.has(f));

    if (pending.length === 0) {
      console.log('[migrations] All migrations already executed. Nothing to do.');
      return;
    }

    console.log(`[migrations] ${pending.length} pending migration(s): ${pending.join(', ')}`);

    // Execute each pending migration in order
    for (const migrationFile of pending) {
      console.log(`\n[migrations] Running: ${migrationFile}`);
      
      try {
        const migrationPath = path.join(__dirname, migrationFile);
        const migrationModule = await import(migrationPath);
        
        // Support both default export and named export
        const migrateFn = migrationModule.default || migrationModule.migrate;
        
        if (typeof migrateFn !== 'function') {
          throw new Error(`Migration ${migrationFile} does not export a migrate function`);
        }

        // Run the migration
        await migrateFn();

        // Record successful execution
        await MigrationState.create({ name: migrationFile });
        console.log(`[migrations] ✅ ${migrationFile} completed successfully.`);
        
      } catch (err) {
        console.error(`[migrations] ❌ ${migrationFile} FAILED:`, err.message || err);
        // Stop on first failure to prevent running dependent migrations
        throw err;
      }
    }

    console.log(`\n[migrations] All ${pending.length} migration(s) completed successfully.`);

  } finally {
    await mongoose.disconnect();
    console.log('[migrations] Disconnected from MongoDB.');
  }
}

// Run if executed directly
runMigrations()
  .then(() => {
    console.log('[migrations] Done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[migrations] Migration runner failed:', err);
    process.exit(1);
  });
