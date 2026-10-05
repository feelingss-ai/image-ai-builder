import { Knex } from 'knex'

// links a content report to the reported project (parsed from the report
// form's return_url when it points at /dataset?project=). Used by the admin
// review page to show/unlist the reported dataset.
// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  await knex.raw('alter table `content_report` add column `project_id` integer null')
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.raw('alter table `content_report` drop column `project_id`')
}