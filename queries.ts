const { dmmf } = require('@prisma/client')
import {
  GraphQLString,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLBoolean,
  GraphQLInputObjectType,
} from 'graphql'

export const SimpleStringFilter = new GraphQLInputObjectType({
  name: 'SimpleStringFilter',
  fields: () => ({
    equals: {
      type: GraphQLString,
    },
    in: {
      type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
    },
    notIn: {
      type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
    },
  }),
})
export const ModelWhereInput = new GraphQLInputObjectType({
  name: 'ModelWhereInput',
  fields: () => ({
    name: { type: SimpleStringFilter },
  }),
})
export const ModelFieldWhereInput = new GraphQLInputObjectType({
  name: 'ModelFieldWhereInput',
  fields: () => ({
    name: { type: SimpleStringFilter },
    kind: { type: GraphQLString },
    type: { type: GraphQLString },
  }),
})
export const ModelField = new GraphQLObjectType({
  name: 'ModelField',
  fields: () => ({
    name: {
      type: new GraphQLNonNull(GraphQLString),
    },
    type: {
      type: new GraphQLNonNull(GraphQLString),
    },
    kind: {
      type: new GraphQLNonNull(GraphQLString),
    },
  }),
})
export const Model = new GraphQLObjectType({
  name: 'Model',
  fields: () => ({
    name: {
      type: new GraphQLNonNull(GraphQLString),
    },
    fields: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ModelField))),
      args: {
        where: { type: ModelFieldWhereInput },
      },
      async resolve(root, args, ctx) {
        let fields = root.fields || []
        if (args.where?.name?.equals) {
          fields = fields.filter(
            (field) => field.name === args.where.name.equals,
          )
        }
        if (args.where?.name?.in) {
          fields = fields.filter((field) =>
            args.where.name.in.includes(field.name),
          )
        }
        if (args.where?.name?.notIn) {
          fields = fields.filter(
            (field) => !args.where.name.in.includes(field.name),
          )
        }
        if (args.where?.kind) {
          fields = fields.filter((field) => field.kind === args.where.kind)
        }
        if (args.where?.type) {
          fields = fields.filter((field) => field.type === args.where.type)
        }
        return fields
      },
    },
  }),
})

export const authQueries = {
  findManyModel: {
    extensions: { allowRoles: ['ADMIN'] },
    type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(Model))),
    args: {
      where: { type: ModelWhereInput },
    },
    async resolve(_root, args, ctx) {
      let models = dmmf.datamodel.models
      if (args.where?.name?.equals) {
        models = models.filter((model) => model.name === args.where.name.equals)
      }
      if (args.where?.name?.in) {
        models = models.filter((model) =>
          args.where.name.in.includes(model.name),
        )
      }
      if (args.where?.name?.notIn) {
        models = models.filter(
          (model) => !args.where.name.in.includes(model.name),
        )
      }
      return models
    },
  },
  findUserRoles: {
    extensions: { allowRoles: ['ADMIN'] },
    type: new GraphQLNonNull(
      new GraphQLList(new GraphQLNonNull(GraphQLString)),
    ),

    async resolve(_root, args, ctx) {
      return dmmf.schema.enumTypes.model.find(
        (item) => item.name === 'UserRole',
      )?.values
    },
  },
}
