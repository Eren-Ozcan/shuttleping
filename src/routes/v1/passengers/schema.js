const uuidParam = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
}

export const listPassengersSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      stopId: { type: 'string', format: 'uuid' },
      active: { type: 'boolean' },
    },
  },
}

export const createPassengerSchema = {
  body: {
    type: 'object',
    required: ['stopId', 'fullName'],
    additionalProperties: false,
    properties: {
      stopId: { type: 'string', format: 'uuid' },
      fullName: { type: 'string', minLength: 2, maxLength: 100 },
      phone: { type: 'string', maxLength: 20 },
      telegramChatId: { type: 'string', maxLength: 32 },
      notificationChannel: { type: 'string', enum: ['telegram', 'sms'] },
      notifyBeforeMinutes: { type: 'integer', minimum: 1, maximum: 120 },
    },
  },
}

export const updatePassengerSchema = {
  params: uuidParam,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      stopId: { type: 'string', format: 'uuid' },
      fullName: { type: 'string', minLength: 2, maxLength: 100 },
      phone: { type: 'string', maxLength: 20 },
      telegramChatId: { type: 'string', maxLength: 32 },
      notificationChannel: { type: 'string', enum: ['telegram', 'sms'] },
      notifyBeforeMinutes: { type: 'integer', minimum: 1, maximum: 120 },
      isActive: { type: 'boolean' },
    },
  },
}
