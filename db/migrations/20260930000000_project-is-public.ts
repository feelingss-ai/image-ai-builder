import { Knex } from 'knex'

// Adds project.is_public: public projects are viewable by anyone (including
// logged-out visitors) and will appear in the public dataset gallery
// (tasks/public-dataset-gallery.md). NULL/false = private (members only,
// current behaviour). Default private, opt-in public; only the owner/admin
// can flip it.
// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  await knex.raw('alter table `project` add column `is_public` boolean null')
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.raw('alter table `project` drop column `is_public`')
}