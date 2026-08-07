import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('image_bounding_box_confirmation'))) {
    await knex.schema.createTable('image_bounding_box_confirmation', table => {
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
  await knex.schema.dropTableIfExists('image_bounding_box_confirmation')
}
