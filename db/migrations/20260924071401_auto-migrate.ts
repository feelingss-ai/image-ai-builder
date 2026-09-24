import { Knex } from 'knex'

// Adds label_conflict: an unordered pair of labels that cannot both be
// selected. The pair is normalised so label_a_id < label_b_id, and the unique
// index prevents duplicate pairs. (auto-migrate also wanted to drop the
// image_keypoint unique index because erd.txt does not declare it, but that
// index is required by the keypoint upsert — intentionally left untouched.)
// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('label_conflict'))) {
    await knex.schema.createTable('label_conflict', table => {
      table.increments('id')
      table.integer('project_id').unsigned().notNullable().references('project.id')
      table.integer('label_a_id').unsigned().notNullable().references('label.id')
      table.integer('label_b_id').unsigned().notNullable().references('label.id')
      table.timestamps(false, true)
      table.unique(['label_a_id', 'label_b_id'])
    })
  }
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('label_conflict')
}
