// For super_admin support access (E12): which tenant's data to read.
// Must be declared in the schema, otherwise removeAdditional strips it.
const supportCompanyId = { companyId: { type: 'string', format: 'uuid' } }

const dateTimeRange = {
  from: { type: 'string', format: 'date-time' },
  to: { type: 'string', format: 'date-time' },
}

export const locationHistorySchema = {
  params: {
    type: 'object',
    required: ['routeId'],
    additionalProperties: false,
    properties: {
      routeId: { type: 'string', format: 'uuid' },
    },
  },
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...dateTimeRange,
      limit: { type: 'integer', minimum: 1, maximum: 2000, default: 500 },
      ...supportCompanyId,
    },
  },
}

export const notificationHistorySchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...dateTimeRange,
      passengerId: { type: 'string', format: 'uuid' },
      status: { type: 'string', enum: ['sent', 'failed'] },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
      ...supportCompanyId,
    },
  },
}
