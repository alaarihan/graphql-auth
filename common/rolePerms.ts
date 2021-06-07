import NodeCache from 'node-cache'
import { prisma } from '../../../prisma'
export const rolesPerms = new NodeCache()

export async function getRolePerms(role) {
  if (rolesPerms.get(role) === undefined) {
    await prisma.permission
      .findMany({
        where: {
          role: { equals: role },
        },
      })
      .then((res) => {
        rolesPerms.set(role, res)
      })
      .catch((err) => {
        console.log(err)
        throw new Error('Something wrong happened!')
      })
  }

  return rolesPerms.get(role)
}
