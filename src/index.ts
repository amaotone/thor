import { createLogger } from './core/shared/logger.js';
import { bootstrap } from './runtime/bootstrap.js';

const logger = createLogger('thor');

bootstrap().catch((err) => logger.error(err));
