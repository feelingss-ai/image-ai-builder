import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('image_embedding', table => {
    table.dropUnique(['image_id'])
  })
  // alter type for `image_embedding`.`model_version`
  {
    await knex.raw('create temp table `image_embedding_temp` as select * from `image_embedding`')
    await knex.raw('delete from `image_embedding`')
    await knex.raw('alter table `image_embedding` drop column `model_version`')
    await knex.raw('alter table `image_embedding` add column `model_version` text not null')
    await knex.raw('insert into `image_embedding` select * from `image_embedding_temp`')
    await knex.raw('drop table `image_embedding_temp`')
  }

  if (!(await knex.schema.hasTable('embedding_weight'))) {
    await knex.schema.createTable('embedding_weight', table => {
      table.increments('id')
      table.integer('project_id').unsigned().notNullable().references('project.id')
      table.integer('label_id').unsigned().nullable().references('label.id')
      table.binary('vector').notNullable()
      table.text('source').notNullable()
      table.integer('trained_at').notNullable()
      table.timestamps(false, true)
    })
  }
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('embedding_weight')
  // alter type for `image_embedding`.`model_version`
  {
    await knex.raw('create temp table `image_embedding_temp` as select * from `image_embedding`')
    await knex.raw('delete from `image_embedding`')
    await knex.raw('alter table `image_embedding` drop column `model_version`')
    await knex.raw('alter table `image_embedding` add column `model_version` varchar(255) not null')
    await knex.raw('insert into `image_embedding` select * from `image_embedding_temp`')
    await knex.raw('drop table `image_embedding_temp`')
  }
  await knex.schema.alterTable('image_embedding', table => {
    table.unique(['image_id'])
  })
}
