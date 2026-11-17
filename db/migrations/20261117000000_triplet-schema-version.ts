import { Knex } from 'knex'

// The triplet annotation question changed from "which pair is the most
// similar?" to "which one is the most different?". The stored numbers
// mean different things under the two schemes, so every row records
// which scheme it follows.
//
// A NULL schema_version means the row predates the change and follows
// version 1 ("which pair is the most similar").
// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('similar_triplet', 'schema_version'))) {
    await knex.schema.alterTable('similar_triplet', table => {
      table.integer('schema_version').nullable()
    })
  }
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('similar_triplet', 'schema_version')) {
    await knex.schema.alterTable('similar_triplet', table => {
      table.dropColumn('schema_version')
    })
  }
}