import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('keypoint_template'))) {
    await knex.schema.createTable('keypoint_template', table => {
      table.increments('id')
      table.integer('project_id').unsigned().notNullable().references('project.id')
      table.text('title').notNullable()
      table.text('names').notNullable()
      table.text('edges').notNullable()
      table.text('flip_idx').nullable()
      table.timestamps(false, true)
    })
  }
  if (!(await knex.schema.hasColumn('label', 'keypoint_template_id'))) {
    await knex.raw('alter table `label` add column `keypoint_template_id` integer null references `keypoint_template`(`id`)')
  }

  if (!(await knex.schema.hasTable('image_keypoint'))) {
    await knex.schema.createTable('image_keypoint', table => {
      table.increments('id')
      table.integer('box_id').unsigned().notNullable().references('image_bounding_box.id')
      table.integer('user_id').unsigned().notNullable().references('user.id')
      table.integer('idx').notNullable()
      table.specificType('x', 'real').notNullable()
      table.specificType('y', 'real').notNullable()
      table.integer('visibility').notNullable()
      table.timestamps(false, true)
      table.unique(['box_id', 'user_id', 'idx'])
    })
  }

  if (!(await knex.schema.hasTable('image_keypoint_confirmation'))) {
    await knex.schema.createTable('image_keypoint_confirmation', table => {
      table.increments('id')
      table.integer('image_id').unsigned().notNullable().references('image.id')
      table.integer('user_id').unsigned().notNullable().references('user.id')
      table.integer('label_id').unsigned().notNullable().references('label.id')
      table.timestamps(false, true)
    })
  }
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('image_keypoint_confirmation')
  await knex.schema.dropTableIfExists('image_keypoint')
  await knex.schema.alterTable(`label`, table => table.dropColumn(`keypoint_template_id`))
  await knex.schema.dropTableIfExists('keypoint_template')
}
