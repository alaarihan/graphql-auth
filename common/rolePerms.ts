import NodeCache from 'node-cache'
import { prisma } from '../../../prisma'
export const rolePermsCache = new NodeCache()

export async function getRolePerms(role): Promise<any> {
  if (rolePermsCache.get(role) === undefined) {
    await prisma.permission
      .findMany({
        where: {
          role: { equals: role },
          active: { equals: true },
        },
      })
      .then((res) => {
        rolePermsCache.set(role, res)
      })
      .catch((err) => {
        console.error(err)
        throw new Error('Could not get the role permissions!')
      })
  }

  return rolePermsCache.get(role)
}
