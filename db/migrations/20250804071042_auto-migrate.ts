import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`image_bounding_box`, table => table.renameColumn(`image_label_id`, `label_id`))
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`image_bounding_box`, table => table.renameColumn(`label_id`, `image_label_id`))
}
