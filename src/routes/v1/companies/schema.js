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

export const listCompaniesSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      active: { type: 'boolean' },
    },
  },
}
