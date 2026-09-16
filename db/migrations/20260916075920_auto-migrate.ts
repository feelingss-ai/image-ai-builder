import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`similar_pair_feedback`, table => table.dropColumn(`image_id_b`))
  await knex.schema.alterTable(`similar_pair_feedback`, table => table.dropColumn(`image_id_a`))
  await knex.raw('alter table `similar_pair_feedback` add column `image_a_id` integer not null references `image`(`id`)')
  await knex.raw('alter table `similar_pair_feedback` add column `image_b_id` integer not null references `image`(`id`)')
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`similar_pair_feedback`, table => table.dropColumn(`image_b_id`))
  await knex.schema.alterTable(`similar_pair_feedback`, table => table.dropColumn(`image_a_id`))
  await knex.raw('alter table `similar_pair_feedback` add column `image_id_a` integer not null references `image`(`id`)')
  await knex.raw('alter table `similar_pair_feedback` add column `image_id_b` integer not null references `image`(`id`)')
}
