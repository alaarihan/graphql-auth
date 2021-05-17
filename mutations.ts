import {
  GraphQLBoolean,
  GraphQLNonNull,
  GraphQLString,
  GraphQLObjectType,
  GraphQLInputObjectType,
} from 'graphql'
import { hash, compare } from 'bcrypt'
import { sign, verify } from 'jsonwebtoken'
import { User } from '../../models/User/type'
import { GraphQLDateTime, GraphQLEmailAddress } from 'graphql-scalars'
import { generateToken } from './common/generateToken'
import path from 'path'
import { sendEmail } from './common/sendEmail'

export const AuthPayload = new GraphQLObjectType({
  name: 'AuthPayload',
  fields: () => ({
    token: {
      type: new GraphQLNonNull(GraphQLString),
    },
    user: {
      type: new GraphQLNonNull(User),
    },
  }),
})

export const UserSignupInput = new GraphQLInputObjectType({
  name: 'UserSignupInput',
  fields: () => ({
    email: { type: new GraphQLNonNull(GraphQLEmailAddress) },
    firstName: { type: GraphQLString },
    lastName: { type: GraphQLString },
    password: { type: new GraphQLNonNull(GraphQLString) },
    country: { type: GraphQLString },
    dateOfBirth: { type: GraphQLDateTime },
  }),
})

export const authMutations = {
  signup: {
    type: new GraphQLNonNull(AuthPayload),
    args: {
      data: { type: new GraphQLNonNull(UserSignupInput) },
    },
    async resolve(_root, args, ctx) {
      args.data.password = await hash(args.data.password, 10).then(function (
        hash,
      ) {
        return hash
      })
      const generatedToken = generateToken()
      args.data.verificationToken = sign(
        { token: generatedToken, created: new Date(), type: 'email' },
        process.env.APP_SECRET,
        {
          expiresIn: '1d',
        },
      )
      delete args.select
      const user = await ctx.prisma.user
        .create({ data: args.data })
        .catch((err) => {
          throw err
        })
      sendEmail
        .send({
          template: 'signup',
          message: {
            to: args.data.email,
            attachments: [
              {
                filename: 'logo.png',
                path: path.resolve('src/auth/src/email-templates/imgs/logo.png'),
                cid: 'logo',
              },
            ],
          },
          locals: {
            user,
            token: generatedToken,
            url: process.env.API_URL,
          },
        })
        .catch(async (err) => {
          await ctx.prisma.user
            .delete({ where: { id: user.id } })
            .catch((err) => {
              throw err
            })
          throw err
        })
      delete user.password
      delete user.verificationToken
      return {
        token: sign({ id: user.id, role: user.role }, process.env.APP_SECRET, {
          expiresIn: '30d',
        }),
        user,
      }
    },
  },
  login: {
    type: new GraphQLNonNull(AuthPayload),
    args: {
      email: { type: new GraphQLNonNull(GraphQLEmailAddress) },
      password: { type: new GraphQLNonNull(GraphQLString) },
    },
    async resolve(_root, args, ctx) {
      const user = await ctx.prisma.user.findUnique({
        where: { email: args.email },
      })
      if (!user) {
        throw new Error(`No account found for this email: ${args.email}`)
      }
      const passwordValid = await compare(args.password, user.password)
      if (!passwordValid) {
        throw new Error('Invalid password')
      }
      delete user.password
      delete user.verificationToken
      return {
        token: sign({ id: user.id, role: user.role }, process.env.APP_SECRET, {
          expiresIn: '30d',
        }),
        user,
      }
    },
  },
  forgotPassword: {
    type: GraphQLBoolean,
    args: {
      email: { type: new GraphQLNonNull(GraphQLEmailAddress) },
    },
    async resolve(_root, { email }, ctx) {
      let user = await ctx.prisma.user
        .findUnique({ where: { email } })
        .catch((err) => undefined)
      if (!user) {
        throw new Error('Account not exists!')
      }
      const generatedToken = generateToken()
      const verificationToken = sign(
        { token: generatedToken, created: new Date(), type: 'password' },
        process.env.APP_SECRET,
        {
          expiresIn: '1d',
        },
      )

      user = await ctx.prisma.user.update({
        where: { email },
        data: { verificationToken },
      })
      sendEmail
        .send({
          template: 'forgotPassword',
          message: {
            to: email,
            attachments: [
              {
                filename: 'logo.png',
                path: path.resolve('src/email-templates/imgs/logo.png'),
                cid: 'logo',
              },
            ],
          },
          locals: {
            user,
            token: generatedToken,
            url: process.env.API_URL,
          },
        })
        .catch((err) => {
          throw err
        })
      return true
    },
  },
  resetUserPassword: {
    type: new GraphQLNonNull(User),
    args: {
      email: { type: new GraphQLNonNull(GraphQLEmailAddress) },
      token: { type: new GraphQLNonNull(GraphQLString) },
      password: { type: new GraphQLNonNull(GraphQLString) },
    },
    async resolve(_root, { email, token, password }, ctx) {
      const user = await ctx.prisma.user.findUnique({ where: { email } })
      if (!user) {
        throw new Error(`No account found for this email address: ${email}`)
      }

      if (user.role === 'UNVERIFIED') {
        throw new Error('Verify your email first!')
      }
      const hashedPassword = await hash(password, 10).then(function (hash) {
        return hash
      })
      const verificationToken = user.verificationToken
        ? verify(user.verificationToken, process.env.APP_SECRET)
        : false
      if (!verificationToken) throw new Error('Invalid token!')
      if (
        verificationToken.token === token &&
        verificationToken.type === 'password'
      ) {
        await ctx.prisma.user.update({
          where: {
            email,
          },
          data: {
            password: hashedPassword,
            verificationToken: null,
          },
        })
      } else {
        throw new Error('Invalid link')
      }
      return true
    },
  },
}
