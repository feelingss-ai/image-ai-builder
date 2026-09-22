import { Knex } from 'knex'

// Remember the last marked position of a keypoint so a deleted point can be
// restored by tapping its chip again (delete is undoable).
// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('image_keypoint', 'last_x'))) {
    await knex.schema.alterTable('image_keypoint', table => {
      table.specificType('last_x', 'real').nullable()
    })
  }
  if (!(await knex.schema.hasColumn('image_keypoint', 'last_y'))) {
    await knex.schema.alterTable('image_keypoint', table => {
      table.specificType('last_y', 'real').nullable()
    })
  }
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('image_keypoint', 'last_x')) {
    await knex.schema.alterTable('image_keypoint', table => {
      table.dropColumn('last_x')
    })
  }
  if (await knex.schema.hasColumn('image_keypoint', 'last_y')) {
    await knex.schema.alterTable('image_keypoint', table => {
      table.dropColumn('last_y')
    })
  }
}