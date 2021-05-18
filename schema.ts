import { authMutations } from './mutations'
import { GraphQLSchema, GraphQLObjectType, GraphQLString } from 'graphql'

export const authSchema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: 'Query',
    fields: () => ({
      me: {
        type: GraphQLString,
      },
    }),
  }),
  mutation: new GraphQLObjectType({
    name: 'Mutation',
    fields: authMutations,
  }),
})
