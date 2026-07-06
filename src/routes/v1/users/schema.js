const uuidParam = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
}

export const listUsersSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      role: { type: 'string', enum: ['company_admin', 'driver'] },
      active: { type: 'boolean' },
    },
  },
}

export const createUserSchema = {
  body: {
    type: 'object',
    required: ['email', 'password', 'fullName', 'role'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email', maxLength: 255 },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      fullName: { type: 'string', minLength: 2, maxLength: 100 },
      phone: { type: 'string', maxLength: 20 },
      role: { type: 'string', enum: ['company_admin', 'driver'] },
    },
  },
}

export const updateUserSchema = {
  params: uuidParam,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      fullName: { type: 'string', minLength: 2, maxLength: 100 },
      phone: { type: 'string', maxLength: 20 },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      isActive: { type: 'boolean' },
    },
  },
}
