# Mission Control Skill

A skill for clawdbot to interact with the Mission Control kanban system.

## Features

- **Poll for orphaned tasks**: Finds InProgress tasks without active sessions
- **Spawn sub-agents**: Creates sub-agents to work on claimed tasks
- **Heartbeat integration**: Works with clawdbot's heartbeat to automate task processing

## Usage

### During Heartbeat

```bash
node ~/.nvm/.../skills/mission-control/scripts/poll-and-spawn.cjs
```

This will:
1. Poll Mission Control API for orphaned InProgress tasks
2. If found, spawn a sub-agent using `sessions_spawn`
3. Report what was spawned

### Direct Commands

```bash
# Poll for work
node ~/.nvm/.../skills/mission-control/scripts/poll.cjs

# Spawn for a specific task
node ~/.nvm/.../skills/mission-control/scripts/spawn.cjs <task-id> "<task-title>"
```

## Files

```
mission-control/
├── SKILL.md           ← This file
├── src/
│   └── index.ts       ← Skill implementation (future)
└── scripts/
    ├── poll.cjs       ← Poll for orphaned tasks
    └── spawn.cjs      ← Spawn sub-agent for task
```

## API Endpoints

Mission Control API: `http://192.168.1.84:3001`

- `GET /api/v1/tasks/orphaned?sessionKey=<key>&assignee=clawdbot`
  - Returns orphaned InProgress tasks
  - Claims task if found

## Configuration

No configuration needed. Uses defaults:
- API URL: `http://192.168.1.84:3001`
- Assignee: `clawdbot`
