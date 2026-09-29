import { Knex } from 'knex'

// Adds label.mutually_exclusive: when set on a PARENT label, all its children
// become pairwise mutually exclusive (only one child may be yes per image).
// The group is expanded into the conflict map by getProjectConflictMap, so
// every consumer (annotation cascade, auto-label, import cascade, UI
// disabling) picks it up without changes. NULL/false = independent labels.
// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  await knex.raw('alter table `label` add column `mutually_exclusive` boolean null')
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.raw('alter table `label` drop column `mutually_exclusive`')
}