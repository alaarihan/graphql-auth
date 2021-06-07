import NodeCache from 'node-cache'
import { prisma } from '../../../prisma'
export const rolePermsCache = new NodeCache()

export async function getRolePerms(role) {
  if (rolePermsCache.get(role) === undefined) {
    await prisma.permission
      .findMany({
        where: {
          role: { equals: role },
        },
      })
      .then((res) => {
        rolePermsCache.set(role, res)
      })
      .catch((err) => {
        console.log(err)
        throw new Error('Something wrong happened!')
      })
  }

  return rolePermsCache.get(role)
}
