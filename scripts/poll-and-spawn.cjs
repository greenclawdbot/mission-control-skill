#!/usr/bin/env node
// Mission Control Skill - Poll and Spawn
// Runs during heartbeat to check for orphaned tasks and spawn sub-agents

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

// Run and output result for clawdbot to parse
pollForWork()
  .then(task => {
    if (task) {
      // Output JSON that clawdbot can parse
      console.log(JSON.stringify({
        found: true,
        taskId: task.id,
        title: task.title
      }, null, 2));
    } else {
      console.log(JSON.stringify({ found: false }));
    }
  })
  .catch(err => {
    console.error(JSON.stringify({ error: err.message }));
  });
