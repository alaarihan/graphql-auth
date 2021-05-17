import Email from 'email-templates'

export const sendEmail = new Email({
  message: {
    from: process.env.MAIL_FROM,
  },
  transport: {
    secure: false,
    host: process.env.MAIL_HOST,
    port: process.env.MAIL_PORT,
    auth: {
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD,
    },
  },
  views: {
    root: './src/auth/src/email-templates',
    options: {
      extension: 'ejs',
    },
  },
})
