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
    // consentGiven required (T2.4): docs/KVKK-AYDINLATMA-METNI.md is the
    // disclosure text shown to the passenger before this checkbox is ticked
    // in the panel — the API is the enforcement point, not just the UI
    required: ['stopId', 'fullName', 'consentGiven'],
    additionalProperties: false,
    properties: {
      stopId: { type: 'string', format: 'uuid' },
      fullName: { type: 'string', minLength: 2, maxLength: 100 },
      phone: { type: 'string', maxLength: 20 },
      telegramChatId: { type: 'string', maxLength: 32 },
      notificationChannel: { type: 'string', enum: ['telegram', 'sms'] },
      notifyBeforeMinutes: { type: 'integer', minimum: 1, maximum: 120 },
      consentGiven: { type: 'boolean', const: true },
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
