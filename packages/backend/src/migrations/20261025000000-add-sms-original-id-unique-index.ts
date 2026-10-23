import { QueryInterface } from 'sequelize';

const INDEX_NAME = 'transactions_sms_account_original_id_unique_idx';

/**
 * Prevent concurrent SMS syncs from booking the same provider reference twice.
 * Scoped to rows carrying `externalData.sms` so other sources keep their current ID semantics.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX_NAME}
      ON "Transactions" ("accountId", "originalId")
      WHERE "originalId" IS NOT NULL
        AND "externalData"->'sms' IS NOT NULL;
    `);
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${INDEX_NAME};`);
  },
};
