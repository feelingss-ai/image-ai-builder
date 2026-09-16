import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('similar_pair_feedback'))) {
    await knex.schema.createTable('similar_pair_feedback', table => {
      table.increments('id')
      table.integer('project_id').unsigned().notNullable().references('project.id')
      table.integer('image_id_a').unsigned().notNullable().references('image.id')
      table.integer('image_id_b').unsigned().notNullable().references('image.id')
      table.integer('user_id').unsigned().notNullable().references('user.id')
      table.integer('is_similar').notNullable()
      table.integer('created_at').notNullable()
    })
  }
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('similar_pair_feedback')
}
