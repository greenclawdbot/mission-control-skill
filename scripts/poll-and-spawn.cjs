#!/usr/bin/env node
// Mission Control Skill - Poll and Spawn
// Runs during heartbeat to check for orphaned tasks

const API_URL = 'http://192.168.1.84:3001';
const SESSION_KEY = `mc:${Date.now()}`;

async function log(msg) {
  console.log(`[MC-SKILL] ${msg}`);
}

async function pollForWork() {
  log('Polling for orphaned tasks...');
  
  try {
    const response = await fetch(
      `${API_URL}/api/v1/tasks/orphaned?sessionKey=${SESSION_KEY}&assignee=clawdbot`
    );

    if (!response.ok) {
      log(`API error: ${response.statusText}`);
      return null;
    }

    const result = await response.json();
    
    if (result.task && result.action === 'claimed') {
      log(`Found task: ${result.task.title}`);
      return result.task;
    }
    
    log('No orphaned tasks found');
    return null;
  } catch (error) {
    log(`Error: ${error.message}`);
    return null;
  }
}

// Run and output result
pollForWork()
  .then(task => {
    if (task) {
      console.log('');
      console.log('=== TASK FOUND ===');
      console.log(`ID: ${task.id}`);
      console.log(`Title: ${task.title}`);
      console.log('');
      console.log('To spawn sub-agent, run:');
      console.log(`sessions_spawn({`);
      console.log(`  task: "Complete: ${task.title}",`);
      console.log(`  label: "mission-control:${task.id}",`);
      console.log(`  cleanup: "delete"`);
      console.log(`})`);
      console.log('');
    } else {
      console.log('[MC-SKILL] No work found');
    }
  })
  .catch(err => {
    console.error('[MC-SKILL] Error:', err.message);
    process.exit(1);
  });
