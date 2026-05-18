/**
 * Seed script — inserts safe sample data into Supabase for development.
 *
 * Usage (run from the app/ directory so ts-node resolves @supabase/supabase-js):
 *   cd app && npx ts-node ../scripts/seed-sample-data.ts
 *
 * Requirements:
 *   - .env file in the repo root with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   - At least one user signed up in the app (the script seeds data for the first user)
 *
 * This script uses the service role key to bypass RLS — for development only.
 * Never run this against a production database with real user data.
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load .env from repo root
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  console.error('See docs/ENVIRONMENT_VARIABLES.md for details.');
  process.exit(1);
}

if (serviceRoleKey.length < 100) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY looks too short — check your .env file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

async function seed() {
  console.log('Daily Workflow Management App — Sample Data Seed Script');
  console.log('=========================================================');
  console.log('Target:', supabaseUrl);
  console.log('');

  // 1. Find the first test user
  const { data: users, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError) {
    console.error('Failed to list users:', usersError.message);
    process.exit(1);
  }

  const firstUser = users?.users?.[0];
  if (!firstUser) {
    console.error('No users found. Sign up in the app first, then run this script.');
    process.exit(1);
  }

  const userId = firstUser.id;
  console.log(`Seeding data for user: ${firstUser.email} (${userId})`);
  console.log('');

  // 2. Create a workflow
  const { data: workflow, error: workflowError } = await supabase
    .from('workflows')
    .insert({
      user_id: userId,
      name: 'Daily Planning',
      description: 'Morning planning workflow for reviewing tasks and setting priorities for the day.',
      status: 'active',
    })
    .select('id')
    .single();

  if (workflowError) {
    console.error('Failed to create workflow:', workflowError.message);
    process.exit(1);
  }

  console.log('Created workflow: Daily Planning');

  // 3. Create a summary
  const { data: summary, error: summaryError } = await supabase
    .from('summaries')
    .insert({
      user_id: userId,
      title: 'Daily Workflow Summary — Example',
      content:
        'This is an example daily summary. In a real workflow, this would contain a concise overview ' +
        'of your day: key highlights, carry-over items, blockers that need attention, and decisions to make. ' +
        'The agent reads context from your work tools and produces this summary each morning.',
      source: 'agent',
      workflow_id: workflow.id,
    })
    .select('id')
    .single();

  if (summaryError) {
    console.error('Failed to create summary:', summaryError.message);
    process.exit(1);
  }

  console.log('Created summary: Daily Workflow Summary — Example');

  // 4. Create sample tasks
  const tasks = [
    {
      title: 'Review open pull request',
      description: 'A pull request is waiting for your review. Check comments and approve or request changes.',
      status: 'open',
      priority: 'high',
      source: 'agent',
      workflow_id: workflow.id,
      summary_id: summary.id,
    },
    {
      title: 'Prepare project update for weekly meeting',
      description: 'Cover what shipped last week, what is in progress, any blockers, and next week\'s plan.',
      status: 'open',
      priority: 'high',
      source: 'agent',
      workflow_id: workflow.id,
      summary_id: summary.id,
    },
    {
      title: 'Follow up with vendor on proposal',
      description: 'Initial email was sent. If no response by end of day, follow up by phone.',
      status: 'open',
      priority: 'medium',
      source: 'agent',
      workflow_id: workflow.id,
      summary_id: summary.id,
    },
    {
      title: 'Summarise customer meeting notes',
      description: 'Meeting was this morning. Extract action items and share with the team.',
      status: 'open',
      priority: 'medium',
      source: 'user',
      workflow_id: workflow.id,
      summary_id: null,
    },
    {
      title: 'Update API documentation',
      description: 'Three new endpoints added last sprint are missing from the public documentation.',
      status: 'open',
      priority: 'low',
      source: 'agent',
      workflow_id: workflow.id,
      summary_id: summary.id,
    },
    {
      title: 'Schedule quarterly planning session',
      description: 'Q1 planning needs to happen next month. Find a time that works for the full team.',
      status: 'open',
      priority: 'low',
      source: 'agent',
      workflow_id: null,
      summary_id: null,
    },
  ];

  const tasksWithUserId = tasks.map((t) => ({ ...t, user_id: userId }));

  const { data: insertedTasks, error: tasksError } = await supabase
    .from('tasks')
    .insert(tasksWithUserId)
    .select('id, title');

  if (tasksError) {
    console.error('Failed to create tasks:', tasksError.message);
    process.exit(1);
  }

  console.log(`Created ${insertedTasks?.length ?? 0} tasks:`);
  for (const task of insertedTasks ?? []) {
    console.log(`  - ${task.title}`);
  }

  // 5. Create task_events for each task
  if (insertedTasks && insertedTasks.length > 0) {
    const events = insertedTasks.map((task) => ({
      task_id: task.id,
      user_id: userId,
      actor: 'agent',
      event_type: 'created',
      previous_status: null,
      new_status: 'open',
      details: { note: 'Created by seed script' },
    }));

    const { error: eventsError } = await supabase.from('task_events').insert(events);
    if (eventsError) {
      console.error('Warning: Failed to create task_events:', eventsError.message);
    } else {
      console.log(`Created ${events.length} task_events`);
    }
  }

  console.log('');
  console.log('Seed complete. Open the app to see the sample data.');
  console.log('Sign in with:', firstUser.email);
}

seed().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
