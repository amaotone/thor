import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MemoryDB } from '../memory/memory-db.js';
import { appendJsonl } from '../shared/file-utils.js';
import { createLogger } from '../shared/logger.js';

const logger = createLogger('migrate');

/**
 * Migrate conversation data from SQLite (MemoryDB) to file-based stores.
 *
 * Idempotent: skips channels that already have a turns.jsonl file.
 * After migration, SQLite tables are left as-is (not deleted or modified).
 */
export function migrateToFiles(memoryDb: MemoryDB, contextDir: string): void {
  const channelsDir = join(contextDir, 'channels');

  // Get all distinct channel IDs from conversation_turns
  const channelIds = memoryDb.getConversationChannelIds();

  if (channelIds.length === 0) {
    logger.info('No conversation data to migrate');
    return;
  }

  logger.info(`Migrating ${channelIds.length} channels from SQLite to files`);

  for (const channelId of channelIds) {
    const channelDir = join(channelsDir, channelId);
    const turnsPath = join(channelDir, 'turns.jsonl');

    // Skip if already migrated
    if (existsSync(turnsPath)) {
      logger.debug(`Channel ${channelId} already migrated, skipping`);
      continue;
    }

    mkdirSync(channelDir, { recursive: true });

    // Migrate turns
    const turns = memoryDb.getRecentTurns(channelId, 10000); // Get all turns
    if (turns.length > 0) {
      for (const turn of turns) {
        appendJsonl(turnsPath, turn);
      }
      logger.info(`Migrated ${turns.length} turns for channel ${channelId}`);
    }

    // Migrate summary
    const summary = memoryDb.getSummary(channelId);
    if (summary) {
      const meta = JSON.stringify({
        lastTurnId: summary.last_turn_id,
        turnCount: summary.turn_count,
      });
      writeFileSync(join(channelDir, 'summary.md'), `<!--meta:${meta}-->\n${summary.summary}`);
      logger.info(`Migrated summary for channel ${channelId}`);
    }
  }

  logger.info('Migration complete');
}
