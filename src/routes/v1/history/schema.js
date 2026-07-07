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
    },
  },
}
