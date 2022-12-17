import { GraphQLSchema } from 'graphql'
import {
  FilterInputObjectFields,
  FilterObjectFields,
  FilterRootFields,
  FilterTypes,
  PruneSchema,
  TransformEnumValues,
} from '@graphql-tools/wrap'
import { applySchemaTransforms } from '@graphql-tools/delegate'
import { getSchema, getDMMF} from '@prisma/internals'

import pluralize from 'pluralize'
import options from './options'
import { getRolePerms } from './common/rolePerms'

let dmmf = null as any
const queryMap = options.queryMap

export async function getRoleSchema(schema: GraphQLSchema, role) {
  const dmmfSchema = await getSchema()
  dmmf = await getDMMF({
    datamodel: dmmfSchema,
  })
  const perms = (await getRolePerms(role)) || []
  const schemaFilters = getRoleSchemaTransformations(perms)
  const modSchema = applySchemaTransforms(schema, {
    schema,
    transforms: [
      new FilterTypes((type) => {
        return (
          !(
            type.constructor.name === 'GraphQLObjectType' &&
            schemaFilters.types.includes(type.name)
          ) &&
          !(
            type.constructor.name === 'GraphQLInputObjectType' &&
            schemaFilters.inputs.includes(type.name)
          )
        )
      }),
      new FilterRootFields((operationName, fieldName, fieldConfig) => {
        return (
          operationName === 'Subscription' ||
          (((fieldConfig.extensions?.preventRoles === undefined &&
            fieldConfig.extensions?.allowRoles === undefined) ||
            (fieldConfig.extensions?.preventRoles !== undefined &&
              !fieldConfig.extensions?.preventRoles?.includes(role)) ||
            fieldConfig.extensions?.allowRoles?.includes(role)) &&
            !schemaFilters.rootFields.includes(fieldName))
        )
      }),
      new FilterRootFields((operationName, fieldName, fieldConfig) => {
        return (
          operationName !== 'Subscription' ||
          ((fieldConfig.extensions?.allowRoles === undefined ||
            fieldConfig.extensions?.allowRoles?.includes(role)) &&
            !schemaFilters.rootSubscriptionFields.includes(fieldName))
        )
      }),
      new FilterObjectFields((typeName, fieldName, fieldConfig) => {
        return (
          !schemaFilters.objectFields.some(
            (item) =>
              item.model === typeName && item.fields.includes(fieldName),
          ) &&
          !schemaFilters.outputFields.some(
            (item) =>
              item.outputs.includes(typeName) &&
              item.fields.includes(fieldName),
          )
        )
      }),
      new FilterInputObjectFields((typeName, fieldName, inputFieldConfig) => {
        return !schemaFilters.inputFields.some(
          (item) =>
            item.inputs.includes(typeName) && item.fields.includes(fieldName),
        )
      }),
      new TransformEnumValues((typeName, enumValue, enumValueConfig) => {
        let newEnumValue = undefined
        const isFilteredValue = schemaFilters.objectFields.some(
          (item) =>
            `${item.model}ScalarFieldEnum` === typeName &&
            item.fields.includes(enumValue),
        )

        if (isFilteredValue) {
          newEnumValue = null
        }
        return newEnumValue
      }),
      new PruneSchema(),
    ],
  })
  return modSchema
}
export type SchemaTransformations = {
  types?: String[]
  inputs?: String[]
  rootFields?: String[]
  rootSubscriptionFields?: String[]
  objectFields?: ModelFields[]
  inputFields?: InputsFields[]
  outputFields?: outputFields[]
}

export class PermTypesModels {
  read: String[]
  create: String[]
  update: String[]
  delete: String[]
}

export type ModelFieldsByPermType = {
  read: ModelFields[]
  create: ModelFields[]
  update: ModelFields[]
  delete: ModelFields[]
}

export type ModelFields = {
  model: String
  fields: String[]
  ops?: Object
  objectFieldsOps?: Object
}

export type InputsFields = {
  inputs: String[]
  fields: String[]
}
export type outputFields = {
  outputs: String[]
  fields: String[]
}

function getRoleSchemaTransformations(perms): SchemaTransformations {
  const transformations: SchemaTransformations = {
    types: [],
    rootFields: [],
    rootSubscriptionFields: [],
    inputs: [],
    objectFields: [],
    inputFields: [],
    outputFields: [],
  }
  try {
    const filteredModelsFields = getFilteredModelsFields(perms)
    const filteredModels = getFilteredModels(perms)
    const filteredSubscriptions = getFilteredSubscriptions(perms)
    transformations.types = transformations.types.concat(
      filteredModels,
      filteredSubscriptions,
    )

    const filteredModelsOpsRootFields =
      getFilteredModelsOpsRootFields(filteredModelsFields)
    const filteredRootFields = [
      ...getFilteredRootFieldsFromModels(filteredModels),
      ...getFilteredRootFields(perms, filteredModels),
      ...filteredModelsOpsRootFields,
    ]
    transformations.rootFields =
      transformations.rootFields.concat(filteredRootFields)
    const filteredSubscriptionsRootOps =
      getFilteredSubscriptionsRootFields(filteredModelsFields)
    transformations.rootSubscriptionFields =
      transformations.rootSubscriptionFields.concat(
        filteredSubscriptionsRootOps,
      )

    const filteredInputs = [
      ...getFilteredInputsFromModels(filteredModels),
      ...getFilteredInputs(perms),
    ]
    transformations.inputs = transformations.inputs.concat(filteredInputs)

    transformations.objectFields = transformations.objectFields.concat(
      filteredModelsFields.read,
    )

    const filteredOutputsFields =
      getFilteredOutputTypesFields(filteredModelsFields)
    transformations.outputFields = transformations.outputFields.concat(
      filteredOutputsFields,
    )

    const filteredInputsOpsFields = getFilteredInputsOpsFields(perms)
    const filteredInputsFields = getFilteredInputsFields(filteredModelsFields)
    transformations.inputFields = transformations.inputFields.concat(
      filteredInputsFields,
      filteredInputsOpsFields,
    )
  } catch (err) {
    console.log(err)
  }
  return transformations
}

function getFilteredModels(perms): String[] {
  const allowedModels: String[] = perms.map((item) => item.model)
  const filteredModels: String[] = dmmf.datamodel.models
    .filter((model) => !allowedModels.includes(model.name))
    .map((item) => item.name)
  return filteredModels
}

// Just the rest of the fields that haven't removed when removing the type
function getFilteredRootFieldsFromModels(filteredModels): String[] {
  let filteredRootFields: String[] = []
  filteredModels.forEach((item) => {
    filteredRootFields = filteredRootFields.concat([
      queryMap.createMany(item),
      queryMap.deleteMany(item),
      queryMap.updateMany(item),
      queryMap.aggregate(item),
      queryMap.count(item),
    ])
  })
  return filteredRootFields
}

function getFilteredRootFields(perms, filteredModels): String[] {
  const modelsPerms = getFilteredModelsByPermType(perms)
  let filteredRootFields = []

  filteredRootFields = [
    ...getModelsFilteredOperationsByPermType(
      modelsPerms.read,
      'READ',
      filteredModels,
    ),
    ...getModelsFilteredOperationsByPermType(
      modelsPerms.create,
      'CREATE',
      filteredModels,
    ),
    ...getModelsFilteredOperationsByPermType(
      modelsPerms.update,
      'UPDATE',
      filteredModels,
    ),
    ...getModelsFilteredOperationsByPermType(
      modelsPerms.delete,
      'DELETE',
      filteredModels,
    ),
  ]
  return filteredRootFields
}

function getFilteredModelsFields(perms): ModelFieldsByPermType {
  const allowedModelsPerms = getAllowedModelsPerms(perms)
  const dataModels = dmmf.datamodel.models
  let filteredModelsFields: ModelFieldsByPermType = {
    read: [],
    create: [],
    update: [],
    delete: [],
  }
  for (const type in allowedModelsPerms) {
    dataModels.forEach((model) => {
      const modelFields = allowedModelsPerms[type].find(
        (item) => item.model === model.name,
      )
      if (modelFields) {
        const modelFilteredFields: String[] = model.fields
          .filter((field) => !modelFields.fields.includes(field.name))
          .map((item) => item.name)

        const opName = type === 'read' ? 'find' : type
        let modelFilteredOps = []
        if (
          Array.isArray(modelFields.ops) &&
          !modelFields.ops.includes(`${opName}Many`)
        ) {
          modelFilteredOps.push(`${opName}Many`)
        }
        if (
          Array.isArray(modelFields.ops) &&
          !modelFields.ops.includes(`${opName}One`)
        ) {
          modelFilteredOps.push(`${opName}One`)
        }
        if (
          type === 'update' &&
          Array.isArray(modelFields.ops) &&
          !modelFields.ops.includes(`upsertOne`)
        ) {
          modelFilteredOps.push(`upsertOne`)
        }
        if (type === 'read') {
          modelFilteredOps = modelFilteredOps.concat(
            [
              'aggregate',
              'count',
              'subscription',
              'findFirst',
              'findUnique',
            ].filter((i) => !modelFields.ops.includes(i)),
          )
        }

        let modelFilteredObjectFieldsOps = {}
        if (type === 'update' || type === 'create') {
          const modelObjectFields = model.fields.filter(
            (item) => item.kind === 'object',
          )

          modelObjectFields.forEach((item) => {
            const field = modelFields.objectFieldsOps
              ? modelFields.objectFieldsOps[item.name] || []
              : []
            modelFilteredObjectFieldsOps[item.name] = {
              model: item.type,
              ops: ['connect', 'disconnect', 'set', 'connectOrCreate'].filter(
                (i) => !field?.includes(i),
              ),
            }
          })
        }
        filteredModelsFields[type] = filteredModelsFields[type].concat({
          model: model.name,
          fields: modelFilteredFields,
          ops: modelFilteredOps,
          objectFieldsOps: modelFilteredObjectFieldsOps,
        })
      }
    })
  }
  return filteredModelsFields
}

function getFilteredSubscriptions(perms) {
  const allowedModelsPerms = getFilteredModelsByPermType(perms)
  const filteredSubscriptions = dmmf.datamodel.models
    .filter((model) => allowedModelsPerms.read.includes(model.name))
    .map((item) => `${item.name}Subscription`)
  return filteredSubscriptions
}

function getFilteredInputsFields(modelsFields: ModelFieldsByPermType) {
  const inputsFields = []
  for (const type in modelsFields) {
    modelsFields[type].forEach((model) => {
      if (type === 'read') {
        inputsFields.push({
          inputs: [
            `${model.model}WhereInput`,
            `${model.model}OrderByInput`,
            `${model.model}ScalarWhereInput`,
          ],
          fields: model.fields,
        })
      } else if (type === 'create') {
        const nestedInputs = dmmf.schema.inputObjectTypes.prisma
          .filter((item) =>
            [
              `${model.model}CreateWithout`,
              `${model.model}UncheckedCreateWithout`,
            ].some((someItem) => item.name.startsWith(someItem)),
          )
          .map((item) => item.name)
        inputsFields.push({
          inputs: [...nestedInputs, `${model.model}CreateInput`],
          fields: model.fields,
        })

        if (model.ops?.includes('createMany')) {
          // Filter nested "createMany"
          const nestedUpdateFields = dmmf.schema.inputObjectTypes.prisma
            .filter((item) => {
              return [
                `${model.model}CreateMany`,
                `${model.model}UpdateManyWithout`,
              ].some((someItem) => item.name.startsWith(someItem))
            })
            .map((item) => item.name)
          inputsFields.push({
            inputs: nestedUpdateFields,
            fields: ['createMany'],
          })
        }
      } else if (type === 'update') {
        const nestedInputs = dmmf.schema.inputObjectTypes.prisma
          .filter((item) =>
            [
              `${model.model}UpdateWithout`,
              `${model.model}UncheckedUpdateWithout`,
              `${model.model}UpdateOneRequired`,
            ].some((someItem) => item.name.startsWith(someItem)),
          )
          .map((item) => item.name)
        inputsFields.push({
          inputs: [...nestedInputs, `${model.model}UpdateInput`],
          fields: model.fields,
        })
        if (model.ops?.includes('updateMany')) {
          // Filter nested "updateMany"
          const nestedUpdateFields = dmmf.schema.inputObjectTypes.prisma
            .filter((item) => {
              const opName = `${model.model}UpdateManyWithout`
              return item.name.startsWith(opName)
            })
            .map((item) => item.name)
          inputsFields.push({
            inputs: nestedUpdateFields,
            fields: ['updateMany'],
          })
        }
      } else if (type === 'delete') {
        if (model.ops?.includes('deleteMany')) {
          // Filter nested "deleteMany"
          const nestedUpdateFields = dmmf.schema.inputObjectTypes.prisma
            .filter((item) => {
              const opName = `${model.model}UpdateManyWithout`
              return item.name.startsWith(opName)
            })
            .map((item) => item.name)
          inputsFields.push({
            inputs: nestedUpdateFields,
            fields: ['deleteMany'],
          })
        }
      }
    })
  }
  dmmf.datamodel.models.forEach((model) => {
    // Remove the extra input fields that haven't been removed by removing other inputs
    if (
      !modelsFields.delete.some((someItem) => model.name === someItem.model)
    ) {
      const inputs = dmmf.schema.inputObjectTypes.prisma
        .filter((item) =>
          [
            `${model.name}UpdateManyWithout`,
            `${model.name}UpdateOneWithout`,
          ].some((someItem) => item.name.startsWith(someItem)),
        )
        .map((item) => item.name)
      inputsFields.push({
        inputs: inputs,
        fields: ['delete', 'deleteMany'],
      })
    }
  })
  return inputsFields
}

function getFilteredOutputTypesFields(modelsFields: ModelFieldsByPermType) {
  const outputFields = []
  modelsFields.read.forEach((model) => {
    outputFields.push({
      outputs: [
        `${model.model}CountAggregateOutputType`,
        `${model.model}AvgAggregateOutputType`,
        `${model.model}SumAggregateOutputType`,
        `${model.model}MinAggregateOutputType`,
        `${model.model}MaxAggregateOutputType`,
      ],
      fields: model.fields,
    })
  })

  return outputFields
}

function getFilteredInputsFromModels(filteredModels: String[]): String[] {
  const filteredInputs: String[] = []
  filteredModels.forEach((type) => {
    dmmf.schema.inputObjectTypes.prisma
      .filter(
        (item) =>
          [
            `${type}UpdateMany`,
            `${type}UpdateOne`,
            `${type}CreateNestedMany`,
            `${type}CreateNestedOne`,
          ].some((someItem) => item.name.startsWith(someItem)) ||
          [
            `${type}WhereInput`,
            `${type}WhereUniqueInput`,
            `${type}OrderByInput`,
            `${type}ListRelationFilter`,
          ].includes(item.name),
      )
      .forEach((item) => {
        filteredInputs.push(item.name)
      })
  })
  return filteredInputs
}

function getFilteredInputs(perms): String[] {
  const modelsPerms = getFilteredModelsByPermType(perms)
  let filteredInputs = []
  for (const type in modelsPerms) {
    dmmf.datamodel.models.forEach((model) => {
      if (modelsPerms[type].includes(model.name)) {
        if (type === 'create') {
          const inputs = dmmf.schema.inputObjectTypes.prisma
            .filter((item) =>
              [
                `${model.name}CreateWithout`,
                `${model.name}UncheckedCreateWithout`,
                `${model.name}CreateMany`,
                `${model.name}CreateOrConnectWithout`,
                `${model.name}UpsertWithWhere`,
                `${model.name}UpsertWithout`,
              ].some((someItem) => item.name.startsWith(someItem)),
            )
            .map((item) => item.name)
          filteredInputs = filteredInputs.concat(inputs)
        } else if (type === 'update') {
          const inputs = dmmf.schema.inputObjectTypes.prisma
            .filter((item) =>
              [
                `${model.name}UncheckedUpdateWithout`,
                `${model.name}UpdateWithWhere`,
                `${model.name}UpdateManyWithWhere`,
                `${model.name}UpsertWithWhere`,
                `${model.name}UpsertWithout`,
              ].some((someItem) => item.name.startsWith(someItem)),
            )
            .map((item) => item.name)
          filteredInputs = filteredInputs.concat(inputs)
        }
      }
    })
  }
  return filteredInputs
}

function getAllowedModelsPermByType(perms, type): ModelFields[] {
  const allowedPerm = perms
    .filter((item) => item.type === type)
    .map((perm) => {
      let fields = perm.def?.columns || []
      const setFields = perm.def?.set || {}
      fields = fields.filter(
        (column) => !Object.keys(setFields).includes(column),
      )
      return {
        model: perm.model,
        fields,
        ops: perm.def?.ops || [],
        objectFieldsOps: perm.def?.objectFieldsOps || {},
      }
    })
  return allowedPerm
}

function getAllowedModelsPerms(perms): ModelFieldsByPermType {
  return {
    read: getAllowedModelsPermByType(perms, 'READ'),
    create: getAllowedModelsPermByType(perms, 'CREATE'),
    update: getAllowedModelsPermByType(perms, 'UPDATE'),
    delete: getAllowedModelsPermByType(perms, 'DELETE'),
  }
}

function getFilteredModelsByPermType(perms): PermTypesModels {
  const allowedModelsPerms = getAllowedModelsPerms(perms)
  const dataModels = dmmf.datamodel.models
  const filteredModelsPerms = new PermTypesModels()
  for (const type in allowedModelsPerms) {
    filteredModelsPerms[type] = dataModels
      .filter(
        (model) =>
          !allowedModelsPerms[type].some((item) => item.model === model.name),
      )
      .map((item) => item.name)
  }
  return filteredModelsPerms
}

function getModelsFilteredOperationsByPermType(
  models,
  type,
  filteredModels,
): String[] {
  let filteredFields: String[] = []

  models
    .filter((model) => !filteredModels.includes(model))
    .forEach((item) => {
      if (type === 'READ') {
        filteredFields = filteredFields.concat([
          queryMap.findUnique(item),
          queryMap.findFirst(item),
          queryMap.findMany(item),
          queryMap.aggregate(item),
          queryMap.count(item),
        ])
      } else if (type === 'CREATE') {
        filteredFields = filteredFields.concat([
          queryMap.createMany(item),
          queryMap.upsertOne(item),
          queryMap.createOne(item),
        ])
      } else if (type === 'UPDATE') {
        filteredFields = filteredFields.concat([
          queryMap.updateOne(item),
          queryMap.upsertOne(item),
          queryMap.updateMany(item),
        ])
      } else if (type === 'DELETE') {
        filteredFields = filteredFields.concat([
          queryMap.deleteOne(item),
          queryMap.deleteMany(item),
        ])
      }
    })
  return filteredFields
}

function getFilteredInputsOpsFields(perms) {
  const allowedModelsPerms = getFilteredModelsFields(perms)
  // Remove "connect", "disconnect", "set" and "connectOrCreate" by object fields perms
  const inputsFields = []
  for (const type in allowedModelsPerms) {
    if (type === 'update') {
      allowedModelsPerms[type].forEach((item) => {
        const objectFieldsOps = item.objectFieldsOps
        if (objectFieldsOps) {
          for (const field in objectFieldsOps) {
            if (objectFieldsOps[field]?.ops?.length) {
              const inputs = dmmf.schema.inputObjectTypes.prisma
                .filter((input) =>
                  [
                    `${objectFieldsOps[field].model}UpdateManyWithout${item.model}Input`,
                    `${objectFieldsOps[field].model}UpdateOneWithout${item.model}Input`,
                    `${objectFieldsOps[field].model}UpdateOneRequiredWithout${item.model}Input`,
                    `${
                      objectFieldsOps[field].model
                    }UpdateManyWithout${pluralize(item.model)}Input`,
                    `${objectFieldsOps[field].model}UpdateOneWithout${pluralize(
                      item.model,
                    )}Input`,
                    `${
                      objectFieldsOps[field].model
                    }UpdateOneRequiredWithout${pluralize(item.model)}Input`,
                  ].some((someItem) => input.name.startsWith(someItem)),
                )
                .map((item) => item.name)
              inputsFields.push({
                inputs: inputs,
                fields: objectFieldsOps[field].ops,
              })
            }
          }
        }
      })
    } else if (type === 'create') {
      allowedModelsPerms[type].forEach((item) => {
        const objectFieldsOps = item.objectFieldsOps
        if (objectFieldsOps) {
          for (const field in objectFieldsOps) {
            if (objectFieldsOps[field]?.ops?.length) {
              objectFieldsOps[field]
              const inputs = dmmf.schema.inputObjectTypes.prisma
                .filter((input) =>
                  [
                    `${objectFieldsOps[field].model}CreateNestedManyWithout${item.model}Input`,
                    `${objectFieldsOps[field].model}CreateNestedOneWithout${item.model}Input`,
                    `${
                      objectFieldsOps[field].model
                    }CreateNestedManyWithout${pluralize(item.model)}Input`,
                    `${
                      objectFieldsOps[field].model
                    }CreateNestedOneWithout${pluralize(item.model)}Input`,
                  ].some((someItem) => input.name.startsWith(someItem)),
                )
                .map((item) => item.name)
              inputsFields.push({
                inputs: inputs,
                fields: objectFieldsOps[field].ops,
              })
            }
          }
        }
      })
    }
  }
  return inputsFields
}

function getFilteredModelsOpsRootFields(filteredModelsFields) {
  // Remove "findMany",  "createMany", "updateMany", "deleteMany" and "aggregate" by perms ops
  const rootFields = []
  for (const type in filteredModelsFields) {
    filteredModelsFields[type].forEach((item) => {
      const itemOps = item.ops
      const opName = type === 'read' ? 'find' : type
      if (itemOps.includes(`${opName}Many`)) {
        rootFields.push(queryMap[`${opName}Many`](item.model))
      }
      if (type === 'read') {
        if (itemOps.includes('aggregate')) {
          rootFields.push(queryMap.aggregate(item.model))
        }
        if (itemOps.includes('count')) {
          rootFields.push(queryMap.count(item.model))
        }
        if (itemOps.includes('findFirst')) {
          rootFields.push(queryMap.findFirst(item.model))
        }
        if (itemOps.includes('findUnique')) {
          rootFields.push(queryMap.findUnique(item.model))
        }
      } else {
        if (itemOps.includes(`${opName}One`)) {
          rootFields.push(queryMap[`${opName}One`](item.model))
        }
        if (
          itemOps.includes(`upsertOne`) &&
          !rootFields.includes(queryMap.upsertOne(item.model))
        ) {
          rootFields.push(queryMap.upsertOne(item.model))
        }
      }
    })
  }
  return rootFields
}

function getFilteredSubscriptionsRootFields(filteredModelsFields) {
  // Remove "subscription" by perms ops
  const rootFields = []
  filteredModelsFields['read'].forEach((item) => {
    const itemOps = item.ops
    if (itemOps.includes('subscription')) {
      rootFields.push(queryMap.subscription(item.model))
    }
  })

  return rootFields
}
