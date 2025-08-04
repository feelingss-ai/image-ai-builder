import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`image_bounding_box`, table => table.dropColumn(`image_label_id`))
  await knex.raw('alter table `image_bounding_box` add column `label_id` integer not null references `label`(`id`)')
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`image_bounding_box`, table => table.dropColumn(`label_id`))
  await knex.raw('alter table `image_bounding_box` add column `image_label_id` integer not null references `image_label`(`id`)')
}
