export const jwtAuth = async (resolve, root, args, context, info) => {
  const types = ['Query', 'Mutation']
  const byPassList = [
    'login',
    'signup',
    'verifyUserEmail',
    'forgotPassword',
    'resetUserPassword',
  ]
  if (
    types.includes(info.path.typename) &&
    !byPassList.includes(info.fieldName)
  ) {
    if (!context.user) {
      throw new Error('Not logged in!')
    }
  }
  return resolve(root, args, context, info)
}
