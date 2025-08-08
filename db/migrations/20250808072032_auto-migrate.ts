import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('image_bounding_box', table => {
    table.dropForeign('label_id')
    table.foreign('label_id').references('label.id')
  })
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('image_bounding_box', table => {
    table.dropForeign('label_id')
    table.foreign('label_id').references('image_label.id')
  })
}
