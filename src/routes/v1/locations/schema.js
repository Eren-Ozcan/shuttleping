export const ingestLocationSchema = {
  body: {
    type: 'object',
    required: ['lat', 'lng'],
    additionalProperties: false,
    properties: {
      lat: { type: 'number', minimum: -90, maximum: 90 },
      lng: { type: 'number', minimum: -180, maximum: 180 },
      heading: { type: 'number', minimum: 0, maximum: 360 },
      speed: { type: 'number', minimum: 0 },
      // Offline buffer flush'ında gerçek yakalanma anı (ISO); yoksa now()
      recordedAt: { type: 'string', format: 'date-time' },
    },
  },
}

export const getLocationSchema = {
  params: {
    type: 'object',
    required: ['routeId'],
    additionalProperties: false,
    properties: {
      routeId: { type: 'string', format: 'uuid' },
    },
  },
}

export const getEtaSchema = getLocationSchema

export const streamTicketSchema = getLocationSchema

export const streamSchema = {
  params: getLocationSchema.params,
  querystring: {
    type: 'object',
    required: ['ticket'],
    additionalProperties: false,
    properties: {
      // EventSource header taşıyamaz. Access token yerine tek kullanımlık,
      // kısa ömürlü bilet gönderilir — access token URL'e, proxy loglarına
      // ve Referer'a hiç girmez (D2).
      ticket: { type: 'string', minLength: 16, maxLength: 128 },
    },
  },
}
