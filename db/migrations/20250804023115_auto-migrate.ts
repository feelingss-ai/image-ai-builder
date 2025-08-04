import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`project`, table => table.dropColumn(`label_id`))
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.raw('alter table `project` add column `label_id` integer not null references `label`(`id`)')
}
