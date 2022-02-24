const { dmmf } = require('@prisma/client')
import { merge } from 'lodash'
import { camelCase } from 'change-case'
import { AppContext } from '../../../context'
import { prisma } from '../../../prisma'
import { getRolePerms } from '../common/rolePerms'
import { flatten, unflatten } from 'flat'

export const acl = async (resolve, root, args, ctx, info) => {
  if (['Query', 'Mutation'].includes(info.path.typename)) {
    try {
      const ext = info.parentType.getFields()[info.fieldName].extensions
      if (!ext?.op || ctx.user?.role === 'ROOT')
        return resolve(root, args, ctx, info)
      return checkAcl(resolve, root, args, ctx, info, ext)
    } catch (e) {
      throw e
    }
  } else {
    return resolve(root, args, ctx, info)
  }
}

async function checkAcl(resolve, root, args, ctx: AppContext, info, ext) {
  const rolePerms = await getRolePerms(ctx.user.role)

  if (args.select) {
    args.select = await mergeNestedModelCheckWithWhere(args.select, ext)
  }

  if (['updateOne', 'findUnique'].includes(ext.op)) {
    await checkModelItemsExist(args.where, ctx, ext)
  }

  if (
    [
      'findMany',
      'findFirst',
      'aggregate',
      'count',
      'updateMany',
      'deleteMany',
    ].includes(ext.op)
  ) {
    args.where = await mergeModelCheckWithWhere(args.where, ext)
  }

  if (['updateOne', 'createOne'].includes(ext.op)) {
    args.data = await setPermValues(args.data, ext)
    await checkItemACL(args.data, ext)
    args.data = await checkNestedFieldsModelsACL(args.data, ext)
  } else if (ext.op === 'deleteOne') {
    await checkModelItemsExist(args.where, ctx, ext)
  } else if (ext.op === 'createMany') {
    for (let index = 0; index < args.data.length; index++) {
      args.data[index] = await setPermValuesOneLevel(args.data[index], ext)
      await checkItemACL(args.data[index], ext)
    }
  } else if (ext.op === 'updateMany') {
    args.data = await setPermValuesOneLevel(args.data, ext)
    await checkItemACL(args.data, ext)
  } else if (ext.op === 'upsertOne') {
    ext.permType = 'CREATE'
    args.create = await setPermValuesOneLevel(args.create, ext)
    await checkItemACL(args.create, ext)
    ext.permType = 'UPDATE'
    const modelPerm = modelPermByType(rolePerms, ext.model, ext.permType)
    if (modelPerm?.def?.check) {
      const itemExistsBeforeCheck = await itemsExist({}, args.update, ext.model)
      if (itemExistsBeforeCheck) {
        await checkModelItemsExist(args.update, ctx, ext)
      }
    }
    args.update = await setPermValuesOneLevel(args.update, ext)
    await checkItemACL(args.update, ext)
  }

  async function checkItem(check, item, ext, op = 'AND', relMod?) {
    const itemOps = [
      'create',
      'update',
      'delete',
      'upsert',
      'connectOrCreate',
      'connect',
      'disconnect',
      'set',
      'createMany',
      'updateMany',
      'deleteMany',
    ]
    for (const key in check) {
      if (item && item[key] !== undefined && typeof item[key] !== 'object') {
        const checkRes = await checkOp(check[key], item[key], ext, op)
        if (checkRes === false) {
          return false
        }
      } else if (
        typeof check[key] === 'object' &&
        ['AND', 'OR', 'NOT'].includes(key) &&
        typeof item === 'object'
      ) {
        const itemsChecks = []
        if (Object.keys(item).some((someKey) => itemOps.includes(someKey))) {
          const checkRes = await checkNestedOps(check, item, ext, op, relMod)
          if (checkRes === false) return false
        } else {
          for (let index = 0; index < check[key].length; index++) {
            const checkRes = await checkItem(check[key][index], item, ext, key)
            if (
              (key === 'AND' && checkRes === false) ||
              (key === 'NOT' && checkRes === true)
            )
              return false
            else if (key === 'OR') {
              itemsChecks.push(checkRes)
            }
          }
        }
        if (
          key === 'OR' &&
          itemsChecks.filter((i) => i === false).length === check[key].length
        ) {
          return false
        }
      } else if (
        typeof item === 'object' &&
        !['AND', 'OR', 'NOT', 'every', 'none', 'some', 'is', 'isNot'].includes(
          key,
        ) &&
        Object.keys(item).some((someKey) => itemOps.includes(someKey))
      ) {
        const checkRes = await checkNestedOps(check, item, ext, op, relMod)
        if (checkRes === false) return false
      } else if (
        typeof check[key] === 'object' &&
        ['some', 'every', 'none', 'is', 'isNot'].includes(key) &&
        typeof item === 'object'
      ) {
        const itemsChecks = []
        const checkRes = await checkItem(check[key], item, ext, key)
        if (
          (['every', 'is'].includes(key) && checkRes === false) ||
          (['none', 'isNot'].includes(key) && checkRes === true)
        )
          return false
        else if (key === 'some' && ext.permType === 'CREATE') {
          itemsChecks.push(checkRes)

          // Do some check
        }
      } else if (
        typeof check[key] === 'object' &&
        typeof item[key] === 'object'
      ) {
        const currentModel = relMod ? relMod : ext.model
        const relModel = getNestedFieldModelName(currentModel, key)
        const checkRes = await checkItem(
          check[key],
          item[key],
          ext,
          op,
          relModel,
        )
        if (checkRes === false) return false
      }
    }
    return true
  }

  async function checkOp(check, item, ext, itemOp) {
    const op = Object.keys(check)[0]
    check = check[op]
    if (
      (op === 'equals' && check === item) ||
      (op === 'contains' && item.includes(check)) ||
      (op === 'endsWith' && item.endsWith(check)) ||
      (op === 'startsWith' && item.startsWith(check)) ||
      (op === 'gt' && item > check) ||
      (op === 'gte' && item >= check) ||
      (op === 'lt' && item < check) ||
      (op === 'lte' && item <= check) ||
      (op === 'in' && check.includes(item)) ||
      (op === 'notIn' && !check.includes(item))
    )
      return true
    else if (op === 'not') {
      const res = await checkItem(check, item, ext, itemOp)
      if (res !== false) return false
    }
    return false
  }

  async function checkNestedOps(check, item, ext, op, relMod) {
    for (const k in item) {
      if (['connect', 'set', 'disconnect'].includes(k)) {
        if (k === 'disconnect' && typeof item[k] === 'boolean') {
          continue
        }
        const existingTtem = await itemsExist(check, item[k], relMod)
        if (!existingTtem) return false
      } else if (k === 'create') {
        if (!Array.isArray(item[k])) {
          const checkRes = await checkItem(check, item[k], ext, op)
          if (checkRes === false) return false
        } else {
          for (let index = 0; index < item[k].length; index++) {
            const checkRes = await checkItem(check, item[k][index], ext, op)
            if (checkRes === false) return false
          }
        }
      } else if (k === 'update') {
        if (!Array.isArray(item[k])) {
          const checkRes = await checkItem(check, item[k].data, ext, op)
          if (checkRes === false) return false
        } else {
          for (let index = 0; index < item[k].length; index++) {
            const checkRes = await checkItem(
              check,
              item[k][index].data,
              ext,
              op,
            )
            if (checkRes === false) return false
          }
        }
      } else if (k === 'connectOrCreate') {
        if (!Array.isArray(item[k])) {
          const checkRes = await checkItem(check, item[k].create, ext, op)
          if (checkRes === false) return false
        } else {
          for (let index = 0; index < item[k].length; index++) {
            const checkRes = await checkItem(
              check,
              item[k][index].create,
              ext,
              op,
            )
            if (checkRes === false) return false
          }
        }
      } else if (k === 'upsert') {
        if (!Array.isArray(item[k])) {
          ext.permType = 'CREATE'
          const checkCreateRes = await checkItem(check, item[k].create, ext, op)
          if (checkCreateRes === false) return false
          ext.permType = 'UPDATE'
          const checkUpdateRes = await checkItem(check, item[k].update, ext, op)
          if (checkUpdateRes === false) return false
        } else {
          for (let index = 0; index < item[k].length; index++) {
            ext.permType = 'CREATE'
            const checkCreateRes = await checkItem(
              check,
              item[k][index].create,
              ext,
              op,
            )
            if (checkCreateRes === false) return false
            ext.permType = 'UPDATE'
            const checkUpdateRes = await checkItem(
              check,
              item[k][index].update,
              ext,
              op,
            )
            if (checkUpdateRes === false) return false
          }
        }
      }
    }

    return true
  }

  async function setPermValuesOneLevel(data, ext) {
    const modelPerm = modelPermByType(rolePerms, ext.model, ext.permType)
    if (modelPerm?.def?.set) {
      const permSet = await getCtxValuesForPerm(modelPerm.def.set, ctx, data)
      data = merge(data, permSet)
    }
    return data
  }

  async function checkItemACL(data, ext) {
    const modelPerm = modelPermByType(rolePerms, ext.model, ext.permType)
    if (modelPerm?.def?.check) {
      const permCheck = await getCtxValuesForPerm(modelPerm.def.check, ctx)
      const checkResult = await checkItem(permCheck, data, ext)
      if (!checkResult) {
        throw new Error(
          `The item/s not exist or you don't have permission to ${ext.permType} it`,
        )
      }
    }
    return true
  }

  async function mergeModelCheckWithWhere(where, ext) {
    const modelPerm = modelPermByType(rolePerms, ext.model, ext.permType)
    if (modelPerm?.def?.check) {
      const permCheck = await getCtxValuesForPerm(modelPerm.def.check, ctx)
      where = mergeCheckWithWhere(where, permCheck)
    }
    return where
  }

  async function setPermValues(data, ext) {
    const itemOps = [
      'create',
      'update',
      'createMany',
      'updateMany',
      'connectOrCreate',
      'upsert',
    ]
    data = await setPermValuesOneLevel(data, ext)
    for (const key in data) {
      if (
        data[key] &&
        typeof data[key] === 'object' &&
        Object.keys(data[key]).some((someKey) => itemOps.includes(someKey))
      ) {
        const relModel = getNestedFieldModelName(ext.model, key)
        for (const op in data[key]) {
          if (op === 'create') {
            const relExt = {
              model: relModel,
              permType: 'CREATE',
            }
            if (!Array.isArray(data[key][op])) {
              data[key][op] = await setPermValuesOneLevel(data[key][op], relExt)
              data[key][op] = await setPermValues(data[key][op], relExt)
            } else {
              for (let index = 0; index < data[key][op].length; index++) {
                data[key][op][index] = await setPermValuesOneLevel(
                  data[key][op][index],
                  relExt,
                )
                data[key][op][index] = await setPermValues(
                  data[key][op][index],
                  relExt,
                )
              }
            }
          } else if (op === 'update') {
            const relExt = {
              model: relModel,
              permType: 'UPDATE',
            }
            if (!Array.isArray(data[key][op])) {
              data[key][op].data = await setPermValuesOneLevel(
                data[key][op].data,
                relExt,
              )
              data[key][op].data = await setPermValues(
                data[key][op].data,
                relExt,
              )
            } else {
              for (let index = 0; index < data[key][op].length; index++) {
                data[key][op][index].data = await setPermValuesOneLevel(
                  data[key][op][index].data,
                  relExt,
                )
                data[key][op][index].data = await setPermValues(
                  data[key][op][index].data,
                  relExt,
                )
              }
            }
          } else if (op === 'createMany') {
            for (let index = 0; index < data[key][op].data.length; index++) {
              data[key][op].data[index] = await setPermValuesOneLevel(
                data[key][op].data[index],
                {
                  model: relModel,
                  permType: 'CREATE',
                },
              )
            }
          } else if (op === 'updateMany') {
            const relExt = {
              model: relModel,
              permType: 'UPDATE',
            }
            if (!Array.isArray(data[key][op])) {
              data[key][op].data = await setPermValuesOneLevel(
                data[key][op].data,
                relExt,
              )
            } else {
              for (let index = 0; index < data[key][op].length; index++) {
                data[key][op][index].data = await setPermValuesOneLevel(
                  data[key][op][index].data,
                  relExt,
                )
              }
            }
          } else if (op === 'connectOrCreate') {
            const relExt = {
              model: relModel,
              permType: 'CREATE',
            }
            if (!Array.isArray(data[key][op])) {
              data[key][op].create = await setPermValuesOneLevel(
                data[key][op].create,
                relExt,
              )
            } else {
              for (let index = 0; index < data[key][op].length; index++) {
                data[key][op][index].create = await setPermValuesOneLevel(
                  data[key][op][index].create,
                  relExt,
                )
              }
            }
          } else if (op === 'upsert') {
            if (!Array.isArray(data[key][op])) {
              data[key][op].create = await setPermValuesOneLevel(
                data[key][op].create,
                {
                  model: relModel,
                  permType: 'CREATE',
                },
              )
              data[key][op].update = await setPermValuesOneLevel(
                data[key][op].update,
                {
                  model: relModel,
                  permType: 'UPDATE',
                },
              )
            } else {
              for (let index = 0; index < data[key][op].length; index++) {
                data[key][op][index].create = await setPermValuesOneLevel(
                  data[key][op][index].create,
                  {
                    model: relModel,
                    permType: 'CREATE',
                  },
                )
                data[key][op][index].update = await setPermValuesOneLevel(
                  data[key][op][index].update,
                  {
                    model: relModel,
                    permType: 'UPDATE',
                  },
                )
              }
            }
          }
        }
      }
    }
    return data
  }

  async function checkNestedFieldsModelsACL(data, ext) {
    const itemOps = [
      'create',
      'update',
      'delete',
      'createMany',
      'updateMany',
      'deleteMany',
      'connectOrCreate',
      'upsert',
      'connect',
      'disconnect',
      'set',
    ]
    for (const key in data) {
      if (
        data[key] &&
        typeof data[key] === 'object' &&
        Object.keys(data[key]).some((someKey) => itemOps.includes(someKey))
      ) {
        const relModel = getNestedFieldModelName(ext.model, key)
        for (const op in data[key]) {
          if (op === 'create') {
            const relExt = {
              model: relModel,
              permType: 'CREATE',
            }
            if (!Array.isArray(data[key][op])) {
              await checkItemACL(data[key][op], relExt)
              data[key][op] = await checkNestedFieldsModelsACL(
                data[key][op],
                relExt,
              )
            } else {
              for (let index = 0; index < data[key][op].length; index++) {
                await checkItemACL(data[key][op][index], relExt)
                data[key][op][index] = await checkNestedFieldsModelsACL(
                  data[key][op][index],
                  relExt,
                )
              }
            }
          } else if (op === 'update') {
            const relExt = {
              model: relModel,
              permType: 'UPDATE',
            }

            if (!Array.isArray(data[key][op])) {
              if (data[key][op].where) {
                await checkModelItemsExist(data[key][op].where, ctx, relExt)
              }
              await checkItemACL(data[key][op].data, relExt)
              data[key][op].data = await checkNestedFieldsModelsACL(
                data[key][op].data,
                relExt,
              )
            } else {
              for (let index = 0; index < data[key][op].length; index++) {
                if (data[key][op][index].where) {
                  await checkModelItemsExist(
                    data[key][op][index].where,
                    ctx,
                    relExt,
                  )
                }
                await checkItemACL(data[key][op][index].data, relExt)
                data[key][op][index].data = await checkNestedFieldsModelsACL(
                  data[key][op][index].data,
                  relExt,
                )
              }
            }
          } else if (op === 'delete' && data[key][op].where) {
            const relExt = {
              model: relModel,
              permType: 'DELETE',
            }
            if (!Array.isArray(data[key][op])) {
              await checkModelItemsExist(data[key][op].where, ctx, relExt)
            } else {
              // Todo: make one where for the whole items instead of the loop
              for (let index = 0; index < data[key][op].length; index++) {
                await checkModelItemsExist(
                  data[key][op][index].where,
                  ctx,
                  relExt,
                )
              }
            }
          } else if (op === 'createMany') {
            for (let index = 0; index < data[key][op].length; index++) {
              await checkItemACL(data[key][op].data[index], {
                model: relModel,
                permType: 'CREATE',
              })
            }
          } else if (op === 'updateMany') {
            const relExt = {
              model: relModel,
              permType: 'UPDATE',
            }
            if (!Array.isArray(data[key][op])) {
              data[key][op].where = await mergeModelCheckWithWhere(
                data[key][op].where,
                relExt,
              )
            } else {
              for (let index = 0; index < data[key][op].length; index++) {
                data[key][op][index].where = await mergeModelCheckWithWhere(
                  data[key][op][index].where,
                  relExt,
                )
              }
            }
          } else if (op === 'deleteMany') {
            const relExt = {
              model: relModel,
              permType: 'DELETE',
            }
            if (!Array.isArray(data[key][op])) {
              data[key][op] = await mergeModelCheckWithWhere(
                data[key][op],
                relExt,
              )
            } else {
              for (let index = 0; index < data[key][op].length; index++) {
                data[key][op][index] = await mergeModelCheckWithWhere(
                  data[key][op][index],
                  relExt,
                )
              }
            }
          } else if (op === 'connectOrCreate') {
            const relExt = {
              model: relModel,
              permType: 'CREATE',
            }
            if (!Array.isArray(data[key][op])) {
              await checkConnectOrCreate(data[key][op], relExt)
            } else {
              for (let index = 0; index < data[key][op].length; index++) {
                await checkConnectOrCreate(data[key][op][index], relExt)
              }
            }
          } else if (op === 'upsert') {
            const relExt = {
              model: relModel,
              permType: 'CREATE',
            }
            if (!Array.isArray(data[key][op])) {
              await checkUpsert(data[key][op], relExt)
            } else {
              for (let index = 0; index < data[key][op].length; index++) {
                await checkUpsert(data[key][op][index], relExt)
              }
            }
          } else if (['connect', 'set', 'disconnect'].includes(op)) {
            if (op === 'disconnect' && typeof data[key][op] === 'boolean')
              continue
            const relExt = {
              model: relModel,
              permType: 'READ',
            }
            await checkModelItemsExist(data[key][op], ctx, relExt)
          }
        }
      }
    }
    return data
  }

  async function checkConnectOrCreate(item, ext) {
    await checkItemACL(item.create, ext)
    await checkItemExistBeforeAndAfterCheck(item, ext)
  }

  async function checkUpsert(item, ext) {
    await checkItemACL(item.create, ext)
    ext.permType = 'UPDATE'
    await checkItemExistBeforeAndAfterCheck(item, ext)
    await checkItemACL(item.update, ext)
  }

  async function checkItemExistBeforeAndAfterCheck(item, ext) {
    const modelPerm = modelPermByType(rolePerms, ext.model, ext.permType)
    if (modelPerm?.def?.check) {
      const itemExistsBeforeCheck = await itemsExist({}, item.where, ext.model)
      if (itemExistsBeforeCheck) {
        await checkModelItemsExist(item.where, ctx, ext)
      }
    }
  }

  async function mergeNestedModelCheckWithWhere(select, ext) {
    for (const key in select) {
      if (typeof select[key] === 'object' && select[key].select) {
        const relModel = getNestedFieldModelName(ext.model, key)
        if (relModel) {
          const isList = dmmf.datamodel.models
            .find((i) => i.name === ext.model)
            ?.fields?.find((f) => f.name === key)?.isList
          if (isList) {
            const modelPerm = modelPermByType(rolePerms, relModel, 'READ')
            if (modelPerm?.def?.check) {
              if (!select[key].where) {
                select[key].where = {}
              }
              const permCheck = await getCtxValuesForPerm(
                modelPerm.def.check,
                ctx,
              )
              select[key].where = mergeCheckWithWhere(
                select[key].where,
                permCheck,
              )
            }
          }
          select[key].select = await mergeNestedModelCheckWithWhere(
            select[key].select,
            {
              model: relModel,
              permType: 'READ',
            },
          )
        }
      }
    }

    return select
  }

  return resolve(root, args, ctx, info)
}

function modelPermByType(perms, model, permType) {
  if (!perms) return
  return perms.find((item) => item.model === model && item.type === permType)
}

async function getCtxValuesForPerm(value, ctx, data?) {
  const flatPermVal = flatten(value)
  for (const key of Object.keys(flatPermVal)) {
    if (flatPermVal[key] === 'ctx-userId') {
      flatPermVal[key] = ctx.user.id
    } else if (
      typeof flatPermVal[key] === 'string' &&
      flatPermVal[key].startsWith('ctx-fn-') &&
      ctx.fns?.[flatPermVal[key].slice(7)]
    ) {
      const ctxFn = ctx.fns[flatPermVal[key].slice(7)]
      flatPermVal[key] = await ctxFn(ctx, data, key)
    }
  }
  return unflatten(flatPermVal)
}

function uniqueWhereToManyWhere(where) {
  const finalWhere = {}
  Object.keys(where).forEach((key) => {
    finalWhere[key] = { equals: where[key] }
  })
  return finalWhere
}

export function mergeCheckWithWhere(where, check) {
  if (where === undefined) return check
  if (where.AND) {
    where.AND.push(check)
  } else {
    where.AND = [check]
  }
  return where
}

function getNestedFieldModelName(model, fieldName) {
  return dmmf.datamodel.models
    .find((i) => i.name === model)
    ?.fields?.find((f) => f.name === fieldName)?.type
}

async function itemsExist(check, item, model) {
  let originalWhere
  if (!Array.isArray(item)) {
    originalWhere = uniqueWhereToManyWhere(item)
    const finalWhere = mergeCheckWithWhere(originalWhere, check)
    const finalItems = await prisma[camelCase(model)]
      .count({
        where: finalWhere,
      })
      .catch((err) => {
        console.error(err)
      })
    if (!finalItems) return false
  } else {
    originalWhere = { OR: [] }
    item.forEach((i) => {
      const andWhere = uniqueWhereToManyWhere(i)
      originalWhere.OR.push(andWhere)
    })

    const originalItems = await prisma[camelCase(model)]
      .count({
        where: originalWhere,
      })
      .catch((err) => {
        console.error(err)
      })
    const finalWhere = mergeCheckWithWhere(originalWhere, check)
    const finalItems = await prisma[camelCase(model)]
      .count({
        where: finalWhere,
      })
      .catch((err) => {
        console.error(err)
      })

    if (!finalItems || finalItems < originalItems) return false
  }

  return true
}

export async function checkModelItemsExist(data, ctx, ext, thrw = true) {
  const rolePerms = await getRolePerms(ctx.user.role)
  const modelPerm = modelPermByType(rolePerms, ext.model, ext.permType)
  if (modelPerm?.def?.check) {
    const permCheck = await getCtxValuesForPerm(modelPerm.def.check, ctx)
    const existingTtem = await itemsExist(permCheck, data, ext.model)
    if (!existingTtem && thrw) {
      throw new Error(
        `The item/s not exist or you don't have permission to ${ext.permType} it`,
      )
    } else if (!existingTtem && !thrw) {
      return false
    }
  }
  return true
}
