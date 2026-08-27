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
        paymentStatus: { type: 'string' },
        lastPaymentDate: { type: ['string', 'null'] },
        nextDueDate: { type: ['string', 'null'] },
        maxPassengers: { type: ['integer', 'null'] },
        dryRun: { type: 'boolean' },
        createdAt: { type: 'string' },
      },
    },
  },
}

export const updatePaymentStatusSchema = {
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
    required: ['paymentStatus'],
    additionalProperties: false,
    properties: {
      paymentStatus: { type: 'string', enum: ['active', 'overdue', 'suspended'] },
      // Sadece paymentStatus: 'active' ile birlikte anlamlı; verilmezse +30 gün varsayılır
      nextDueDate: { type: 'string', format: 'date-time' },
      // 'active' ile birlikte ödeme defterine kayıt düşer
      amount: { type: 'number', minimum: 0 },
      note: { type: 'string', maxLength: 500 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        slug: { type: 'string' },
        isActive: { type: 'boolean' },
        paymentStatus: { type: 'string' },
        lastPaymentDate: { type: ['string', 'null'] },
        nextDueDate: { type: ['string', 'null'] },
        maxPassengers: { type: ['integer', 'null'] },
        dryRun: { type: 'boolean' },
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

export const updateCompanySchema = {
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
    minProperties: 1,
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 100 },
      isActive: { type: 'boolean' },
      // null = sınırsız
      maxPassengers: { type: ['integer', 'null'], minimum: 1 },
      // Prova modu: bu şirketin bildirimleri gerçekten gönderilmez
      dryRun: { type: 'boolean' },
    },
  },
}

export const listPaymentsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
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
