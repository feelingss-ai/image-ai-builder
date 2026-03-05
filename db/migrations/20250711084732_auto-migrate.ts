import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('training_stats'))) {
    await knex.schema.createTable('training_stats', table => {
      table.increments('id')
      table.integer('user_id').unsigned().notNullable().references('user.id')
      table.integer('epoch').notNullable()
      table.specificType('learning_rate', 'real').notNullable()
      table.specificType('train_accuracy', 'real').notNullable()
      table.specificType('train_loss', 'real').notNullable()
      table.specificType('val_accuracy', 'real').notNullable()
      table.specificType('val_loss', 'real').notNullable()
      table.timestamps(false, true)
    })
  }
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('training_stats')
}
