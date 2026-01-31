#!/usr/bin/env node
// Mission Control Skill - Post-Process Script
// Extracts results from completed sub-agent sessions and updates tasks

const fs = require('fs');
const path = require('path');

const API_URL = 'http://192.168.1.84:3001';
const SESSIONS_DIR = path.join(process.env.HOME || '', '.clawdbot', 'agents', 'main', 'sessions');

async function log(msg) {
  console.log(`[MC-POST] ${msg}`);
}

/**
 * Find session files for a given task label
 * The label format is "mission-control:<task-id>"
 */
function findSessionFilesForLabel(label) {
  if (!fs.existsSync(SESSIONS_DIR)) {
    log(`Sessions directory not found: ${SESSIONS_DIR}`);
    return [];
  }

  // Extract the task ID from the label (e.g., "mission-control:0b65663f-..." -> "0b65663f-...")
  const taskId = label.replace('mission-control:', '');

  const files = [];
  try {
    const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        // Check if the filename contains the task ID
        if (entry.name.includes(taskId)) {
          files.push(path.join(SESSIONS_DIR, entry.name));
        }
      }
    }
  } catch (e) {
    log(`Error reading sessions directory: ${e.message}`);
  }

  return files;
}

/**
 * Extract the final summary from a session transcript
 * Looks for the last assistant message that contains actual work results
 */
function extractFinalSummary(transcriptPath) {
  const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n').filter(Boolean);
  
  // Collect all assistant messages
  const assistantMessages = [];
  
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      
      // Look for message type entries
      if (entry.type === 'message' && entry.message) {
        const msg = entry.message;
        
        if (msg.role === 'assistant' && msg.content) {
          // Extract content from the assistant message
          let content = '';
          
          if (Array.isArray(msg.content)) {
            // Multi-part content - extract text parts
            content = msg.content
              .filter(part => part.type === 'text' || part.type === 'thinking')
              .map(part => part.text || '')
              .join('\n\n');
          } else if (typeof msg.content === 'string') {
            content = msg.content;
          }
          
          if (content.trim().length > 0) {
            assistantMessages.push(content);
          }
        }
      }
    } catch (e) {
      // Skip malformed lines
    }
  }
  
  if (assistantMessages.length === 0) {
    return null;
  }
  
  // Helper to clean content
  function cleanContent(text) {
    return text
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/\*\*Thinking:\*\*[\s\S]*?(\n\n|\*\*)/gi, '')
      .replace(/HEARTBEAT_OK/gi, '')
      .trim();
  }
  
  // Strategy 1: Look for "Findings:" marker in assistant messages (prefer last occurrences)
  for (let i = assistantMessages.length - 1; i >= 0; i--) {
    const clean = cleanContent(assistantMessages[i]);
    const findingsMatch = clean.match(/##?\s*Findings?:?\s*\n([\s\S]*)/i);
    if (findingsMatch && findingsMatch[1].trim().length > 5) {
      return findingsMatch[1].trim();
    }
  }
  
  // Strategy 2: Look for the last assistant message that isn't just an acknowledgment
  for (let i = assistantMessages.length - 1; i >= 0; i--) {
    const clean = cleanContent(assistantMessages[i]);
    
    // Skip if it looks like an acknowledgment
    const isAcknowledgment = /^(Understood|Okay|OK|Thanks|Acknowledged|Copy|Will do|I'll|I will|HEARTBEAT)/i.test(clean);
    
    // Skip heartbeat-only messages
    const isHeartbeatOnly = clean.length < 20 || clean.includes('HEARTBEAT_OK');
    
    if (!isAcknowledgment && !isHeartbeatOnly) {
      // Limit the length to avoid overly long results
      if (clean.length > 2000) {
        return clean.substring(0, 2000) + '\n\n... (truncated)';
      }
      return clean;
    }
  }
  
  // Strategy 3: Fall back to the last assistant message (any content)
  const lastClean = cleanContent(assistantMessages[assistantMessages.length - 1]);
  if (lastClean.length > 0) {
    if (lastClean.length > 2000) {
      return lastClean.substring(0, 2000) + '\n\n... (truncated)';
    }
    return lastClean;
  }
  
  return null;
}

/**
 * Fetch tasks that are InProgress and might need review
 */
async function fetchTasksNeedingReview() {
  try {
    const response = await fetch(`${API_URL}/api/v1/tasks?status=InProgress&assignee=clawdbot`);
    if (!response.ok) {
      log(`Failed to fetch tasks: ${response.statusText}`);
      return [];
    }
    const data = await response.json();
    return data.tasks || [];
  } catch (error) {
    log(`Error fetching tasks: ${error.message}`);
    return [];
  }
}

/**
 * Update a task with results and move to Review
 */
async function completeTask(taskId, results) {
  try {
    // First, update the results field
    const updateResponse = await fetch(`${API_URL}/api/v1/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results })
    });
    
    if (!updateResponse.ok) {
      log(`Failed to update task results: ${updateResponse.statusText}`);
      return false;
    }
    
    log(`Updated task ${taskId} with results (${results.length} chars)`);
    
    // Then move to Review
    const moveResponse = await fetch(`${API_URL}/api/v1/tasks/${taskId}/move`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Review' })
    });
    
    if (!moveResponse.ok) {
      log(`Failed to move task to Review: ${moveResponse.statusText}`);
      return false;
    }
    
    log(`Moved task ${taskId} to Review`);
    return true;
  } catch (error) {
    log(`Error completing task: ${error.message}`);
    return false;
  }
}

/**
 * Main processing function
 */
async function main() {
  log('Starting post-process...');
  
  const tasks = await fetchTasksNeedingReview();
  
  if (tasks.length === 0) {
    log('No tasks needing review');
    return;
  }
  
  log(`Found ${tasks.length} InProgress task(s)`);
  
  let processed = 0;
  
  for (const task of tasks) {
    // Only process tasks with mission-control label
    // The label is stored in sessionKey
    const sessionKey = task.sessionKey || '';
    
    if (!sessionKey.includes('mission-control')) {
      log(`Skipping task without mission-control label: ${task.id}`);
      continue;
    }
    
    log(`Processing task: ${task.title} (${task.id})`);
    log(`Session key: ${sessionKey}`);
    
    // Find session transcripts
    const transcriptFiles = findSessionFilesForLabel(sessionKey);
    
    if (transcriptFiles.length === 0) {
      log(`No transcript found for ${sessionKey}`);
      // Use a default message if no transcript
      await completeTask(task.id, `Sub-agent completed work. Please review changes.`);
      processed++;
      continue;
    }
    
    log(`Found ${transcriptFiles.length} transcript file(s)`);
    
    // Use the most recent transcript file
    const transcriptPath = transcriptFiles.sort().pop();
    log(`Using transcript: ${path.basename(transcriptPath)}`);
    
    // Extract summary
    const summary = extractFinalSummary(transcriptPath);
    
    if (summary) {
      log(`Extracted summary (${summary.length} chars)`);
      await completeTask(task.id, summary);
    } else {
      log('No summary found in transcript, using default');
      await completeTask(task.id, `Sub-agent completed work. Please review changes.`);
    }
    
    processed++;
  }
  
  log(`Post-process complete. Processed ${processed} task(s).`);
}

main().catch(err => {
  log(`Error: ${err.message}`);
  process.exit(1);
});
