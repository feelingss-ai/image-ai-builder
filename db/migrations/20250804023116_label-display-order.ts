import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`label`, table => table.integer(`display_order`).nullable())
  await knex.raw('update label set display_order = id where display_order is null')
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`label`, table => table.dropColumn(`display_order`))
}
