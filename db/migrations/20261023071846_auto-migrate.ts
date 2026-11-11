import { Knex } from 'knex'

// stores the triplets the user annotated with the relation between
// their three images (which two are the most similar, or all three are
// about equally similar)
// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('similar_triplet'))) {
    await knex.schema.createTable('similar_triplet', table => {
      table.increments('id')
      table.integer('project_id').unsigned().notNullable().references('project.id')
      table.integer('user_id').unsigned().notNullable().references('user.id')
      table.integer('image_a_id').unsigned().notNullable().references('image.id')
      table.integer('image_b_id').unsigned().notNullable().references('image.id')
      table.integer('image_c_id').unsigned().notNullable().references('image.id')
      table.integer('relation').notNullable()
      table.integer('created_at').notNullable()
    })
  }
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('similar_triplet')
}
