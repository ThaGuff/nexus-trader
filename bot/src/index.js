import 'dotenv/config';
import { startServer, setBotModule } from './server.js';
import * as botModule from './bot.js';

startServer();
setBotModule(botModule);
botModule.startBot();

process.on('SIGTERM', () => { botModule.stopBot(); process.exit(0); });
process.on('SIGINT',  () => { botModule.stopBot(); process.exit(0); });
process.on('uncaughtException',  e => console.error('[Main] Uncaught:', e.message));
process.on('unhandledRejection', r => console.error('[Main] Rejection:', r));
