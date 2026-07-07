export const createCompanySchema = {
  body: {
    type: 'object',
    required: ['name', 'slug'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 100 },
      // Sadece küçük harf, rakam, tire
      slug: { type: 'string', minLength: 2, maxLength: 50, pattern: '^[a-z0-9-]+$' },
    },
  },
  response: {
    201: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        slug: { type: 'string' },
        isActive: { type: 'boolean' },
        createdAt: { type: 'string' },
      },
    },
  },
}

export const createCompanyAdminSchema = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    required: ['email', 'password', 'fullName'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email', maxLength: 254 },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      fullName: { type: 'string', minLength: 2, maxLength: 100 },
      phone: { type: 'string', minLength: 7, maxLength: 20 },
    },
  },
}

export const listCompaniesSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      active: { type: 'boolean' },
    },
  },
}
