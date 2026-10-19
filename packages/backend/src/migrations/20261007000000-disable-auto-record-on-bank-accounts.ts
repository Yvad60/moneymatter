import { QueryInterface } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `UPDATE "Subscriptions" SET "autoRecord" = false
         WHERE "autoRecord" = true
           AND "accountId" IN (SELECT id FROM "Accounts" WHERE type <> 'system')`,
        { transaction },
      );
    });
  },

  down: async (): Promise<void> => {},
};
