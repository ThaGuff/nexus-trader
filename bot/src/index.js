/**
 * NEXUS TRADER · Entry Point
 */

import 'dotenv/config';
import { startServer, setBotModule } from './server.js';
import * as botModule from './bot.js';

// Start HTTP + WebSocket server
startServer();

// Wire bot module into server for WS init
setBotModule(botModule);

// Start trading bot
botModule.startBot();

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Main] SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Main] SIGINT received, shutting down...');
  process.exit(0);
});

process.on('uncaughtException', (e) => {
  console.error('[Main] Uncaught exception:', e.message, e.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});
