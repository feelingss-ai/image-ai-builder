import { Knex } from 'knex'

// stores the metadata of the shared similarity model trained for a
// project (the model weights themselves live in
// saved_models/project-{id}/relation/).
// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('relation_model'))) {
    await knex.schema.createTable('relation_model', table => {
      table.increments('id')
      table.integer('project_id').unsigned().notNullable().references('project.id')
      table.integer('label_id').unsigned().nullable().references('label.id')
      table.text('model_version').notNullable()
      table.text('spec').notNullable()
      table.integer('trained_at').notNullable()
      table.timestamps(false, true)
    })
  }
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('relation_model')
}
