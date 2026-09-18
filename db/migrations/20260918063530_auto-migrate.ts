import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('similar_pair_comparison'))) {
    await knex.schema.createTable('similar_pair_comparison', table => {
      table.increments('id')
      table.integer('project_id').unsigned().notNullable().references('project.id')
      table.integer('user_id').unsigned().notNullable().references('user.id')
      table.integer('pair_hi_a_id').unsigned().notNullable().references('image.id')
      table.integer('pair_hi_b_id').unsigned().notNullable().references('image.id')
      table.integer('pair_lo_a_id').unsigned().notNullable().references('image.id')
      table.integer('pair_lo_b_id').unsigned().notNullable().references('image.id')
      table.integer('hi_more_similar').notNullable()
      table.integer('created_at').notNullable()
    })
  }
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('similar_pair_comparison')
}
