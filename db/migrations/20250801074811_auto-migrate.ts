import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('project'))) {
    await knex.schema.createTable('project', table => {
      table.increments('id')
      table.text('title').notNullable()
      table.integer('creator_id').unsigned().notNullable().references('user.id')
      table.integer('label_id').unsigned().notNullable().references('label.id')
      table.timestamps(false, true)
    })
  }

  await knex.raw('alter table `label` add column `project_id` integer null references `project`(`id`)')
  await knex.raw('alter table `image` add column `project_id` integer null references `project`(`id`)')

  if (!(await knex.schema.hasTable('project_member'))) {
    await knex.schema.createTable('project_member', table => {
      table.increments('id')
      table.integer('project_id').unsigned().notNullable().references('project.id')
      table.integer('user_id').unsigned().notNullable().references('user.id')
      table.timestamps(false, true)
    })
  }
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('project_member')
  await knex.schema.alterTable(`image`, table => table.dropColumn(`project_id`))
  await knex.schema.alterTable(`label`, table => table.dropColumn(`project_id`))
  await knex.schema.dropTableIfExists('project')
}
