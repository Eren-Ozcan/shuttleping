export const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email', maxLength: 255 },
      password: { type: 'string', minLength: 8, maxLength: 128 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        accessToken: { type: 'string' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string' },
            fullName: { type: 'string' },
            companyId: { type: ['string', 'null'] },
          },
        },
      },
    },
  },
}

export const refreshSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        accessToken: { type: 'string' },
      },
    },
  },
}

export const logoutSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
      },
    },
  },
}
