import { QueryInterface, Transaction } from 'sequelize';

const INCOME_ROOTS = `
  SELECT "userId", jsonb_agg("id") AS ids
  FROM "Categories"
  WHERE "key" = 'income' AND "parentId" IS NULL AND "userId" IS NOT NULL
  GROUP BY "userId"
`;

/**
 * Seeds `settings.incomeCategoryIds` with each user's default "income" root category, so the
 * category picker separates income from expense categories without a manual setup step.
 * Rows that already carry the key are left alone; users with no settings row get one.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `
        UPDATE "UserSettings" us
        SET "settings" = jsonb_set(us."settings", '{incomeCategoryIds}', c.ids)
        FROM (${INCOME_ROOTS}) c
        WHERE c."userId" = us."userId"
          AND jsonb_typeof(us."settings") = 'object'
          AND NOT jsonb_exists(us."settings", 'incomeCategoryIds');
        `,
        { transaction: t },
      );
      await queryInterface.sequelize.query(
        `
        INSERT INTO "UserSettings" ("id", "userId", "settings", "createdAt", "updatedAt")
        SELECT
          gen_random_uuid(),
          c."userId",
          jsonb_build_object('locale', 'en', 'includeCreditLimitInStats', false, 'incomeCategoryIds', c.ids),
          NOW(),
          NOW()
        FROM (${INCOME_ROOTS}) c
        WHERE NOT EXISTS (SELECT 1 FROM "UserSettings" us WHERE us."userId" = c."userId");
        `,
        { transaction: t },
      );
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(`UPDATE "UserSettings" SET "settings" = "settings" - 'incomeCategoryIds';`);
  },
};
