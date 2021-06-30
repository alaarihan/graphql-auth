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
import { SimpleStringFilter } from '../../models/inputs'

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
    isList: { type: GraphQLBoolean },
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
    isList: {
      type: new GraphQLNonNull(GraphQLBoolean),
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
        if (args.where?.isList) {
          fields = fields.filter((field) => field.isList === args.where.isList)
        }
        return fields
      },
    },
  }),
})

export const MePaypload = new GraphQLObjectType({
  name: 'MePaypload',
  fields: () => ({
    id: {
      type: GraphQLInt,
    },
    role: {
      type: new GraphQLNonNull(GraphQLString),
    },
  }),
})

export const authQueries = {
  me: {
    type: new GraphQLNonNull(MePaypload),
    async resolve(_root, args, ctx) {
      return ctx.user
    },
  },
  findManyModel: {
    extensions: { allowRoles: ['ROOT'] },
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
    extensions: { allowRoles: ['ROOT'] },
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
