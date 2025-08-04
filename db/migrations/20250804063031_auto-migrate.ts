import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('image_bounding_box'))) {
    await knex.schema.createTable('image_bounding_box', table => {
      table.increments('id')
      table.integer('image_id').unsigned().notNullable().references('image.id')
      table.integer('user_id').unsigned().notNullable().references('user.id')
      table.integer('image_label_id').unsigned().notNullable().references('image_label.id')
      table.specificType('x', 'real').notNullable()
      table.specificType('y', 'real').notNullable()
      table.specificType('height', 'real').notNullable()
      table.specificType('width', 'real').notNullable()
      table.specificType('rotate', 'real').notNullable()
      table.timestamps(false, true)
    })
  }
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('image_bounding_box')
}
