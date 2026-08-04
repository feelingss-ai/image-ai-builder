import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`image`, table => table.text(`content_hash`).nullable())
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`image`, table => table.dropColumn(`content_hash`))
}
