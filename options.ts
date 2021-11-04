const conf = require('../conf')
const options = conf.options || {}
if (!options.dir) {
  options.dir = 'src'
}
if (!options.queryMap) {
  options.queryMap = {
    findUnique(type) {
      return 'findUnique' + type
    },
    findFirst(type) {
      return 'findFirst' + type
    },
    findMany(type) {
      return 'findMany' + type
    },
    count(type) {
      return 'count' + type
    },
    aggregate(type) {
      return 'aggregate' + type
    },
    createOne(type) {
      return 'createOne' + type
    },
    updateOne(type) {
      return 'updateOne' + type
    },
    deleteOne(type) {
      return 'deleteOne' + type
    },
    upsertOne(type) {
      return 'upsertOne' + type
    },
    createMany(type) {
      return 'createMany' + type
    },
    updateMany(type) {
      return 'updateMany' + type
    },
    deleteMany(type) {
      return 'deleteMany' + type
    },
    subscription(type) {
      return toCamelCase(type)
    },
  }
}

export default options
