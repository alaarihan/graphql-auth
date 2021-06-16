import { GraphQLSchema } from 'graphql'
import NodeCache from 'node-cache'
import { getRoleSchema } from '../roleSchema'
export const roleSchemaCache = new NodeCache()

export async function getRoleSchemaCache(schema: GraphQLSchema, role): Promise<GraphQLSchema> {
  if (roleSchemaCache.get(role) === undefined) {
    const roleSchema = await getRoleSchema(schema, role)
    roleSchemaCache.set(role, roleSchema)
  }

  return roleSchemaCache.get(role)
}
