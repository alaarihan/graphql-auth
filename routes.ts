import { verify } from 'jsonwebtoken'
import { setTokenCookie } from '../../common/getUserFromRequest'
import { prisma } from '../../prisma'

module.exports = function (fastify, opts, done) {
  fastify.get('/verify-email/:email/:token', async (req, reply) => {
    const token = req.params.token
    const email = req.params.email
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return reply
        .status(400)
        .send(`No account found for this email address: ${email}`)
    }
    const verificationToken = user.verificationToken
      ? verify(user.verificationToken, process.env.JWT_SECRET)
      : false
    if (!verificationToken) return reply.status(400).send('Invalid token!')
    if (
      user.role === 'UNVERIFIED' &&
      verificationToken.token === token &&
      verificationToken.type === 'email'
    ) {
      await prisma.user.update({
        where: {
          email,
        },
        data: {
          role: 'USER',
          verificationToken: null,
        },
      })
      setTokenCookie({ id: user.id, role: 'USER' }, reply)
    } else {
      return reply.status(400).send('Invalid token or email already verified!')
    }
    return reply.status(200).send('Email has been verified successfully.')
  })
  done()
}
